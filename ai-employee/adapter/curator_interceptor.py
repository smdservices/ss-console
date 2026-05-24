"""Skill Curator write-path interceptor (ADR 0017).

The Hermes upstream autonomous Skill Curator generates skill candidates from
execution traces, scores them on outcomes over a seven-day window, consolidates
overlapping definitions, and prunes underperformers — all autonomously. For
the upstream single-user local-deployment use case, where the operator IS the
developer and skill drift is self-experienced, this is a productivity feature.
For SMD's per-customer AI Employee, where reviewer-as-sender ([ADR 0005](../../docs/adr/0005-reviewer-as-sender.md))
puts a bar-licensed partner on the hook for whatever the AI Employee does,
autonomous skill mutation is uninsurable.

[ADR 0017](../../docs/adr/0017-skill-curator-disposition.md) resolves this
with Pattern C: the Curator runs in observer-only mode. The Curator's
observations land in a dedicated per-customer `skill_drafts` D1 table
(migration 0008). No skill is created, modified, consolidated, or pruned
inside a customer Machine. Every skill-catalog change is a PR against
`crane-console/.agents/skills/`, reviewed and merged per established skill
governance, reaching customer Machines only through the next content-hash-
pinned Hermes deploy.

What this module does
---------------------

1. `CuratorInterceptor` — single per-Machine instance, owns the write path.
   `record_draft()` validates source-evidence ([ADR 0017](../../docs/adr/0017-skill-curator-disposition.md) §6),
   inserts into `skill_drafts`, and emits a `CURATOR_DRAFT` audit row.
   `promote()` and `dismiss()` stamp the row and emit `CURATOR_PROMOTION` /
   `CURATOR_DISMISSAL` audit rows; the actual `crane-console` PR generation
   is the calibration-session UI's job (not in scope here).

2. `CuratorNativeWriteBlocked` — exception raised when boot-time verification
   detects a Curator-like native write surface that bypasses the interceptor
   (direct skill-file mutation, in-memory skill-set registration/deregistration).
   Boot fails closed.

3. `verify_curator_intercepted()` — boot-time check ([ADR 0017](../../docs/adr/0017-skill-curator-disposition.md) §_Verification_
   point 2). Confirms that (a) the interceptor is constructed and (b) no
   competing Curator writer module has been loaded onto the runtime.
   Halts Machine boot on failure.

The no-self-promotion commitment (ADR 0017 §10)
------------------------------------------------

Honcho ([ADR 0016](../../docs/adr/0016-honcho-disposition.md)) leaves a
Phase 2 question open: low-risk preference observations *might* one day
self-promote without partner review. The Curator does not. Skills are
executable behavior; the bar is absolute. This module enforces that
structurally: the only `promote()` code path requires an explicit Captain
identifier AND a `crane-console` PR URL the caller supplies — there is no
"auto-promote if curator_score > threshold" gate, never has been, and
adding one requires superseding ADR 0017 with explicit reasoning, not a
threshold tweak.

What this module does NOT do
-----------------------------

* Generate drafts. The Curator/upstream code is the source of draft text,
  scores, and overlap detection; this module is the gate that decides
  whether the proposed draft is accepted, where it lands, and what audit
  row is emitted.

* Read `skill_drafts` in any code path that affects runtime behavior.
  Reads are calibration-session UI and decommission export only
  ([ADR 0017](../../docs/adr/0017-skill-curator-disposition.md) §2). The
  runtime skill set is content-hash-pinned per
  [ADR 0007](../../docs/adr/0007-per-customer-machine-isolation.md) and
  immutable for the lifetime of that Machine pin — never sourced from
  this table.

* Mutate the skill catalog. Promotion is a PR against
  `crane-console/.agents/skills/` opened by the calibration-session UI;
  this module records the promotion in the D1 row (with the PR URL the
  caller supplies) and emits the audit event. The PR-and-merge plus the
  content-hash re-pin is the audit trail and the amplification gate.

* Enforce trust-ceiling. Drafts are internal proposals downstream of
  execution; trust-ceiling does not run on draft writes. The fabrication-
  evidence requirement (§6) and the sticky-stop volume cap (§7) are the
  two guards that apply (the latter is a follow-on outside this module).

* Reach across the customer boundary. Per
  [ADR 0009](../../docs/adr/0009-cross-machine-query-prohibition.md) and
  [ADR 0017](../../docs/adr/0017-skill-curator-disposition.md) §11, the
  Curator running in customer A's Machine cannot observe customer B's
  execution traces. Cross-customer skill-pattern discovery is a manual
  platform-team analytical task, not a Curator function.

Test isolation
--------------

The interceptor takes its `Executor` and `AuditLogWriter` by constructor
injection; tests pass a `SqliteExecutor` against an in-memory database.
Tests are in `tests/test_curator_interceptor.py`.
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

log = logging.getLogger("aie.curator_interceptor")


# ---------------------------------------------------------------------------
# Draft type — closed vocabulary
#
# ADR 0017 §1 enumerates four draft types. The closed enum is the contract:
# adding a new type requires updating both this enum and the calibration-
# session UI's promotion handler so the new type has a defined PR-generation
# shape (ADR 0017 §3 documents the four shapes).
# ---------------------------------------------------------------------------


class DraftType(str, enum.Enum):
    NEW_SKILL = "new_skill"
    CONSOLIDATION = "consolidation"
    PRUNE_RECOMMENDATION = "prune_recommendation"
    SCOPE_ADJUSTMENT = "scope_adjustment"


# Draft types that operate on an existing skill (target_skill_slug required).
# new_skill stands alone — it proposes a fresh SKILL.md and target_skill_slug
# is null.
_TYPES_REQUIRING_TARGET: frozenset = frozenset(
    {
        DraftType.CONSOLIDATION,
        DraftType.PRUNE_RECOMMENDATION,
        DraftType.SCOPE_ADJUSTMENT,
    }
)


# ---------------------------------------------------------------------------
# Exception types
# ---------------------------------------------------------------------------


class CuratorEvidenceRequired(ValueError):
    """Raised when a draft is offered without source-evidence pointers.

    Per ADR 0017 §6: every draft written to `skill_drafts` must include
    source-evidence pointers — execution-trace row IDs from the per-
    customer audit log, outcome scores, and the trace window the Curator
    analyzed. "The Curator thinks this is a good skill" without "here
    are the 47 execution traces it analyzed" is not a valid draft.

    The database-level CHECK constraint enforces this redundantly. The
    runtime assertion in `CuratorInterceptor.record_draft()` raises this
    exception first so the caller sees a clear failure mode rather than
    a CHECK-constraint SQL error.
    """


class CuratorTargetRequired(ValueError):
    """Raised when a draft that operates on an existing skill omits the target.

    Per ADR 0017 §1, `target_skill_slug` is required for consolidation,
    prune_recommendation, and scope_adjustment drafts. Only new_skill
    drafts may set it to None (because they propose a new SKILL.md, not
    a change to an existing one).
    """


class CuratorNativeWriteBlocked(RuntimeError):
    """Raised when boot-time verification detects a Curator native writer.

    Per ADR 0017 §1, the Curator's native write paths (direct skill-file
    mutation, in-memory skill-set mutation, skill registration /
    deregistration) are blocked at overlay boot. Detection of any such
    surface halts Machine boot. There is no bypass.

    The detection is necessarily heuristic — we cannot enumerate every
    future upstream Curator surface. The current check covers the surfaces
    visible at the time of writing (named module imports, attribute
    presence on imported objects). Quarterly Hermes rebase agenda item
    re-verifies this list per ADR 0017 §_Verification_ guards.
    """


class CuratorDraftStateError(RuntimeError):
    """Raised on illegal state transitions on a draft row.

    Promotion of an already-promoted or already-dismissed row, dismissal
    of an already-dismissed or already-promoted row. Each row has at most
    one terminal action; subsequent state changes are programmer error.
    """


# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SkillDraft:
    """Input shape for `CuratorInterceptor.record_draft()`.

    Constructed by the (future) Curator integration code at the seam where
    upstream would otherwise mutate the skill catalog. The interceptor is
    the only legitimate consumer of this dataclass.

    Fields:
        draft_type        — closed vocabulary; see `DraftType`.
        draft_body        — proposed SKILL.md markdown (for new_skill,
                            consolidation, scope_adjustment) or rationale
                            text (for prune_recommendation). Stored verbatim.
                            Caller is responsible for shape; this module
                            does not interpret it.
        source_evidence   — list of stable identifiers (execution-trace
                            row IDs, audit_log row ULIDs, outcome scores)
                            that ground the draft. Non-empty. Serialized
                            via json.dumps() and stored as TEXT.
        target_skill_slug — required for consolidation, prune, and scope
                            adjustment; must be None for new_skill.
        curator_score     — optional; the Curator's own grading value.
                            Surfaced for Captain review; NEVER an
                            auto-promotion gate (ADR 0017 §10).
    """

    draft_type: DraftType
    draft_body: str
    source_evidence: list
    target_skill_slug: Optional[str] = None
    curator_score: Optional[float] = None


# ---------------------------------------------------------------------------
# ULID helper — same shape as honcho_interceptor's; vendored to keep modules
# independent. Identical implementation.
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


_INSERT_DRAFT_SQL = (
    "INSERT INTO skill_drafts "
    "(draft_id, draft_type, target_skill_slug, draft_body, "
    "source_evidence_json, curator_score) "
    "VALUES (?, ?, ?, ?, ?, ?)"
)

_STAMP_PROMOTION_SQL = (
    "UPDATE skill_drafts "
    "SET promoted_at = datetime('now'), promoted_by = ?, promoted_pr_url = ? "
    "WHERE draft_id = ? "
    "AND promoted_at IS NULL "
    "AND dismissed_at IS NULL"
)

_STAMP_DISMISSAL_SQL = (
    "UPDATE skill_drafts "
    "SET dismissed_at = datetime('now'), dismissed_by = ?, dismissed_reason = ? "
    "WHERE draft_id = ? "
    "AND promoted_at IS NULL "
    "AND dismissed_at IS NULL"
)

_SELECT_STAMPS_SQL = (
    "SELECT promoted_at, promoted_by, promoted_pr_url, "
    "dismissed_at, dismissed_by, dismissed_reason "
    "FROM skill_drafts WHERE draft_id = ?"
)


# ---------------------------------------------------------------------------
# The interceptor
# ---------------------------------------------------------------------------


class CuratorInterceptor:
    """The only legitimate write path for Curator output.

    Construction takes an `Executor` (writes to `skill_drafts`) and an
    `AuditLogWriter` (emits the per-action audit rows per ADR 0017 §8).
    One instance per Machine; concurrency-safe to the extent the underlying
    executor and writer are.

    Public surface:

      * `record_draft(draft)` — validates evidence, validates target-slug
        requirement, inserts the row, emits `CURATOR_DRAFT` audit row.
        Returns the draft ULID.

      * `promote(draft_id, promoted_by, pr_url)` — stamps the row with
        promotion metadata and emits `CURATOR_PROMOTION` audit row. The
        caller (calibration-session UI) is responsible for opening the
        `crane-console/.agents/skills/` PR and passing its URL here. The
        PR URL is required; there is no auto-promotion path (ADR 0017 §10).

      * `dismiss(draft_id, dismissed_by, reason)` — stamps dismissal and
        emits `CURATOR_DISMISSAL` audit row. Reason is required for the
        dismissal-corpus signal (§4).

    All three methods are async. State-transition methods (promote /
    dismiss) do the SQL UPDATE first, then defensively re-read to confirm
    the transition landed on THIS call (not on a racing earlier call),
    then emit the audit row. record_draft emits the audit row after the
    INSERT succeeds for the same reason.
    """

    def __init__(
        self,
        *,
        executor: Executor,
        audit_writer: AuditLogWriter,
        customer: str,
    ) -> None:
        if not customer:
            raise ValueError("CuratorInterceptor requires a non-empty customer slug")
        self._executor = executor
        self._audit_writer = audit_writer
        self._customer = customer

    # ---- Draft creation -------------------------------------------------

    async def record_draft(self, draft: SkillDraft) -> str:
        """Insert one draft row + emit the CURATOR_DRAFT audit row.

        Returns the draft ULID. Raises:
          * `CuratorEvidenceRequired` if source-evidence is empty (§6)
          * `CuratorTargetRequired` if a consolidation / prune / scope draft
            omits `target_skill_slug`, or a new_skill draft sets it
          * the executor's native error if D1 INSERT fails
        """
        if not draft.source_evidence:
            raise CuratorEvidenceRequired(
                "skill_drafts writes require non-empty source_evidence; "
                "the draft must point to execution-trace row IDs, audit_log "
                "row IDs, and outcome scores that ground the proposal "
                "(ADR 0017 §6). A draft without evidence is not a valid draft."
            )

        if draft.draft_type in _TYPES_REQUIRING_TARGET and not draft.target_skill_slug:
            raise CuratorTargetRequired(
                f"draft_type={draft.draft_type.value} operates on an existing "
                f"skill; target_skill_slug is required (ADR 0017 §1). Only "
                "new_skill drafts may omit target_skill_slug."
            )

        if draft.draft_type == DraftType.NEW_SKILL and draft.target_skill_slug:
            raise CuratorTargetRequired(
                "draft_type=new_skill proposes a fresh SKILL.md and must NOT "
                "set target_skill_slug; the proposed slug belongs in draft_body "
                "frontmatter (ADR 0017 §3, new_skill shape)."
            )

        if not draft.draft_body:
            raise ValueError(
                "draft_body is required; an empty draft body has no value to "
                "review and no signal for the Curator's extraction tuning"
            )

        draft_id = _ulid()
        evidence_json = json.dumps(draft.source_evidence, sort_keys=True, separators=(",", ":"))

        await self._executor.execute(
            _INSERT_DRAFT_SQL,
            [
                draft_id,
                draft.draft_type.value,
                draft.target_skill_slug,
                draft.draft_body,
                evidence_json,
                draft.curator_score,
            ],
        )

        await self._audit_writer.write(
            AuditEvent(
                action_type="CURATOR_DRAFT",
                actor="agent",
                actor_role=ActorRole.AGENT,
                skill_name=draft.target_skill_slug,
                matter_ref=None,
                metadata={
                    "customer": self._customer,
                    "draft_id": draft_id,
                    "draft_type": draft.draft_type.value,
                    "target_skill_slug": draft.target_skill_slug,
                    "curator_score": draft.curator_score,
                    "evidence_count": len(draft.source_evidence),
                },
            )
        )

        log.info(
            "curator.draft: customer=%s type=%s target=%s id=%s",
            self._customer,
            draft.draft_type.value,
            draft.target_skill_slug,
            draft_id,
        )
        return draft_id

    # ---- Promotion ------------------------------------------------------

    async def promote(
        self,
        *,
        draft_id: str,
        promoted_by: str,
        pr_url: str,
    ) -> None:
        """Stamp the row promoted; emit the CURATOR_PROMOTION audit row.

        `promoted_by` is the Captain identifier from the calibration session.
        `pr_url` is the `crane-console/.agents/skills/` PR the caller opened
        — the URL is the audit-trail anchor (ADR 0017 §3).

        No auto-promotion path exists; both identifiers are required by the
        method signature. Per ADR 0017 §10, the Curator never self-promotes;
        the structural enforcement is that this is the ONLY promotion code
        path and it requires real values from the calibration-session UI.

        Raises `CuratorDraftStateError` if the row is missing or already
        in a terminal state.
        """
        if not draft_id:
            raise ValueError("draft_id is required")
        if not promoted_by:
            raise ValueError(
                "promoted_by is required (Captain identifier from calibration "
                "session); ADR 0017 §10 — the Curator NEVER self-promotes, "
                "every promotion has a named human actor"
            )
        if not pr_url:
            raise ValueError(
                "pr_url is required; promotion must point at the "
                "crane-console/.agents/skills/ PR opened by the "
                "calibration-session UI (ADR 0017 §3)"
            )

        await self._executor.execute(
            _STAMP_PROMOTION_SQL,
            [promoted_by, pr_url, draft_id],
        )
        await self._assert_transition_succeeded(
            draft_id,
            expected="promoted",
            expected_actor=promoted_by,
            expected_pr_url=pr_url,
        )

        await self._audit_writer.write(
            AuditEvent(
                action_type="CURATOR_PROMOTION",
                actor=promoted_by,
                actor_role=ActorRole.CAPTAIN,
                skill_name=None,
                matter_ref=None,
                metadata={
                    "customer": self._customer,
                    "draft_id": draft_id,
                    "promoted_pr_url": pr_url,
                },
            )
        )

        log.info(
            "curator.promotion: customer=%s id=%s by=%s pr=%s",
            self._customer,
            draft_id,
            promoted_by,
            pr_url,
        )

    # ---- Dismissal ------------------------------------------------------

    async def dismiss(
        self,
        *,
        draft_id: str,
        dismissed_by: str,
        reason: str,
    ) -> None:
        """Stamp the row dismissed; emit the CURATOR_DISMISSAL audit row.

        Dismissed rows remain in the table for the dismissal-corpus signal
        (ADR 0017 §4). `reason` is required — silent dismissal hides
        systematic over-firing of the Curator's extraction signal.

        Raises `CuratorDraftStateError` if the row is missing or already
        in a terminal state.
        """
        if not draft_id:
            raise ValueError("draft_id is required")
        if not dismissed_by:
            raise ValueError("dismissed_by is required")
        if not reason:
            raise ValueError(
                "reason is required; silent dismissal hides Curator over-firing "
                "(ADR 0017 §4 — dismissed drafts remain in the table for "
                "tuning extraction signal over time)"
            )

        await self._executor.execute(
            _STAMP_DISMISSAL_SQL,
            [dismissed_by, reason, draft_id],
        )
        await self._assert_transition_succeeded(
            draft_id,
            expected="dismissed",
            expected_actor=dismissed_by,
            expected_reason=reason,
        )

        await self._audit_writer.write(
            AuditEvent(
                action_type="CURATOR_DISMISSAL",
                actor=dismissed_by,
                actor_role=ActorRole.CAPTAIN,
                skill_name=None,
                matter_ref=None,
                metadata={
                    "customer": self._customer,
                    "draft_id": draft_id,
                    "dismissed_reason": reason,
                },
            )
        )

        log.info(
            "curator.dismissal: customer=%s id=%s by=%s reason=%s",
            self._customer,
            draft_id,
            dismissed_by,
            reason[:80],
        )

    # ---- Internal -------------------------------------------------------

    async def _assert_transition_succeeded(
        self,
        draft_id: str,
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
        was a no-op — raise CuratorDraftStateError.

        Production paths can use a real D1 executor that returns row counts;
        this re-read is the defensive-floor check that works against the
        Protocol surface. Used by `promote()` and `dismiss()`.
        """
        rows = await _fetch_one(self._executor, _SELECT_STAMPS_SQL, [draft_id])
        if rows is None:
            raise CuratorDraftStateError(
                f"skill_drafts row not found: draft_id={draft_id}"
            )
        promoted_at, promoted_by, promoted_pr_url, dismissed_at, dismissed_by, dismissed_reason = rows

        if expected == "promoted":
            this_call_landed = (
                promoted_at is not None
                and promoted_by == expected_actor
                and promoted_pr_url == expected_pr_url
            )
            if not this_call_landed:
                raise CuratorDraftStateError(
                    f"promotion failed: draft_id={draft_id} is already in a "
                    f"terminal state (promoted_at={promoted_at}, "
                    f"dismissed_at={dismissed_at}); a row can be promoted or "
                    "dismissed exactly once (ADR 0017 §3, §4)"
                )
            return

        if expected == "dismissed":
            this_call_landed = (
                dismissed_at is not None
                and dismissed_by == expected_actor
                and dismissed_reason == expected_reason
            )
            if not this_call_landed:
                raise CuratorDraftStateError(
                    f"dismissal failed: draft_id={draft_id} is already in a "
                    f"terminal state (promoted_at={promoted_at}, "
                    f"dismissed_at={dismissed_at})"
                )
            return


# ---------------------------------------------------------------------------
# Helper — read a single row through the Executor Protocol
#
# Same shape as honcho_interceptor._fetch_one; the two modules share the
# constraint and the workaround. See that module's docstring for the
# rationale. When the Executor protocol grows a fetch surface, both
# helpers fold back into the protocol.
# ---------------------------------------------------------------------------


async def _fetch_one(executor: Executor, sql: str, params: list) -> Optional[tuple]:
    """Adapter-layer helper that returns the first row of a SELECT.

    Inspects the executor to find a fetch path: SqliteExecutor exposes its
    `_conn` attribute (a sqlite3.Connection). The HttpD1Executor variant
    will land in a follow-on PR — until then, calls against an unrecognized
    executor raise an explicit RuntimeError so the failure mode is loud.
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
# Boot-time verification (ADR 0017 §_Verification_ point 2)
# ---------------------------------------------------------------------------


# Module names whose presence on the import path would indicate a Curator
# native writer wiring. The list is intentionally conservative — false
# positives are loud (boot halts; Captain investigates); false negatives
# silently violate the safety floor. ADR 0017 §_Verification_ guards
# requires this list to be re-checked at every quarterly Hermes rebase.
#
# Different surfaces than Honcho's: the Curator mutates skill files and
# the in-memory skill registry, not customer.yaml or runtime persona state.
_FORBIDDEN_CURATOR_MODULES: tuple[str, ...] = (
    "hermes.skills.curator_writer",          # hypothetical upstream writer
    "hermes.skills.registry_mutation",       # hypothetical in-memory mutation surface
    "hermes.skills.autonomous_promotion",    # hypothetical auto-promote path (ADR 0017 §10)
    "hermes.skills.auto_consolidation",      # hypothetical auto-consolidate path
)


def verify_curator_intercepted(
    interceptor: Optional[CuratorInterceptor],
    *,
    forbidden_modules: tuple[str, ...] = _FORBIDDEN_CURATOR_MODULES,
) -> None:
    """Boot-time check: the interceptor is constructed; no native writer is loaded.

    Per ADR 0017 §_Verification_ point 2: "The Curator interceptor is
    active at Machine boot. Boot-time check confirms native Curator write
    paths (skill file mutation, in-memory skill-set mutation) are blocked
    and the interceptor is the only write surface. Failure halts Machine
    boot."

    Raises `CuratorNativeWriteBlocked` on failure. The caller (bootstrap.sh
    → Machine boot path) does not catch — boot fails closed.

    Args:
        interceptor — the CuratorInterceptor instance constructed by the
                      overlay. Must be present. None means the overlay
                      booted without wiring the interceptor; that itself
                      is a violation (no legitimate write path exists).

        forbidden_modules — closed list of module names that, if present
                            in sys.modules, indicate a competing writer.
                            Production callers should use the default;
                            tests pass a tuple to exercise the check.

    Out of scope for this v1 check (tracked as follow-on, per ADR 0017
    §_Verification_ point 3): the grep-level CI assertion that no code
    path in a customer Machine mutates the loaded skill set after boot.
    That is a static-analysis check on the codebase, not a runtime
    function — and it lives in CI, not here.
    """
    import sys  # noqa: PLC0415 — local import so tests can monkeypatch

    if interceptor is None:
        raise CuratorNativeWriteBlocked(
            "Curator interceptor was not constructed at overlay boot. The "
            "interceptor is the ONLY legitimate write path for Curator output "
            "(ADR 0017 §1); booting without one means there is either no "
            "Curator integration (which is fine — return early before this "
            "check) or there IS one with no interception (which is a safety "
            "violation). Halting Machine boot."
        )

    loaded_forbidden = [m for m in forbidden_modules if m in sys.modules]
    if loaded_forbidden:
        raise CuratorNativeWriteBlocked(
            f"Native Curator write surface detected on import path: "
            f"{loaded_forbidden!r}. Per ADR 0017 §1, all Curator writes MUST "
            f"flow through CuratorInterceptor — there is no allowlist for "
            f"direct skill-file mutation, in-memory skill-set mutation, or "
            f"autonomous promotion (the latter is structurally forbidden by "
            f"ADR 0017 §10). The quarterly Hermes-rebase agenda item is the "
            "maintenance hook for new forbidden surfaces; if this module name "
            "was added intentionally, the maintenance PR must also update "
            "_FORBIDDEN_CURATOR_MODULES in curator_interceptor.py."
        )

    log.info("verify_curator_intercepted: ok (interceptor=%r)", type(interceptor).__name__)


__all__ = [
    "CuratorDraftStateError",
    "CuratorEvidenceRequired",
    "CuratorInterceptor",
    "CuratorNativeWriteBlocked",
    "CuratorTargetRequired",
    "DraftType",
    "SkillDraft",
    "verify_curator_intercepted",
]
