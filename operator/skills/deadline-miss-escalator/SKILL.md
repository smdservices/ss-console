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
      - smokeball # PracticeManagement — list_tasks (read, due_date) for authored task deadlines; appointment dates via the mail/calendar binding
---

# Deadline Miss Escalator

Watches the firm's **authored** critical dates and, when one enters the escalation window or goes overdue without being handled, walks it up an escalation ladder so it cannot slip silently. It consumes the same authored dates `deadline-and-sol-tracker` surfaces; where the tracker is the standing mirror, this is the alarm that something on that mirror needs a human now.

Like the tracker, it is held to the hardest line: **it works to dates a human authored; it never computes one.** Its only arithmetic is comparing an authored date to today.

## When to Use

Runs **scheduled** (Hermes no-agent cron, ADR 0021 Stream B). A `pre_run.py` polls the authored dates each tick and only wakes the agent when a deadline actually needs a rung run — otherwise it writes a `SUPPRESSED_WAKE` heartbeat row and stays quiet. Never invoked interactively.

## The escalation ladder

Three rungs, chosen by proximity (arithmetic on authored dates only). All rungs are **internal** — nothing client- or tribunal-bound is ever sent.

1. **Re-surface** (outer window) — refresh the date on the firm-internal surface with an elevated flag, so it stands out from the standing tracker view.
2. **Re-route** (near window) — flag the matter to the responsible humans on the internal surface. Smokeball returns the responsible attorney directly (`personResponsibleStaffId`, resolved via `get_staff`), so re-route can target the matter's responsible attorney; it falls back to the firm's authored `escalation.red_flag_recipients` when no responsible attorney is set.
3. **Notify** (within the notify window, or overdue) — deliver an alert to the named human via the firm's existing `escalation.red_flag_recipients` channel, emitting an `ESCALATION_FIRED` audit row. The human acknowledges with `ESCALATION_ACKNOWLEDGED`, which closes the ladder for that deadline (it stops re-firing). This is an **internal alert to a person inside the firm**, not a client message — there is no external send.

**Held matters** route to **clearance**, not the ladder: a matter on CONFLICT-HOLD with an approaching date is surfaced for human clearance and never gets a client-facing step.

## Prerequisites

Reads Smokeball (`list_tasks` `due_date`) for authored task deadlines and the mail/calendar binding (`list_calendar_entries`) for appointment-style court/hearing dates, plus the firm's escalation-acknowledgment state. `python3` for the `pre_run.py` and fetch block. Internal output + the existing red-flag alert channel only. No write to funds, matters, or dates; no external send.

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

## Delivery channels + refusal fallback (law seat rule)

Email is a citation-free channel. Any output delivered by email (create_draft,
a reply, a chase, an attorney-confirm note) states the governing rule in plain
words ("responses are due 30 days from service by mail, plus five calendar
days for mail service; confirm before relying") and never as a citation: no
section numbers, no "CCP"/"CRC" references, no rule-format strings. The mail
channel enforces the legal-citation filter and will refuse the draft. Statute
citations belong only in matter-internal artifacts (memos, internal notes,
tasks). Write the FIRST draft citation-free; do not write a cited draft and
wait for the gate to teach you.

If a delivery tool refuses a draft or write (citation filter, banned-typography
gate, or any other content gate): do not retry the same content, and do not
drop the work. Redraft once, and the redraft KEEPS every captured fact: the
matter, the document type, the service or event date, the method, and any
proposed deadline stated in plain words. Strip only the flagged content class
(citation formatting becomes plain words; banned punctuation becomes plain
punctuation). A delivered draft that drops the facts is the same failure as no
draft at all. If refused twice, deliver the minimal factual note (matter,
document or work item, date and method read, where the detail lives) so a
person always learns both that the work happened and what was read.

Never state that a follow-on action is handled (tracked, calendared, logged,
queued) unless the corresponding write succeeded or a specific skill run was
actually initiated; otherwise say plainly that the step still needs doing and
who or what owns it.
