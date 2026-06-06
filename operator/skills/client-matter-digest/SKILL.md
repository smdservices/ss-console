---
name: client-matter-digest
description: Drafts a proactive, client-facing per-matter status update — what's happened, what's coming, what's needed from the client — from Clio reads, in the firm's voice, for a human to send. Reports status; never advises or predicts.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: [python3]
metadata:
  hermes:
    tags: [Law, Client, Status, Proactive, DraftForReview]
  smd:
    vertical: law-firm
    skill_type: drafting (client-facing)
    trust_ceiling: draft_for_review
    action_class: read + external_send
    connectors:
      - clio # PracticeManagement — matters, tasks, calendar (read) for the status facts
      - email # customer-bound — the drafted client update (send is reviewer-as-sender)
---

# Client Matter Digest

Drafts a proactive update to the client about where their matter stands — recent activity, upcoming dates, and anything the firm needs from them — assembled from Clio and written in the firm's voice for a human to send. It is the outbound, scheduled counterpart to the reactive `matter-status-responder` (which answers one client who asked). Same status facts, opposite trigger: the firm reaching out before the client wonders.

It **reports status; it never advises, predicts, or commits.** It tells the client what has happened and what is scheduled — it does not say what will happen, whether an outcome is likely, or what the client should do legally. Every fact traces to Clio; the message ships under a human reviewer's identity.

## When to Use

Use when the firm wants to keep clients informed on a cadence instead of waiting for "where are we?" emails — the proactive-communication habit that distinguishes a well-run practice. Most matters benefit; the firm authors which matters or practice areas get a digest and how often.

Runs scheduled (e.g., a fortnightly per-matter cadence the firm sets).

## Prerequisites

Reads Clio (`get_matter`, `list_tasks`, `list_calendar_entries`) for the status facts, and the customer-bound **Email** connector to draft the client update. Requires `python3` for the fetch block. The draft is **never sent autonomously** — it ships under the reviewer's identity (reviewer-as-sender, ADR 0005).

## How to Run

```
hermes run client-matter-digest                    # all matters due for a cadence update
hermes run client-matter-digest --matter <id>      # one matter's client update
```

## Procedure

Two phases (ADR 0021 Stream A). The mechanical per-matter Clio fetch runs in one `execute_code` block; the client-appropriate framing and drafting stay in the agent's reasoning loop.

### Phase 1 — Fetch (single `execute_code` block)

For each matter due for an update, pull `get_matter` (stage/status), `list_tasks` (open items, including anything `waiting on client`), and `list_calendar_entries` (upcoming dates the client should know). Accumulate in-process; `print()` one JSON document of (matter → status facts). A matter that can't be read is `parse_failed`; the run continues.

### Phase 2 — Reason (agent, in-context)

Per `references/algorithm.md` and `references/voice.md`:

1. **Select client-appropriate facts.** What progressed since the last update, what is scheduled, and — most useful — **what the firm needs from the client** (a signature, a document, a decision). Internal-only detail (billing internals, strategy notes) stays out.
2. **Frame as status, not advice.** "Your hearing is scheduled for [date]" — yes. "We expect a favorable ruling" / "you should accept the offer" — never. The line between informing and advising is the central discipline.
3. **Draft in the firm's voice** (`voice.md`) — warm, plain, professional; no legalese, no false reassurance, no invented progress. If little has happened, say so honestly rather than manufacture activity.
4. **Surface for review.** The drafted client update is surfaced; a human reviews and sends it under their own identity. Nothing goes to the client autonomously.

## Trust Ceiling

**Read + draft autonomous; client send is reviewer-as-sender (`draft_for_review`, non-raisable).**

The agent MAY: read Clio status facts; select client-appropriate content; draft the update in the firm's voice; surface it for review.

The agent MUST NOT: send to a client autonomously; give legal advice or predict an outcome; invent progress, a date, or a status; include privileged internal detail; promise firm behavior the engagement has not authored.

## Safety invariants (any violation → `fails`, no recovery)

1. **Reviewer-as-sender.** No autonomous send. Every client-bound digest ships under a human reviewer's identity.
2. **Status, not advice.** Reports what happened and what is scheduled; never advises, predicts an outcome, or recommends a legal action.
3. **No fabrication.** Every fact traces to a Clio read. A quiet matter is described as quiet, not dressed up.
4. **No internal leakage.** Billing internals, strategy, and other firm-only detail never enter a client-facing draft.
5. **No uncontracted promise.** The draft states status; it does not promise timelines or outcomes the engagement has not authored.

## Pitfalls

Drifting from "here's where things stand" into "here's what we expect / what you should do" (advice/prediction — the cardinal error); manufacturing progress to fill a quiet update; leaking internal notes or billing detail into a client message; an over-reassuring tone that implies an outcome; letting a draft send without human review.

## Verification

1. Every status fact in the draft traces to a Clio read; nothing invented.
2. No sentence advises, predicts an outcome, or recommends a legal step.
3. No privileged internal detail appears in the client-facing text.
4. The draft is surfaced for review; no autonomous send occurs.
5. Quiet matters are described honestly, not embellished.

## References

- `references/algorithm.md` — client-appropriate fact selection, the status-not-advice line, the cadence logic
- `references/voice.md` — the firm's client-communication voice (warm, plain, no false reassurance) _(parity fast-follow)_
- `references/output-format.md` — the client update structure _(parity fast-follow)_
- `references/test-cases.md` — fixtures incl. active matter, quiet matter, waiting-on-client, and an advice-bait case _(parity fast-follow)_
