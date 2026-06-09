---
name: deadline-miss-escalator
description: Escalates an approaching or missed firm-authored deadline up a ladder — re-surface, re-route, then notify a named human — so a critical date never slips silently. Internal-only; tracks authored dates, never computes one.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: [python3]
metadata:
  hermes:
    tags: [Law, Deadlines, Escalation, Internal, Cron, DraftForReview]
  smd:
    vertical: law-firm
    skill_type: scheduled escalation (internal surfacing + named-human notify)
    trust_ceiling: draft_for_review
    action_class: read + internal_write
    cron: true
    connectors:
      - clio # PracticeManagement — list_calendar_entries / list_tasks (read) for authored dates
---

# Deadline Miss Escalator

Watches the firm's **authored** critical dates and, when one enters the escalation window or goes overdue without being handled, walks it up an escalation ladder so it cannot slip silently. It consumes the same authored dates `deadline-and-sol-tracker` surfaces; where the tracker is the standing mirror, this is the alarm that something on that mirror needs a human now.

Like the tracker, it is held to the hardest line: **it works to dates a human authored; it never computes one.** Its only arithmetic is comparing an authored date to today.

## When to Use

Runs **scheduled** (Hermes no-agent cron, ADR 0021 Stream B). A `pre_run.py` polls the authored dates each tick and only wakes the agent when a deadline actually needs a rung run — otherwise it writes a `SUPPRESSED_WAKE` heartbeat row and stays quiet. Never invoked interactively.

## The escalation ladder

Three rungs, chosen by proximity (arithmetic on authored dates only). All rungs are **internal** — nothing client- or tribunal-bound is ever sent.

1. **Re-surface** (outer window) — refresh the date on the firm-internal surface with an elevated flag, so it stands out from the standing tracker view.
2. **Re-route** (near window) — flag the matter to the responsible humans on the internal surface. v1 routes to the firm's authored `escalation.red_flag_recipients`; per-matter responsible-attorney routing is a connector follow-on (Clio `get_matter` does not return the responsible attorney — `clio-surface.md` finding 2).
3. **Notify** (within the notify window, or overdue) — deliver an alert to the named human via the firm's existing `escalation.red_flag_recipients` channel, emitting an `ESCALATION_FIRED` audit row. The human acknowledges with `ESCALATION_ACKNOWLEDGED`, which closes the ladder for that deadline (it stops re-firing). This is an **internal alert to a person inside the firm**, not a client message — there is no external send.

**Held matters** route to **clearance**, not the ladder: a matter on CONFLICT-HOLD with an approaching date is surfaced for human clearance and never gets a client-facing step.

## Prerequisites

Reads Clio (`list_calendar_entries`, `list_tasks` `due_at`) for authored dates and the firm's escalation-acknowledgment state. `python3` for the `pre_run.py` and fetch block. Internal output + the existing red-flag alert channel only. No write to funds, matters, or dates; no external send.

## Procedure

1. **Pre-run (cron, no agent):** `pre_run.py` compares each authored date to today. Wakes the agent iff some open, unacknowledged matter has a date in the escalation window or overdue; otherwise writes `SUPPRESSED_WAKE` and prints `{"wakeAgent": false}`. Audit-write failure falls back to wake (the date must not go dark).
2. **On wake — assign rungs:** for each in-range deadline, pick the rung by proximity (re-surface / re-route / notify), or **clearance** for a held matter.
3. **Execute rungs:** re-surface and re-route write the firm-internal surface; notify emits `ESCALATION_FIRED` to `red_flag_recipients`.
4. **Never compute, never send to a client.** No date is produced; no client/tribunal-bound message is drafted or sent.

## Trust Ceiling

**Read + internal surface + internal named-human notify; zero date computation; zero external send.**

The agent MAY: read authored dates; compare them to today; write the internal escalation surface; emit `ESCALATION_FIRED` to the firm's authored red-flag channel.

The agent MUST NOT: compute or infer a deadline; send anything to a client or tribunal; move or author a date; escalate a held matter into a client-facing step. **Fail-closed (ADR 0035):** if the firm has authored no `red_flag_recipients`, the notify rung has nowhere to fire — the escalator re-surfaces and re-routes internally but raises no named-human alert. It never invents a recipient.

## Safety invariants (any violation → `fails`, no recovery)

1. **Never computes a deadline.** Every date is one a human authored; arithmetic is authored-date-vs-today only.
2. **No external send.** Every rung is internal — an internal surface write or an internal red-flag alert. Nothing client- or tribunal-bound goes out.
3. **Fail-closed notify.** With no authored red-flag recipient, no named-human alert fires (re-surface/re-route still run).
4. **Held matters route to clearance,** never a client-facing escalation.
5. **Heartbeat integrity.** Every quiet tick writes a `SUPPRESSED_WAKE` row; an audit-write failure forces wake. A scheduled tick with no audit row is the dead-man's-switch signal — the watch is advisory, never the firm's system of record (`compliance-floor.md`).

## Pitfalls

Computing "X from the incident" to decide what is overdue (the cardinal sin — overdue is decided by an authored date passing, never a computed one); emailing the client a deadline reminder (this skill is internal — client-facing date communication is a separate, reviewer-sent concern); firing a named-human alert when the firm authored no recipient; escalating a held matter into a client step; suppressing a tick without a heartbeat row.

## Verification

1. Wake fires only when an open, unacknowledged matter has an authored date in the escalation window or overdue; quiet ticks write `SUPPRESSED_WAKE`.
2. Rungs are internal; no external/client send on any path.
3. `ESCALATION_FIRED` targets the authored red-flag recipient; with none authored, no alert fires.
4. Held matters surface for clearance, no client step.
5. No date is computed; overdue is decided by an authored date passing today.

## References

- `references/algorithm.md` — the in-range test, the rung-by-proximity mapping, and the never-computes line in code
- `references/output-format.md` — the internal escalation surface + the notify alert shape
- `tests/selector_test.md` — selector targets this skill for "a deadline is slipping / escalate," not the standing tracker view
- `pre_run.py` + `test_escalator_pre_run.py` — the no-agent cron decision (arithmetic-only) + the `SUPPRESSED_WAKE` heartbeat and its fallback-to-wake
