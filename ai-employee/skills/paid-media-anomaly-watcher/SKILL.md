---
name: paid-media-anomaly-watcher
description: Daily scan of paid-media accounts for anomalies + alerts.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Marketing, Agency, PaidMedia, MonitoringSkill]
  smd:
    vertical: marketing-agency
    trust_ceiling: autonomous
    action_class: read + internal_write
    connectors:
      - meta_ads | google_ads | linkedin_ads
      - slack
---

# Paid Media Anomaly Watcher

Once a day (early morning), reads each client's paid-media campaigns across Meta / Google / LinkedIn / wherever they run, checks for the anomaly patterns that an account manager should know about, posts a digest to Slack. The agent surfaces; the owner decides.

## When to Use

Paid platform anomalies cost agencies twice: (a) bad performance burns client trust if not caught + explained quickly, (b) ad disapprovals + policy strikes pause spend without anyone noticing until end of week. The traditional fix is a human checking dashboards every morning across 10-30 client accounts. Nobody actually does it; clients call when their campaign has been off for 4 days.

The skill runs the morning check across every client every day. Surfaces only what's worth a human reading. Drafts client-facing language if owner asks for it, never sends.

## Prerequisites

Requires at least one paid-media connector (Meta Ads, Google Ads, or LinkedIn Ads) plus Slack for the internal digest. See frontmatter.

## How to Run

Daily cadence (0700 PT) via cron-skill:

```
hermes run paid-media-anomaly-watcher
```

Single-client deep dive:

```
hermes run paid-media-anomaly-watcher --client "Acme Co" --window "last 7 days"
```

## Procedure

### What the agent watches for

Per client, per active campaign, the rubric (see `references/categorization-rubric.md`) checks:

- **CPL spike** — cost-per-lead > 2× rolling 7-day average. Likely creative fatigue, audience saturation, bidding strategy issue, or seasonal demand drop.
- **Frequency saturation** — frequency > 5 in a 7-day window on a prospecting campaign. Burns audience; CPM drift up follows.
- **Ad disapprovals** — any disapproved ad active in the past 24h. Special urgency: pharma / financial / political restricted-vertical campaigns where a disapproval may pause the whole ad set.
- **Spend pacing** — projected end-of-month spend deviating from budget cap by > ±15%. Either under-pacing (missing the budget = missing the goals) or over-pacing (going to overspend = client argument).
- **Conversion drop** — week-over-week conversion volume down > 30% with no obvious creative or budget change. Usually a tracking/pixel issue.
- **CTR collapse** — CTR dropping > 40% week-over-week on an evergreen ad set. Creative fatigue.
- **Policy strikes** — any account-level strikes in the past 24h. Strike accumulation eventually disables the account.

### What the agent does

1. **Iterate active clients with paid-media connectors enabled.** Per `customer.yaml`.
2. **Pull yesterday's data + rolling 7-day baselines** from each enabled platform. Aggregate by campaign.
3. **Run the anomaly rubric** against each campaign. Score each finding by severity (CRITICAL / WARN / INFO).
4. **Group by client.** A client with 3 CRITICAL findings is treated differently than one with 1 INFO. Suppress all-INFO clients to keep the digest scannable.
5. **Generate Slack digest.** Format in `references/output-format.md`. Per-client, per-platform, per-campaign. CRITICAL findings get one-line suggested action.
6. **Optionally draft client-facing context.** If the owner replies to the Slack thread with `@agent draft note Acme`, the agent drafts a short message the owner could send to the client explaining the anomaly + the plan. Owner reads, edits, ships.

### Trust Ceiling

**autonomous** for the read + Slack post. The agent reads platform data and posts the digest without owner approval. The volume of platforms × clients makes this safe by default — no external blast radius.

**draft_for_review** for any client-facing message (triggered by the owner asking for a draft).

The agent MAY:

- Read all paid-media platform data within the customer.yaml's connector scope
- Post the daily digest to the `paid-media-ops` Slack channel
- Update an internal anomaly-history note for trend analysis
- Draft client-facing notes when explicitly invoked by the owner

The agent MUST NOT:

- Pause / start / modify campaigns
- Change budgets, bid strategies, or audience targeting
- Send client-facing messages
- Override the rubric thresholds based on a single client's preferences (rubric tweaks are owner work)
- Post to channels other than `paid-media-ops` unless explicitly configured per-customer

## Pitfalls

Common failures: noisy false positives (tune rubric thresholds with owner), surfacing INFO-only days as digests (suppress), drafting client-facing notes without owner trigger.

## Verification

1. Every active client with paid spend gets a daily digest entry (even if "no anomalies").
2. CRITICAL findings are unmissable — Slack alerts + summary surface above other content.
3. False-positive rate < 1 per 5 clients per week. If the rubric is too noisy, owner adjusts thresholds; the skill follows.
4. Trend awareness: if a campaign has been WARN for 3 days running, the digest notes "3rd day this campaign is WARN — sustained pattern, not a blip."
5. Drafts requested by owner are tight, owner-voice, ship-shaped.

## References

- `references/voice.md` — Slack digest voice + client-facing draft voice
- `references/output-format.md` — digest format; draft template
- `references/categorization-rubric.md` — anomaly thresholds + severity scoring
- `references/test-cases.md` — synthetic platform datasets covering each anomaly type

## Cost estimate (filled by grading)

- Typical tokens-in per client per day: ~5K (across enabled platforms)
- Typical tokens-out per digest: ~2K (one daily digest per agency)
- Tool calls per run: ~15 × N-clients (per-platform reads)
- Typical cadence: daily

For a 20-client agency: ~$3-6/month in tokens, ~$2/month in tool calls.
