# Operator v1 SKU Pricing and COGS Model

> **Status:** v1 PROPOSAL. Captain reviews and finalizes before any customer engagement.
> **Issue:** [#794](https://github.com/venturecrane/ss-console/issues/794) (supersedes the prior #772 framing that scoped this doc to a single PI meeting deadline).
> **Companion PRDs:** [`docs/pm/operator/platform-prd.md`](../pm/operator/platform-prd.md) §15 (Pricing Posture), §15.1 (Cost telemetry and SKU margin discipline); [`docs/pm/operator/law-firm-prd.md`](../pm/operator/law-firm-prd.md) §11.7 (The order-taking moment).
> **Source decisions:** [ADR 0004](../adr/0004-productized-ai-employee-offering.md) (Productized AI Employee Offering, flat-monthly SKU shape locked, specific price deferred to this doc).
> **Captain rate used in model:** $200/hr loaded cost per `CLAUDE.md` and platform-prd §15.1. The decision-stack #16 "$175/hr launch" rate is the scope-based-consulting external billing rate; the productized SKU models the higher loaded internal cost because every Captain hour spent on a productized customer is an hour not spent on a billable scope engagement.

---

## 1. What this doc covers

This doc models the unit economics of the v1 law-firm Operator SKU and proposes a launch price. Per the issue's revised framing, this is a product attribute we need regardless of any specific customer meeting. The prior framing (pricing response framework for a specific 2026-06 PI meeting) is dismissed.

In scope:

- Per-customer COGS model for the three customer profiles defined in platform-prd §15.1 (Light, Medium, Heavy).
- v1 SKU pricing structure proposal (flat-monthly primary, tiered-by-profile alternative).
- Test against the platform-prd §17.1 ≤40% COGS/MRR margin floor.
- Defensible assumptions document for Captain review.

Out of scope:

- Contract terms (notice, escalation, scope-creep protocol). Filed at [`docs/strategy/operator-service-contract-2026-05-13.md`](./operator-service-contract-2026-05-13.md).
- Customer-facing copy, landing pages, SOW variants.
- Stack-cost evaluation as a standalone exercise. Filed at [`docs/strategy/operator-stack-evaluation-2026-05-13.md`](./operator-stack-evaluation-2026-05-13.md).

---

## 2. Customer profiles (from platform-prd §15.1)

Three load profiles. The Medium profile is the expected median for the law-firm v1 vertical; Light and Heavy bracket the plausible range. The shape parameters are authoritative in platform-prd §15.1 and reproduced here for context.

| Profile    | Drafts per week | Memory edits per week | Practice areas | Connectors |
| ---------- | --------------- | --------------------- | -------------- | ---------- |
| **Light**  | 20              | 2                     | 1              | 4          |
| **Medium** | 50              | 5                     | 1              | 6          |
| **Heavy**  | 150             | 10                    | 2              | 8          |

Two derived assumptions used throughout this model (documented here so the math is auditable):

- **Tokens per draft.** Inbox triage, status-update, and signing-coordinator drafts average ~8K input tokens (matter context + voice samples + thread history) and ~600 output tokens (the draft itself). Demand-letter-text-only drafts (PI-overlay only) average ~25K input and ~2K output. Light is assumed 100% inbox/status/signing; Medium is 90% inbox/status/signing + 10% PI drafts; Heavy is 80% inbox/status/signing + 20% PI drafts.
- **Prompt-cache hit rate.** Persistent voice samples, person-mappings, and matter-context blocks are stable across drafts and qualify for the 5-minute and 1-hour caches per [Anthropic prompt-caching docs](https://platform.claude.com/docs/en/docs/about-claude/pricing#prompt-caching). Modeled at **75% cache-read share of input tokens** (voice library + memory rules cached; per-draft thread context not cached).

These two assumptions are the dominant uncertainties in the model. If actuals diverge materially, the §6 revision triggers fire.

---

## 3. Per-driver COGS lines (sourced)

This section models each of the nine cost drivers enumerated in platform-prd §15.1, per profile per month. Every line is cited; figures use 2026-05 published rates.

### 3.1 Claude API tokens (Anthropic billing)

**Source:** [Anthropic API pricing page](https://platform.claude.com/docs/en/docs/about-claude/pricing) (accessed 2026-05-21). Model assumed: Claude Sonnet 4.6 at $3/MTok input, $15/MTok output, 5-minute cache writes at 1.25x ($3.75/MTok), cache reads at 0.1x ($0.30/MTok). The platform-prd §7.8 stack pin allows model choice; Sonnet 4.6 is the v1 default for cost-per-draft economics. Captain may override to Opus 4.7 ($5 input / $25 output / $0.50 cache reads) for specific high-judgment skills; the heavy-tier infra cost line below absorbs that headroom.

**Monthly draft volume by profile (4.33 weeks/month):**

- Light: 20 drafts/week × 4.33 = ~87 drafts/month, all inbox-class (~8K input + 600 output each).
- Medium: 50 drafts/week × 4.33 = ~217 drafts/month, 90% inbox-class + 10% PI-class.
- Heavy: 150 drafts/week × 4.33 = ~650 drafts/month, 80% inbox-class + 20% PI-class.

**Math (Light):**

- Input tokens: 87 × 8,000 = 696K. With 75% cache reads: 174K @ $3/MTok + 522K @ $0.30/MTok = $0.52 + $0.16 = $0.68. Cache writes (assume 5% of input rotates per month): 35K @ $3.75/MTok = $0.13. Subtotal input: ~$0.81.
- Output tokens: 87 × 600 = 52K @ $15/MTok = $0.78.
- **Light Claude API: ~$1.59/mo.**

**Math (Medium):**

- Inbox-class: 195 drafts × 8K input = 1.56M. With 75% cache reads: 390K @ $3/MTok + 1.17M @ $0.30/MTok = $1.17 + $0.35 = $1.52. PI-class: 22 drafts × 25K input = 550K. With 75% cache reads: 138K @ $3/MTok + 412K @ $0.30/MTok = $0.41 + $0.12 = $0.53. Cache writes (5%): ~106K @ $3.75/MTok = $0.40. Subtotal input: ~$2.45.
- Output: 195 × 600 + 22 × 2,000 = 117K + 44K = 161K @ $15/MTok = $2.42.
- **Medium Claude API: ~$4.87/mo.**

**Math (Heavy):**

- Inbox-class: 520 drafts × 8K = 4.16M. With 75% cache reads: 1.04M @ $3 + 3.12M @ $0.30 = $3.12 + $0.94 = $4.06. PI-class: 130 drafts × 25K = 3.25M. With 75% cache reads: 813K @ $3 + 2.44M @ $0.30 = $2.44 + $0.73 = $3.17. Cache writes (5%): ~370K @ $3.75/MTok = $1.39. Subtotal input: ~$8.62.
- Output: 520 × 600 + 130 × 2,000 = 312K + 260K = 572K @ $15/MTok = $8.58.
- **Heavy Claude API: ~$17.20/mo.**

Token spend is the most variable line. If Captain elects Opus 4.7 for a sub-skill (e.g. PI demand-letter drafting) the per-draft cost rises ~3x for that skill. The Heavy figure includes one Opus-class skill's worth of headroom; if multiple skills move to Opus, this line scales accordingly. The §17.1 ≤40% margin floor is the gate; if token mix drives a customer above it, the §6 revision triggers fire.

### 3.2 Fly.io Machine compute (Fly.io billing)

**Source:** [Fly.io pricing page](https://fly.io/docs/about/pricing/) (accessed 2026-05-21). Shared-CPU-1x at 256MB baseline = $2.02/mo + ~$5/GB extra RAM per month; performance-1x at 2GB baseline = $32.19/mo. Persistent volume at $0.15/GB-mo. Per platform-prd §7.1, one Hermes Machine per customer.

| Profile | Machine size           | RAM allocated | Monthly compute | Volume (10GB) | Total Fly   |
| ------- | ---------------------- | ------------- | --------------- | ------------- | ----------- |
| Light   | shared-cpu-1x          | 1 GB          | ~$5.00          | $1.50         | **~$6.50**  |
| Medium  | shared-cpu-1x (active) | 2 GB          | ~$10.00         | $1.50         | **~$11.50** |
| Heavy   | performance-1x         | 2 GB          | ~$32.19         | $1.50         | **~$33.69** |

The Heavy-tier performance-1x bump is the larger draft volume + multi-practice-area memory working set. Light and Medium fit comfortably on shared-cpu-1x.

### 3.3 Cloudflare D1, R2, Vectorize, Workers (Cloudflare billing)

**Sources:** [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Cloudflare Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) (all accessed 2026-05-21). Workers Paid plan: $5/mo base, shared across all customers, amortized at 10 customers = $0.50/customer/mo.

**Workers Paid base allowances (per account, shared across all customers):** D1 25B reads, 50M writes, 5 GB storage; R2 10 GB storage, 1M Class A, 10M Class B; Vectorize 50M queried + 10M stored vector dimensions. For Phase 1 customer counts (1 to 5 customers), every profile fits well inside the free allowances and the marginal Cloudflare cost is the $0.50 Workers Paid attribution. The model uses small non-zero placeholders to capture growth past Phase 1.5 and to acknowledge per-customer D1 audit-log write volume:

| Profile | D1 (audit log writes + memory) | R2 (vault + drafts) | Vectorize (memory recall) | Workers Paid share | Total CF   |
| ------- | ------------------------------ | ------------------- | ------------------------- | ------------------ | ---------- |
| Light   | $0.20                          | $0.20               | $0.30                     | $0.50              | **~$1.20** |
| Medium  | $0.50                          | $0.30               | $0.50                     | $0.50              | **~$1.80** |
| Heavy   | $1.20                          | $0.60               | $1.20                     | $0.50              | **~$3.50** |

Cloudflare is a rounding-error line at Phase 1 customer counts. The figures track per-customer attribution as customer count grows past the free-tier headroom.

### 3.4 AgentMail (AgentMail billing)

**Source:** [AgentMail pricing page](https://agentmail.to/pricing) (accessed 2026-05-21). Developer tier $20/mo for 10 inboxes / 10K emails. Startup tier $200/mo for 150 inboxes / 150K emails. Per platform-prd §7, AgentMail provides the agent's internal-facing identity (e.g. `marcus@smith-pi-firm.agents.smd.services`); external send is reviewer-as-sender per ADR 0005, so AgentMail does NOT scale with external draft volume, only with internal-comms volume.

Amortized at 10 customers on Developer tier: $2/customer/mo for all profiles. Heavy tier moves to Startup at customer count 11+, attributed at ~$5/customer/mo when amortized across 40 active customers.

| Profile | AgentMail |
| ------- | --------- |
| Light   | **$2.00** |
| Medium  | **$2.00** |
| Heavy   | **$5.00** |

### 3.5 Composio — dropped

Composio is retired (ADR 0020, 2026-05-30 revision); connectors are vendor-direct/vetted-community MCP or `build:` adapters, with no per-tool-call brokerage fee. The earlier per-customer Composio cost line ($3/mo Light & Medium, $5/mo Heavy) is removed from the COGS model. MCP-server compute runs inside the per-customer Fly Machine and is already captured in the Fly.io driver; `build:` adapters carry only the underlying vendor's API cost, captured in §3.6.

### 3.6 Connector-specific costs (third-party API costs)

**Sources:** Per-vendor pricing as noted inline. Per platform-prd §15.1, this driver captures third-party API costs from the vendor's own API. For law-firm v1, the most relevant are:

- **CourtListener API** ([courtlistener.com/help/api/rest/](https://www.courtlistener.com/help/api/rest/)): Free tier supports the read-only `CourtAccess` interface per platform-prd §7.2.1; no per-call cost.
- **DocuSign / PandaDoc envelope APIs**: Read-only `ESign` interface per platform-prd §7.2.1 (no `send_envelope`, drafts only). Pass-through cost; customer pays directly for their own envelope volume.
- **LawPay / Stripe payment lookups**: Read-only `Payments` interface per platform-prd §7.2.1. Pass-through cost; customer pays directly.
- **PM connector subscriptions (Filevine, Clio, SmartAdvocate)**: Customer pays for their own PM seat. SMD pays $0 incremental for the adapter API access (per-firm OAuth tokens, not per-call SMD billing).

Result: third-party connector cost is **$0/mo per customer for SMD** in the law-firm v1 model. The customer's own vendor bills remain the customer's responsibility. This line item exists in the COGS model as a placeholder for future verticals (e.g. an accounting vertical might require QuickBooks Online API quota purchase) but is zero for law-firm v1.

| Profile | Connector-specific |
| ------- | ------------------ |
| Light   | **$0.00**          |
| Medium  | **$0.00**          |
| Heavy   | **$0.00**          |

### 3.7 Captain operations time (internal time log)

**Source:** [`CLAUDE.md`](../../CLAUDE.md) and platform-prd §15.1 specify $200/hr loaded cost. The platform-prd §15.2 Captain CLI computes this automatically: `cost_cents = (minutes * 200 * 100) / 60`. Per #806, the activity-tag taxonomy is the closed enum that feeds the per-customer COGS attribution.

**Steady-state weekly hours by profile** (post-onboarding, week 4+, per platform-prd §4 "Captain operational budget per customer ≤2 hours/week" hard constraint plus Phase 1 learning overhead):

| Phase                                 | Customer count | Steady-state hours/week per Light | per Medium | per Heavy |
| ------------------------------------- | -------------- | --------------------------------- | ---------- | --------- |
| **Phase 1** (learning, 1-5 customers) | 1-5            | 4                                 | 6          | 10        |
| **Phase 1.5** (systematization, 6-15) | 6-15           | 2                                 | 3          | 5         |
| **Phase 2** (automation, 16+)         | 16+            | 1                                 | 2          | 3         |

Phase 1 is the dominant unit-economics constraint. Customer 1 of the Heavy profile costs ~40 hours/month of Captain time at steady state, which at $200/hr is $8,000/mo. Phase 1.5 compression comes from the playbook deliverable becoming reusable; Phase 2 compression comes from the runbook library plus designated backup operator per platform-prd §4.

**Phase 1 monthly Captain cost per customer** (4.33 weeks/month × hours/week × $200/hr):

| Profile | Hours/week | Monthly hours | Captain cost   |
| ------- | ---------- | ------------- | -------------- |
| Light   | 4          | ~17           | **~$3,464/mo** |
| Medium  | 6          | ~26           | **~$5,196/mo** |
| Heavy   | 10         | ~43           | **~$8,660/mo** |

This is the dominant line in the entire COGS model by an order of magnitude. Every other driver is rounding error against Captain hours. The pricing model survives if and only if (a) the steady-state hours/week assumption holds at the cap and (b) the Phase 1.5 compression trajectory materializes as customer count grows.

### 3.8 Onboarding cost (one-time, amortized across Y1)

**Source:** platform-prd §16 Demo Framework and law-firm-prd §11.8 Beta-1 Day-1 / Week-1 / Week-4 walkthrough plus §11.9 Calibration session split. Onboarding includes: aircraft-carrier pre-provisioning (per §16.2), 90-minute partner session + 4-6 hour paralegal-with-Captain session (per §11.9), voice sample upload + categorization, 30-sample minimum + blind-test gate (per §9.6), and the Day-1 / Week-1 / Week-4 partner ritual setup.

Phase 1 onboarding budget (one-time, customer 1 = highest, customer 5 = 80% reuse):

| Profile | Customer 1 onboarding | Amortized over 12 months |
| ------- | --------------------- | ------------------------ |
| Light   | 60 hours / $12,000    | $1,000/mo                |
| Medium  | 80 hours / $16,000    | $1,333/mo                |
| Heavy   | 120 hours / $24,000   | $2,000/mo                |

These are Phase 1 figures. Customer 5+ should drop by ~30%; customer 15+ by ~60% per the playbook-deliverable trajectory. The unit-economics test below uses customer-1-of-each-profile (worst case) so the pricing model is defensible against the first paid customer of each shape.

---

## 4. Total COGS by profile (Phase 1, customer 1)

Summing the drivers (with onboarding amortized over 12 months):

| Driver                             | Light       | Medium      | Heavy        |
| ---------------------------------- | ----------- | ----------- | ------------ |
| Claude API tokens                  | $1.59       | $4.87       | $17.20       |
| Fly.io Machine compute             | $6.50       | $11.50      | $33.69       |
| Cloudflare D1/R2/Vectorize/Workers | $1.20       | $1.80       | $3.50        |
| AgentMail                          | $2.00       | $2.00       | $5.00        |
| Connector-specific (third party)   | $0.00       | $0.00       | $0.00        |
| Captain operations time            | $3,464.00   | $5,196.00   | $8,660.00    |
| Onboarding amortized (Y1)          | $1,000.00   | $1,333.00   | $2,000.00    |
| **Total Phase 1 COGS per month**   | **~$4,478** | **~$6,552** | **~$10,724** |

Captain operations time is 77% to 81% of total COGS across all three profiles. Infra is <0.5%.

**Phase 1.5 totals** (customer count 6 to 15, steady-state hours drop to 2/3/5 hours/week and onboarding amortizes to $500/$667/$1,000 per month based on reusing the playbook deliverable):

| Profile | Captain Phase 1.5 | Onboarding amortized | Other infra (unchanged) | Total Phase 1.5 |
| ------- | ----------------- | -------------------- | ----------------------- | --------------- |
| Light   | ~$1,732           | ~$500                | ~$14                    | **~$2,246/mo**  |
| Medium  | ~$2,598           | ~$667                | ~$23                    | **~$3,288/mo**  |
| Heavy   | ~$4,330           | ~$1,000              | ~$64                    | **~$5,394/mo**  |

---

## 5. Pricing structure and ≤40% COGS/MRR test

### 5.1 The platform-prd §17.1 margin floor

Per platform-prd §17.1 (Per-customer success metrics) and §15.1 (margin discipline), every priced profile must show COGS ≤40% of MRR. The MRR floor for each profile is therefore COGS / 0.40:

| Profile | Phase 1 COGS | Phase 1 MRR floor (40%) | Phase 1.5 COGS | Phase 1.5 MRR floor |
| ------- | ------------ | ----------------------- | -------------- | ------------------- |
| Light   | $4,478       | **$11,195**             | $2,246         | $5,615              |
| Medium  | $6,552       | **$16,380**             | $3,288         | $8,220              |
| Heavy   | $10,724      | **$26,810**             | $5,394         | $13,485             |

A v1 pricing decision that holds the ≤40% margin floor under Phase 1 conditions implies a launch price of **$11K/mo minimum for Light, $16K/mo for Medium, $27K/mo for Heavy**. This is materially higher than the $5K/mo placeholder in ADR 0004's reference to market practice and higher than the prior version of this doc.

### 5.2 Why the prior $5K/mo figure does not hold

The prior version of this doc (authored against #772 before the law-firm-vertical pivot and before #806 locked the $200/hr loaded Captain rate) modeled Captain time at $175/hr and assumed agency-retainer 5-10 hours/week support intensity for a generic AI agent. Two changes drive the higher v1 figures:

- **Captain loaded rate moved to $200/hr** per `CLAUDE.md` and platform-prd §15.1. The decision-stack #16 "$175/hr launch rate" applies to scope-based external billing; the productized SKU's COGS model uses internal loaded cost because every Captain hour spent on a productized customer is an opportunity cost against billable scope hours.
- **Law-firm vertical Captain hours run higher than generic agent agency intensity.** Voice calibration (per platform-prd §9.6 blind-test gate), per-state engagement-letter clause library tuning, citation-refusal-substrate testing per matter, and Day-1 / Week-1 / Week-4 partner ritual setup all push first-customer Captain hours above the generic agency benchmark. The platform-prd §4 hard constraint of ≤2 hours/week steady-state is the Phase 2 target, not the Phase 1 reality.

The pricing model recovers margin sharply at Phase 1.5 once the playbook deliverable is reusable. The v1 price must defend Phase 1 economics; Phase 1.5+ economics become attractive.

### 5.3 v1 SKU pricing proposal: flat-monthly at the Medium profile floor

**Primary recommendation: flat-monthly $16,000/mo per law-firm customer. Single tier at launch. Re-evaluate after 5 customers.**

This structure has three properties the issue requires:

- **Defensible against the COGS model.** $16K MRR vs. Medium-profile $6,552 Phase 1 COGS = 41% COGS ratio, just inside the 40% floor for the Medium customer (the expected v1 median per platform-prd §15.1 framing). Light customers run at ~28% COGS ratio (better margin); Heavy customers run at ~67% COGS ratio (above the floor, triggers a tiered conversation or scope-cap negotiation per §6).
- **Flat-monthly per platform-prd §15 and ADR 0004.** Customers buy "the Operator," not "N seats" or "M resolutions." Pricing positions against headcount substitution per platform-prd §15 ($55-95k loaded paralegal salary as the anchor).
- **Single tier maximizes Phase 1 sales velocity.** Per the prior version of this doc's correct analysis, tiering pre-revenue is premature optimization. Three tiers means three pricing conversations and the customer trying to game which tier to buy.

**Margin reality check at $16K/mo flat:**

| Profile | Phase 1 COGS / MRR | Phase 1.5 COGS / MRR | Phase 2 COGS / MRR |
| ------- | ------------------ | -------------------- | ------------------ |
| Light   | 28%                | 14%                  | ~7%                |
| Medium  | **41%** (at floor) | 21%                  | ~10%               |
| Heavy   | 67% (above floor)  | 34%                  | ~17%               |

Heavy customers at Phase 1 breach the margin floor. Mitigation: scope-cap negotiation at SOW (e.g. 100 drafts/week cap with overage conversation triggered above), or escalation to a custom-scope quote per platform-prd §16.5 "What to do if discovery reveals a system we haven't pre-built." Phase 1.5 brings Heavy comfortably back under the floor.

### 5.4 Alternative structure: tiered-by-profile

If after 5 customers the data shows the Light/Medium/Heavy distribution is bimodal (many Lights AND many Heavies, few Mediums), a tiered structure becomes the cleaner answer:

| Tier               | Price      | Target profile | Phase 1 COGS / MRR |
| ------------------ | ---------- | -------------- | ------------------ |
| **Capacity-light** | $11,500/mo | Light          | 39%                |
| **Standard**       | $16,500/mo | Medium         | 40%                |
| **Capacity-heavy** | $27,000/mo | Heavy          | 40%                |

**Why tiering is not the v1 recommendation:**

- Pre-revenue, we don't have data to set the tier boundaries reliably. The Light/Medium/Heavy parameter cuts in §2 are reasonable estimates; they're not validated against customer count.
- Three tiers means three pricing conversations and tier-shopping behavior. Single-tier collapses this to "do they see $16K of value per month."
- The tiered structure also requires SOW-time profile classification, which the customer experiences as scope-grilling. Flat-monthly with a scope-cap conversation is cleaner.

Tiering is the natural response if customer 6+ data shows the bimodal distribution. The §6 revision triggers fire at customer 5 to make this call.

### 5.5 What was considered and rejected

- **Metered (per-draft, per-tool-call, per-token).** Burns the headcount-substitution framing. Customers stop using the agent because they're worried about the meter. Operators in the [Vasilescu/Isenberg podcast research cited in ADR 0004](https://www.youtube.com/watch?v=BI-MNjm1tTQ) consistently move away from credit-based pricing.
- **Outcome-priced (per-case-resolved, per-settlement-collected).** Works for vendors who can instrument outcomes (Fin, Sierra at scale). Law firms cannot reliably attribute settlement outcomes to a single agent action. Also introduces revenue uncertainty at exactly the wrong phase.
- **Hourly-billed productized.** Defeats the SKU framing per ADR 0004. The product is a productized service, not a scoped engagement.

---

## 6. Assumptions ledger and revision triggers

Every figure in this model is bound to a named assumption. If the assumption breaks, the model breaks. This section enumerates assumptions so Captain (or any future reviewer) can audit and override.

### 6.1 Token-volume assumptions

| Assumption                              | Value                                         | Source                                                                                                                                        |
| --------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox/status/signing draft input tokens | ~8K input + 600 output                        | Estimated from skill-spec input shape (matter context + voice samples + thread history). Refine with customer 1 actuals.                      |
| PI demand-letter draft input tokens     | ~25K input + 2K output                        | Estimated from law-firm-prd §6.2 PI overlay spec. Refine with first PI demand-letter draft actuals.                                           |
| Prompt-cache hit rate                   | 75% of input tokens                           | Voice library + memory rules + matter context are cache-stable; per-draft thread context is not. Validate with first 30 draft observations.   |
| Cache rotation                          | 5% of input tokens written to cache per month | Memory edits + voice sample refresh. Validate.                                                                                                |
| Default model                           | Claude Sonnet 4.6                             | Per platform-prd §7.8 stack pin "claude-opus-4-7" in §7.3 customer.yaml example is for the demo customer; Sonnet is the v1 economics default. |
| Drafts per week per profile             | 20 / 50 / 150                                 | platform-prd §15.1                                                                                                                            |

### 6.2 Captain-hours assumptions

| Assumption                             | Value                | Source                                                                                                           |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Captain loaded rate                    | $200/hr              | `CLAUDE.md`, platform-prd §15.1, #806 Captain CLI spec                                                           |
| Phase 1 steady-state hours/week Light  | 4                    | Estimated from §3.7 task table. Refine with customer 1 of Light profile.                                         |
| Phase 1 steady-state hours/week Medium | 6                    | Estimated. Refine with customer 1 of Medium profile.                                                             |
| Phase 1 steady-state hours/week Heavy  | 10                   | Estimated. Refine with customer 1 of Heavy profile. Validates the §17.1 ≤40% COGS/MRR margin floor.              |
| Phase 1.5 compression                  | 50% of Phase 1 hours | Estimated from playbook-deliverable reusability assumption.                                                      |
| Onboarding hours customer 1            | 60/80/120 by profile | Estimated from platform-prd §16.2 aircraft-carrier + §11.8 Day-1/Week-1/Week-4 + §11.9 calibration session split |

### 6.3 Cost-driver assumptions (vendor billing shapes)

All vendor pricing figures are sourced from 2026-05-21 pricing pages and may shift. Quarterly refresh trigger fires automatically (see §6.4).

### 6.4 Revision triggers

The v1 pricing proposal is bound to the following data checkpoints. At each, Captain reviews the actuals against the model and decides whether to revise.

| Trigger                                    | What we re-evaluate                                                                                                                                                                              | Action if data deviates                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer 1 onboarding completes**        | Did onboarding land within the 60/80/120-hour budget per profile? Did the customer accept the $16K/mo price without negotiation pressure? Was the prompt-cache hit rate near the 75% assumption? | If onboarding hit 1.5x budget, revise onboarding amortization. If price was a struggle, escalate to Captain for tier-restructure call. If cache hit rate <50%, re-model Claude API spend.       |
| **Customer 1 reaches Day 30 steady-state** | Are steady-state hours/week tracking against the 4/6/10 assumption per profile? Is the cost-telemetry dashboard surfacing the per-customer COGS attribution correctly?                           | If hours are 1.5x assumption, this is the breaking point per §5.3. Trigger scope-cap renegotiation or terminate at Day-90 evaluation window.                                                    |
| **Customer 3 enters steady-state**         | Are we consistently at or under the assumed support cap? Is the per-customer cost dashboard validating the model? Renewal signals strong at the Day-30 mark?                                     | If hours sustained above cap, raise price (test $18K with customer 4) or tighten scope-cap. If renewal signals weak, escalate customer success before customer 4.                               |
| **Customer 5 reaches Day 60**              | Is the Light/Medium/Heavy distribution unimodal (most customers Medium) or bimodal (Light + Heavy with few Medium)? Phase 1.5 transition readiness?                                              | If unimodal, lock $16K/mo single tier for customer 6+. If bimodal, switch to the §5.4 tiered structure. If each customer requires custom skills, the SKU model is broken; revisit per ADR 0004. |
| **Customer 5 renewal decision**            | Among customers 1-3 who hit their renewal window, what's the renewal rate?                                                                                                                       | If <70% renew at 6-month mark, the price-value equation is wrong; adjust before scaling.                                                                                                        |
| **Quarterly (every 90 days)**              | Vendor pricing shifts (Anthropic, Fly, Cloudflare, AgentMail); new tooling that changes the cost stack; new operator data on Captain-hour benchmarks.                                            | Update the doc with new evidence; revise v1 pricing for new customers if signal warrants.                                                                                                       |

These triggers are operational discipline, not contract clauses. Customers do not see them. They drive whether customer 4 ships with the same terms as customer 3, or different terms.

---

## 7. Risks

- **Phase 1 Captain-hour drift.** If first-customer hours land at 1.5x to 2x the modeled assumption (i.e. Light at 6 hours/week, Medium at 9, Heavy at 15), the Medium-profile breakeven price moves to $24K/mo and the SKU becomes a hard sell against the headcount-substitution anchor. This is the dominant risk. Mitigation: scope-cap contractual guardrails per service-contract doc; weekly Captain-hour tracking from customer 1; Captain-veto rights on Day-30 renewal if hours overrun.
- **Cache hit rate lower than 75%.** Drops Claude API spend efficiency; not a material margin risk at current per-draft costs (Heavy Claude API is $17/mo even if cache rate halves), but worth tracking.
- **Vendor pricing shifts.** Anthropic's pricing for Sonnet/Opus has shifted twice in 12 months. Fly and Cloudflare are more stable but not immune. Quarterly refresh trigger fires automatically.
- **The 40% margin floor is a benchmark, not a law.** Per platform-prd §17.1 the floor is a kill criterion; Captain may elect to operate above it for strategic reasons (e.g. anchor customer at a logo-significant firm). The model defends the floor; Captain decides whether to apply it.
- **Multi-practice-area customers (PI + WC, PI + family, etc.) move toward Heavy faster than modeled.** The Heavy profile assumes 2 practice areas; a third drives token spend, Captain hours, and connector complexity up.

---

## 8. Captain decisions queued

These are PROPOSALS subject to Captain review. None auto-execute.

1. **Adopt flat-monthly $16,000/mo per law-firm customer as the v1 launch price.** Single tier. Re-evaluate after 5 customers per §5.4 tiering trigger.
2. **Adopt Captain $200/hr loaded rate for productized-SKU COGS modeling**, distinct from the decision-stack #16 $175/hr launch rate for scope-based external billing. This is the platform-prd §15.1 and #806 figure; this doc confirms its use.
3. **Adopt scope-cap conversation at SOW for Heavy customers** rather than tiered pricing at launch. Customer-shape classification at SOW; scope-cap negotiation if the customer profile exceeds the Medium envelope; Phase 1.5 customer 6+ revisit per §5.4.
4. **Adopt the assumptions ledger (§6.1, §6.2) as the audit trail** for every figure in the model. Customer 1 actuals trigger first revision.

These four queue against [#794](https://github.com/venturecrane/ss-console/issues/794) for Captain finalization. Once approved, this doc unblocks any customer-facing pricing conversation and links from platform-prd §15 + law-firm-prd §11.7.

---

## 9. Sources

- [Anthropic API pricing page](https://platform.claude.com/docs/en/docs/about-claude/pricing) (accessed 2026-05-21)
- [Fly.io pricing page](https://fly.io/docs/about/pricing/) (accessed 2026-05-21)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) (accessed 2026-05-21)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) (accessed 2026-05-21)
- [Cloudflare Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) (accessed 2026-05-21)
- [AgentMail pricing page](https://agentmail.to/pricing) (accessed 2026-05-21)
- [`CLAUDE.md`](../../CLAUDE.md) Captain $200/hr loaded rate
- [`docs/pm/operator/platform-prd.md`](../pm/operator/platform-prd.md) §15 Pricing Posture, §15.1 Cost telemetry and SKU margin discipline, §15.2 Captain CLI for operations time-logging, §17.1 Per-customer success metrics
- [`docs/pm/operator/law-firm-prd.md`](../pm/operator/law-firm-prd.md) §11.7 The order-taking moment, §11.8 Beta-1 Day-1/Week-1/Week-4, §11.9 Calibration session split
- [ADR 0004 Productized AI Employee Offering](../adr/0004-productized-ai-employee-offering.md)
- [`docs/strategy/operator-stack-evaluation-2026-05-13.md`](./operator-stack-evaluation-2026-05-13.md) cost-shape inputs
- [`docs/strategy/operator-service-contract-2026-05-13.md`](./operator-service-contract-2026-05-13.md) contract guardrails companion
- [The Startup Ideas Podcast "The $1M+ Solo AI Agent Business"](https://www.youtube.com/watch?v=BI-MNjm1tTQ) (Greg Isenberg + Nick Vasilescu, 2026-05-12) market-pricing operator anecdotes
