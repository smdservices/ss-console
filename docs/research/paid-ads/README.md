# Paid-Ads Research Dossier — SMD Services

Phase 1 research feeding the Phase 2 paid-advertising strategy ADR. Compiled
2026-07-05. Every quantitative claim in the track files is cited; vendor-sourced
benchmarks and unverifiable items are flagged inline.

> **Decision outcome (2026-07-05).** The Captain reviewed this dossier and locked
> the round-one strategy in [ADR 0066](../../adr/0066-paid-acquisition-round-one.md).
> The dossier's organic-first sequencing recommendation ("The one-paragraph read"
> and implication 5 below) was consciously superseded: small-budget paid is adopted
> as the message-validation instrument itself, with the attribution/tracking build
> as a hard launch gate. The text below is preserved verbatim as the research record.

## Contents

- `01-competitive-landscape.md` — Track A. Who is advertising AI-agent/AI-employee
  services to SMBs, their offers, pricing, hooks, creative formats, and the
  whitespace gaps. Includes the law vertical.
- `02-channel-economics.md` — Track B. 2026 CPC/CPM/CPL by channel (Meta, Google,
  LinkedIn, YouTube, TikTok), minimum viable test budgets, channel fit for the
  buyer, and 2026-specific platform shifts.
- `03-funnel-and-tracking.md` — Track C. Ad -> landing page -> booked-call funnel
  best practice, and the 2026 privacy-first tracking stack (Pixel/CAPI, GA4 vs
  privacy-first analytics, the offline-conversion loop, UTM taxonomy, consent),
  with Cloudflare Workers implementation patterns.
- `04-internal-audit.md` — Track D. What smd.services can and cannot track today,
  and the minimum build to become ad-ready.

## The one-paragraph read

The AI-services ad field is crowded with faceless done-for-you agencies running
free-audit and salary-cost-comparison offers, but three positioning lanes are
genuinely uncontested: the human+AI _firm_ (a real team behind the worker),
vertical-specific _law-firm operations_ (everyone else advertises phone intake
only), and a single _named managed Operator priced against a salary_. Meanwhile
every ad channel inflated in 2026 (Meta CPA +38% YoY), and because nobody searches
for SMD's category by name, this is a discovery/interruption problem (Meta,
LinkedIn), not a search-capture problem. The hard blocker is internal: smd.services
cannot currently attribute a booked call to an ad — UTM/gclid/fbclid are discarded
at every layer and there is no pixel, CAPI, or offline-conversion loop. Paid ads
should be treated as a _scale_ play that follows a proven converting message, not
the _first-proof_ engine, mirroring the cold-email Mode-A shelving already locked
in ADR 0059.

## Cross-track synthesis

### 1. The competitive whitespace maps almost exactly onto SMD's existing thesis

The three uncontested lanes (Track A, section 4d) are the Operator Thesis
(ADR 0037) restated as ad angles: "competes with a hire" -> salary
cost-comparison; "the moat is the harness + guide + memory" -> the human+AI firm;
"packs turn the universal into the recognizable" -> vertical-specific law-firm
operations. SMD does not need a new positioning for ads; it needs to translate the
locked positioning into the proven creative formats.

### 2. The proven format and SMD's thesis are the same lever

Smith.ai's long-running "$48k/yr receptionist vs $6k/yr Smith" split-panel is the
most mature creative in the field (Track A) and is a direct expression of
"price against a salary, not a software seat" (ADR 0037 Tenet 1). This is the
lowest-risk creative bet: adopt a validated format that also happens to be the
firm's core argument.

### 3. Channel choice is constrained by category-creation + local niche

Nobody searches SMD's category by name, so Google Search only catches
adjacent-intent terms at legal-adjacent CPCs ($6-15+), and the job is discovery
(Meta) or precision role-targeting (LinkedIn) (Track B, Task 3). But Phoenix-local

- law-firm-owner is a tiny audience that starves Meta's learning phase and pushes
  LinkedIn into ultra-narrow $150-300 CPM. The local + niche + category-creation
  triple is the biggest structural headwind and argues against a big local paid test
  before a message is proven.

### 4. The economics demand qualified-call optimization, which SMD cannot do yet

For a high-ticket, low-volume offer, optimizing to cheap form-fills is the classic
failure (Track B Task 2, Track C section 2). The fix is the offline booked-call ->
CRM -> ad-platform loop. Track D shows SMD has the ingredients (first-party `/book`,
D1, admin console) but none of the wiring (no click-ID capture, no CAPI, no offline
import). The loop is the single highest-leverage engineering investment, and it is
easier here than in a typical Calendly setup because the booking is first-party.

### 5. Sequencing: message first, then attribution, then spend

Track B's honest counterfactual is that paid may underperform Scott's existing
hand-personalized Mode-B outbound until a converting message exists. The rational
order is: (a) prove a converting message and offer, cheaply; (b) build the
attribution/offline-loop wiring (Track D build list); (c) then spend, starting on
the discovery/precision channels, optimizing to qualified booked calls.

## Top implications for the Phase 2 ADR (decisions to lock)

1. **Positioning for ads:** lead with the salary cost-comparison, put a real
   human/firm on the creative, and go vertical on law-firm operations (not intake).
   These are the three whitespace lanes and they are the locked thesis restated.
2. **Channel posture:** discovery/interruption (Meta) + precision role-targeting
   (LinkedIn) over search-capture (Google). Google Search only for adjacent-intent
   terms; skip PMax/TikTok for this offer at this scale. Validate SMD's exact
   keyword CPCs in Keyword Planner before committing (open data gap).
3. **Do not spend before the wiring exists.** Attribution is a hard prerequisite:
   ship click-ID capture + the offline booked-call conversion loop (Track D build
   list) before the first dollar, or ad optimization is blind and budget chases
   junk form-fills.
4. **Budget realism:** ~$2.5-5k over 4-6 weeks per channel to get a defensible
   read, optimizing to an upstream micro-conversion; under ~$1.5k is noise.
5. **Sequencing:** treat paid as a scale play after a converting message is proven
   (mirror ADR 0059's Mode-A shelving), not the first-proof engine. The
   near-term paid experiment, if any, should be a small, message-testing buy, not
   a scaled campaign.
6. **Compliance:** confirm US-only ad geo so the lighter CCPA path applies; add a
   marketing cookie/privacy notice before any pixel ships (none exists today).

## Open items to close before or during the ADR

- Actual Google Keyword Planner CPCs for SMD's exact terms (no published figure).
- Any PMax/Demand Gen B2B-services CPL benchmark (genuinely absent from the field).
- A manual Chrome pass on the Meta Ad Library to capture exact live creatives, run
  dates, and impression buckets for the five named advertisers (SPA blocked
  automated fetch).
- Build-vs-buy decision on Meta CAPI (one-click Meta-enabled CAPI vs Worker-based),
  noting the offline loop needs custom code regardless.
