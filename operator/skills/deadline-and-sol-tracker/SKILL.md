---
name: deadline-and-sol-tracker
description: Surfaces the firm's authored court dates, filing deadlines, and statute-of-limitations dates by proximity — overdue, imminent, upcoming. Reflects dates a human entered; never computes a limitation period.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: [python3]
metadata:
  hermes:
    tags: [Law, Deadlines, Calendar, Internal, DraftForReview]
  smd:
    vertical: law-firm
    skill_type: read + assembly (internal surfacing)
    trust_ceiling: draft_for_review
    action_class: read + internal_write
    connectors:
      - clio # PracticeManagement — list_calendar_entries / list_tasks (read) for authored dates
---

# Deadline and SOL Tracker

Surfaces the firm's **authored** critical dates — court dates, filing deadlines, response windows, and statute-of-limitations dates that a human has entered into the system — bucketed by proximity so nothing critical arrives by surprise. It is the date-awareness layer for the practice.

This skill is the **nearest of all the law skills to legal judgment**, so it is drawn with the hardest line: **it tracks dates a human authored; it never computes one.** A statute of limitations is a legal determination — the date the deadline falls is the lawyer's to set. This skill reads the date the lawyer set and tells them it is coming. It does not calculate "three years from the incident," does not infer a filing window from a rule, and does not advise. Authored in, surfaced out.

## When to Use

Use when the firm wants a standing view of what is coming due across matters — the dates that, if missed, cause real harm. A principal otherwise reconstructs this by clicking through every matter's calendar; this assembles it, sourced and honest about what it can and cannot know.

Runs scheduled (e.g., a daily or Monday-morning scan).

## Prerequisites

Reads Clio (`list_calendar_entries` for authored court/filing dates, `list_tasks` for deadline-bearing tasks via `due_at`). Requires `python3` for the fetch block. Internal output only. No write to funds, matters, or dates.

## How to Run

```
hermes run deadline-and-sol-tracker                 # full scan, all open matters
hermes run deadline-and-sol-tracker --window 30d    # only dates within N days
hermes run deadline-and-sol-tracker --matter <id>   # one matter's dates
```

## Procedure

Two phases (ADR 0021 Stream A). The mechanical per-matter date fetch runs in one `execute_code` block; the bucketing and surfacing stay in the agent's reasoning loop.

### Phase 1 — Fetch (single `execute_code` block)

Enumerate open matters, then per matter pull `list_calendar_entries` (court dates, hearings, authored deadline events) and `list_tasks` (tasks carrying a `due_at`). Accumulate in-process; `print()` one JSON document of (matter → authored dates with their source type and date). A matter whose dates can't be read is a `parse_failed` row; the scan does not abort.

### Phase 2 — Reason (agent, in-context)

Per `references/algorithm.md`:

1. **Bucket by proximity** — `overdue` (past, still open), `imminent` (within the firm's near window), `upcoming` (within the scan window). Buckets are date arithmetic on authored dates only.
2. **Label the source** — each date is tagged court-date / filing-deadline / SOL / task-deadline as authored. The label is read from how the human entered it; the skill does not classify a date as an SOL on its own.
3. **Flag missing-where-expected** — if firm policy says a matter type should carry an SOL date and none is authored, surface **"no authored deadline on file"** for a human to address. This is the one place the skill points at an absence — and it points, it does not fill.
4. **Assemble the surface** — dates per matter, by bucket, each sourced and labeled, to the firm-internal surface per `references/output-format.md`.

## Trust Ceiling

**Read + assemble + surface autonomous; internal-only; zero date computation.**

The agent MAY: read authored calendar entries and task due dates; bucket them by proximity; flag a matter that lacks an expected authored deadline; write the surface to the firm-internal notes surface.

The agent MUST NOT: compute, infer, or estimate a limitation period or any deadline; advise on timeliness; move a date; send anything to a client; present a computed date as if authored.

## Safety invariants (any violation → `fails`, no recovery)

1. **Never computes a deadline.** Every date surfaced is one a human authored. The skill does no date math beyond comparing authored dates to today for bucketing.
2. **No legal advice.** It surfaces "this date is coming"; it never says whether a filing is timely or what the limitation is.
3. **Missing is flagged, not filled.** An absent expected deadline is surfaced as absent; the skill never supplies a plausible date.
4. **No fabrication.** Every date traces to a Clio read with its authored source label.
5. **Internal + privilege.** The surface is for the firm; it stays on firm surfaces.

## Pitfalls

Computing "X years from the incident" — the cardinal sin here; inferring a filing window from a court rule; labeling a generic calendar entry as an SOL the human didn't mark; presenting a missing deadline as though a date were known; sending date reminders to clients (this skill is internal — client-facing date communication is a separate, reviewer-sent concern).

## Verification

1. Every surfaced date traces to an authored Clio calendar entry or task `due_at` — none computed.
2. Buckets (overdue/imminent/upcoming) are correct date arithmetic against today.
3. Source labels match how the human authored each date; no date is self-classified as an SOL.
4. Matters missing an expected authored deadline are flagged as missing, not filled.
5. Nothing is sent to a client; the surface is firm-internal.

## References

- `references/algorithm.md` — the proximity buckets, the authored-only rule, and the missing-where-expected flag logic
- `references/output-format.md` — the by-matter, by-bucket date surface _(parity fast-follow)_
- `references/test-cases.md` — fixtures incl. overdue/imminent/upcoming, an authored SOL, and a missing-expected-deadline matter _(parity fast-follow)_
