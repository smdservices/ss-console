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

import json
import os
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Protocol, Sequence


# ---------------------------------------------------------------------------
# Deadline source protocol — the real adapter reads Clio (list_calendar_entries
# + list_tasks due_at) and the firm's escalation-acknowledgment ledger.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MatterDeadline:
    """One AUTHORED critical date on a matter. ``authored_date`` was entered by a
    human and read from Clio — never computed here."""

    matter_id: str
    authored_date: date
    label: str  # authored: court-date | filing-deadline | sol | response-window | task-deadline
    matter_open: bool = True
    conflict_hold: bool = False
    acknowledged: bool = False  # a human already acked this escalation → stop re-firing


class DeadlineSource(Protocol):
    """Adapter the real Clio reader satisfies. Returns one MatterDeadline per
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
# Decision engine — pure function, no I/O. Unit-tested directly.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WakeDecision:
    wake: bool
    decision_basis: str
    pre_run_inputs_digest: bytes
    extra_metadata: dict = field(default_factory=dict)


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


def _emit_wake() -> int:
    print(json.dumps({"wakeAgent": True}))
    return 0


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
    }


async def run_once(
    sources: Sequence[DeadlineSource],
    windows: EscalationWindows,
    audit_writer_factory,  # () -> SuppressedWakeWriter | None
    *,
    skill_name: str = "deadline-miss-escalator",
    today: date | None = None,
    now: datetime | None = None,
) -> int:
    """Driver. Returns the exit code; emits stdout JSON as a side effect.

    ``audit_writer_factory`` is called only when we would suppress. The factory
    may return None to signal "no audit writer wired (dev mode)" — in which case
    suppression falls back to wake (mirror-don't-gate)."""
    now = now or datetime.now(timezone.utc)
    today = today or now.date()
    deadlines: list[MatterDeadline] = []
    raw_input_blob: bytes = b""
    for source in sources:
        pulled = list(source.pull_deadlines())
        deadlines.extend(pulled)
        raw_input_blob += json.dumps(
            [_deadline_to_dict(d) for d in pulled], sort_keys=True
        ).encode("utf-8")

    decision = decide(
        deadlines,
        windows,
        raw_inputs_for_digest=raw_input_blob,
        today=today,
    )
    if decision.wake:
        return _emit_wake()

    writer = audit_writer_factory()
    if writer is None:
        # Mirror-don't-gate: no writer = no heartbeat trail = always wake.
        return _emit_wake()
    try:
        await writer.write_suppressed_wake(
            skill_name=skill_name,
            pre_run_inputs=decision.pre_run_inputs_digest,
            decision_basis=decision.decision_basis,
            next_scheduled_at=_next_scheduled_at(now),
            extra_metadata=decision.extra_metadata,
        )
    except Exception:  # noqa: BLE001 — any audit failure → wake (dead-man's-switch)
        return _emit_wake()
    return _emit_suppress()


# ---------------------------------------------------------------------------
# CLI bootstrap. The cron daemon invokes this directly. Production wiring
# resolves the Clio deadline reader from customer.yaml and the audit writer from
# env (ADR 0008 d1_env). Until the reader adapter ships, the cron invocation
# falls through to wake — the agent wakes, the absence becomes visible.
# ---------------------------------------------------------------------------


def main() -> int:
    customer_slug = os.environ.get("CUSTOMER_SLUG")
    if not customer_slug:
        sys.stderr.write("[pre_run] CUSTOMER_SLUG unset; falling back to wake\n")
        return _emit_wake()
    sys.stderr.write(
        "[pre_run] deadline-miss-escalator Clio reader not yet wired; "
        "falling back to wake (see ADR 0021 Stream B follow-on)\n"
    )
    return _emit_wake()


if __name__ == "__main__":
    sys.exit(main())
