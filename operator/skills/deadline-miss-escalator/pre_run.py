#!/usr/bin/env python3
"""deadline-miss-escalator pre-run script — ADR 0021 Stream B.

Runs BEFORE the Hermes cron daemon wakes the agent. Reads the firm's
**authored** critical dates (court dates, filing deadlines, SOL dates a human
entered), compares each to today, and decides whether any deadline has entered
the escalation range and still needs a human's attention — i.e. whether the
agent needs to wake and run the escalation ladder.

The never-computes line, restated for the pre-run path
------------------------------------------------------
This script does exactly one kind of arithmetic: **comparing an authored date to
today** (``authored_date <= today + window``, ``authored_date < today``,
``(authored_date - today).days``). It performs NO arithmetic that *produces* a
deadline — no "incident_date + limitation_period", no inferring a window from a
rule. The dates it reads were authored by a human; it never originates one. The
same cardinal line `deadline-and-sol-tracker` holds, held here in code.

Wake / suppress decision (per references/algorithm.md):

  - WAKE if any open, unacknowledged matter has an authored deadline within the
    firm's escalation window (or already overdue). That is a deadline that needs
    a rung of the ladder run.
  - SUPPRESS otherwise. Before printing wakeAgent:false write a SUPPRESSED_WAKE
    audit row; audit-write failure falls back to wake (mirror-don't-gate,
    ADR 0016). The SUPPRESSED_WAKE row IS the heartbeat: a scheduled tick that
    produces no audit row is the dead-man's-switch signal the watcher-health
    view alarms on. The deadline-watch is advisory, never the firm's system of
    record (see operator/verticals/law-firm/compliance-floor.md).

The decide() function is pure — no I/O, unit-tested directly with fake inputs.
run_once() wires the real deadline source + audit writer + stdout.

Exit codes:
    0 — decision emitted (wake or suppress)
    2 — fatal startup error (config missing). Caller treats as wake-and-investigate.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import socket
import subprocess
import sys
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol, Sequence


# ---------------------------------------------------------------------------
# Deadline source protocol — the real adapter reads Smokeball (list_tasks
# due_date) + the mail/calendar binding (list_calendar_entries) and the firm's
# escalation-acknowledgment ledger.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MatterDeadline:
    """One AUTHORED critical date on a matter. ``authored_date`` was entered by a
    human and read from the firm's authored records — never computed here."""

    matter_id: str
    authored_date: date
    label: str  # authored: court-date | filing-deadline | sol | response-window | task-deadline
    matter_open: bool = True
    conflict_hold: bool = False
    acknowledged: bool = False  # a human already acked this escalation → stop re-firing
    # Whether the quiet state is specifically an ACK-snooze (vs the re-fire
    # window after the Operator's own recent raise). ``acknowledged`` collapses
    # both for the wake decision; the digest projection (ss #2405) needs the
    # distinction: an acked item is omitted (snoozed by a person), a
    # recently-raised unacked item renders under "Under active escalation
    # elsewhere" so it is not double-counted.
    acked: bool = False
    # The stable Smokeball task/event id — the anti-collision half of item
    # identity (two same-day tasks on one matter differ only by this). ``None``
    # for an item with no stable id: it gets no per-item ack token and renders
    # in the blanket-ack-only group.
    task_id: str | None = None
    # When the OPERATOR last raised this item, from the escalation ledger
    # (``ItemState.last_raised_ts``), joined in ``enrich_with_ledger``. ``None``
    # on a pulled-but-not-yet-enriched item and on an item the Operator has
    # never raised. It is NOT "when the firm last acted on this deadline" — the
    # ledger records only Operator raises, and only after a successful send
    # (SKILL.md step 3), so absent means "no Operator raise on record" and never
    # "not raised". Carried into the wake payload so a woken turn states a last
    # raise it READ instead of inventing one (#2253).
    last_raised: str | None = None


class DeadlineSource(Protocol):
    """Adapter the real Smokeball + calendar reader satisfies. Returns one MatterDeadline per
    authored date on an open matter, plus the matter's conflict-hold state and
    whether the escalation has been acknowledged."""

    def pull_deadlines(self) -> Sequence[MatterDeadline]:
        ...


# ---------------------------------------------------------------------------
# Escalation windows — firm-authored; defaults below. All in days.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EscalationWindows:
    escalation_window_days: int = 14  # a deadline this near (or overdue) is in escalation range
    near_days: int = 7  # within this → re-route rung
    notify_days: int = 3  # within this (or overdue) → notify rung (ESCALATION_FIRED)


# ---------------------------------------------------------------------------
# Re-fire policy — fire once, re-fire only on the authored window (never daily);
# ack is a snooze, not a tombstone. Pack-authored defaults are legitimate
# content (ADR 0035): a repetitive deadline watcher is worse than a silent one,
# so refire_days ships a default rather than fail-closing to quiet.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FirePolicy:
    refire_days: int = 3  # re-fire an unacked, still-open item only this many days after the last raise
    ack_snooze_days: int = 7  # an acked-but-unresolved item re-surfaces this many days after the ack


_PACK_DEFAULT_WINDOWS = EscalationWindows()
_PACK_DEFAULT_FIRE_POLICY = FirePolicy()


def _pos_int(value, fallback: int) -> int:
    """A positive int override, else the pack default. Any junk → default
    (never crash, never silently suppress)."""
    if isinstance(value, bool):
        return fallback
    if isinstance(value, int) and value > 0:
        return value
    return fallback


def load_escalation_config(
    customer_yaml_path: str | None = None,
) -> tuple[EscalationWindows, FirePolicy]:
    """Read the escalation windows + re-fire policy from the trusted volume
    customer.yaml (``SMD_CUSTOMER_YAML_PATH`` — the root-owned copy the ADR-0044
    applier live-updates, so a value change reaches pre_run without a rebuild).

    Keys, all under the top-level ``escalation:`` block, all optional:
    ``escalation_window_days`` / ``near_days`` / ``notify_days`` /
    ``refire_days`` / ``ack_snooze_days``. Missing file, missing PyYAML, or an
    unparseable file → pack defaults (authored content, never a crash and never
    silent suppression)."""
    path = customer_yaml_path or os.environ.get("SMD_CUSTOMER_YAML_PATH")
    if not path:
        return _PACK_DEFAULT_WINDOWS, _PACK_DEFAULT_FIRE_POLICY
    try:
        import yaml  # available in the Hermes venv (the overlay's config reader uses it)
    except ImportError:
        return _PACK_DEFAULT_WINDOWS, _PACK_DEFAULT_FIRE_POLICY
    try:
        with open(path, encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except (OSError, yaml.YAMLError):
        return _PACK_DEFAULT_WINDOWS, _PACK_DEFAULT_FIRE_POLICY
    esc = data.get("escalation") if isinstance(data, dict) else None
    if not isinstance(esc, dict):
        return _PACK_DEFAULT_WINDOWS, _PACK_DEFAULT_FIRE_POLICY
    windows = EscalationWindows(
        escalation_window_days=_pos_int(
            esc.get("escalation_window_days"), _PACK_DEFAULT_WINDOWS.escalation_window_days
        ),
        near_days=_pos_int(esc.get("near_days"), _PACK_DEFAULT_WINDOWS.near_days),
        notify_days=_pos_int(esc.get("notify_days"), _PACK_DEFAULT_WINDOWS.notify_days),
    )
    policy = FirePolicy(
        refire_days=_pos_int(esc.get("refire_days"), _PACK_DEFAULT_FIRE_POLICY.refire_days),
        ack_snooze_days=_pos_int(
            esc.get("ack_snooze_days"), _PACK_DEFAULT_FIRE_POLICY.ack_snooze_days
        ),
    )
    return windows, policy


# ---------------------------------------------------------------------------
# Escalation ledger — the vendored copy of the shared module (byte-identical to
# operator/workspace_broker/escalation_ledger.py; see test_escalation_ledger_sync).
# Loaded by absolute path because the cron scheduler may run pre_run from a
# staged scripts dir, not the skill dir. If it cannot be loaded, the escalator
# fails OPEN — it fires every in-range item (the old behavior) rather than going
# silent, because a silent deadline watcher is the dangerous failure.
# ---------------------------------------------------------------------------


def _load_ledger_module():
    import importlib.util

    candidates = [Path(__file__).resolve().parent]
    for base in ("/opt/data/skills", "/app/skills"):
        candidates.append(Path(base) / "deadline-miss-escalator")
    for cand in candidates:
        module_path = cand / "escalation_ledger.py"
        if module_path.is_file():
            spec = importlib.util.spec_from_file_location(
                "escalation_ledger_vendored", module_path
            )
            if spec is None or spec.loader is None:
                continue
            module = importlib.util.module_from_spec(spec)
            # Register BEFORE exec: on Python 3.14 a `@dataclass` under
            # `from __future__ import annotations` resolves its string
            # annotations via sys.modules[cls.__module__] at class-creation
            # time, so the module must be importable by its own name first.
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            return module
    return None


def enrich_with_ledger(
    deadlines: Sequence[MatterDeadline],
    *,
    today: date,
    policy: FirePolicy,
    ledger_events: Sequence[dict] | None = None,
) -> list[MatterDeadline]:
    """Join pulled deadlines against the escalation ledger and set each item's
    ``acknowledged`` to the negation of "should fire now": an item is treated as
    acknowledged (suppressed) when it fired recently (inside the re-fire window),
    was acked and is still inside the snooze window, or was handed off/resolved.
    An item that should fire now stays un-acknowledged and wakes the ladder.

    Also carries each item's ``last_raised`` across from the ledger state this
    join already reads (``ItemState.last_raised_ts``) so the wake payload can
    state it with provenance (#2253). No new ledger API: the state dataclass
    already exposes the field.

    Ledger unavailable (module load fails) → fire-open: every item's
    ``acknowledged`` is left as pulled (False), i.e. the pre-ledger behavior."""
    ledger = _load_ledger_module()
    if ledger is None:
        return list(deadlines)
    if ledger_events is None:
        ledger_events = ledger.read_ledger()
    states = ledger.derive_state(ledger_events)
    enriched: list[MatterDeadline] = []
    for d in deadlines:
        key = ledger.item_key(d.matter_id, d.task_id, d.label, d.authored_date)
        state = states.get(key)
        fire = ledger.should_fire(
            state,
            today,
            refire_days=policy.refire_days,
            ack_snooze_days=policy.ack_snooze_days,
        )
        enriched.append(
            MatterDeadline(
                matter_id=d.matter_id,
                authored_date=d.authored_date,
                label=d.label,
                matter_open=d.matter_open,
                conflict_hold=d.conflict_hold,
                acknowledged=not fire,
                acked=False if state is None else bool(state.acked),
                task_id=d.task_id,
                last_raised=None if state is None else state.last_raised_ts,
            )
        )
    return enriched


# ---------------------------------------------------------------------------
# Decision engine — pure function, no I/O. Unit-tested directly.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ItemPlan:
    """One firing item as the gate saw it, carried to the woken turn (#2253).

    ``authored_date`` is the human-authored date VERBATIM, not only the derived
    ``days_out``: an integer alone invites the woken turn to invert it back into
    a date, which is arithmetic that PRODUCES a date and the one thing this
    skill may never do. Both are carried; the date is the fact, the integer is
    the convenience.
    """

    matter_id: str
    task_id: str | None
    label: str  # the authored deadline label
    authored_date: str  # ISO YYYY-MM-DD, verbatim from the authored record
    days_out: int
    rung: str
    # The Operator's own last raise on this item, or None. See MatterDeadline.
    last_raised: str | None


@dataclass(frozen=True)
class WakeDecision:
    wake: bool
    decision_basis: str
    pre_run_inputs_digest: bytes
    plans: tuple[ItemPlan, ...] = ()
    extra_metadata: dict = field(default_factory=dict)
    # The projected digest structure (ss #2405) — sections, per-matter groups,
    # ACK codes, and every count, computed HERE so the email's numbers can never
    # disagree with its lists. None when the ledger is unavailable (the turn
    # composes without a projection and says so) or on a suppress.
    digest: dict | None = None


# The digest projection (ss #2405). The 2026-08-14 digest labeled matter
# 2026-PI-106 "1 routine confirmation(s)" above TWO ack codes, and its subject
# counted 32 routine confirms as "need you" — every count was model arithmetic.
# This function computes the whole reader-facing structure from the enriched
# universe: counts are list lengths BY CONSTRUCTION, and it runs over the FULL
# item set ahead of the _MAX_SERIALIZED_PLANS cap, so a truncated plan list can
# never produce confident counts over an incomplete universe (the /critique
# finding). The turn renders it verbatim: it may order prose within a band and
# write each item's one-line consequence, but it never moves an item across
# bands and never re-counts.
_NEEDS_YOU_MAX = 5  # output-format rule 2: three to five in the top block


def _digest_item(d: MatterDeadline, today: date, ack_code: str | None) -> dict:
    return {
        "matter_id": d.matter_id,
        "task_id": d.task_id,
        "label": d.label,
        "authored_date": d.authored_date.isoformat(),
        "days_out": (d.authored_date - today).days,
        "ack_code": ack_code,
        "last_raised": d.last_raised,
    }


def project_digest(
    deadlines: Sequence[MatterDeadline],
    windows: EscalationWindows,
    ledger,
    *,
    today: date,
    probe_stats: dict | None = None,
) -> dict:
    """Project the reader-facing digest structure from the enriched universe.

    Banding is deterministic, from authored signals only (output-format rule 1
    as computable here): membership in "Needs you today" is the up-to-5 MOST
    OVERDUE firing items with stable identity; every other stable firing item
    collapses into the per-matter "Admin confirms" groups; firing items with no
    stable id render blanket-ack-only; in-range conflict-held matters render
    under clearance; in-range items quiet because the Operator RAISED them
    recently (not because a person acked them) render under "elsewhere" so they
    are not double-counted. Acked-and-snoozed items are omitted (a person
    silenced them). Empty sections are omitted whole (rule 9). The subject
    counts ONLY the needs-you band — the 08-14 subject said "37 need you" when
    5 needed a person and 32 were routine confirms (Law 11).
    """
    in_range = [
        d
        for d in deadlines
        if d.matter_open
        and d.authored_date <= today + timedelta(days=windows.escalation_window_days)
    ]
    clearance = [d for d in in_range if d.conflict_hold]
    firing = [d for d in in_range if not d.acknowledged and not d.conflict_hold]
    elsewhere = [
        d
        for d in in_range
        if d.acknowledged and not d.acked and d.last_raised and not d.conflict_hold
    ]

    def code_for(d: MatterDeadline) -> str | None:
        if not ledger.has_stable_identity(d.task_id, d.matter_id):
            return None
        key = ledger.item_key(d.matter_id, d.task_id, d.label, d.authored_date)
        return ledger.token_for(key)

    stable = [d for d in firing if ledger.has_stable_identity(d.task_id, d.matter_id)]
    blanket = [d for d in firing if not ledger.has_stable_identity(d.task_id, d.matter_id)]
    stable.sort(key=lambda d: ((d.authored_date - today).days, d.matter_id, d.task_id or ""))
    needs_you = stable[:_NEEDS_YOU_MAX]
    admin = stable[_NEEDS_YOU_MAX:]

    digest: dict = {
        "subject": f"[Deadlines] {len(needs_you)} need you, {today.isoformat()}",
        "needs_you": [_digest_item(d, today, code_for(d)) for d in needs_you],
    }
    if admin:
        by_matter: dict[str, list[dict]] = {}
        for d in admin:
            by_matter.setdefault(d.matter_id, []).append(_digest_item(d, today, code_for(d)))
        digest["admin_confirms"] = {
            "total": len(admin),
            "matter_count": len(by_matter),
            "matters": [
                {
                    "matter_id": matter_id,
                    "count": len(items),
                    "ack_codes": [i["ack_code"] for i in items],
                    "items": items,
                }
                for matter_id, items in sorted(by_matter.items())
            ],
        }
    if elsewhere:
        digest["under_active_escalation_elsewhere"] = [
            _digest_item(d, today, None) for d in sorted(elsewhere, key=lambda d: d.matter_id)
        ]
    if clearance:
        digest["awaiting_clearance"] = [
            _digest_item(d, today, None) for d in sorted(clearance, key=lambda d: d.matter_id)
        ]
    if blanket:
        digest["blanket_ack_only"] = [
            _digest_item(d, today, None)
            for d in sorted(blanket, key=lambda d: ((d.authored_date - today).days, d.matter_id))
        ]
    if probe_stats and (probe_stats.get("excluded") or probe_stats.get("stale")):
        # ss #2403's daily loud channel: probe artifacts present on the tenant
        # are stated in the digest (excluded from work, and stale ones named for
        # teardown) rather than silently filtered.
        digest["probe_artifacts"] = dict(probe_stats)
    return digest


def _in_escalation_range(d: MatterDeadline, today: date, windows: EscalationWindows) -> bool:
    """True iff this authored deadline needs the ladder run now: the matter is
    open, the escalation is not yet acknowledged, and the authored date is within
    the escalation window or already past. Pure date comparison — no date is
    produced."""
    if not d.matter_open or d.acknowledged:
        return False
    return d.authored_date <= today + timedelta(days=windows.escalation_window_days)


def _rung_for(d: MatterDeadline, today: date, windows: EscalationWindows) -> str:
    """Which ladder rung a given in-range deadline maps to, by proximity. Held
    matters route to clearance regardless of proximity. Arithmetic compares the
    authored date to today; it never derives a date."""
    if d.conflict_hold:
        return "clearance"  # human conflict clearance, never a client-facing step
    days_out = (d.authored_date - today).days
    if days_out <= windows.notify_days:  # within notify window or overdue
        return "notify"
    if days_out <= windows.near_days:
        return "re-route"
    return "re-surface"


def decide(
    deadlines: Sequence[MatterDeadline],
    windows: EscalationWindows,
    *,
    raw_inputs_for_digest: bytes,
    today: date,
) -> WakeDecision:
    """Pure decision: does any authored deadline need the ladder run now?

    WAKE if any open, unacknowledged matter has an authored deadline in the
    escalation window (or overdue). SUPPRESS otherwise.
    """
    in_range = [d for d in deadlines if _in_escalation_range(d, today, windows)]
    if in_range:
        return WakeDecision(
            wake=True,
            decision_basis="deadline_in_escalation_range",
            pre_run_inputs_digest=raw_inputs_for_digest,
            plans=tuple(
                ItemPlan(
                    matter_id=d.matter_id,
                    task_id=d.task_id,
                    label=d.label,
                    authored_date=d.authored_date.isoformat(),
                    days_out=(d.authored_date - today).days,
                    rung=_rung_for(d, today, windows),
                    last_raised=d.last_raised,
                )
                for d in in_range
            ),
            extra_metadata={
                "matters": [
                    {
                        "matter_id": d.matter_id,
                        "label": d.label,
                        "days_out": (d.authored_date - today).days,
                        "rung": _rung_for(d, today, windows),
                    }
                    for d in in_range
                ],
            },
        )
    return WakeDecision(
        wake=False,
        decision_basis="no_deadline_in_escalation_range",
        pre_run_inputs_digest=raw_inputs_for_digest,
        extra_metadata={"deadline_count": len(deadlines)},
    )


# ---------------------------------------------------------------------------
# Runtime entrypoint — wires the deadline source + audit writer + stdout.
# ---------------------------------------------------------------------------


def _next_scheduled_at(now: datetime, schedule_hours: int = 24) -> str:
    return (now + timedelta(hours=schedule_hours)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# At most this many plans are serialized onto the wake line. A prompt-injected
# block is not free, and a firm with a hundred in-range dates does not need all
# hundred to start work. The cap ALWAYS announces itself (plans_total /
# plans_emitted / plans_truncated) — a truncated list that reads as complete is
# a check that cannot fail.
_MAX_SERIALIZED_PLANS = 50


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

_HANDOFF_SKILL = "deadline-miss-escalator"
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
    """Print the wake gate line — WITH the facts the gate already computed (#2253).

    Hermes reads only ``wakeAgent`` from the last stdout line and then injects
    the whole stdout verbatim into the woken agent's prompt (the "Script Output"
    block). Emitting a bare ``{"wakeAgent": true}`` therefore threw away every
    per-item fact ``decide`` had in hand: which matter, which authored date,
    which rung, when the Operator last raised it. On 2026-08-10 the escalator
    woke fact-free with the Smokeball connector down, and the alert it sent
    stated a specific "last raised" date in the same message that said it could
    not read dates (#2253). A gate that hands over a bare boolean is asking the
    turn to supply the facts from somewhere, and with no source reachable
    "somewhere" was invention.

    ``authored_date`` rides verbatim for the same reason ``days_out`` alone is
    not enough: re-deriving a date from an integer is producing a date.

    Fail-open callers have no decision — they pass ``basis`` so the woken turn
    knows it woke blind and must enumerate through the connector instead of
    treating an absent plan list as an empty one.
    """
    payload: dict = {"wakeAgent": True}
    resolved_basis = decision.decision_basis if decision is not None else basis
    if resolved_basis:
        payload["decision_basis"] = resolved_basis
    if decision is not None and decision.plans:
        emitted = decision.plans[:_MAX_SERIALIZED_PLANS]
        payload["plans"] = [
            {
                "matter_id": p.matter_id,
                "task_id": p.task_id,
                "label": p.label,
                "authored_date": p.authored_date,
                "days_out": p.days_out,
                "rung": p.rung,
                "last_raised": p.last_raised,
                # Provenance, stated in the payload rather than assumed by the
                # reader: this timestamp is the OPERATOR's escalation ledger,
                # which records only raises that sent successfully. Null means
                # "no Operator raise on record", never "not raised".
                "last_raised_source": "operator_ledger",
            }
            for p in emitted
        ]
        payload["plans_total"] = len(decision.plans)
        payload["plans_emitted"] = len(emitted)
        payload["plans_truncated"] = len(emitted) < len(decision.plans)
    if decision is not None and decision.digest is not None:
        # ss #2405: the projected digest — computed over the FULL universe,
        # deliberately NOT subject to the plan cap. The turn renders it
        # verbatim; its counts are list lengths by construction.
        payload["digest"] = decision.digest
    _write_pre_run_handoff(payload)
    print(json.dumps(payload))
    return 0


def _plan_counts(decision: "WakeDecision") -> dict:
    """The cap's own accounting, computed the one way ``_emit_wake`` computes it.

    Duplicating the slice in the audit path would let the row and the wake line
    disagree about how much was handed over — a discrepancy nobody would look
    for, in the one record kept to catch discrepancies.
    """
    counts: dict = {}
    if decision.plans:
        emitted = len(decision.plans[:_MAX_SERIALIZED_PLANS])
        counts = {
            "plans_total": len(decision.plans),
            "plans_emitted": emitted,
            "plans_truncated": emitted < len(decision.plans),
        }
    if decision.digest is not None:
        # ss #2405: the projection's fingerprint + headline counts go on the
        # EMITTED_WAKE row, so a post-hoc audit pass can diff the SENT digest
        # against what the gate projected — the copy-verbatim contract's
        # enforcement seam (a SKILL.md sentence alone is the mechanism that
        # already failed).
        canonical = json.dumps(decision.digest, sort_keys=True, separators=(",", ":"))
        counts["digest_sha256"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        counts["digest_needs_you"] = len(decision.digest.get("needs_you") or [])
        admin = decision.digest.get("admin_confirms") or {}
        counts["digest_admin_total"] = int(admin.get("total") or 0)
    return counts


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
    of the ticks it fired. On 2026-08-10 the escalator woke with the Smokeball
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

    Not called on the fail-open paths: `no_audit_writer_fail_open` fires because
    there is no writer to call, and `suppress_heartbeat_failed_fail_open` fires
    because a write to that writer just failed.
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


def _deadline_to_dict(d: MatterDeadline) -> dict:
    return {
        "matter_id": d.matter_id,
        "authored_date": d.authored_date.isoformat(),
        "label": d.label,
        "matter_open": d.matter_open,
        "conflict_hold": d.conflict_hold,
        "acknowledged": d.acknowledged,
        "task_id": d.task_id,
    }


async def run_once(
    sources: Sequence[DeadlineSource],
    windows: EscalationWindows,
    audit_writer_factory,  # () -> SuppressedWakeWriter | None
    *,
    skill_name: str = "deadline-miss-escalator",
    today: date | None = None,
    now: datetime | None = None,
    fire_policy: FirePolicy | None = None,
    ledger_events: Sequence[dict] | None = None,
) -> int:
    """Driver. Returns the exit code; emits stdout JSON as a side effect.

    ``audit_writer_factory`` is called only when we would suppress. The factory
    may return None to signal "no audit writer wired (dev mode)" — in which case
    suppression falls back to wake (mirror-don't-gate).

    The pull is joined against the escalation ledger (``enrich_with_ledger``) so
    an item that already fired inside its re-fire window, or was acked and is
    still snoozed, does NOT re-wake the ladder — the fix for the daily re-fire.
    ``fire_policy``/``ledger_events`` default to the live config + the on-disk
    ledger; tests inject them directly."""
    now = now or datetime.now(timezone.utc)
    today = today or now.date()
    if fire_policy is None:
        _windows_unused, fire_policy = load_escalation_config()
    deadlines: list[MatterDeadline] = []
    raw_input_blob: bytes = b""
    for source in sources:
        pulled = list(source.pull_deadlines())
        deadlines.extend(pulled)
        raw_input_blob += json.dumps(
            [_deadline_to_dict(d) for d in pulled], sort_keys=True
        ).encode("utf-8")

    deadlines = enrich_with_ledger(
        deadlines, today=today, policy=fire_policy, ledger_events=ledger_events
    )

    decision = decide(
        deadlines,
        windows,
        raw_inputs_for_digest=raw_input_blob,
        today=today,
    )
    if decision.wake:
        # ss #2405: project the digest from the FULL enriched universe (never
        # the capped plan list). Ledger unavailable → no projection; the turn
        # composes without one and states that the projection was unavailable.
        ledger = _load_ledger_module()
        if ledger is not None:
            probe_stats: dict = {}
            for source in sources:
                stats = getattr(source, "probe_stats", None)
                if isinstance(stats, dict):
                    for k in ("excluded", "stale"):
                        probe_stats[k] = probe_stats.get(k, 0) + int(stats.get(k) or 0)
                    ids = stats.get("stale_task_ids") or []
                    if ids:
                        probe_stats.setdefault("stale_task_ids", []).extend(ids[:5])
            decision = replace(
                decision,
                digest=project_digest(
                    deadlines,
                    windows,
                    ledger,
                    today=today,
                    probe_stats=probe_stats or None,
                ),
            )
        # The row goes in BEFORE the wake line, and cannot stop it (#2253).
        await _try_write_emitted_wake(
            audit_writer_factory, decision, skill_name=skill_name, now=now
        )
        return _emit_wake(decision)

    writer = audit_writer_factory()
    if writer is None:
        # Mirror-don't-gate: no writer = no heartbeat trail = always wake.
        return _emit_wake(basis="no_audit_writer_fail_open")
    try:
        await writer.write_suppressed_wake(
            skill_name=skill_name,
            pre_run_inputs=decision.pre_run_inputs_digest,
            decision_basis=decision.decision_basis,
            next_scheduled_at=_next_scheduled_at(now),
            extra_metadata=decision.extra_metadata,
        )
    except Exception:  # noqa: BLE001 — any audit failure → wake (dead-man's-switch)
        return _emit_wake(basis="suppress_heartbeat_failed_fail_open")
    return _emit_suppress()


# ---------------------------------------------------------------------------
# Production wiring (#1748, ADR 0021 Stream B). The Smokeball pull runs in the
# connector's own venv via subprocess (smokeball_connector is not importable
# from the Hermes venv this script runs in); the SUPPRESSED_WAKE heartbeat goes
# through the broker's uid-gated `suppressed_wake_append` verb (a cron pre_run
# is a gateway CHILD — agent uid, non-gateway PID — so the strict audit_append
# PID gate correctly rejects it). Every unknown stays conservative: pull
# failure, unrecognized envelope, zero parseable dates on a non-empty pull,
# heartbeat failure — all wake.
# ---------------------------------------------------------------------------

_CONNECTOR_PYTHON_DEFAULT = "/opt/connectors/smokeball/.venv/bin/python"
_PULL_TIMEOUT_SECONDS = 60
_HEARTBEAT_TIMEOUT_SECONDS = 10

# Runs inside the connector venv. Both pulls are attempted independently and
# errors are REPORTED, not swallowed — a partial view must not suppress.
_PULL_SNIPPET = """\
import json
import sys

from smokeball_connector.client import build_client_from_env

frm, to = sys.argv[1], sys.argv[2]
client = build_client_from_env()
out = {}
try:
    out["tasks"] = client.get("/tasks", IsCompleted=False, Limit=500)
except Exception as exc:
    out["tasksError"] = str(exc)[:300]
try:
    out["events"] = client.get("/events", From=frm, To=to, Limit=500)
except Exception as exc:
    out["eventsError"] = str(exc)[:300]
print(json.dumps(out, default=str))
"""

_TASK_DATE_KEYS = ("dueDate", "DueDate", "due_date")
_EVENT_DATE_KEYS = ("startTime", "StartTime", "startDate", "start", "from")
_SUBJECT_KEYS = ("subject", "Subject", "name", "Name", "title", "Title")

# Rehearsal/self-test artifacts carry "[SMD-PROBE <stamp>]" at the start of the
# subject (after the connector's "[Operator]" provenance stamp) — ss #2403: a
# probe task outlived its test and became a live chase's tracking anchor. Probe
# rows are never deadlines. Position-anchored on purpose: a real task QUOTING
# the marker mid-subject must not be hidden (a deadline watcher that can be
# silenced by subject text is the dangerous failure).
_PROBE_MARK = "[SMD-PROBE"
_PROVENANCE_MARK = "[Operator]"


def _is_probe_item(item: dict) -> bool:
    subject = ""
    for key in _SUBJECT_KEYS:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            subject = value
            break
    text = subject.lstrip()
    if text.upper().startswith(_PROVENANCE_MARK.upper()):
        text = text[len(_PROVENANCE_MARK) :].lstrip()
    return text.upper().startswith(_PROBE_MARK.upper())
_MATTER_ID_KEYS = ("matterId", "MatterId", "matter_id", "id")
# The Smokeball task/event id, extracted INDEPENDENTLY of matter id (a task's
# own ``id`` is not its matter) — the anti-collision half of item identity.
_SOURCE_ID_KEYS = ("id", "Id", "taskId", "TaskId", "eventId", "EventId")


def _extract_items(payload) -> list | None:
    """Defensive envelope unwrap; None means the shape is unrecognized."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "value", "results", "tasks", "events", "data"):
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


def _matter_id_of(item: dict) -> str:
    # The live Smokeball /tasks payload carries the matter as a NESTED link
    # object ({"matter": {"id": ..., "href": ...}}), not a flat matterId —
    # found by the WP-D probe (ss #1915). The flat keys stay as fallbacks; the
    # bare "id" fallback is last (it is the TASK's own id, kept only for the
    # calendar-entry shapes that flatten differently).
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
    """The item's own stable Smokeball id, or None. Never falls back to the
    matter id — a per-item ack token keyed on the matter would silence every
    item on that matter."""
    for key in _SOURCE_ID_KEYS:
        value = item.get(key)
        if isinstance(value, (str, int)) and str(value).strip():
            return str(value)
    return None


# A probe artifact older than this is stale: its rehearsal is over and its
# teardown never ran (ss #2403). Age comes from the ISO stamp INSIDE the
# marker ("[SMD-PROBE 2026-08-18T14:00Z] ..."), not from an API field this
# vendor may or may not serve; a marker with no parseable stamp is stale
# immediately (a malformed probe is a probe someone must look at).
_PROBE_STALE_HOURS = 24


def _probe_stamp_of(item: dict) -> datetime | None:
    subject = ""
    for key in _SUBJECT_KEYS:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            subject = value
            break
    text = subject.lstrip()
    if text.upper().startswith(_PROVENANCE_MARK.upper()):
        text = text[len(_PROVENANCE_MARK) :].lstrip()
    rest = text[len(_PROBE_MARK) :].lstrip()
    stamp = rest.split("]", 1)[0].strip()
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None


def parse_pull(
    raw: dict, *, now: datetime | None = None
) -> tuple[list[MatterDeadline], str | None, dict]:
    """Pure parse of the connector pull. Returns (deadlines, problem, probe_stats).

    A non-None problem means the view is partial or unrecognizable and the
    caller MUST wake. Dateless items are skipped (a task without a due date
    is not an authored deadline) — but a non-empty pull yielding ZERO
    parseable dates is treated as an unrecognized wire shape, not an empty
    deadline book. Every date here was read, never computed.

    ``probe_stats`` is the ss #2403 census: how many probe-marked artifacts the
    pull excluded, and how many of those are STALE (marker stamp older than
    ``_PROBE_STALE_HOURS``, or unparseable). Exclusion must never be silent —
    the digest projection renders the census so a leftover probe is surfaced
    daily instead of quietly filtered forever.
    """
    probe_stats: dict = {"excluded": 0, "stale": 0, "stale_task_ids": []}
    for error_key in ("tasksError", "eventsError"):
        if raw.get(error_key):
            return [], f"pull error: {error_key}={raw[error_key]}", probe_stats
    tasks = _extract_items(raw.get("tasks"))
    events = _extract_items(raw.get("events"))
    if tasks is None or events is None:
        return [], "unrecognized pull envelope", probe_stats
    deadlines: list[MatterDeadline] = []
    total_items = 0
    for items, keys, label in (
        (tasks, _TASK_DATE_KEYS, "task-deadline"),
        (events, _EVENT_DATE_KEYS, "court-date"),
    ):
        for item in items:
            if not isinstance(item, dict):
                continue
            if _is_probe_item(item):
                # ss #2403: probe artifacts are never deadlines — counted, and
                # aged off the stamp inside their own marker.
                probe_stats["excluded"] += 1
                stamp = _probe_stamp_of(item)
                reference = now or datetime.now(timezone.utc)
                if stamp is None or (
                    reference - stamp
                ) >= timedelta(hours=_PROBE_STALE_HOURS):
                    probe_stats["stale"] += 1
                    if len(probe_stats["stale_task_ids"]) < 5:
                        sid = _source_id_of(item)
                        if sid:
                            probe_stats["stale_task_ids"].append(sid)
                continue
            total_items += 1
            authored = _first_date(item, keys)
            if authored is None:
                continue
            deadlines.append(
                MatterDeadline(
                    matter_id=_matter_id_of(item),
                    authored_date=authored,
                    label=label,
                    matter_open=True,
                    conflict_hold=False,
                    # ``acknowledged`` here is the pure-parse default; the real
                    # per-item state is joined from the escalation ledger in
                    # run_once (see enrich_with_ledger). Carrying the stable
                    # source id makes that join collision-safe.
                    acknowledged=False,
                    task_id=_source_id_of(item),
                )
            )
    if total_items > 0 and not deadlines:
        return [], "non-empty pull with zero parseable dates", probe_stats
    return deadlines, None, probe_stats


class SmokeballSubprocessSource:
    """DeadlineSource over a connector-venv subprocess pull.

    ``probe_stats`` holds the last pull's ss #2403 probe census (read by
    run_once after the pull; the DeadlineSource protocol itself stays a plain
    deadlines pull)."""

    def __init__(self, windows: EscalationWindows, today: date) -> None:
        self._windows = windows
        self._today = today
        self.probe_stats: dict | None = None

    def pull_deadlines(self) -> Sequence[MatterDeadline]:
        connector_python = os.environ.get(
            "SMD_CONNECTOR_VENV_PYTHON", _CONNECTOR_PYTHON_DEFAULT
        )
        frm = self._today.isoformat()
        to = (self._today + timedelta(days=self._windows.escalation_window_days)).isoformat()
        result = subprocess.run(  # raises on timeout → caller wakes
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args — argv[0] is the module-constant connector-venv interpreter, overridable only via SMD_CONNECTOR_VENV_PYTHON from the Machine's own boot env (same trust domain; the test seam). The snippet is a module constant; frm/to are date.isoformat() strings computed here, never external input.
            [connector_python, "-c", _PULL_SNIPPET, frm, to],
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
        deadlines, problem, probe_stats = parse_pull(raw)
        self.probe_stats = probe_stats
        if problem:
            raise RuntimeError(problem)
        return deadlines


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
    windows, fire_policy = load_escalation_config()
    today = datetime.now(timezone.utc).date()
    source = SmokeballSubprocessSource(windows, today)
    try:
        return asyncio.run(
            run_once(
                [source], windows, _writer_factory, today=today, fire_policy=fire_policy
            )
        )
    except Exception as exc:  # noqa: BLE001 — any wiring failure → wake
        sys.stderr.write(f"[pre_run] escalator pre_run failed ({exc}); waking\n")
        return _emit_wake(basis="pre_run_crashed_fail_open")


if __name__ == "__main__":
    sys.exit(main())
