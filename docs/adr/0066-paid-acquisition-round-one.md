---
title: Paid Acquisition Round One — Posture, Budget, and Guardrails
date: 2026-07-05
status: accepted
captain: Scott Durgan
related-adr: 0037-operator-thesis.md, 0039-operator-led-assessment-funnel.md, 0040-operator-positioning-and-why-us.md, 0060-retire-automated-lead-gen-machine.md
related-doc: docs/research/paid-ads/README.md, docs/marketing/positioning-spine.md, docs/archive/research-lead-gen-2026-07-01/06-paid-acquisition.md
---

# ADR 0066 — Paid Acquisition Round One: Posture, Budget, and Guardrails

**Status:** Accepted (Captain decisions, 2026-07-05).

## Context

Competitors are running paid social ads at SMD's exact intersection today: Smith.ai (salary cost-comparison split-panel, long-running), AgentsInstall.com (done-for-you managed agents — the closest twin to the Managed Operator), Binary Studio, RapidDev, and Youtiva (free "AI Opportunity Audit" entry). A four-track research sprint (competitive ad intelligence, channel economics, funnel/tracking practice, internal readiness audit — the full cited dossier is `docs/research/paid-ads/`) established:

1. **Three positioning lanes are uncontested in ad creative**, and all three are restatements of the locked Operator Thesis (ADR 0037): the human+AI _firm_ (the field is faceless), vertical-specific **law-firm operations** (the entire legal AI ad lane sells phone intake; nobody advertises matters/deadlines/discovery coordination — the A&P wedge), and a single named **managed** Operator priced against a salary (competitors sell plural abstract "agents" or per-seat SKUs).
2. **Channels do different jobs.** Nobody searches the category by name ("managed operator" has no search volume), so Meta is the discovery/message-validation surface (post-Andromeda, creative is the targeting); Google Search only harvests adjacent-intent terms ("ai receptionist for law firms") at legal-vertical CPCs. Judging both on one metric is a category error.
3. **The funnel is structurally unable to attribute a paid click to a booked call today.** GA4 runs (reporting-only, ads signals off, property currently in the Venture Crane account), `?interest=` persists to the lead, but `utm_*`/`gclid`/`fbclid` are captured nowhere, and there is no pixel, CAPI, or offline-conversion loop (`docs/research/paid-ads/04-internal-audit.md`).
4. **Prior posture said wait.** The archived paid-acquisition briefing (`docs/archive/research-lead-gen-2026-07-01/06-paid-acquisition.md`) and ADR 0058 gated paid spend behind an organically validated converting message. That organic baseline was never produced, and the machine that was supposed to feed it was retired (ADR 0060). The research dossier's own summary reaches the same conservative default; the decision below consciously departs from it.

## Decision

### 1. Posture: paid is the message-validation instrument (supersedes the organic-first gate)

Small-budget paid social is adopted as the fastest, most quantitative way to find the converting message — the thing the organic-first posture was waiting for. The "paid is the wrong first dollar" gate from the archived briefing is superseded for this bounded round. The tracking/attribution layer is built immediately regardless of spend decisions: it is one-time work that compounds and it is a launch gate (§7).

### 2. Budget envelope: ~$3,000/month (Scenario B)

Meta ~$2,200/mo (one campaign, one consolidated ad set, 3–4 angle creatives) + Google ~$800/mo (Search-only harvest). Research math says this is the floor that produces a defensible ranking of message angles rather than click-vanity data. Dollar figures here are an envelope set by Captain, revisitable at any readout; they are not published externally and not encoded anywhere in the product.

### 3. Ad-copy rule: salary-anchored, no dollars

Ads and their landing pages MAY anchor against the cost of a hire ("a full-time front desk for a fraction of a salary," "the coordinator role you can't fill, handled") and MAY quantify the gap in the owner's own numbers (owner-does-the-math, per the positioning spine). Ads MUST NOT:

- publish dollar figures (ours or a named salary figure),
- run a Without/With people-vs-AI comparison table (spine voice law: never disparage people or software),
- use employment framing ("instead of hiring," "don't hire," "replace your receptionist") — this is simultaneously a spine voice law and a Meta Employment special-category classifier risk that would strip targeting precision.

**No positioning-spine locks are amended.** Ads inherit the spine verbatim (including no em dashes, no fabricated client-facing content — P0); this section only adds ad-surface rules on top.

### 4. Channel roles (round one)

- **Meta (IG/FB)** — message validation. One campaign, one consolidated ad set, 3–4 creatives = the angle test. Optimize to the mid-funnel `Lead` event, never the booking (booked-call volume cannot exit the learning phase); judge angles on CTR + cost-per-lead as leading indicators, cost-per-booked as the verdict.
- **Google Ads** — demand harvest, Search-only. Tight adjacent-intent keywords, aggressive negatives, **no Performance Max**. Phoenix-consulting local terms are a small parallel test.
- **Retargeting** — pixel audiences on `/operator` + pack visitors from day one (cheapest first paid dollar; the one thing the archived briefing and this ADR agree on).
- **Deferred:** LinkedIn (until a winning message exists), legal-tech podcast/newsletter sponsorship (round-two candidate or Scenario-C upgrade).

### 5. Funnel rule: ad → message-matched LP → /book, never the home page

Each angle lands on a dedicated, no-nav landing page whose hero mirrors the ad (built on the existing pack kit; law-firm pack first). LP promises only what the assessment actually delivers — never trick the click (conversion practice and the no-fabrication policy agree). All paid paths must be live routes (the retired-path 301 list in `src/middleware.ts` is a pre-launch check). First vertical: **law-firm operations** (the whitespace + the A&P proof vertical). Angle set for round one, all derived from locked positioning: (a) salary-anchored cost/outcome, (b) the human+AI firm, (c) law-ops lifecycle ("your matters, deadlines and discovery, handled"), (d) symptom→gap.

### 6. Measurement

North star: **cost per booked assessment**; guardrail: fit-qualified rate. Kill/scale rules are spend-gated, not day-gated: an angle gets ~3–5× target cost-per-lead in spend before judgment; kill on weak CTR + 2× CPL; healthy CTR with dead LP conversion means fix the LP, not the angle; scale winners gradually (20–30%). Weekly one-row-per-angle readout (Spend | Impr | CTR | CPC | Leads | CPL | Booked | Cost/Booked | Held). Once volume exists, feed `assessment_held` / `became_client` back to Meta from D1 (offline conversions) to optimize toward quality — Meta's raw lead quality is the worst of the major channels and this loop is the fix.

### 7. Launch gates — no spend until ALL pass

1. **Attribution capture end-to-end:** `utm_*`/`gclid`/`fbclid` captured on landing, persisted first-touch, threaded through `/api/intake/send` and `/api/booking/reserve` onto the D1 lead/booking record; `utm_content` = creative angle, mapped alongside the existing `?interest=` token.
2. **Meta Pixel + Conversions API** (server-side on the existing Worker) live with shared-`event_id` dedup; events `Lead` (intake success) and `Schedule` (booking success).
3. **GA4 conversion events** emitted and marked; Google-Ads-readiness config decision made consciously (`allow_google_signals` is currently off by design).
4. **Consent hygiene:** CCPA Do-Not-Sell/Share notice, honor GPC, Meta Limited Data Use, privacy-policy update.
5. **Account ownership:** ad accounts and the GA4 property SMD-owned (the GA4 stream currently lives in the Venture Crane account — identity-separation rule).
6. **AI-imagery disclosure** workflow for any AI-generated creative (Meta disapproval risk).
7. **Live-route verification** of every ad-target path post-deploy.

## Consequences

- Build issues are filed for each launch gate plus the creative kit and campaign-structure runbook; the gates are the definition of ad-ready.
- The research dossier (`docs/research/paid-ads/`) is committed as the evidence record. Its summary's organic-first recommendation is preserved verbatim and superseded by this ADR (noted inline there).
- Round one is bounded: it either produces a validated converting message (feeding round two: scale, LinkedIn, sponsorships) or a documented negative result that re-arms the organic-first posture with data instead of caution.
- `docs/handbook/customer-lifecycle.md` still describes the retired lead-gen pipelines (pre-existing ADR 0060 drift); the paid-channel mention belongs in that cleanup, not here.
