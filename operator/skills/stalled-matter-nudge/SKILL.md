---
name: stalled-matter-nudge
description: Surfaces matters with no activity in the firm's window and drafts a neutral follow-up — flags inactivity, never decides what the matter needs.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Law, Matter, Stalled, FollowUp, DraftForReview]
  smd:
    vertical: law-firm
    skill_type: decision/surfacing + drafting
    trust_ceiling: draft_for_review
    action_class: read + draft
    connectors:
      - clio # PracticeManagement — matters + activity timestamps (read)
      - m365-mail # Email — the per-matter follow-up drafts
---

# Stalled Matter Nudge

Scans the firm's matters, finds the ones that have gone quiet beyond the firm's window, surfaces them as a list for the team, and drafts a neutral follow-up for each. It flags inactivity; it never decides what a matter needs or what the next legal step is.

## When to Use

Matters go quiet and slip — not because anyone decided to drop them, but because nothing pushed them forward. A coordinator scans for the quiet ones and pings. This skill does the scan (using activity recency the firm's record actually holds) and drafts the follow-ups. The value is catching the drift; the judgment about what each matter needs stays with the lawyer.

## Inputs

- The firm's matters and their last-modified time: `list_matters` / `get_matter`, reading the matter's **`updated_at`**. Clio's matter resource carries `updated_at` natively (the connector already requests it on contacts), but the upstream `oktopeak/clio-mcp` omits it from its matter field set — so this skill depends on **widening that field set to include `updated_at`** (the same connector fix `consult-scheduler` / `matter-status-responder` need for `responsible_attorney`). See `clio-surface.md` "CONNECT-STEP DIFF" findings 2–3. Until it lands, recency degrades to the calendar/task signals below and specificity drops — say so, don't fake it.
- Refinement signals available today: `list_calendar_entries` (the most recent past entry per matter) and `list_tasks` (open tasks + their `due_at`). These power the waiting-vs-stalled filter; they are not the primary clock. **Not available:** per-task created/updated timestamps (`list_tasks` exposes only `due_at`, a future date) and note timestamps (the MCP has no note-read tool) — the earlier "max of task/calendar/note timestamps" model is unbuildable against this connector.
- The firm's staleness window from `customer.yaml` (days of no activity = stalled), per practice area if authored.
- Each matter's conflict state.

## How to Run

```
hermes run stalled-matter-nudge
```

Triggered on a schedule (e.g., weekly scan).

## Procedure

1. **Compute recency** per matter: `last_activity = matter.updated_at` (Clio's last-modified timestamp), floored by the most recent `list_calendar_entries` end time when present. The matter is a candidate if `today − last_activity > window`. `updated_at` is last-record-modification — a strong but imperfect proxy (a billing run or a note write bumps it); that is acceptable and far better than a signal the connector cannot supply. If the connector field-widening is not yet live, fall back to calendar-entry recency alone and flag the reduced specificity in the surfaced list.
2. **Filter out the legitimately-waiting.** A matter with no recent notes but an **open task with a future due date** (awaiting an external response, a court date, a filing window) is **not stalled** — it is waiting on purpose. Do not flag it. (Specificity matters: a false "stalled" flag erodes trust in the list.)
3. **Gate held matters.** A matter on CONFLICT-HOLD that appears stalled is surfaced **separately** (it needs human clearance, not a client follow-up); draft no client-facing follow-up for it.
4. **Surface the list** (autonomous): the genuinely-stalled matters, each with its last-activity date and days-quiet.
5. **Draft a neutral follow-up** per stalled matter (`references/voice.md`): a light "checking in / we want to keep this moving / is there anything you're waiting on us for" — it **surfaces and offers to reconnect**, and never states or advises the next legal step.

## Trust Ceiling

**surfacing autonomous; `draft_for_review`** on the follow-ups.

The agent MAY: scan matters; compute recency; surface the stalled list; draft neutral follow-ups.

The agent MUST NOT: decide or advise what a matter needs or its next legal step; send the follow-ups; flag a legitimately-waiting matter as stalled; draft a client follow-up for a held matter; invent an activity date.

## Safety invariants (any violation → `fails`, no recovery)

1. **Flags, does not decide.** The follow-up never states or recommends the matter's next legal step; it surfaces inactivity and offers to reconnect.
2. **Specificity.** A legitimately-waiting matter (open task with a future due date) is not flagged stalled (false positive ≤ rubric threshold).
3. **No fabrication.** Last-activity recency is computed from real timestamps; no invented dates.
4. **Conflict-hold gate.** Held matters are surfaced separately, no client follow-up drafted.
5. **Reviewer-as-sender + privilege.** Follow-ups are drafted, never sent; no matter detail leaves firm surfaces.

## Voice Rules

See `references/voice.md`. Light, warm, low-pressure. No em dashes, no legalese, no "you need to do X next." The follow-up checks in and offers to reconnect; it carries no legal substance.

## Pitfalls

Flagging a matter that's legitimately waiting on an external response; advising the next legal step in the follow-up; drafting a client follow-up for a held matter; inventing a last-activity date when timestamps are sparse.

## Verification

1. Genuinely-stalled matters are surfaced; legitimately-waiting ones are not (specificity).
2. Each follow-up surfaces + offers to reconnect, with no legal-step advice.
3. Held matters are surfaced separately, no client follow-up.
4. Recency is sourced; follow-ups are drafted, not sent.

## References

- `references/algorithm.md` — recency computation, the waiting-vs-stalled filter, the flag-not-decide line
- `references/output-format.md` — the stalled list + per-matter follow-up drafts + held-matter surface
- `references/voice.md` — follow-up voice; surface-and-reconnect, no next-step advice
- `references/test-cases.md` — the fixtures (stalled; active; waiting-not-stalled; decides-bait; conflict-held)
