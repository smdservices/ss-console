---
name: status-report-assembler
description: Weekly client status report from PM tools + analytics.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Marketing, Agency, ClientReporting, DraftForReview]
  smd:
    vertical: marketing-agency
    trust_ceiling: draft_for_review
    action_class: read + internal_write
    connectors:
      - asana | clickup | monday
      - google_analytics
      - meta_ads | google_ads | linkedin_ads
      - slack
      - gmail
---

# Status Report Assembler

Reads the work the agency completed for each retainer client over the past week, pulls the metrics that prove it, drafts a client-facing status note. Output lands in the agency's internal "drafts" folder + Slack thread for the owner to review. The agent never sends to clients; the owner ships.

## When to Use

Friday-night status report assembly is the canonical agency-owner bottleneck. Each client wants weekly proof of value: what shipped, what moved, what's next. Pulling that proof from 4-6 tools per client, 10-30 clients, every week, is 4-8 hours of the owner's time. Most owners do it badly under time pressure — clients notice; retention erodes.

This skill reduces it to: owner reads 30 drafts on Friday morning, edits/approves each in 1-2 minutes, ships from their own inbox. Saves the weekend.

## Prerequisites

Requires a PM tool connector (Asana / ClickUp / Monday), Google Analytics, at least one paid-media connector if the client runs paid, plus Slack and Gmail. See frontmatter.

## How to Run

Weekly cadence (Fridays at 0700 PT) via cron-skill:

```
hermes run status-report-assembler
```

Single client on demand:

```
hermes run status-report-assembler --client "Acme Co"
```

Custom window:

```
hermes run status-report-assembler --window "last 14 days"
```

## Procedure

1. **Pull PM activity.** From the client's PM tool (per `customer.yaml` connector binding for that client's workspace), fetch completed tasks + tickets in the window. Group by epic/category. Note any blockers logged.
2. **Pull analytics.** GA4 (or alternative) for the client's site: sessions, conversions, top pages, week-over-week deltas. Use `references/output-format.md` for which metrics are standard vs optional.
3. **Pull paid-media metrics.** If the client runs paid (Meta/Google/LinkedIn), grab spend, CPM/CPC/CPL, conversion volume, top + worst ads of the week. If no paid activity, skip the section.
4. **Pull pipeline / leads.** If the client has CRM access (HubSpot etc.), grab new leads + pipeline-stage movements in the window.
5. **Assemble the draft.** Use the client's preferred report template (in their workspace at `clients/{name}/status-template.md` or a default). Structure: this-week-shipped + this-week-results + this-week-blockers + next-week-priorities + asks.
6. **Voice-match.** Read prior shipped reports from the client (stored in drafts folder + their inbox). Match voice — formality level, paragraph density, technical depth.
7. **Write to drafts folder.** `customer_notes/drafts/{client}/status-YYYY-MM-DD.md`. Add a Slack thread message in the agency's `client-status-drafts` channel: client name + draft length + any flagged anomalies + draft permalink.

### Trust Ceiling

**draft_for_review** for all clients. No exceptions. Even if a client has explicitly said "the agent can send weekly," the SOW provision and the substrate enforce draft-only for external sends.

The agent MAY:

- Read PM, analytics, paid, CRM tools per the client's connector binding
- Write the draft to the internal drafts folder
- Post a Slack thread message in the internal channel
- Read prior shipped reports (for voice matching)

The agent MUST NOT:

- Send the draft to the client (gmail.send refused per invariant 2)
- Modify any client-facing data in the source tools
- Promise specific results in next-week-priorities (the owner authors goals)
- Hallucinate metrics — every number must be sourceable to a tool call

## Pitfalls

Common failures: hallucinated metrics (every number must trace to a tool call), invented next-week-priorities (use placeholders when owner hasn't authored goals), voice drift from prior shipped reports.

## Verification

A successful weekly run satisfies:

1. Every active client has a draft in `drafts/{client}/` within 30 min of run start.
2. Every metric in every draft is sourceable to a specific tool call (audit-trail in the run log).
3. Voice match: a sample human-graded against prior shipped reports — passes if the owner edits < 25% of the words.
4. Flagged anomalies (campaign disapprovals, traffic drops, blocker tickets that should be in next-week-priorities) are surfaced — the value-add over a dumb template.
5. No invented promises. If the agent doesn't have an evidence base for next-week-priorities, it leaves placeholders for the owner to fill, not made-up goals.

## References

- `references/voice.md` — agency-to-client voice + client-specific tonal matching
- `references/output-format.md` — exact draft structure + metric inclusion rules
- `references/categorization-rubric.md` — what counts as a "blocker" vs "noise"; anomaly thresholds
- `references/test-cases.md` — synthetic client datasets (10 clients, varied verticals + tone)

## Cost estimate (filled by grading)

- Typical tokens-in per client: ~15K (PM data + analytics + paid + prior reports)
- Typical tokens-out per client: ~3K (the draft)
- Tool calls per client: ~12 (PM, GA4, Meta, Google, LinkedIn, CRM, drafts read)
- Typical cadence: weekly × N clients

For a 20-client agency: ~$8-12/month in tokens, ~$2/month in tool calls.
