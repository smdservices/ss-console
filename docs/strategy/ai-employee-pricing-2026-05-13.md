# AI Employee Pricing Analysis — 2026-05-13

**Issue:** [#772](https://github.com/venturecrane/ss-console/issues/772)
**Authorizes:** Launch pricing lock for productized AI Employee SKU
**Inputs:** [Stack evaluation](./ai-employee-stack-evaluation-2026-05-13.md) (cost shape), [functional shape research](./ai-employee-functional-shape-2026-05-13.md) (market pricing patterns + $5K/mo Captain confirmation)
**Captain decision required** — does not auto-execute.

---

## Executive summary

Captain confirmed $5K/mo flat single tier launch pricing in the functional shape doc. This analysis validates that decision against the cost stack, surfaces the support-labor variable as the dominant margin risk, and proposes contract guardrails to protect economics.

**The numbers.**

| Year                                             | Revenue/customer | Cost/customer | Gross profit/customer | Gross margin |
| ------------------------------------------------ | ---------------- | ------------- | --------------------- | ------------ |
| Y1 (Phase 1 — first 1-5 customers)               | $60,000          | ~$37,700      | ~$22,300              | **~37%**     |
| Y2 (Phase 1.5 — 6-15 customers, systematization) | $60,000          | ~$11,500      | ~$48,500              | **~81%**     |
| Y3+ (Phase 2 — 16+ customers, automation)        | $60,000          | ~$7,300       | ~$52,700              | **~88%**     |

**The dominant risk.** Support labor is 90% of the cost stack. Infra cost ($35-170/mo per customer) is rounding error against support hours ($350-2,100/mo per customer depending on operations phase). The pricing model survives if we bound support hours contractually and systematize delivery as customer count grows. The pricing model collapses if Phase 1 customer support drifts to 16+ hours/week per customer.

**LTV / CAC framework.** At conservative retention (30% Y1 churn, 20% Y2, 15% Y3+), mean customer life is ~24-30 months. Expected lifetime gross profit per customer: **$70K-$90K**. Target LTV:CAC of 6:1 implies acquisition cost cap of $13K — well above realistic Phase 1 acquisition cost through warm channels (Vistage, EO Arizona, referrals, content; estimated $2-5K per customer).

**Tier structure: single flat tier at launch, re-evaluate after 5 customers.** Tiering pre-revenue is premature optimization. Single tier maximizes sales velocity and customer self-selection. After 5 customers, data will indicate whether to add a smaller capacity-light tier or a larger dedicated-support tier.

**Pricing starting position (subject to revision against data, not a lock): $5,000/mo flat retainer, no tiering, 6-month initial term for Phase 1 customers with 90-day evaluation window. 12-month commitment pattern locks for customer 6+ once Phase 1.5 data validates assumptions.** This is a newly emerging market; our data is thin (operator anecdotes, one quarter of market signals). Locking these numbers as firm benchmarks would be overconfidence. We adopt them as the best starting position the available data supports and bind them to explicit revision triggers (see below).

---

## Cost stack per customer per month

Three load points based on customer usage shape. Most SMD customers should land in **moderate**; the **light** and **heavy** profiles bracket the realistic range.

| Component                                              | Light                          | Moderate (expected SMD median) | Heavy                                    |
| ------------------------------------------------------ | ------------------------------ | ------------------------------ | ---------------------------------------- |
| Workers Paid (shared, attributed per customer at 10)   | $0.50                          | $0.50                          | $0.50                                    |
| Fly.io Hermes machine                                  | $5 (shared-cpu-1x, low active) | $10 (shared-cpu-1x active)     | $20 (performance-1x sustained)           |
| CF Sandboxes (computer-use bursts)                     | $1 (rare GUI)                  | $5 (regular GUI)               | $15 (frequent GUI)                       |
| Cloudflare Vectorize                                   | $0.50                          | $1                             | $2                                       |
| D1 + R2 (memory layer)                                 | $0.50                          | $1                             | $2                                       |
| AgentMail Builder ($20/mo / 10 inboxes)                | $2                             | $2                             | $5 (Scale-tier pro-rata)                 |
| Composio Standard ($29/mo / 200K calls / 10 customers) | $3                             | $3                             | $5 (heavier may need Pro-tier amortized) |
| Claude API tokens (with prompt caching)                | $20                            | $50                            | $120                                     |
| **Total**                                              | **~$32/mo**                    | **~$72/mo**                    | **~$170/mo**                             |

**Notes on the cost shape:**

- The Composio and AgentMail amortizations assume 10 active customers. At 5 customers, per-customer cost is roughly 2x amortized; at 25 customers, ~0.4x. Material but not dominant.
- Claude API is the variable that scales most directly with customer usage. Prompt caching (1.25x base for 5min, 2x for 1hr, reads at 0.1x) is mandatory; without it, costs roughly 3-5x.
- Fly.io machine sizing is the second-largest variable. A customer running a chat-only agent on shared-cpu-1x with low utilization sits at the low end; a customer running heavy multi-surface gateway with frequent long-horizon tasks pushes to performance-1x or 2x. Phase 2 re-evaluation should consider moving to Cloudflare-native (CF Agents + Claude Agent SDK) to collapse this line item entirely.
- Infra cost is real but small. Even at the heavy end ($170/mo), it represents 3.4% of a $5K/mo retainer.

---

## Support labor model

Support labor dominates the cost stack. The model assumes Captain's internal rate of $175/hr at launch (per Decision #16). All hours are Captain or Captain-with-agent-fleet hours.

### Three regimes by customer-count phase

| Phase                                                       | Customer count | Onboarding (one-time)    | Steady-state per customer per month |
| ----------------------------------------------------------- | -------------- | ------------------------ | ----------------------------------- |
| **Phase 1** (learning)                                      | 1-5            | 80-120 hours / $14K-$21K | 8-12 hours/week / $1,400-$2,100/mo  |
| **Phase 1.5** (systematization)                             | 6-15           | 40-80 hours / $7K-$14K   | 4-6 hours/week / $700-$1,050/mo     |
| **Phase 2** (automation, Captain's rate scaling to $200/hr) | 16+            | 20-40 hours / $4K-$8K    | 2-4 hours/week / $350-$800/mo       |

### What drives the trajectory

**Onboarding compression** comes from the playbook itself becoming a deliverable. The first customer's onboarding includes building the vertical pack from scratch; customer 5 reuses 80% of customer 4's pack; customer 15 reuses 95% of the v1 marketing-agencies pack.

**Steady-state compression** comes from three places:

- **Agent self-service** — by Phase 1.5, the customer's agent handles routine customer questions instead of escalating to Captain.
- **Watchdog and observability automation** — Phase 1.5 builds out monitoring that catches issues before manual discovery.
- **Pattern libraries** — Phase 2 has runbooks for the top 20 issue patterns; resolution time drops from "investigate" to "apply runbook 7."

### Support hours allocation guidance

For Phase 1 (1-5 customers), realistic allocation per customer per month:

| Task                               | Hours/month        | Notes                                                    |
| ---------------------------------- | ------------------ | -------------------------------------------------------- |
| Customer success check-in (weekly) | 4                  | Day-7, Day-30, Day-60, Day-90 cadence                    |
| Skill iteration / customization    | 8-16               | New skills, vertical pack tuning                         |
| Incident response                  | 4-8                | Variable; bound by SLA                                   |
| Reporting / dashboard maintenance  | 2-4                | Customer-facing health metrics                           |
| Vendor coordination                | 1-3                | Hermes upgrades, MCP changes, Fly issues                 |
| Customer escalations               | 4-8                | The customer pings us with an ad-hoc question or request |
| **Total**                          | **23-43 hours/mo** | Roughly 5-10 hours/week                                  |

This is consistent with the operator data points in the functional shape research: agency-retainer pattern reports 5-10 hours/week per customer maintenance once stable.

---

## Margin analysis

### Year 1 per customer (Phase 1)

| Line item                                                        | Value        |
| ---------------------------------------------------------------- | ------------ |
| Revenue ($5K/mo × 12 months)                                     | $60,000      |
| Onboarding cost (one-time, Phase 1 mid-range)                    | -$17,500     |
| Infra cost ($72/mo × 12)                                         | -$864        |
| Support cost ($1,750/mo × 11 months, excluding onboarding month) | -$19,250     |
| **Total cost Y1**                                                | **-$37,614** |
| **Gross profit Y1**                                              | **$22,386**  |
| **Gross margin Y1**                                              | **~37%**     |

### Year 2 per customer (Phase 1.5 — systematization)

| Line item                                         | Value        |
| ------------------------------------------------- | ------------ |
| Revenue                                           | $60,000      |
| Infra cost ($75/mo × 12)                          | -$900        |
| Support cost ($875/mo × 12 — Phase 1.5 mid-range) | -$10,500     |
| **Total cost Y2**                                 | **-$11,400** |
| **Gross profit Y2**                               | **$48,600**  |
| **Gross margin Y2**                               | **~81%**     |

### Year 3+ per customer (Phase 2 — automation)

| Line item                                       | Value       |
| ----------------------------------------------- | ----------- |
| Revenue                                         | $60,000     |
| Infra cost ($75/mo × 12)                        | -$900       |
| Support cost ($525/mo × 12 — Phase 2 mid-range) | -$6,300     |
| **Total cost Y3+**                              | **-$7,200** |
| **Gross profit Y3+**                            | **$52,800** |
| **Gross margin Y3+**                            | **~88%**    |

### Blended Y1+Y2 (the typical retained customer)

Two-year revenue: $120,000. Two-year cost: $49,014. Two-year gross profit: $70,986. Blended margin: **~59%**.

### LTV framework

Conservative retention assumption (informed by AI-SDR cancellation data in the functional shape research):

| Year     | Probability of retention to this year | Annual gross profit | Expected gross profit    |
| -------- | ------------------------------------- | ------------------- | ------------------------ |
| Y1       | 100% (all paying customers)           | $22,386             | $22,386                  |
| Y2       | 70% (30% Y1 churn — 60-90 day cliff)  | $48,600             | $34,020                  |
| Y3       | 56% (80% Y2-to-Y3 retention)          | $52,800             | $29,568                  |
| Y4       | 48% (85% Y3-to-Y4)                    | $52,800             | $25,344                  |
| Y5+ tail | Continues tapering                    | —                   | ~$30,000 cumulative tail |

**Expected lifetime gross profit per customer: ~$141K** (cumulative across the full tail).

This is conservative — Phase 2+ retention rates may improve materially if the agent demonstrably reduces customer churn from their other operational pain. The $141K is a low-end planning number.

### CAC framework

Target LTV:CAC of **6:1** (mid-market SaaS benchmark; SMB services tends higher because retention is longer).

LTV $141K → CAC ceiling $23K per customer.

Phase 1 acquisition through warm channels (Vistage, EO Arizona, accountant/bookkeeper referrals, content) realistically lands at **$2-5K per customer** — well below the ceiling.

At scale with outbound + paid + content, $5-10K per customer is reasonable and still within budget. The LTV:CAC math is not the constraint at any near-term phase.

---

## Sensitivity analysis

What breaks the pricing model?

### Support hours double (16-24 hours/week per customer Phase 1)

| Line item                | Value        |
| ------------------------ | ------------ |
| Revenue                  | $60,000      |
| Onboarding (unchanged)   | -$17,500     |
| Infra (unchanged)        | -$864        |
| Support ($3,500/mo × 11) | -$38,500     |
| **Total cost Y1**        | **-$56,864** |
| **Gross profit Y1**      | **$3,136**   |
| **Gross margin Y1**      | **~5%**      |

**This is the breaking point.** If Phase 1 customers consistently require 16+ hours/week of Captain attention, the math collapses. Mitigation: contractual scope guardrails (see service contract implications below), graduated autonomy that reduces customer dependence, and a hard rule that customers requiring >12 hours/week are escalated to either a custom scope quote or termination.

### Token spend doubles (Claude API to $40-160/mo, infra avg to $120/mo)

| Line item            | Value        |
| -------------------- | ------------ |
| Revenue              | $60,000      |
| Onboarding           | -$17,500     |
| Infra ($120/mo × 12) | -$1,440      |
| Support              | -$19,250     |
| **Total cost Y1**    | **-$38,190** |
| **Gross margin Y1**  | **~36%**     |

Negligible impact. Token spend doubling adds $576 to the annual cost — <1% margin shift. Not a real risk.

### Onboarding stretches 2x (8 weeks instead of 4)

| Line item                       | Value        |
| ------------------------------- | ------------ |
| Revenue                         | $60,000      |
| Onboarding ($35K, double)       | -$35,000     |
| Infra                           | -$864        |
| Support ($1,750/mo × 10 months) | -$17,500     |
| **Total cost Y1**               | **-$53,364** |
| **Gross profit Y1**             | **$6,636**   |
| **Gross margin Y1**             | **~11%**     |

Tight but survivable in Y1; Y2+ unchanged. Mitigation: structured onboarding playbook with customer-side prerequisite gates, shadow-mode period reduces ambiguity, hard 80-hour cap on onboarding hours (anything beyond is a paid scope expansion).

### Y1 churn hits 60% instead of 30%

LTV halves to ~$70K. CAC ceiling drops to $12K — still well above realistic warm-channel acquisition cost. The pricing model survives but the customer-success engine must be much sharper. Mitigation: structured Day-7 / Day-30 / Day-60 / Day-90 check-ins, shared KPI dashboard, fast-response incident protocol, the onboarding-as-paid-stage framing that gives customers a clean exit at Day 90 without bad blood.

### Multi-failure scenario (support doubles AND onboarding stretches AND Y1 churn at 60%)

Y1 cost: ~$74K. Y1 gross profit per customer: **-$14K (loss)**. LTV gross profit per customer: ~$25K (just Y1's of survivors, no Y2+ accumulation worth modeling at this churn).

This is the worst plausible case. It survives because most variables move toward Phase 1.5 / 2 quickly as customer count grows — the pain is concentrated in the first 1-2 customers, and the marginal cost of customer N drops fast.

---

## Pricing starting position

**Single flat tier at $5,000/mo. 6-month initial term for Phase 1 (customers 1-5) with 90-day evaluation window. 12-month commitment pattern locks for customer 6+ once Phase 1.5 data validates the assumptions.**

This is the best starting position the available data supports. The market is newly emerging; the operator data is thin; locking these numbers as firm benchmarks would be overconfidence. The structure binds the starting position to explicit revision triggers (see below) so each Phase 1 customer becomes a data point that improves the next.

### Why $5K (and not $3K or $7.5K)

- **Below $3K** — Y1 gross profit per customer goes negative. Pre-launch the firm cannot subsidize losses on first-customer acquisition; we're trying to reach profitability, not buy market share.
- **$3-4K range** — Y1 margin under 20%. Possible but tight. Loses the market-consensus mid-mark positioning.
- **$5K** — Lands at the mid-market mark per research consensus. Y1 margin 37% (acceptable, given Phase 1 onboarding intensity); Y2+ margin 80%+ (excellent).
- **$7.5-10K range** — Better margin, but competes with fractional CTO and FDE deployments where buyer expectations are higher. Premature for a pre-launch SKU.

### Why flat (and not metered or outcome-priced)

- **Metered** — burns the simplicity advantage. Customers stop using the agent because they're worried about the meter. Operators in the research consistently move away from credit-based pricing for this reason.
- **Outcome-priced** — works for large vendors (Fin, Sierra) because their customers can instrument outcomes. SMB customers can't reliably count outcomes (they're not instrumented). Outcome pricing also introduces revenue uncertainty for the operator at exactly the wrong phase.
- **Flat retainer** — matches how the buyer mentally accounts for the cost being replaced (a hire). Predictable revenue for SMD. Customer self-selects on whether they get $5K of value per month.

### Why single tier (and not entry/standard/premium)

- **Sales complexity** — three tiers means three pricing conversations and the customer trying to game which tier to buy. Single tier collapses this.
- **Capacity planning** — three tiers means three capacity models. Pre-revenue, we don't have data to set the tier boundaries.
- **Customer self-selection** — single tier means the customer either sees $5K of value or doesn't. Cleaner conversion signal than tier-shopping.
- **Re-evaluate after 5 customers** — Phase 1.5 data will indicate whether to add a capacity-light tier ($2.5-3K, single skill, single vertical pack, capped support) or a premium tier ($10-15K, dedicated support, custom skills, faster SLA).

### Why 12-month commitment

- **Aligns with the SaaS retention reality.** AI-SDR data shows day-60-90 cliff is the natural cancellation point regardless of contract length. A 12-month commitment with a 90-day evaluation window gives the customer optionality at the natural cliff while reducing month-to-month churn after.
- **Smooths revenue.** Pre-launch, predictable annual revenue per customer is critical for cash flow planning.
- **Aligns incentives.** Customer commits to letting the agent learn their business; SMD commits to making it work.

### Why 90-day evaluation window

- **Honest about reality.** First 90 days are when failures surface, when trust is built or broken, when customers decide whether to renew.
- **Reduces sales friction.** "If after 90 days you're not seeing value, we part ways" is a closer-friendly story.
- **Reduces churn risk.** Customers who would have churned at Day-90 anyway will use the evaluation window cleanly; everyone else commits.

---

## Revision triggers

The starting position above commits to a specific number ($5K), term length (6 months Phase 1 / 12 months Phase 1.5+), and support cap (10 hrs/week). Each of these is bound to a concrete data checkpoint at which we revisit.

| Trigger                             | What we re-evaluate                                                                                                                                                | Action if data deviates                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer 1 onboarding completes** | Did the 80-hour onboarding cap hold? Did the customer accept the $5K price without negotiation pressure? Was the 10 hrs/week steady-state realistic in week 5-8?   | If onboarding hit 120+ hours, revise scope or raise cap. If $5K was a struggle, test $4K with customer 2. If steady-state is 15+ hours/week, adjust cap for customer 2.       |
| **Customer 3 enters steady-state**  | Are we consistently at the support-hour cap or under? Are renewal signals strong (Day-30 satisfaction)? Is per-customer infra cost tracking against the model?     | If support is sustained above cap, raise price (test $6K with customer 4) or tighten scope. If renewal signals weak, escalate customer success engineering before customer 4. |
| **Customer 5 reaches Day-60**       | Are we ready to transition Phase 1.5 (systematization)? Does the v1 marketing-agencies pack hold up across customers, or is each customer requiring custom skills? | If pack holds up, lock $5K/mo and 12-month commitment for customer 6+. If each customer needs custom skills, the model is broken; revisit scope of the productized SKU.       |
| **Customer 5 renewal decision**     | Among customers 1-3 who hit their renewal window during this phase, what's the renewal rate?                                                                       | If <70% renew at the 6-month mark, the price-value equation is wrong somewhere; adjust before scaling.                                                                        |
| **Quarterly (every 90 days)**       | Market data refresh — pricing shifts among operators we track, new tooling that changes our cost stack, churn-pattern data in published case studies.              | Update the doc with new evidence; revise starting positions for new customers if signal warrants.                                                                             |

These triggers are operational discipline, not contract clauses. Customers don't see them. They drive whether we ship customer 4 with the same terms as customer 3, or different terms.

---

## Implications for service contract (#773)

The margin math drives several contract terms that #773 should lock:

**Onboarding scope is bounded.**

- Maximum 80 hours of Captain time in the onboarding period.
- Customer-side prerequisites enumerated (clean CRM data, OAuth admin consent, named champion, data audit).
- If customer-side prerequisites slip, onboarding pauses; clock resumes when prerequisites complete.
- Above 80 hours, customer is quoted a scope expansion at $200/hr.

**Steady-state support is bounded.**

- 10 hours per week per customer included in the retainer.
- Hours tracked, monthly statement provided.
- Customer requesting >10 hours/week is offered: (a) reduced scope, (b) higher-tier package (when tiers exist), or (c) end of engagement at next renewal.
- This is the single most important guardrail in the contract. Without it, the pricing model collapses.

**Trust ceiling per task is enumerated in the SOW.**

- Per Captain confirmation, the SOW lists each task as autonomous / draft-for-review / refused.
- Customers requesting more autonomy than the SOW allows trigger a scope conversation, not a quiet expansion.
- This protects margin (no scope creep) and protects the firm (no Air Canada-style liability exposure).

**Day 60-90 evaluation period.**

- Customer can terminate at Day-90 with 30 days notice, no penalty.
- After Day-90, the 12-month commitment kicks in (early termination = balance of contract paid).
- This is the cancellation-curve mitigation — the natural decision point becomes a contractual decision point.

**Incident-response SLA.**

- AI-generated customer-facing artifact errors: 4-hour acknowledgment, 24-hour remediation.
- Internal-only errors: 1 business day.
- Other issues: best-effort.
- Hard SLA outside business hours is not committed; on-call infrastructure is Phase 2+.

---

## Captain decisions queued

Three starting positions, each bound to the revision triggers above. **These are not lock-it-in commitments — they are the best starting position the data supports, subject to revision at each named trigger.**

1. **Adopt $5K/mo flat single tier as customer-1 starting position.** Revisit at customer 1 onboarding completion and customer 3 steady-state.
2. **Adopt 6-month initial term + 90-day evaluation window for Phase 1 (customers 1-5).** 12-month commitment pattern locks for customer 6+ once Phase 1.5 data validates assumptions. Revisit at customer 5 renewal-decision data point.
3. **Adopt 10 hours/week support cap as customer-1 starting position.** Track actuals. Revisit at customer 1 steady-state (week 5-8) and customer 3 steady-state. This remains the most important margin guardrail; even if the specific number changes, _some_ cap is non-negotiable.

These three starting positions close #772 and unblock #773 (service contract terms — codifies the contract shape and the revision discipline), #774 (service name), and #775 (copy/surfaces). Captain confirmation as "starting positions subject to revision triggers" is what proceeds the work.

---

## Risks tracked

- **Phase 1 support drift** — if Captain finds himself in 16+ hours/week per customer, the model breaks. Track weekly hours per customer from customer 1.
- **Onboarding cost overrun** — first customer is the highest-risk; the playbook hasn't been built. Budget $25K for customer 1; expect the second to land at $15-17K; third should drop to $10-12K.
- **Churn at 60-day cliff** — operator data points to this as the highest-risk period. Day-7 / Day-30 / Day-60 / Day-90 check-in cadence is mandatory.
- **Token spend escalation under bad agent loops** — the $47K agent loop case from the functional shape research is a real risk. Hard token budgets per customer per day enforced in code, not as alerts.
- **Vertical pack scope creep** — v1 marketing-agencies pack should be 6-8 skills, not 15. Adding skills costs Captain hours that come out of margin. Bound the v1 scope and quote expansions.

---

## Sources

- [Stack evaluation companion doc](./ai-employee-stack-evaluation-2026-05-13.md) — cost shape inputs
- [Functional shape research](./ai-employee-functional-shape-2026-05-13.md) — market pricing patterns, retention data, support-hour benchmarks
- [ADR 0004 — Productized AI Employee Offering](../adr/0004-productized-ai-employee-offering.md)
- [Decision Stack #16 — Pricing model](../adr/decision-stack.md) — Captain's internal rate ($175/hr at launch, $200/hr after first case study)
- [Source episode — The $1M+ Solo AI Agent Business](https://www.youtube.com/watch?v=BI-MNjm1tTQ) (Greg Isenberg + Nick Vasilescu, 2026-05-12)
