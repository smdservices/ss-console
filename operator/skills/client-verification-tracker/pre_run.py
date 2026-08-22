#!/usr/bin/env python3
"""client-verification-tracker pre-run gate — ADR 0021 Stream B (WP-B, #1889).

Runs BEFORE the Hermes cron daemon wakes the agent. Decides whether any open
verification item actually needs a turn today, so the expensive chase agent does
NOT wake every weekday when nothing is due.

Why this skill graduated off the shared empty-seat gate
-------------------------------------------------------
The shared ``operator/templates/pre_run_gate.py`` wakes on *any* open matter — a
seat with live matters wakes the chase daily even when no chase is due and the
internal escalation-to-a-person email repeats on every wake (observed live:
identical alerts July 6, 7, 8, 14). The template's own docstring calls a deeper
state-delta gate the intended follow-on; this is that follow-on. The chase now
reads the escalation ledger (the shared, broker-owned telemetry state, WP-A) and
the firm's authored cadence/ceiling, and wakes only on a real transition.

Wake / suppress decision
------------------------
For each open verification tracking item the skill maintains:

  (a) CHASE DUE — cadence authored, the last ``chased`` raise is at least
      ``chase_cadence_days`` old (or there is no prior chase and the tracking
      task's authored due date has arrived), and attempts are below the ceiling.
  (b) CEILING HAND-OFF — attempts have reached ``escalate_after_attempts`` and
      the ledger holds no ``handed_off`` event yet: wake ONCE to stop chasing the
      client and hand the open item to the responsible attorney. A ``handed_off``
      item is terminal for autonomous wakes.
  (d) HELD — the ledger carries an open per-MATTER hold (a ``fired`` raise on
      the matter's hold sentinel; see ``HOLD_SOURCE_ID``): a turn that
      inspected the matter found it cannot chase safely (signer unresolved, or
      any other surface-and-ask condition). A held matter NEVER plans a chase
      or a hand-off for any of its verification items; instead the hold
      re-surfaces to a person on the re-fire window until a turn writes
      ``resolved`` on the hold sentinel (ss #2402 — on 2026-08-11 the turn
      surfaced "signer not confirmed" and three days later the next wake
      planned a chase to the unconfirmed signer, because the hold lived only
      in an email).

Plus one seat-level condition:

  (c) CONFIG MISSING — ``chase_cadence_days`` or ``escalate_after_attempts`` is
      not authored: these are client-commitment numbers (File 07), so there is NO
      pack default. Fail-closed: wake to surface "chase cadence / escalation
      attempt-count not authored", record that surface in the ledger, and then
      re-surface on the shared fire-once + re-fire-window rule (every
      ``refire_days``) until the dials are authored — a chase held dark must not
      go permanently silent on one missed notice (#1899). An unset dial holds
      the client chase; it never releases it and never daily-spams.

Everything else -> a ``SUPPRESSED_WAKE`` heartbeat through the broker, then
``{"wakeAgent": false}``. The heartbeat IS the dead-man's-switch: a scheduled
tick with no audit row is the alarm the watcher-health view fires on.

What this gate deliberately does NOT own
----------------------------------------
Deadline-proximity escalation on an unsigned verification (a verification nearing
its authored response deadline; RFA highest severity) is owned by
``deadline-miss-escalator``, which pulls every authored deadline — verification
response deadlines included — and applies its own re-fire policy. The chase does
not run a second deadline pull; its internal escalation references the deadline
lane by pointer (the dedup rule), so a nearing-deadline verification is escalated
once by the owning lane, not duplicated into a second morning email. The
attempt-ceiling hand-off here and the deadline-proximity escalation there remain
the two independent triggers the skill contract promises; only the ownership is
split, which removes the duplicate-signal defect.

Fail direction (per the plan)
-----------------------------
- Ledger unreadable (module load / read failure) -> FIRE-OPEN (wake), the
  pre-graduation behavior. Never silently skip a chase.
- Smokeball pull failure / unrecognized envelope -> FIRE-OPEN (wake).
- Config file unreadable / unauthored -> treat as unauthored: fail-CLOSED hold
  plus the re-fired "config missing" surface (condition (c)), never a silent
  default and never a daily spam loop.

``decide()`` is a pure function (no I/O), unit-tested with fake inputs.
``run_once()`` wires the real verification-task source + broker heartbeat + stdout.

Exit codes:
    0 — decision emitted (wake or suppress)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import socket
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol, Sequence

SKILL_NAME = "client-verification-tracker"

# The config-missing surface is seat-level, not per-item. It is remembered in the
# ledger under a stable sentinel item_key so it fires on the re-fire window
# (every refire_days until authored), never daily (#1899).
_CONFIG_SENTINEL_SOURCE_ID = "__chase_config__"
_CONFIG_SENTINEL_LABEL = "chase-config-missing"

# Per-MATTER hold sentinel (ss #2402). A turn that finds a matter unsafe to
# chase (signer unresolved is the founding case) appends a ``fired`` raise on
# the matter's HOLD identity — the matter id plus the fixed source id below —
# via the broker (derive-then-handle, ss #2304). ``decide()`` then refuses to
# plan a chase or hand-off for ANY verification item on that matter until a
# turn appends ``resolved`` on the hold.
#
# The identity is deliberately MATTER-level, not task-level: the founding
# blocker (conflicting Minor/Deceased sub-roles on the plaintiff) is a fact
# about the matter's roles, not about one tracking task. A task-keyed hold
# would evaporate the moment the tracking task is completed, deleted, or
# recreated — the first wake on a replacement task would plan a chase straight
# past the still-unresolved blocker. Matter-level is also fail-closed for
# multi-plaintiff matters: one unresolved signer holds every verification
# chase on the matter, and the re-surface asks a person rather than guessing
# which sibling items are safe.
#
# The constants are the cross-side contract: the turn and this gate must
# derive the same key from the same components, so they live here and are
# cited verbatim in SKILL.md.
HOLD_SOURCE_ID = "__hold__"
_HOLD_LABEL = "chase-hold"


# ---------------------------------------------------------------------------
# Verification-item source protocol — the real adapter reads the open
# verification TRACKING tasks the skill maintains on each matter (one per
# plaintiff/response-set/version). The tracking task's authored due date is the
# first-chase-due date the skill set when it opened the item.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VerificationItem:
    """One open verification the skill is tracking.

    Item identity is the tracking task's STABLE Smokeball id (``task_id``); the
    ``item_key`` is ``item_key(matter_id, task_id, label, authored_date)``.
    ``authored_date`` must be a value that does NOT move over the item's life —
    the tracking task's due date is re-dated on each chase, so it is NOT used for
    identity (that would change the key and orphan the ledger history). The pull
    has no separate stable response-set date, so it leaves ``authored_date`` None
    and lets ``task_id`` carry identity; ``label`` is the fixed
    ``"client-verification"``. The agent MUST compute the same tuple when it
    appends a ``chased`` / ``handed_off`` / ``resolved`` event (see SKILL.md).

    ``next_chase_due`` is the tracking task's authored due date: the date the
    skill set for the FIRST chase. Once the item has a ``chased`` event in the
    ledger, cadence is computed from that raise instead (see ``_chase_due``), so
    a stale task date cannot re-open a chased item early. ``task_id`` is ``None``
    only for an item with no stable id (blanket-only, and then not per-item
    tokenizable)."""

    matter_id: str
    task_id: str | None
    next_chase_due: date
    authored_date: date | None = None
    label: str = "client-verification"


class VerificationSource(Protocol):
    """Adapter the real Smokeball reader satisfies: one VerificationItem per open
    verification tracking task the skill maintains."""

    def pull_open_verifications(self) -> Sequence[VerificationItem]:
        ...


# ---------------------------------------------------------------------------
# Chase config — CLIENT-COMMITMENT numbers (File 07). No pack default: unset is
# fail-closed hold + re-fired surface, never a silent interval (ADR 0035).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ChaseConfig:
    chase_cadence_days: int | None = None  # days between verification chases; None = unauthored
    escalate_after_attempts: int | None = None  # unanswered chases before hand-off; None = unauthored

    @property
    def authored(self) -> bool:
        """Both dials must be authored for the chase to run at all."""
        return self.chase_cadence_days is not None and self.escalate_after_attempts is not None


# The internal escalation-to-a-person raise (the ceiling hand-off, and the
# config-missing surface) follows the shared fire-once + re-fire-window rule so
# it never repeats on every wake. refire_days is legitimate pack-authored content
# (a repetitive internal alert beats a silent one), read from the top-level
# escalation: block the same way the escalator reads it.
_DEFAULT_REFIRE_DAYS = 3


def _pos_int_or_none(value):
    """A positive int, else None. Any junk (bool, str, <=0, missing) -> None so
    the caller treats the dial as unauthored (fail-closed), never as a default."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    return None


def _pos_int(value, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, int) and value > 0:
        return value
    return fallback


def _find_skill_settings(data) -> dict:
    """Return this skill's per-skill ``settings:`` block from the materialized
    customer.yaml, searching every persona's ``skills:`` list. Empty dict when
    the entry or its settings are absent/malformed (-> unauthored)."""
    if not isinstance(data, dict):
        return {}
    personas = data.get("personas")
    if not isinstance(personas, list):
        return {}
    for persona in personas:
        if not isinstance(persona, dict):
            continue
        skills = persona.get("skills")
        if not isinstance(skills, list):
            continue
        for entry in skills:
            if not isinstance(entry, dict) or entry.get("name") != SKILL_NAME:
                continue
            settings = entry.get("settings")
            return settings if isinstance(settings, dict) else {}
    return {}


def load_chase_config(customer_yaml_path: str | None = None) -> tuple[ChaseConfig, int]:
    """Read (ChaseConfig, refire_days) from the trusted volume customer.yaml
    (``SMD_CUSTOMER_YAML_PATH`` — the root-owned copy the ADR-0044 applier
    live-updates, so a value change reaches pre_run without a rebuild).

    ``chase_cadence_days`` / ``escalate_after_attempts`` come from THIS skill's
    per-skill ``settings:`` block (never the top-level ``escalation:`` block —
    that carries the escalator's windows). ``refire_days`` for the internal
    escalation comes from ``escalation.refire_days`` (pack default 3).

    Missing file, missing PyYAML, or an unparseable file -> unauthored config
    (fail-closed) with the pack-default refire window. Config-read failure is the
    unauthored path by design (never a silent cadence)."""
    path = customer_yaml_path or os.environ.get("SMD_CUSTOMER_YAML_PATH")
    if not path:
        return ChaseConfig(), _DEFAULT_REFIRE_DAYS
    try:
        import yaml  # available in the Hermes venv (the overlay's config reader uses it)
    except ImportError:
        return ChaseConfig(), _DEFAULT_REFIRE_DAYS
    try:
        with open(path, encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except (OSError, yaml.YAMLError):
        return ChaseConfig(), _DEFAULT_REFIRE_DAYS
    settings = _find_skill_settings(data)
    config = ChaseConfig(
        chase_cadence_days=_pos_int_or_none(settings.get("chase_cadence_days")),
        escalate_after_attempts=_pos_int_or_none(settings.get("escalate_after_attempts")),
    )
    esc = data.get("escalation") if isinstance(data, dict) else None
    refire_days = _pos_int(
        esc.get("refire_days") if isinstance(esc, dict) else None, _DEFAULT_REFIRE_DAYS
    )
    return config, refire_days


# ---------------------------------------------------------------------------
# Escalation ledger — vendored copy of the shared module (byte-identical to
# operator/workspace_broker/escalation_ledger.py; test_escalation_ledger_sync).
# Loaded by absolute path because the cron scheduler may run pre_run from a
# staged scripts dir, not the skill dir. If it cannot be loaded, the chase fails
# OPEN — it wakes (the pre-graduation behavior) rather than going silent.
# ---------------------------------------------------------------------------


def _load_ledger_module():
    import importlib.util

    candidates = [Path(__file__).resolve().parent]
    for base in ("/opt/data/skills", "/app/skills"):
        candidates.append(Path(base) / SKILL_NAME)
    for cand in candidates:
        module_path = cand / "escalation_ledger.py"
        if module_path.is_file():
            spec = importlib.util.spec_from_file_location(
                "escalation_ledger_vendored_cvt", module_path
            )
            if spec is None or spec.loader is None:
                continue
            module = importlib.util.module_from_spec(spec)
            # Register BEFORE exec: on Python 3.14 a `@dataclass` under
            # `from __future__ import annotations` resolves its string
            # annotations via sys.modules[cls.__module__] at class-creation time.
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            return module
    return None


# ---------------------------------------------------------------------------
# Decision engine — pure, no I/O. Unit-tested directly.
# ---------------------------------------------------------------------------

# Per-item actions the decision can reach.
ACTION_CHASE = "chase"  # a client nudge is due (attempt < ceiling)
ACTION_HANDOFF = "handoff"  # ceiling reached; stop chasing, hand to the attorney (once)
ACTION_SURFACE_CONFIG = "surface_config_missing"  # seat-level, on the refire window
ACTION_SURFACE_HOLD = "surface_hold"  # item held (e.g. signer unresolved); re-surface, never chase
ACTION_SUPPRESS = "suppress"  # nothing due for this item


@dataclass(frozen=True)
class ItemPlan:
    """What the next turn should do for one item, plus the attempt number a chase
    would carry (the ``nudge <#> of <max>`` numerator)."""

    matter_id: str
    task_id: str | None
    item_key: str
    action: str
    attempt: int  # for a chase: the nudge number this chase would be


@dataclass(frozen=True)
class WakeDecision:
    wake: bool
    decision_basis: str
    pre_run_inputs_digest: bytes
    plans: tuple[ItemPlan, ...] = ()
    extra_metadata: dict = field(default_factory=dict)


def _hold_active(hold_state) -> bool:
    """True iff the item's hold sentinel blocks the chase.

    A hold is open once it has any raise and is not ``resolved``. An ``acked``
    hold stays BLOCKING — ack means "a person saw the surface", not "the
    condition is fixed"; it only snoozes the re-surface (``should_fire``
    handles that). ``handed_off`` likewise blocks and additionally ends
    autonomous re-surfacing: a person owns the item. Only ``resolved`` —
    written by the turn that confirmed the condition is fixed (e.g. the signer
    is confirmed) — releases the chase.
    """
    if hold_state is None or hold_state.attempts == 0:
        return False
    return not hold_state.resolved


def _chase_due(
    state,
    next_chase_due: date,
    today: date,
    *,
    cadence_days: int,
) -> bool:
    """True iff a client chase is due now. With a prior ``chased`` raise, cadence
    is measured from it (the last raise + cadence). With no prior chase, the
    tracking task's authored due date seeds the first chase."""
    if state is None or state.last_raised_date is None:
        return today >= next_chase_due
    return today >= state.last_raised_date + timedelta(days=max(0, cadence_days))


def decide(
    items: Sequence[VerificationItem],
    config: ChaseConfig,
    ledger,
    events: Sequence[dict],
    *,
    raw_inputs_for_digest: bytes,
    today: date,
    refire_days: int,
) -> WakeDecision:
    """Pure decision: does any open verification need a turn today?

    ``ledger`` is the loaded ledger module (or None → caller fires open before
    reaching here). ``events`` are the ledger rows. Wake iff any item plan is
    actionable; otherwise suppress.
    """
    states = ledger.derive_state(events)

    # (c) Seat-level: config unauthored → fail-closed hold + re-fired surface.
    # The sentinel follows the same fire-once + re-fire-window rule as every
    # other internal raise (never daily, but never once-ever either): a held
    # chase re-surfaces every refire_days until the dials are authored (#1899).
    if not config.authored:
        sentinel_key = ledger.item_key(
            "", _CONFIG_SENTINEL_SOURCE_ID, _CONFIG_SENTINEL_LABEL, ""
        )
        sentinel_state = states.get(sentinel_key)
        if not ledger.should_fire(
            sentinel_state, today, refire_days=refire_days, ack_snooze_days=refire_days
        ):
            return WakeDecision(
                wake=False,
                decision_basis="chase_config_unauthored_within_refire_window",
                pre_run_inputs_digest=raw_inputs_for_digest,
                extra_metadata={"open_item_count": len(items)},
            )
        return WakeDecision(
            wake=True,
            decision_basis="chase_config_unauthored_surface",
            pre_run_inputs_digest=raw_inputs_for_digest,
            plans=(
                ItemPlan(
                    matter_id="",
                    task_id=None,
                    item_key=sentinel_key,
                    action=ACTION_SURFACE_CONFIG,
                    attempt=ledger.next_attempt(sentinel_state),
                ),
            ),
            extra_metadata={
                "open_item_count": len(items),
                "missing": [
                    name
                    for name, val in (
                        ("chase_cadence_days", config.chase_cadence_days),
                        ("escalate_after_attempts", config.escalate_after_attempts),
                    )
                    if val is None
                ],
            },
        )

    cadence_days = int(config.chase_cadence_days or 0)
    ceiling = int(config.escalate_after_attempts or 0)
    plans: list[ItemPlan] = []
    for item in items:
        key = ledger.item_key(item.matter_id, item.task_id, item.label, item.authored_date)
        state = states.get(key)
        # Terminal: resolved, or already handed off (a person owns it now).
        if state is not None and (state.resolved or state.handed_off):
            continue
        # (d) HELD — an open hold on this MATTER blocks chase AND hand-off for
        # every verification item on it (the ambiguity precedes the count, and
        # it is a fact about the matter, so a recreated tracking task cannot
        # slip past it). Re-surface on the re-fire window so a held matter
        # never goes permanently dark (#1899); release only on a ``resolved``
        # hold event (ss #2402). One surface per held matter per wake, even
        # with several tracked items on it.
        hold_key = ledger.item_key(item.matter_id, HOLD_SOURCE_ID, _HOLD_LABEL, None)
        hold_state = states.get(hold_key)
        if _hold_active(hold_state):
            already_surfacing = any(p.item_key == hold_key for p in plans)
            if (
                not already_surfacing
                and not hold_state.handed_off
                and ledger.should_fire(
                    hold_state, today, refire_days=refire_days, ack_snooze_days=refire_days
                )
            ):
                plans.append(
                    ItemPlan(
                        matter_id=item.matter_id,
                        task_id=item.task_id,
                        item_key=hold_key,
                        action=ACTION_SURFACE_HOLD,
                        attempt=ledger.next_attempt(hold_state),
                    )
                )
            continue
        attempts = 0 if state is None else state.attempts
        if attempts >= ceiling:
            # (b) Ceiling reached, not yet handed off → wake once to hand off.
            plans.append(
                ItemPlan(
                    matter_id=item.matter_id,
                    task_id=item.task_id,
                    item_key=key,
                    action=ACTION_HANDOFF,
                    attempt=attempts,
                )
            )
            continue
        # (a) Chase due?
        if _chase_due(state, item.next_chase_due, today, cadence_days=cadence_days):
            plans.append(
                ItemPlan(
                    matter_id=item.matter_id,
                    task_id=item.task_id,
                    item_key=key,
                    action=ACTION_CHASE,
                    attempt=ledger.next_attempt(state),  # the nudge number this chase carries
                )
            )
    actionable = tuple(p for p in plans if p.action != ACTION_SUPPRESS)
    if actionable:
        chases = sum(1 for p in actionable if p.action == ACTION_CHASE)
        handoffs = sum(1 for p in actionable if p.action == ACTION_HANDOFF)
        holds = sum(1 for p in actionable if p.action == ACTION_SURFACE_HOLD)
        return WakeDecision(
            wake=True,
            decision_basis="verification_action_due",
            pre_run_inputs_digest=raw_inputs_for_digest,
            plans=actionable,
            extra_metadata={
                "chase_due": chases,
                "handoff_due": handoffs,
                "hold_surface_due": holds,
                "open_item_count": len(items),
                "items": [
                    {
                        "matter_id": p.matter_id,
                        "action": p.action,
                        "attempt": p.attempt,
                        "ceiling": ceiling,
                    }
                    for p in actionable
                ],
            },
        )
    return WakeDecision(
        wake=False,
        decision_basis="no_verification_action_due",
        pre_run_inputs_digest=raw_inputs_for_digest,
        extra_metadata={"open_item_count": len(items)},
    )


# ---------------------------------------------------------------------------
# Runtime entrypoint — wires the verification source + broker heartbeat + stdout.
# ---------------------------------------------------------------------------


def _next_scheduled_at(now: datetime, schedule_hours: int = 24) -> str:
    return (now + timedelta(hours=schedule_hours)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# ---------------------------------------------------------------------------
# Pre-run handoff (ss#2547)
# ---------------------------------------------------------------------------
# The dates this script emits were READ from the firm's record. On the woken
# turn they arrive as prompt text, and prompt text is not a source: on
# 2026-08-19 the escalator's digest was refused five times by the identifier
# gate for the very dates this script had just read, and the escalation nobody
# received was a court date seven days out
# (docs/runbooks/operator/incidents/2026-08-19-gate-muted-escalator.md).
#
# This file is the seam that turns the script's read into a source. The READER
# is the overlay's ``shared/pre_run_handoff.take_handoff``, which binds the
# handoff to the one session started inside its window, seeds only the date
# atoms into the provenance register, and consumes it. The same block is copied
# verbatim into every bespoke pre_run that emits authored record dates: this
# script runs as a subprocess under the connector interpreter and cannot import
# the overlay.
#
# Best-effort by construction. Any failure goes to stderr and changes neither
# stdout nor the wake decision, because a routine that cannot write a handoff
# still has to wake.

_HANDOFF_SKILL = "client-verification-tracker"
_HANDOFF_STARTED_AT = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _handoff_values(node, key: str, out: list) -> list:
    """Every ``key`` string in a nested payload, deduped, first-seen order."""
    if isinstance(node, dict):
        value = node.get(key)
        if isinstance(value, str) and value and value not in out:
            out.append(value)
        for child in node.values():
            _handoff_values(child, key, out)
    elif isinstance(node, list):
        for child in node:
            _handoff_values(child, key, out)
    return out


def _is_iso_day(value: str) -> bool:
    """YYYY-MM-DD and nothing else. The register must never learn a non-date."""
    return (
        len(value) == 10
        and value[4] == "-"
        and value[7] == "-"
        and value.replace("-", "").isdigit()
    )


def _write_pre_run_handoff(payload: dict) -> None:
    """Project the emitted payload down to dates + matter ids and hand it off."""
    try:
        record = {
            "skill": _HANDOFF_SKILL,
            "started_at": _HANDOFF_STARTED_AT,
            "dates": [
                d for d in _handoff_values(payload, "authored_date", []) if _is_iso_day(d)
            ],
            "matter_ids": _handoff_values(payload, "matter_id", []),
        }
        directory = Path(os.environ.get("HERMES_HOME") or "/opt/data") / ".smd" / "pre_run"
        # Modes are set AT CREATION, never by a follow-up chmod: umask can only
        # remove bits, so the result is at most 0700/0600 and there is no window
        # in which the file is readable by anyone else. It names the matters the
        # firm is working on. An already-existing directory keeps whatever mode
        # it has; the file's own 0600 is the load-bearing half.
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        tmp = directory / ("." + _HANDOFF_SKILL + ".json.tmp")
        handle = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(handle, "w", encoding="utf-8") as fh:
            json.dump(record, fh)
        os.replace(tmp, directory / (_HANDOFF_SKILL + ".json"))
    except Exception as exc:  # noqa: BLE001 -- never change stdout or the wake
        sys.stderr.write("[pre_run] handoff write failed (" + str(exc) + ")\n")


def _emit_wake(decision: "WakeDecision | None" = None, *, basis: str | None = None) -> int:
    """Print the wake gate line — WITH the decision's plans (ss #2226).

    Hermes reads only ``wakeAgent`` from the last stdout line and then injects
    the whole stdout verbatim into the woken agent's prompt (the "Script
    Output" block). Emitting a bare ``{"wakeAgent": true}`` therefore threw
    away the one thing the gate computed that the agent cannot cheaply
    re-derive: WHICH items are actionable. A new verification item has no
    escalation-ledger state yet, so a ledger-driven scan never visits its
    matter — on 2026-08-10 the gate woke the agent for exactly one due chase
    and the agent concluded nothing was due (#2226). The plans in this line
    are the woken turn's work list; SKILL.md step 5 consumes them.

    Fail-open callers have no decision — they pass ``basis`` so the agent
    knows it woke blind and must run the full-enumeration fallback.
    """
    payload: dict = {"wakeAgent": True}
    resolved_basis = decision.decision_basis if decision is not None else basis
    if resolved_basis:
        payload["decision_basis"] = resolved_basis
    if decision is not None and decision.plans:
        payload["plans"] = [
            {
                "matter_id": p.matter_id,
                "task_id": p.task_id,
                "item_key": p.item_key,
                "action": p.action,
                "attempt": p.attempt,
            }
            for p in decision.plans
        ]
    _write_pre_run_handoff(payload)
    print(json.dumps(payload))
    return 0


def _plan_counts(decision: "WakeDecision") -> dict:
    """How many per-item plans the gate handed over.

    Only ``plans_total`` here: this gate serializes the whole plan list (no
    ``_MAX_SERIALIZED_PLANS`` cap, unlike its three siblings), so emitted and
    total are the same number and a ``plans_truncated`` field would be a
    constant dressed as a measurement.
    """
    if not decision.plans:
        return {}
    return {"plans_total": len(decision.plans)}


async def _try_write_emitted_wake(
    audit_writer_factory,
    decision: "WakeDecision",
    *,
    skill_name: str,
    now: datetime,
) -> None:
    """Best-effort EMITTED_WAKE row for a real-decision wake (#2253).

    The suppress path logged its reasoning and the wake path logged nothing, so
    the ledger held a record of every tick the gate stayed quiet and no record
    of the ticks it fired. On 2026-08-10 the sibling escalator woke with its
    connector down and sent an alert stating a date it could not read; the only
    way anyone found it was reading the mailbox.

    BEST-EFFORT IS THE CONTRACT, and it inverts the suppress path's on purpose.
    Below, an audit failure escalates to a wake, because a silent suppress is
    indistinguishable from a broken gate. Here the wake is already the decision,
    so every failure — no writer wired, socket down, broker refusal, a writer
    object too old to have the method — is swallowed. A wake that a failed audit
    write could suppress or delay would be a gate made of observability.

    It is not free, and the cost is stated rather than assumed away: the
    broker-socket writer blocks for up to `_HEARTBEAT_TIMEOUT_SECONDS` against a
    hung broker — the same bound the suppress path already accepts. Bounded, and
    never a change of decision.

    Not called on the fail-open paths: `ledger_unavailable_fail_open` returns
    before there is a decision to record, `no_audit_writer_fail_open` fires
    because there is no writer to call, and `suppress_heartbeat_failed_fail_open`
    fires because a write to that writer just failed.
    """
    try:
        writer = audit_writer_factory()
        if writer is None:
            return
        await writer.write_emitted_wake(
            skill_name=skill_name,
            pre_run_inputs=decision.pre_run_inputs_digest,
            decision_basis=decision.decision_basis,
            next_scheduled_at=_next_scheduled_at(now),
            extra_metadata={**decision.extra_metadata, **_plan_counts(decision)},
        )
    except Exception:  # noqa: BLE001 — observability never gates the wake
        pass


def _emit_suppress() -> int:
    print(json.dumps({"wakeAgent": False}))
    return 0


def _item_to_dict(item: VerificationItem) -> dict:
    return {
        "matter_id": item.matter_id,
        "task_id": item.task_id,
        # authored_date is None in production (identity is the stable task_id).
        "authored_date": item.authored_date.isoformat() if item.authored_date else None,
        "next_chase_due": item.next_chase_due.isoformat(),
        "label": item.label,
    }


async def run_once(
    sources: Sequence[VerificationSource],
    audit_writer_factory,  # () -> SuppressedWakeWriter | None
    *,
    today: date | None = None,
    now: datetime | None = None,
    config: ChaseConfig | None = None,
    refire_days: int | None = None,
    ledger_module=None,
    ledger_events: Sequence[dict] | None = None,
) -> int:
    """Driver. Returns the exit code; emits stdout JSON as a side effect.

    ``audit_writer_factory`` is called only when we would suppress; it may return
    None (dev mode) → suppression falls back to wake (mirror-don't-gate).

    Fail-open on ledger loss: if the ledger module cannot be loaded, wake (the
    pre-graduation behavior). Config-read is the unauthored path on failure, but
    that is handled inside ``decide`` (re-fired surface), not here.
    ``config``/``refire_days``/``ledger_events`` default to the live config +
    on-disk ledger; tests inject them directly."""
    now = now or datetime.now(timezone.utc)
    today = today or now.date()
    if config is None or refire_days is None:
        loaded_config, loaded_refire = load_chase_config()
        config = config or loaded_config
        refire_days = refire_days if refire_days is not None else loaded_refire

    ledger = ledger_module if ledger_module is not None else _load_ledger_module()
    if ledger is None:
        # Fire-open: a chase watcher that goes silent is the dangerous failure.
        sys.stderr.write("[pre_run] escalation ledger unavailable; waking\n")
        return _emit_wake(basis="ledger_unavailable_fail_open")
    if ledger_events is None:
        ledger_events = ledger.read_ledger()

    items: list[VerificationItem] = []
    raw_input_blob: bytes = b""
    for source in sources:
        pulled = list(source.pull_open_verifications())
        items.extend(pulled)
        raw_input_blob += json.dumps(
            [_item_to_dict(i) for i in pulled], sort_keys=True
        ).encode("utf-8")

    decision = decide(
        items,
        config,
        ledger,
        ledger_events,
        raw_inputs_for_digest=raw_input_blob,
        today=today,
        refire_days=refire_days,
    )
    if decision.wake:
        # The row goes in BEFORE the wake line, and cannot stop it (#2253).
        await _try_write_emitted_wake(
            audit_writer_factory, decision, skill_name=SKILL_NAME, now=now
        )
        return _emit_wake(decision)

    writer = audit_writer_factory()
    if writer is None:
        # Mirror-don't-gate: no writer = no heartbeat trail = always wake.
        return _emit_wake(basis="no_audit_writer_fail_open")
    try:
        await writer.write_suppressed_wake(
            skill_name=SKILL_NAME,
            pre_run_inputs=decision.pre_run_inputs_digest,
            decision_basis=decision.decision_basis,
            next_scheduled_at=_next_scheduled_at(now),
            extra_metadata=decision.extra_metadata,
        )
    except Exception:  # noqa: BLE001 — any audit failure → wake (dead-man's-switch)
        return _emit_wake(basis="suppress_heartbeat_failed_fail_open")
    return _emit_suppress()


# ---------------------------------------------------------------------------
# Production wiring. The Smokeball pull runs in the connector's own venv via
# subprocess (smokeball_connector is not importable from the Hermes venv this
# script runs in); the SUPPRESSED_WAKE heartbeat goes through the broker's
# uid-gated `suppressed_wake_append` verb. Every unknown stays conservative:
# pull failure, unrecognized envelope, heartbeat failure — all wake.
# ---------------------------------------------------------------------------

_CONNECTOR_PYTHON_DEFAULT = "/opt/connectors/smokeball/.venv/bin/python"
_PULL_TIMEOUT_SECONDS = 60
_HEARTBEAT_TIMEOUT_SECONDS = 10

# The verification tracking tasks the skill maintains carry a stable marker in
# their subject so the pull can subset them out of the open-task list. The
# skill authors this subject (SKILL.md step 4 / How it works). The exact firm
# convention is connect-verified; the marker match is deliberately broad.
_VERIFICATION_SUBJECT_MARKER = "verification"

# Runs inside the connector venv. Pull failure is REPORTED, not swallowed — a
# partial view must wake, never suppress.
_PULL_SNIPPET = """\
import json

from smokeball_connector.client import build_client_from_env

client = build_client_from_env()
out = {}
try:
    out["tasks"] = client.get("/tasks", IsCompleted=False, Limit=500)
except Exception as exc:
    out["tasksError"] = str(exc)[:300]
print(json.dumps(out, default=str))
"""

_TASK_DATE_KEYS = ("dueDate", "DueDate", "due_date")
_TASK_SUBJECT_KEYS = ("subject", "Subject", "name", "Name", "title", "Title", "description")
_MATTER_ID_KEYS = ("matterId", "MatterId", "matter_id")
_SOURCE_ID_KEYS = ("id", "Id", "taskId", "TaskId")


def _extract_items(payload) -> list | None:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "value", "results", "tasks", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return None


def _parse_iso_date(value) -> date | None:
    if not isinstance(value, str) or len(value) < 10:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _first_date(item: dict, keys: Sequence[str]) -> date | None:
    for key in keys:
        parsed = _parse_iso_date(item.get(key))
        if parsed is not None:
            return parsed
    return None


def _first_str(item: dict, keys: Sequence[str]) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _matter_id_of(item: dict) -> str:
    # The live Smokeball /tasks payload carries the matter as a NESTED link
    # object ({"matter": {"id": ..., "href": ...}}), not a flat matterId —
    # found by the WP-D probe when the flat-key miss put "unknown-matter" into
    # every item identity and forked the ledger join (ss #1915).
    matter = item.get("matter") or item.get("Matter")
    if isinstance(matter, dict):
        nested = matter.get("id") or matter.get("Id")
        if isinstance(nested, str) and nested:
            return nested
    for key in _MATTER_ID_KEYS:
        value = item.get(key)
        if isinstance(value, str) and value:
            return value
    return "unknown-matter"


def _source_id_of(item: dict) -> str | None:
    for key in _SOURCE_ID_KEYS:
        value = item.get(key)
        if isinstance(value, (str, int)) and str(value).strip():
            return str(value)
    return None


# Rehearsal/self-test artifacts carry "[SMD-PROBE <stamp>]" at the start of
# the subject (after the connector's "[Operator]" provenance stamp) — ss #2403:
# a probe task outlived its test and became THIS skill's live tracking anchor
# (task 28745d01, 2026-08-14). Probe rows are never tracked verifications.
# Position-anchored: a real task quoting the marker mid-subject is not hidden.
_PROBE_MARK = "[SMD-PROBE"
_PROVENANCE_MARK = "[Operator]"


def _is_probe_subject(subject: str) -> bool:
    text = subject.lstrip()
    if text.upper().startswith(_PROVENANCE_MARK.upper()):
        text = text[len(_PROVENANCE_MARK) :].lstrip()
    return text.upper().startswith(_PROBE_MARK.upper())


def _is_verification_task(subject: str) -> bool:
    if _is_probe_subject(subject):
        return False
    return _VERIFICATION_SUBJECT_MARKER in subject.lower()


def parse_pull(raw: dict, *, today: date) -> tuple[list[VerificationItem], str | None]:
    """Pure parse of the connector pull. Returns (items, problem).

    A non-None problem means the view is partial or unrecognizable and the caller
    MUST wake. Only tasks carrying the verification marker in their subject are
    tracked verifications; other open tasks are ignored (they belong to other
    skills). A verification task with no due date seeds its first chase to today
    (it is already open and overdue for a first touch)."""
    if raw.get("tasksError"):
        return [], f"pull error: tasksError={raw['tasksError']}"
    tasks = _extract_items(raw.get("tasks"))
    if tasks is None:
        return [], "unrecognized pull envelope"
    items: list[VerificationItem] = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        subject = _first_str(task, _TASK_SUBJECT_KEYS)
        if not _is_verification_task(subject):
            continue
        due = _first_date(task, _TASK_DATE_KEYS) or today
        items.append(
            VerificationItem(
                matter_id=_matter_id_of(task),
                task_id=_source_id_of(task),
                next_chase_due=due,
                # authored_date stays None: identity is the stable task_id, never
                # the moving tracking-task due date (see VerificationItem).
                authored_date=None,
                label="client-verification",
            )
        )
    return items, None


class SmokeballSubprocessSource:
    """VerificationSource over a connector-venv subprocess pull."""

    def __init__(self, today: date) -> None:
        self._today = today

    def pull_open_verifications(self) -> Sequence[VerificationItem]:
        connector_python = os.environ.get(
            "SMD_CONNECTOR_VENV_PYTHON", _CONNECTOR_PYTHON_DEFAULT
        )
        result = subprocess.run(  # raises on timeout → caller wakes
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args — argv[0] is the module-constant connector-venv interpreter, overridable only via SMD_CONNECTOR_VENV_PYTHON from the Machine's own boot env (same trust domain; the test seam). The snippet is a module constant; no request/agent-controlled data reaches argv.
            [connector_python, "-c", _PULL_SNIPPET],
            capture_output=True,
            text=True,
            timeout=_PULL_TIMEOUT_SECONDS,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"smokeball pull exit {result.returncode}: "
                f"{(result.stderr or '').strip()[:500]}"
            )
        raw = json.loads((result.stdout or "").strip().splitlines()[-1])
        items, problem = parse_pull(raw, today=self._today)
        if problem:
            raise RuntimeError(problem)
        return items


class BrokerSuppressedWakeWriter:
    """SuppressedWakeWriter over the broker's uid-gated heartbeat verbs.

    Two verbs, one per action_type — `suppressed_wake_append` for the quiet
    tick, `emitted_wake_append` for the firing one (#2253). The broker pins each
    verb to exactly one action_type, so neither can forge the other's row.
    """

    def __init__(self, socket_path: str, customer_slug: str) -> None:
        self._socket_path = socket_path
        self._customer_slug = customer_slug

    async def write_suppressed_wake(
        self,
        *,
        skill_name: str,
        pre_run_inputs: bytes,
        decision_basis: str,
        next_scheduled_at: str,
        extra_metadata: dict | None = None,
    ) -> str:
        return self._append(
            verb="suppressed_wake_append",
            action_type="SUPPRESSED_WAKE",
            skill_name=skill_name,
            pre_run_inputs=pre_run_inputs,
            decision_basis=decision_basis,
            next_scheduled_at=next_scheduled_at,
            extra_metadata=extra_metadata,
        )

    async def write_emitted_wake(
        self,
        *,
        skill_name: str,
        pre_run_inputs: bytes,
        decision_basis: str,
        next_scheduled_at: str,
        extra_metadata: dict | None = None,
    ) -> str:
        """Same payload shape, the wake-path verb. Raises like its sibling; the
        caller (`_try_write_emitted_wake`) is the one that swallows."""
        return self._append(
            verb="emitted_wake_append",
            action_type="EMITTED_WAKE",
            skill_name=skill_name,
            pre_run_inputs=pre_run_inputs,
            decision_basis=decision_basis,
            next_scheduled_at=next_scheduled_at,
            extra_metadata=extra_metadata,
        )

    def _append(
        self,
        *,
        verb: str,
        action_type: str,
        skill_name: str,
        pre_run_inputs: bytes,
        decision_basis: str,
        next_scheduled_at: str,
        extra_metadata: dict | None,
    ) -> str:
        request = {
            "action": verb,
            "row": {
                "action_type": action_type,
                "actor": "agent",
                "actor_role": "agent",
                "skill_name": skill_name,
                "input_digest": hashlib.sha256(pre_run_inputs).hexdigest(),
                "metadata": json.dumps(
                    {
                        "decision_basis": decision_basis,
                        "next_scheduled_at": next_scheduled_at,
                        "platform": "cron-pre-run",
                        "customer": self._customer_slug,
                        **(extra_metadata or {}),
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                    default=str,
                ),
            },
        }
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(_HEARTBEAT_TIMEOUT_SECONDS)
            sock.connect(self._socket_path)
            sock.sendall(json.dumps(request).encode("utf-8") + b"\n")
            raw = b""
            while not raw.endswith(b"\n"):
                chunk = sock.recv(4096)
                if not chunk:
                    break
                raw += chunk
        response = json.loads(raw.decode("utf-8"))
        if response.get("ok") is not True:
            raise RuntimeError(f"heartbeat rejected: {response}")
        return str(response.get("id", ""))


def _writer_factory():
    socket_path = os.environ.get("SMD_AUDIT_BROKER_SOCKET") or os.environ.get(
        "SMD_WORKSPACE_BROKER_SOCKET"
    )
    if not socket_path:
        return None  # run_once treats None as "no writer wired" → wake
    return BrokerSuppressedWakeWriter(
        socket_path, os.environ.get("CUSTOMER_SLUG", "")
    )


def main() -> int:
    customer_slug = os.environ.get("CUSTOMER_SLUG")
    if not customer_slug:
        sys.stderr.write("[pre_run] CUSTOMER_SLUG unset; falling back to wake\n")
        return _emit_wake(basis="customer_slug_unset_fail_open")
    config, refire_days = load_chase_config()
    today = datetime.now(timezone.utc).date()
    source = SmokeballSubprocessSource(today)
    try:
        return asyncio.run(
            run_once(
                [source],
                _writer_factory,
                today=today,
                config=config,
                refire_days=refire_days,
            )
        )
    except Exception as exc:  # noqa: BLE001 — any wiring failure → wake
        sys.stderr.write(f"[pre_run] chase pre_run failed ({exc}); waking\n")
        return _emit_wake(basis="pre_run_crashed_fail_open")


if __name__ == "__main__":
    sys.exit(main())
