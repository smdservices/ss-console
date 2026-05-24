---
name: retainer-hours-reconciler
description: Reconciles tracked hours vs SOW retainer caps for owner.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Marketing, Agency, RetainerOps, Slack]
  smd:
    vertical: marketing-agency
    trust_ceiling: autonomous
    action_class: read + internal_write
    connectors:
      - harvest
      - toggl
      - float
      - slack
---

# Retainer Hours Reconciler

Reads time entries from the agency's time-tracking tool, maps them against the SOW retainer caps for each client, and posts a weekly utilization report to a designated Slack channel. The agent is autonomous on the read + reporting flow; it does NOT message clients, change time entries, or modify SOWs.

## When to Use

Agency owners lose more money to retainer mismanagement than to bad sales. The two recurring failure modes:

- **Over-utilization** — a client is at 110% of their hours by week 3 of the month; the agency eats the difference. Often discovered only at month-end, after the work is already done at a loss.
- **Under-utilization** — a client is at 30% of their hours with one week left; the agency is providing less than the relationship is paid for; client churns at renewal "because we weren't getting value." The owner could have proactively scheduled work, but didn't see the gap.

This skill catches both before they cost money. Weekly Slack post, every Monday morning.

## Prerequisites

See frontmatter.

## How to Run

Weekly cadence (Mondays at 0800 PT) via Hermes' cron-skill mechanism:

```
hermes run retainer-hours-reconciler
```

One-off look at a specific client:

```
hermes run retainer-hours-reconciler --client "Acme Co"
```

Pull a different time window (default: month-to-date):

```
hermes run retainer-hours-reconciler --window "last 7 days"
```

## Procedure

1. **Pull time entries.** For each active retainer client, fetch all time entries in the current month from Harvest (or Toggl/Float per `customer.yaml` connector binding). Sum by client + by service line (account-management, strategy, production, etc.).
2. **Resolve SOW caps.** Look up the client's current SOW from the agency's SOW store (Notion / Google Drive / `customer.yaml` SOW pointer). Extract monthly retainer hours + per-service caps if specified.
3. **Compute utilization.** For each client, compute `actual_hours / contracted_hours` as month-to-date percentage AND projected end-of-month percentage (linear extrapolation from current pace). Service-line breakdown too.
4. **Classify.** Each client lands in one bucket:
   - `OVER_CRITICAL` — projected EOM ≥ 110%; agency will eat hours unless action taken
   - `OVER_WARNING` — projected EOM 95-110%; tight; need awareness
   - `BALANCED` — projected EOM 65-95%; tracking right
   - `UNDER_WARNING` — projected EOM 40-65%; underdelivered; client value at risk
   - `UNDER_CRITICAL` — projected EOM < 40%; significant underdelivery; churn risk at renewal
5. **Surface threading patterns.** If a single service line (e.g., strategy) is at 200% while production is at 30%, surface that — it suggests scope misalignment.
6. **Post the report.** Slack channel (designated in `customer.yaml`). Format below.

### Trust Ceiling

Customer-zero and paying-customer ceiling: **autonomous** for read + internal Slack post.

The agent MAY:

- Read time entries from Harvest / Toggl / Float (read scope)
- Read SOW documents from the SOW store (read scope)
- Post the weekly report to the designated internal Slack channel
- Tag the owner (`@<owner>`) in the post if any client is `OVER_CRITICAL` or `UNDER_CRITICAL`

The agent MUST NOT:

- Modify time entries (edit, delete, reclassify)
- Modify the SOW
- Message clients directly (or even hint at messaging them)
- Post to channels other than the configured `retainer-ops` channel
- Promote any client's status to "OK" autonomously after a previous critical flag

If the owner replies in the Slack thread "Yes, increase Acme's cap to 80 hours," the agent does NOT modify the SOW — it logs the operator instruction and surfaces it in next week's report as a "pending SOW update." SOW changes are human work.

## Pitfalls

Common failure modes: mistaking projected EOM for actual hours, posting to a non-`retainer-ops` channel, repeating noisy alarms three weeks in a row without rubric calibration, and silently promoting a previously critical client to "OK."

## Verification

A successful weekly run satisfies:

1. Every active retainer client gets a utilization entry.
2. Service-line breakdown is present where the SOW specifies service caps.
3. EOM projection is clearly labeled "projected (linear extrapolation)" so the owner doesn't mistake it for actual.
4. Critical entries (over/under) have a one-line suggested action — specific, not generic.
5. Junk-quality alarms are absent: if the agent surfaces something that's "noise" three weeks in a row without the owner acting, the rubric (rubric.md) needs a calibration pass.

## References

- `references/voice.md` — voice for the Slack post (tight, scannable, action-oriented)
- `references/output-format.md` — exact Slack message structure
- `references/categorization-rubric.md` — bucket definitions + thresholds
- `references/test-cases.md` — synthetic time-entry datasets for regression testing

## Cost estimate (filled by grading)

- Typical tokens-in per run: ~12K (reading time entries + SOWs for ~10 clients)
- Typical tokens-out per run: ~2K (the Slack post)
- Tool calls per run: ~25 (one per connector per client)
- Typical cadence: weekly (4 runs/month per customer)

Total marginal cost per month per customer at typical usage: <$1.50 in tokens, <$0.30 in tool calls.
