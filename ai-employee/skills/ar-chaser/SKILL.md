---
name: ar-chaser
description: "Watches AR aging from QuickBooks Online; drafts 7/14/30-day follow-up messages to clients with unpaid invoices; escalates at 45 days. Drafts only — owner ships."
version: pending
vertical: marketing-agency
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  connectors:
    - quickbooks # invoice + payment data
    - gmail      # drafts go here (never sent autonomously)
    - slack      # internal escalation alerts
metadata:
  hermes:
    tags: [Marketing, Agency, AR, Money, DraftForReview]
    action_class: read + internal_write
trust_ceiling: draft_for_review # touches money; categorically never autonomous
---

# AR Chaser

Reads aging-receivables data from QuickBooks Online, identifies invoices past 7 / 14 / 30 days, drafts polite follow-up messages, escalates to the owner at 45 days. The agent's drafts are sourced from the AR row — recipient, amount, invoice number, due date, days overdue. Every draft requires owner review before sending.

## Why this exists

AR follow-up is the single highest-leverage agency task that owners chronically skip. Every $5K-$15K invoice that lingers past 60 days is a real risk of write-off; clients who pay late once will pay later the next time unless gently corrected. Owners hate doing it because the messages feel pushy and templated; doing them well is judgment work.

This skill reduces it to: every morning, owner reviews 3-8 drafts pre-tuned to the relationship history. Edits 30 seconds each, ships from their inbox. Aging stays under control without the emotional tax.

## How to invoke

Daily cadence (8am PT) via cron-skill:

```
hermes run ar-chaser
```

On-demand for a specific client:

```
hermes run ar-chaser --client "Acme Co"
```

## What the agent does

1. **Pull AR aging.** QBO Aging Detail report for the agency. Filter invoices past 7+ days.
2. **For each overdue invoice, decide the cadence step.**
   - 7-13 days overdue: gentle reminder, blame-the-postal-system tone
   - 14-29 days: firmer; ask if they need anything to process
   - 30-44 days: direct; reference payment terms; offer to call
   - 45+ days: ESCALATE to owner in Slack; do not draft another email (owner needs to call or pause services)
3. **Draft per the cadence.** Pull the client's prior threads from Gmail to match voice and reference any prior conversation. Use templates in `references/output-format.md` as starting structure, but voice-match per-client.
4. **Check for context.** If the client recently sent any email mentioning payment ("payment is in process," "we'll get to it next week"), the agent's draft acknowledges that and offers to follow up at the date they named — does not just repeat the same dunning sequence.
5. **Surface unusual patterns.** If a normally-prompt client is suddenly 30 days late, flag it as a relationship-health signal in the Slack thread. If multiple clients of the same vendor stack are late, that's a market signal to surface.
6. **Write to drafts.** `customer_notes/drafts/ar/{client}-{invoice-id}-{stage}.md`. Slack post in `ar-drafts` channel summarizing the day's drafts + escalations.

## Trust ceiling

**draft_for_review** is non-negotiable. AR touches money + client relationships. Even if a customer says "you can send these for me," the SOW does not authorize it and the substrate enforces draft-only on `gmail.send` for this skill.

The agent MAY:

- Read QBO Aging Detail and individual invoice records
- Read prior Gmail threads for context (read scope only)
- Write drafts to the drafts folder
- Post Slack alerts in `ar-drafts`
- Tag `@<owner>` on 45+ day escalations

The agent MUST NOT:

- Send any email to a client
- Modify the QBO invoice (mark paid, write off, adjust amount)
- Pause services to a client autonomously (owner-only decision)
- Forecast that "the client will pay tomorrow" — only state what's verifiable

## Voice rules specific to AR

- Never adversarial. Even at 45+ days, the draft assumes good faith.
- Never reference legal action, late fees, or "collections" without explicit owner instruction.
- Never apologize for asking. "Just checking in" is fine; "Sorry to bother you, but..." is not.
- Reference the specific invoice (number + date) so the client doesn't have to dig.
- Offer a path: "Let me know if you need a fresh copy / different format / a call."

## What "good" looks like

1. Every overdue invoice has a draft at the right cadence stage within 30 min of run start.
2. Voice matches the client's prior thread — if past threads were formal, the AR draft is formal; if casual, casual.
3. Escalations at 45+ days are unmissable in Slack (mentions, color, persistent).
4. Anomaly surface: relationship-health signals visible without the owner having to ask.
5. Zero false positives: a draft never goes out for an invoice that's actually paid (cross-check QBO payment status before drafting).

## References

- `references/voice.md` — AR voice (firm + warm; no apology, no threat)
- `references/output-format.md` — template per cadence stage; Slack-post structure
- `references/categorization-rubric.md` — cadence stage thresholds; relationship-health signals
- `references/test-cases.md` — synthetic AR fixtures (varied client tones, varied delay patterns)

## Cost estimate (filled by grading)

- Typical tokens-in per overdue invoice: ~6K (invoice details + prior thread context)
- Typical tokens-out per draft: ~500
- Tool calls per run: ~10 (QBO aging + per-invoice + Gmail thread reads + Slack post)
- Typical cadence: daily; ~5 drafts/day at a 20-client agency

Monthly per customer at typical volume: <$3 in tokens, <$1 in tool calls.
