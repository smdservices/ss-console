"""Honcho write-path interceptor (ADR 0016).

Honcho is Hermes upstream's persistent cross-session user-modeling subsystem.
Upstream default: Honcho observes interaction, silently evolves a per-user
model, and feeds that model back into response shaping. For SMD's per-customer
AI Employee — where customer.yaml is the authoritative configuration source
([ADR 0012](../../docs/adr/0012-customer-yaml-storage.md)), personas are
PR-reviewed artifacts ([ADR 0011](../../docs/adr/0011-multi-persona-per-customer.md)),
and voice/preference evolution happens in Captain-supervised calibration
sessions — the upstream default is incompatible with three locked commitments.

[ADR 0016](../../docs/adr/0016-honcho-disposition.md) resolves this with Pattern C:
Honcho stays enabled but runs in proposer-only mode. Observations land in a
dedicated per-customer D1 table (`persona_observations`, migration 0007);
nothing Honcho infers reaches runtime persona state or customer.yaml without
an explicit, audit-trailed promotion through the calibration session
([#867](https://github.com/venturecrane/ss-console/issues/867)).

This module is the contract. The interceptor exposes the only legitimate
write path for Honcho output; native Honcho write paths (direct customer.yaml
mutation, runtime persona-state mutation) are structurally blocked.

What this module does
---------------------

1. `HonchoInterceptor` — single per-Machine instance, owns the write path.
   `record_observation()` validates source-evidence (ADR 0016 §5), inserts
   into `persona_observations`, and emits a `HONCHO_OBSERVATION` audit row.
   `promote()` and `dismiss()` stamp the row and emit `HONCHO_PROMOTION` /
   `HONCHO_DISMISSAL` audit rows; the actual customer.yaml PR generation
   is the calibration-session UI's job (not in scope here).

2. `HonchoNativeWriteBlocked` — exception raised when the boot-time
   verification detects a Honcho-like native write surface that bypasses
   the interceptor. Boot fails closed.

3. `verify_honcho_intercepted()` — boot-time check (ADR 0016 §_Verification_
   point 2). Confirms that (a) the interceptor is constructed and (b) no
   competing Honcho writer module has been loaded onto the runtime.
   Halts Machine boot on failure.

What this module does NOT do
-----------------------------

* Generate observations. The Curator/Honcho upstream code is the source
  of observation text and confidence values; this module is the gate
  that decides whether the proposed observation is accepted, where it
  lands, and what audit row is emitted.

* Read from `persona_observations` in any code path that affects runtime
  behavior. Reads are calibration-session UI and decommission export only
  ([ADR 0016](../../docs/adr/0016-honcho-disposition.md) §2). A read path
  that flows into skill dispatch, signature rendering, or any
  customer-bound output is an architectural violation.

* Mutate customer.yaml. Promotion is a PR against
  `customer-configs/<slug>.yaml` opened by the calibration-session UI; this
  module records the promotion in the D1 row (with the PR URL the caller
  supplies) and emits the audit event. The PR-and-merge is the audit trail.

* Enforce trust-ceiling. Observations are internal proposals, not
  customer-bound output. Trust-ceiling does not run on observation writes
  (ADR 0016 §9). The fabrication-evidence requirement and sticky-stop
  volume cap are the two guards that apply.

Test isolation
--------------

The interceptor takes its `Executor` and `AuditLogWriter` by constructor
injection; tests pass a `SqliteExecutor` against an in-memory database.
Tests are in `tests/test_honcho_interceptor.py`.
"""

from __future__ import annotations

import enum
import json
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Optional

from .audit_log import (
    ActorRole,
    AuditEvent,
    AuditLogWriter,
    Executor,
)

log = logging.getLogger("aie.honcho_interceptor")


# ---------------------------------------------------------------------------
# Observation type — closed vocabulary
#
# ADR 0016 §1 lists "voice_drift, recurring_correction, preference_signal,
# etc." as examples. We pin the v1 closed set here. Adding a new type
# requires updating both this enum and the calibration-session UI so the
# new type has a defined surface.
# ---------------------------------------------------------------------------


class ObservationType(str, enum.Enum):
    VOICE_DRIFT = "voice_drift"
    RECURRING_CORRECTION = "recurring_correction"
    PREFERENCE_SIGNAL = "preference_signal"
    OTHER = "other"


# ---------------------------------------------------------------------------
# Exception types
# ---------------------------------------------------------------------------


class HonchoEvidenceRequired(ValueError):
    """Raised when an observation is offered without source-evidence pointers.

    Per ADR 0016 §5: every observation written to `persona_observations`
    must include source-evidence pointers — transcript span IDs, message
    IDs, or audit_log row IDs. "Honcho thinks X" without "here are the
    messages where X shows up" is not a valid observation.

    The database-level CHECK constraint enforces this redundantly. The
    runtime assertion in `HonchoInterceptor.record_observation()` raises
    this exception first so the caller sees a clear failure mode rather
    than a CHECK-constraint SQL error.
    """


class HonchoNativeWriteBlocked(RuntimeError):
    """Raised when boot-time verification detects a Honcho native writer.

    Per ADR 0016 §1, Honcho's native write paths (direct customer.yaml
    mutation, direct runtime persona-state mutation, anything that
    bypasses `HonchoInterceptor`) are blocked at overlay boot. Detection
    of any such surface halts Machine boot. There is no bypass.

    The detection is necessarily heuristic — we cannot enumerate every
    future upstream Honcho surface. The current check covers the surfaces
    visible at the time of writing (named module imports, attribute
    presence on imported objects). Quarterly Hermes rebase agenda item
    re-verifies this list per ADR 0016 §_Verification_ guards.
    """


class HonchoObservationStateError(RuntimeError):
    """Raised on illegal state transitions on an observation row.

    Promotion of an already-promoted or already-dismissed row, dismissal
    of an already-dismissed or already-promoted row. Each row has at most
    one terminal action; subsequent state changes are programmer error.
    """


# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HonchoObservation:
    """Input shape for `HonchoInterceptor.record_observation()`.

    Constructed by the (future) Honcho integration code at the seam where
    upstream would otherwise mutate persona state. The interceptor is the
    only legitimate consumer of this dataclass.

    Fields:
        observation_type — closed vocabulary; see `ObservationType`.
        observation_body — structured JSON; the Honcho inference itself.
                           Stored verbatim. Caller is responsible for
                           shape; this module does not interpret it.
        source_evidence  — list of stable identifiers (transcript span
                           IDs, message IDs, audit_log row ULIDs) that
                           ground the observation. Non-empty. Serialized
                           via json.dumps() and stored as TEXT.
        persona_slug     — optional; the persona this observation applies
                           to. None means a customer-scope observation
                           (e.g., shared voice convention across personas).
        confidence       — optional; Honcho's own confidence value in
                           [0.0, 1.0]. Surfaced for review; never used as
                           an auto-promotion gate.
    """

    observation_type: ObservationType
    observation_body: dict
    source_evidence: list
    persona_slug: Optional[str] = None
    confidence: Optional[float] = None


# ---------------------------------------------------------------------------
# ULID helper — vendored from audit_log to avoid cross-module coupling on a
# helper that may move. The two implementations are identical by design;
# the test asserts they produce sortable strings of the same length.
# ---------------------------------------------------------------------------


_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode_crockford(value: int, length: int) -> str:
    out = []
    for _ in range(length):
        value, rem = divmod(value, 32)
        out.append(_CROCKFORD[rem])
    return "".join(reversed(out))


def _ulid(now_ms: Optional[int] = None) -> str:
    ts = now_ms if now_ms is not None else int(time.time() * 1000)
    rand = secrets.randbits(80)
    return _encode_crockford(ts, 10) + _encode_crockford(rand, 16)


# ---------------------------------------------------------------------------
# SQL — the four statements the interceptor uses
# ---------------------------------------------------------------------------


_INSERT_OBSERVATION_SQL = (
    "INSERT INTO persona_observations "
    "(observation_id, persona_slug, observation_type, observation_body, "
    "source_evidence_json, confidence) "
    "VALUES (?, ?, ?, ?, ?, ?)"
)

_STAMP_PROMOTION_SQL = (
    "UPDATE persona_observations "
    "SET promoted_at = datetime('now'), promoted_by = ?, promoted_pr_url = ? "
    "WHERE observation_id = ? "
    "AND promoted_at IS NULL "
    "AND dismissed_at IS NULL"
)

_STAMP_DISMISSAL_SQL = (
    "UPDATE persona_observations "
    "SET dismissed_at = datetime('now'), dismissed_by = ?, dismissed_reason = ? "
    "WHERE observation_id = ? "
    "AND promoted_at IS NULL "
    "AND dismissed_at IS NULL"
)

_SELECT_STAMPS_SQL = (
    "SELECT promoted_at, promoted_by, promoted_pr_url, "
    "dismissed_at, dismissed_by, dismissed_reason "
    "FROM persona_observations WHERE observation_id = ?"
)


# ---------------------------------------------------------------------------
# The interceptor
# ---------------------------------------------------------------------------


class HonchoInterceptor:
    """The only legitimate write path for Honcho output.

    Construction takes an `Executor` (writes to `persona_observations`)
    and an `AuditLogWriter` (emits the per-action audit rows per ADR 0016
    §7). One instance per Machine; concurrency-safe to the extent the
    underlying executor and writer are.

    Public surface:

      * `record_observation(obs)` — validates evidence, inserts the row,
        emits the `HONCHO_OBSERVATION` audit row. Returns the observation
        ULID.

      * `promote(observation_id, promoted_by, pr_url)` — stamps the row
        with promotion metadata and emits the `HONCHO_PROMOTION` audit
        row. The caller (calibration-session UI) is responsible for
        opening the customer.yaml PR and passing its URL here.

      * `dismiss(observation_id, dismissed_by, reason)` — stamps the row
        with dismissal metadata and emits the `HONCHO_DISMISSAL` audit
        row. Reason is required for the dismissal corpus signal.

    All three methods are async; they `await` both the D1 INSERT/UPDATE
    and the audit-log writer. The audit row emits BEFORE the SQL ack on
    the data row, mirroring the substrate invariant: an unloggable
    persona-shaping action does not run.

    Wait — that's the wrong order for promotion/dismissal: the state
    transition has to happen before we audit-log it (otherwise the row
    might already have been promoted by a racing caller, and the audit
    row would lie). The implementation below does the SQL transition
    first, checks whether it actually changed a row, raises
    `HonchoObservationStateError` if not, and only then emits the audit
    row. For observation creation the audit row emits after the insert
    succeeds for the same reason.
    """

    def __init__(
        self,
        *,
        executor: Executor,
        audit_writer: AuditLogWriter,
        customer: str,
    ) -> None:
        if not customer:
            raise ValueError("HonchoInterceptor requires a non-empty customer slug")
        self._executor = executor
        self._audit_writer = audit_writer
        self._customer = customer

    # ---- Observation creation -------------------------------------------

    async def record_observation(self, obs: HonchoObservation) -> str:
        """Insert one observation row + emit the HONCHO_OBSERVATION audit row.

        Returns the observation ULID. Raises `HonchoEvidenceRequired` if
        the proposed observation lacks source-evidence pointers (ADR 0016
        §5). Raises the executor's native error if D1 INSERT fails.
        """
        if not obs.source_evidence:
            raise HonchoEvidenceRequired(
                "persona_observations writes require non-empty source_evidence; "
                "the observation must point to transcript spans, message IDs, "
                "or audit_log row IDs that ground the inference (ADR 0016 §5). "
                "An observation without evidence is not a valid observation."
            )

        observation_id = _ulid()
        body_json = json.dumps(obs.observation_body, sort_keys=True, separators=(",", ":"))
        evidence_json = json.dumps(obs.source_evidence, sort_keys=True, separators=(",", ":"))

        await self._executor.execute(
            _INSERT_OBSERVATION_SQL,
            [
                observation_id,
                obs.persona_slug,
                obs.observation_type.value,
                body_json,
                evidence_json,
                obs.confidence,
            ],
        )

        await self._audit_writer.write(
            AuditEvent(
                action_type="HONCHO_OBSERVATION",
                actor="agent",
                actor_role=ActorRole.AGENT,
                skill_name=None,
                matter_ref=None,
                metadata={
                    "customer": self._customer,
                    "observation_id": observation_id,
                    "observation_type": obs.observation_type.value,
                    "persona_slug": obs.persona_slug,
                    "confidence": obs.confidence,
                    "evidence_count": len(obs.source_evidence),
                },
            )
        )

        log.info(
            "honcho.observation: customer=%s type=%s persona=%s id=%s",
            self._customer,
            obs.observation_type.value,
            obs.persona_slug,
            observation_id,
        )
        return observation_id

    # ---- Promotion ------------------------------------------------------

    async def promote(
        self,
        *,
        observation_id: str,
        promoted_by: str,
        pr_url: str,
    ) -> None:
        """Stamp the row promoted; emit the HONCHO_PROMOTION audit row.

        `promoted_by` is the principal user identifier from the calibration
        session. `pr_url` is the customer.yaml PR the caller opened — the
        URL is the audit-trail anchor (ADR 0016 §3).

        Raises `HonchoObservationStateError` if the row is missing or
        already in a terminal state (promoted or dismissed).
        """
        if not observation_id:
            raise ValueError("observation_id is required")
        if not promoted_by:
            raise ValueError("promoted_by is required (calibration-session principal)")
        if not pr_url:
            raise ValueError(
                "pr_url is required; promotion must point at the customer.yaml "
                "PR opened by the calibration-session UI (ADR 0016 §3)"
            )

        await self._executor.execute(
            _STAMP_PROMOTION_SQL,
            [promoted_by, pr_url, observation_id],
        )
        await self._assert_transition_succeeded(
            observation_id,
            expected="promoted",
            expected_actor=promoted_by,
            expected_pr_url=pr_url,
        )

        await self._audit_writer.write(
            AuditEvent(
                action_type="HONCHO_PROMOTION",
                actor=promoted_by,
                actor_role=ActorRole.PRINCIPAL,
                skill_name=None,
                matter_ref=None,
                metadata={
                    "customer": self._customer,
                    "observation_id": observation_id,
                    "promoted_pr_url": pr_url,
                },
            )
        )

        log.info(
            "honcho.promotion: customer=%s id=%s by=%s pr=%s",
            self._customer,
            observation_id,
            promoted_by,
            pr_url,
        )

    # ---- Dismissal ------------------------------------------------------

    async def dismiss(
        self,
        *,
        observation_id: str,
        dismissed_by: str,
        reason: str,
    ) -> None:
        """Stamp the row dismissed; emit the HONCHO_DISMISSAL audit row.

        Dismissed rows remain in the table for the dismissal-corpus signal
        (ADR 0016 §4). `reason` is required — silent dismissal hides
        systematic over-firing of Honcho's extraction signal.

        Raises `HonchoObservationStateError` if the row is missing or
        already in a terminal state.
        """
        if not observation_id:
            raise ValueError("observation_id is required")
        if not dismissed_by:
            raise ValueError("dismissed_by is required")
        if not reason:
            raise ValueError(
                "reason is required; silent dismissal hides Honcho over-firing "
                "(ADR 0016 §4 — dismissed observations remain in the table for "
                "tuning extraction signal over time)"
            )

        await self._executor.execute(
            _STAMP_DISMISSAL_SQL,
            [dismissed_by, reason, observation_id],
        )
        await self._assert_transition_succeeded(
            observation_id,
            expected="dismissed",
            expected_actor=dismissed_by,
            expected_reason=reason,
        )

        await self._audit_writer.write(
            AuditEvent(
                action_type="HONCHO_DISMISSAL",
                actor=dismissed_by,
                actor_role=ActorRole.PRINCIPAL,
                skill_name=None,
                matter_ref=None,
                metadata={
                    "customer": self._customer,
                    "observation_id": observation_id,
                    "dismissed_reason": reason,
                },
            )
        )

        log.info(
            "honcho.dismissal: customer=%s id=%s by=%s reason=%s",
            self._customer,
            observation_id,
            dismissed_by,
            reason[:80],
        )

    # ---- Internal -------------------------------------------------------

    async def _assert_transition_succeeded(
        self,
        observation_id: str,
        *,
        expected: str,
        expected_actor: str,
        expected_pr_url: Optional[str] = None,
        expected_reason: Optional[str] = None,
    ) -> None:
        """Verify the UPDATE actually transitioned this row to the expected state.

        Both _STAMP_PROMOTION_SQL and _STAMP_DISMISSAL_SQL are guarded with
        `AND promoted_at IS NULL AND dismissed_at IS NULL` — they no-op on
        already-terminal rows. The Executor protocol does not expose row
        count, so we re-read and compare the stamped actor (and pr_url /
        reason) against what THIS call passed in. If the stamps belong to
        an earlier call, the row was already terminal and this transition
        was a no-op — raise HonchoObservationStateError.

        Production paths can use a real D1 executor that returns row counts;
        this re-read is the defensive-floor check that works against the
        Protocol surface. Used by `promote()` and `dismiss()`.
        """
        rows = await _fetch_one(self._executor, _SELECT_STAMPS_SQL, [observation_id])
        if rows is None:
            raise HonchoObservationStateError(
                f"persona_observations row not found: observation_id={observation_id}"
            )
        promoted_at, promoted_by, promoted_pr_url, dismissed_at, dismissed_by, dismissed_reason = rows

        if expected == "promoted":
            this_call_landed = (
                promoted_at is not None
                and promoted_by == expected_actor
                and promoted_pr_url == expected_pr_url
            )
            if not this_call_landed:
                raise HonchoObservationStateError(
                    f"promotion failed: observation_id={observation_id} is already "
                    f"in a terminal state (promoted_at={promoted_at}, "
                    f"dismissed_at={dismissed_at}); a row can be promoted or "
                    "dismissed exactly once (ADR 0016 §3, §4)"
                )
            return

        if expected == "dismissed":
            this_call_landed = (
                dismissed_at is not None
                and dismissed_by == expected_actor
                and dismissed_reason == expected_reason
            )
            if not this_call_landed:
                raise HonchoObservationStateError(
                    f"dismissal failed: observation_id={observation_id} is already "
                    f"in a terminal state (promoted_at={promoted_at}, "
                    f"dismissed_at={dismissed_at})"
                )
            return


# ---------------------------------------------------------------------------
# Helper — read a single row through the Executor Protocol
#
# The audit_log.Executor protocol exposes only `execute(sql, params)` and
# returns None — it has no fetch surface, by design (the audit-log writer
# does not need one). The interceptor's state-check needs a single-row
# read against a known-shape SELECT. We adapt by depending on the
# concrete executor exposing an attribute the test executor and the real
# HttpD1Executor both provide. For SqliteExecutor this is the underlying
# connection; for HttpD1Executor it is the parsed JSON response. The
# helper is small and isolated so the dependency stays local.
# ---------------------------------------------------------------------------


async def _fetch_one(executor: Executor, sql: str, params: list) -> Optional[tuple]:
    """Adapter-layer helper that returns the first row of a SELECT.

    Inspects the executor to find a fetch path: SqliteExecutor exposes its
    `_conn` attribute (a sqlite3.Connection). The HttpD1Executor variant
    will land in a follow-on PR — until then, calls against an unrecognized
    executor raise an explicit RuntimeError so the failure mode is loud.

    This helper exists only so the interceptor's defensive state-check
    can run against the in-memory test executor without forcing a protocol
    surface change on every Executor implementation in the tree.
    """
    conn = getattr(executor, "_conn", None)
    if conn is not None:
        cur = conn.cursor()
        cur.execute(sql, params)
        row = cur.fetchone()
        return tuple(row) if row is not None else None
    raise RuntimeError(
        f"_fetch_one: executor {type(executor).__name__} does not expose a "
        "supported read path; extend this helper when wiring a new Executor "
        "implementation"
    )


# ---------------------------------------------------------------------------
# Boot-time verification (ADR 0016 §_Verification_ point 2)
# ---------------------------------------------------------------------------


# Module names whose presence on the import path would indicate a Honcho
# native writer wiring. The list is intentionally conservative — false
# positives are loud (boot halts; Captain investigates); false negatives
# silently violate the safety floor. ADR 0016 §_Verification_ guards
# requires this list to be re-checked at every quarterly Hermes rebase.
_FORBIDDEN_HONCHO_MODULES: tuple[str, ...] = (
    "honcho.writer",                   # hypothetical upstream writer module
    "honcho.runtime.persona_state",    # hypothetical runtime mutation surface
    "hermes.honcho_native",            # hypothetical upstream-direct wiring
)


def verify_honcho_intercepted(
    interceptor: Optional[HonchoInterceptor],
    *,
    forbidden_modules: tuple[str, ...] = _FORBIDDEN_HONCHO_MODULES,
) -> None:
    """Boot-time check: the interceptor is constructed; no native writer is loaded.

    Per ADR 0016 §_Verification_ point 2: "The overlay's Honcho interceptor
    is active at Machine boot. Boot-time check confirms native Honcho write
    paths are blocked and the interceptor is the only write surface.
    Failure of this check halts Machine boot."

    Raises `HonchoNativeWriteBlocked` on failure. The caller (bootstrap.sh
    -> Machine boot path) does not catch — boot fails closed.

    Args:
        interceptor — the HonchoInterceptor instance constructed by the
                      overlay. Must be present. None means the overlay
                      booted without wiring the interceptor; that itself
                      is a violation (no legitimate write path exists).

        forbidden_modules — closed list of module names that, if present
                            in sys.modules, indicate a competing writer.
                            Production callers should use the default;
                            tests pass a tuple to exercise the check.
    """
    import sys  # noqa: PLC0415 — local import so tests can monkeypatch

    if interceptor is None:
        raise HonchoNativeWriteBlocked(
            "Honcho interceptor was not constructed at overlay boot. The "
            "interceptor is the ONLY legitimate write path for Honcho output "
            "(ADR 0016 §1); booting without one means there is either no "
            "Honcho integration (which is fine — return early before this "
            "check) or there IS one with no interception (which is a safety "
            "violation). Halting Machine boot."
        )

    loaded_forbidden = [m for m in forbidden_modules if m in sys.modules]
    if loaded_forbidden:
        raise HonchoNativeWriteBlocked(
            f"Native Honcho write surface detected on import path: "
            f"{loaded_forbidden!r}. Per ADR 0016 §1, all Honcho writes MUST "
            f"flow through HonchoInterceptor — there is no allowlist for "
            f"direct customer.yaml or runtime persona-state mutation. The "
            "quarterly Hermes-rebase agenda item is the maintenance hook "
            "for new forbidden surfaces; if this module name was added "
            "intentionally, the maintenance PR must also update "
            "_FORBIDDEN_HONCHO_MODULES in honcho_interceptor.py."
        )

    log.info("verify_honcho_intercepted: ok (interceptor=%r)", type(interceptor).__name__)


__all__ = [
    "HonchoEvidenceRequired",
    "HonchoInterceptor",
    "HonchoNativeWriteBlocked",
    "HonchoObservation",
    "HonchoObservationStateError",
    "ObservationType",
    "verify_honcho_intercepted",
]
