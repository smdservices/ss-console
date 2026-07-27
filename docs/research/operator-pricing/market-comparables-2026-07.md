# Operator Pricing: Market Comparables (July 2026)

**Status:** Internal reference. Never client-facing, never published (Decision Stack: no dollar amounts external; ADR 0063 pricing is internal-only). This is ammunition for pricing conversations, not collateral.

**Purpose:** Answer "what can we point to as a comparison, by functionality and price?" for the Operator SKU ($5,000/mo fully managed + $4,000 stand-up, per ADR 0063). Compiled 2026-07-27 ahead of the first live test of the pricing model (A&P diligence letter 10). All third-party figures are reported/estimated where vendors do not publish pricing; treat as directional, verify before quoting a specific competitor number to anyone.

**Bottom line:** No product or service in the market combines "runs inside the client's existing systems," "managed for the client," "compliance-grade audit," and "flat, all-inclusive, month-to-month." Every partial comparison prices at or above the Operator. The $5,000/mo figure sits at the bottom of the managed-retainer band, at parity with the leading single-function AI employee, and below one fully loaded coordinator salary.

---

## 1. AI "employees" priced as a role (closest pricing comparable)

| Offering                       | What it does                             | Reported price                                                    | Terms                           |
| ------------------------------ | ---------------------------------------- | ----------------------------------------------------------------- | ------------------------------- |
| 11x "Alice" (AI SDR)           | One function: outbound sales development | ~$5,000/mo; median contract ~$45k/yr; first-year minimums $50-60k | Annual commitment               |
| Artisan (AI SDR)               | Lighter self-serve version of the same   | $600/mo entry (annual billing); $2,000-4,000/mo enterprise        | Software you drive, not managed |
| Devin (Cognition, AI engineer) | Autonomous coding agent                  | $500/mo Teams incl. 250 ACUs, then ~$2/ACU; $20-200/seat tiers    | Consumption-metered             |

**Read:** The market's flagship "digital worker" (11x) charges the same $5,000/mo for one function with an annual lock-in. The Operator runs a configurable multi-routine coordinator, month to month. Devin's ACU metering is evidence that consumption pricing is the market norm, which makes "all AI usage included, nothing metered" a real differentiator.

## 2. Legal AI SaaS (per-seat software the firm's staff must operate)

| Product                                                 | What it does                                          | Reported price                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Harvey                                                  | Enterprise legal AI                                   | ~$1,000-2,400/seat/mo; 12-mo commitments; ~20-seat minimums; $50k-300k+/yr contracts; 10-25% renewal uplifts reported                      |
| Eve (plaintiff-focused; a16z-backed, unicorn Sept 2025) | Intake-through-resolution platform for PI / L&E firms | ~$500/user/mo attorney seats (third-party estimate); unpublished                                                                           |
| CoCounsel (Thomson Reuters)                             | Research/review assistant                             | $75-500/user/mo published tiers; full value assumes Westlaw bundle (~$3k/seat reported)                                                    |
| Supio (PI-specific)                                     | Medical record analysis, demand prep                  | est. $150-400/user/mo; unpublished, sales-quoted                                                                                           |
| EvenUp (PI-specific)                                    | Demand letters                                        | ~$300 base per demand, $500-800+ with add-ons; $500-2,000/mo typical; per-case pricing introduced May 2025; hidden-fee complaints reported |
| AI.Law                                                  | "AI paralegal" role seats                             | $149 paralegal / $299 associate / $699 partner per seat/mo                                                                                 |
| Intake tools (Clio Grow, Lawmatics, QualifyAI, Josef)   | Intake automation only                                | $200-2,000/mo                                                                                                                              |

**Read:** Every one of these is a tool the firm's staff has to operate; none replaces the coordinator role, and each wants to be the stack rather than work across the firm's existing one (Smokeball, M365, InfoTrack, BriefPoint). Eve at ~$500/seat across 8-10 seats is $4,000-5,000/mo of software that still needs a human driving it. Harvey's seat minimums exclude an 11-person firm entirely. This is ADR 0037 tenet 1 confirmed by the market: these are connection targets and adjacent tools, not competitors for the coordinator role.

## 3. Custom AI agent agencies / managed automation retainers (closest functional comparable)

| Segment                                           | Reported monthly retainer | Setup/build fee                             |
| ------------------------------------------------- | ------------------------- | ------------------------------------------- |
| Small business (2-3 workflows)                    | $1,000-3,500/mo           | $2,000-12,000 typical range across segments |
| Mid-market (multi-workflow stack, ongoing builds) | $4,000-10,000/mo          | "                                           |
| Enterprise (dedicated team)                       | $8,000-25,000/mo          | "                                           |

**Read:** This is the category the Operator technically lives in: someone builds and operates agents for you, with the agency owning monitoring, fixes, and improvements. The Operator sits at the bottom of the mid-market band while including things no agency retainer carries: fail-closed entitlements, hash-chained audit trail, per-client isolated infrastructure, 24/7 monitoring, and all AI usage in the price. The $4,000 stand-up fee is dead-center of the market's setup-fee range, which validates that number independently.

## 4. The salary anchor (ADR 0037 tenet 1: price against a hire, not a seat)

Sacramento market, 2026:

| Role                   | Base salary (reported range) | Fully loaded (est. 1.25-1.5x) |
| ---------------------- | ---------------------------- | ----------------------------- |
| Paralegal              | $62k-90k+                    | ~$78k-135k                    |
| Case manager paralegal | ~$62k average                | ~$78k-93k                     |
| Paralegal manager      | $99k-124k                    | ~$124k-186k                   |

**Read:** The Operator's $60k/yr run rate is below one fully loaded coordinator, works across every matter simultaneously, and carries no PTO, turnover, or retraining cost.

---

## The three holster sentences

For live pricing conversations. Spoken ammunition, never written into client-facing copy:

1. "The market's leading single-function AI employee charges the same $5,000 a month for one job with a $50k first-year commitment; the Operator runs your whole litigation lifecycle month to month."
2. "The per-seat legal AI platforms reach the same monthly spend by seat three or four, and they're software your staff still has to drive, inside a system that isn't yours."
3. "Managed AI agent retainers for businesses your size run $4,000 to $10,000 a month plus setup; we're at the bottom of that band with the setup waived, and nothing metered."

## Caveats

- Harvey, Eve, Supio, and 11x do not publish pricing. Figures are third-party reporting and customer disclosures. Do not quote a specific competitor number to a client without re-verifying.
- The AI SDR and agency-retainer markets reprice quickly; refresh this doc before relying on it beyond ~Q4 2026.
- Terms differ materially from ours across the board: annual commitments and renewal uplifts (Harvey, 11x), consumption metering (Devin, EvenUp), per-seat scaling (all legal SaaS). Month-to-month flat pricing is the outlier position, in our favor.

## Sources

- Supio: [ProPlaintiff pricing guide](https://www.proplaintiff.ai/post/supio-pricing-guide-what-personal-injury-law-firms-should-expect-to-pay)
- EvenUp: [AI Vortex review](https://www.aivortex.io/legal/ai-tools/evenup/), [ProPlaintiff alternatives](https://www.proplaintiff.ai/post/top-evenup-alternatives-for-personal-injury-law-firms), [EvenUp per-case pricing announcement](https://www.evenuplaw.com/blog/introducing-ai-drafts-suite/)
- Eve: [ProPlaintiff pricing explained](https://www.proplaintiff.ai/post/eve-legal-pricing-explained), [eesel pricing guide](https://www.eesel.ai/blog/eve-ai-pricing)
- Harvey / CoCounsel: [The Legal Prompts pricing report](https://thelegalprompts.com/blog/harvey-ai-pricing), [Vaquill legal AI pricing benchmark](https://www.vaquill.ai/blog/legal-ai-pricing-benchmark)
- 11x / Artisan: [Breakout 11x pricing](https://getbreakout.ai/blog/11x-pricing-ai-sdr-cost-2026), [Altitude AI SDR pricing index](https://altitudebiz.dev/notes/ai-sdr-pricing-index), [11x on Artisan pricing](https://www.11x.ai/guides/artisan-pricing)
- Agency retainers: [Digital Agency Network pricing guide](https://digitalagencynetwork.com/ai-agency-pricing/), [CueBytes cost report](https://cuebytes.com/blog/ai-automation-agency-cost), [Thinkpeak pricing guide](https://thinkpeak.ai/ai-automation-agency-pricing-2026/)
- Devin: [Noizz pricing guide](https://noizz.io/insights/devin-pricing-guide)
- Salaries: [Salary.com Sacramento paralegal](https://www.salary.com/research/salary/benchmark/paralegal-i-salary/sacramento-ca), [Robert Half paralegal manager](https://www.roberthalf.com/us/en/job-details/paralegal-manager/sacramento-ca), [Indeed Sacramento paralegal](https://www.indeed.com/career/paralegal/salaries/Sacramento--CA)
