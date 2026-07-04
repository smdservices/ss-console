---
title: Operator Launch Pricing — $5,000/mo Retainer + $4,000 Stand-Up
date: 2026-07-04
status: accepted
captain: Scott Durgan
related-adr: 0004-productized-operator-offering.md, 0037-operator-thesis.md, 0062-operator-cost-plane.md
related-issues: 1659
supersedes: the deferred-pricing clause of ADR 0004 ("specific monthly price deferred pending stack cost analysis")
---

# ADR 0063 — Operator Launch Pricing

**Status:** Accepted (Captain decision, 2026-07-04, issue [#1659](https://github.com/venturecrane/ss-console/issues/1659)).

**Source:** ADR 0004 locked the pricing _shape_ (flat-rate monthly retainer, not metered, not credit-based) and deferred the number to a stack cost analysis. That analysis never landed a committed artifact; a working baseline ($4,000 stand-up + $3,500/mo, 2026-06-10) lived only in session memory. The Review 5 unit-economics stress test (2026-07-03) produced the committed cost model this decision prices against, and the ADR 0062 cost plane made per-seat COGS observable — which also armed the need for a real price: the locked COGS/MRR kill criterion (spend > 40% of MRR for two consecutive months) is structurally inert while `services.recurring_price` is NULL.

## Decision

**The Operator launch price is $5,000/month (flat-rate retainer) plus a one-time $4,000 stand-up fee.** Internal, not published (the no-published-dollar-amounts rule stands; the client sees the price in their proposal).

## Derivation

- **Cost model (Review 5, committed 2026-07-03):** per-seat hard costs are ~$7.42/mo fixed infrastructure plus ~$300–1,200/mo tokens at modeled production load (now observable per seat via ADR 0062 workspace attribution). The dominant cost is Captain labor at the $200/hr loaded rate: launch-level supervision (~16 h/mo) is ~$3,200/mo by itself. The prior $3,500/mo baseline was therefore a **cost floor**, not a price — pricing at it is break-even under honest labor accounting.
- **Salary anchor (ADR 0037 tenet 1 / ADR 0040):** the Operator competes with a hire, never a software seat. The displaced coordinator role runs ~$60k/yr ≈ $5,000/mo fully loaded before turnover cost. $5,000/mo prices _at_ the anchor: the buyer trades a salary for a seat that does not quit, with the managed service included.
- **Margin and the kill gate:** at $5,000 MRR the 40% COGS criterion trips at $2,000/mo seat cost — comfortably above the token band, so a trip signals genuinely anomalous economics (runaway usage or labor-heavy account) rather than normal operation. At $3,500 the same gate would trip in ordinary months, making it noise.
- **Stand-up fee:** $4,000 covers provisioning + pack configuration + onboarding labor (the Review 5 baseline carried it forward unchanged; it remains cost-derived).

## Consequences

- `services.recurring_price = 5000` is authored on live Operator seats so the COGS/MRR ratio computes and the kill gate arms. Pilot and dogfood seats carry the **list price for gate purposes while invoicing remains $0** during pilot — the ratio then reads as as-if margin, which is the operational signal the gate exists to produce. (A future paid seat authors its actual contracted price, which is expected to equal list.)
- Price changes are per-seat and contractual; this ADR sets the launch list price, not a perpetual commitment. Repricing triggers remain the kill criterion and pilot learnings.
- The handbook pricing posture and Decision Stack entry (#50) are updated with this ADR; the no-external-publication rule is unchanged.
