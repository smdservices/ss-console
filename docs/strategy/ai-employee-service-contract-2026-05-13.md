# AI Employee Service Contract Terms — 2026-05-13

**Issue:** [#773](https://github.com/venturecrane/ss-console/issues/773)
**Authorizes:** Contract shape for productized AI Employee SKU. Drives downstream SOW/MSA drafting (separate deliverable under copy/surfaces #775 or its own follow-on).
**Inputs:** [Pricing analysis](./ai-employee-pricing-2026-05-13.md), [functional shape research](./ai-employee-functional-shape-2026-05-13.md), [stack evaluation](./ai-employee-stack-evaluation-2026-05-13.md), [ADR 0004](../adr/0004-productized-ai-employee-offering.md)

---

## Executive summary

The productized AI Employee SKU is a structurally different agreement than SMD's scope-based consulting engagements ([Decision #14](../adr/decision-stack.md#decision-14---payment-terms)). The pricing analysis surfaced the operational obligations the firm hasn't yet had: bounded onboarding, bounded steady-state support, day-60-90 cancellation risk, trust-ceiling discipline, and SLA shape. This doc locks the contract terms that protect the economic model.

**Contract shape at a glance:**

| Element                      | Starting position (Phase 1, customers 1-5)                                                                            | Phase 1.5 lock (customer 6+)                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Initial term**             | 6 months                                                                                                              | 12 months                                                                     |
| **Evaluation window**        | First 90 days, customer may terminate with 30 days notice                                                             | Same                                                                          |
| **Renewal**                  | Auto-renew month-to-month at end of initial term unless customer gives 30 days notice                                 | Auto-renew annual at end of initial term unless customer gives 60 days notice |
| **Onboarding scope**         | Bounded to 80 hours of Captain time                                                                                   | Same; reduced as playbook matures                                             |
| **Steady-state support**     | 10 hours/week per customer included; additional at $200/hr                                                            | Same; revisit cap at customer 3 data                                          |
| **Trust ceiling**            | Enumerated per task in the SOW (autonomous / draft-for-review / refused)                                              | Same                                                                          |
| **Customer success cadence** | Day-7, Day-30, Day-60, Day-90 check-ins (mandatory)                                                                   | Day-30, Day-90, quarterly                                                     |
| **Incident SLA**             | Customer-facing artifact errors: 4-hour ack / 24-hour remediation. Internal-only: 1 business day. Other: best-effort. | Same; tighten if competitive pressure warrants                                |
| **Termination**              | Data handoff within 14 days; agent shutdown at request                                                                | Same                                                                          |

**Every starting position is bound to a revision trigger** per the pricing analysis. The contract structure is designed to absorb data and tighten over the first 5-15 customers, not to lock today.

---

## 1. Term and evaluation

### Initial term

**Phase 1 customers (1-5): 6-month initial term.**

- Customer commits to 6 months at $5K/mo retainer
- Aligns with the operator data that the 60-90 day cancellation cliff is real. 6 months gives both sides time past the cliff to know if it's working
- Lower commitment than 12 months protects customer ("I'm not locked in for a year on a new service") and protects SMD (if customer 2 hates the offering, we know in 6 months not 12)

**Phase 1.5+ customers (6+): 12-month initial term locks** once data validates the assumptions:

- Renewal rate among customers 1-5 reaches 70%+ at the 6-month decision point
- v1 vertical pack holds up across customers (not custom per-customer)
- Steady-state support tracks against the 10 hr/week cap

If those validation criteria aren't met by customer 5, **the 12-month commitment does not auto-trigger.** We stay at 6 months for customer 6+ until the criteria are met.

### 90-day evaluation window

**For all customers regardless of phase:**

- During the first 90 days, the customer may terminate with 30 days written notice. No penalty.
- After Day-90, the initial-term commitment is in effect — early termination requires payment of the balance.
- This window is the contractual mirror of the operator-observed cancellation cliff. We make the natural decision point an explicit one.

**Termination during evaluation window** is amicable. SMD provides data handoff (vault export, customer's authored skills, conversation transcripts) within 14 days. No reputation damage either direction.

### Renewal

**Phase 1:**

- At end of 6-month initial term, contract converts to month-to-month at the same rate
- Customer may terminate any month with 30 days notice
- This gives Phase 1 customers maximum optionality; they've earned it by being early adopters

**Phase 1.5+:**

- At end of 12-month initial term, contract auto-renews for another 12 months unless customer gives 60 days notice
- Auto-renewal at the same price unless SMD has communicated a price change at least 90 days before renewal date
- Standard SaaS-style renewal

---

## 2. Onboarding (separate paid stage)

Per Captain confirmation, onboarding is a separate paid stage with hard scope. **Customer pays the first month's $5K at signing; onboarding consumes that month.**

### Phases

**Day 1-5: Discovery + access + data audit.**

- Onboarding kickoff call (Day 1)
- Customer-side prerequisites enumerated and tracked (see below)
- OAuth admin consent flows initiated for Gmail/Slack/etc.
- Data audit: identifying gaps that will impair the agent (missing fields, stale records, unstructured documents)
- If customer-side prerequisites slip, onboarding pauses. Clock resumes when prerequisites complete.

**Day 6-14: Shadow mode.**

- Agent installed and configured against customer's actual workflows
- Agent runs in **shadow mode**: it observes, reads, drafts, **but does not send or act externally**
- Customer reviews drafts daily; provides feedback; Captain tunes
- This period builds the customer's trust without exposing the customer to agent error
- End-of-Day-14: customer reviews shadow-mode outputs and decides which task classes to graduate to autonomy

**Day 15+: Graduated autonomy.**

- Trust ceiling per task is set in the SOW exhibit
- Tasks classified as _autonomous_ graduate first; _draft-for-review_ tasks remain in review queue
- Customer success check-in at Day-7 (during shadow), Day-30 (post-graduation), Day-60, Day-90

### Customer-side prerequisites

These are enumerated in the SOW and must complete before onboarding clock advances. Customer slippage on these pauses onboarding without penalty to SMD:

1. **Named champion** — at least one employee designated to own the agent post-handoff (per Decision #28)
2. **OAuth admin consent** — domain admin approves the agent's app permissions
3. **Data audit access** — read access to the systems the agent will integrate with
4. **Workspace setup** — Slack workspace invite for the agent (or equivalent gateway)
5. **Sample artifact set** — 20-50 examples of the work the agent will do, with annotated correct/incorrect signals
6. **Business hours and escalation contact** — when can the agent act, who does it escalate to

### Hard onboarding cap

**80 hours of Captain time.** Tracked via timestamped activity log per customer.

- Above 80 hours, customer is quoted a scope expansion at $200/hr (matching Captain's Phase 1.5 rate)
- Above 120 hours: SMD evaluates whether the customer-fit is wrong. Some businesses will not be ready for AI Employee even at the $5K price point. We exit cleanly.

**Customer 1's onboarding** is expected to hit the cap — the playbook is being built. Customer 2-3 should land at 60-70 hours. Customer 4-5 at 40-60 hours.

---

## 3. Steady-state scope (what's included)

### Included in the retainer

- **One AI Employee** (one named agent for the customer's business)
- **Up to one vertical pack** of skills (e.g., the v1 marketing-agencies pack)
- **Skill iteration and customization** within the vertical pack (up to 4 new skills per quarter; major skill development beyond that is a scope expansion)
- **Multi-gateway connectivity** to up to three customer-facing surfaces (Slack + email + one more by default; additional surfaces are scope expansions)
- **Connector layer access** via Native MCP + Composio Standard tier
- **Memory layer** — D1 structured memory + R2 markdown vault + Vectorize index per customer
- **Email identity** — one AgentMail inbox per customer at a subdomain SMD provisions
- **Monitoring + watchdog** — automated gateway recovery, cron failure alerting, anomaly detection
- **Customer success cadence** — Day-7, Day-30, Day-60, Day-90 check-ins (Phase 1); Day-30 + Day-90 + quarterly (Phase 1.5+)
- **Incident response** at the SLA shape below
- **Steady-state support** capped at 10 hours/week per customer

### Steady-state support hour cap

**10 hours per week per customer included.** Tracked, monthly statement provided.

What the 10 hours covers:

- Customer success check-ins (~1 hr/week)
- Skill iteration and customization (~2-4 hrs/week)
- Incident response (~1-2 hrs/week variable)
- Vendor coordination, dashboard maintenance (~1-2 hrs/week)
- Customer-initiated escalations (~1-2 hrs/week)

**Above the cap:**

- 10-12 hours/week: tracked; no immediate action. May be a transient spike (campaign launch, new skill, incident).
- 12-15 hours/week sustained for 4+ weeks: SMD raises the conversation. Options are: (a) reduce scope, (b) move to a higher-tier package when tiers exist, (c) wind down the engagement at month-end.
- **15+ hours/week**: hard signal of misfit. Customer is quoted overage at $200/hr immediately or scope is reduced.

**Why 10 hours/week, not unlimited:** The pricing analysis is explicit that support-hour drift is the single failure mode that breaks the economic model. Without a cap, customers naturally expand requests until the firm is upside-down. The cap is the margin guardrail.

### Trust ceiling per task

**Per Captain confirmation, the SOW exhibits a Trust Ceiling Matrix** specific to the customer's deployment. Three classifications:

- **Autonomous** — agent acts directly, logs the action, customer is informed via audit log or notification. No human in the loop.
- **Draft for review** — agent prepares the action (email, document, change), submits to customer's review queue. Customer approves or modifies before action takes effect.
- **Refused** — agent does not perform this action class. If a customer requests it, the agent declines and explains why. (Examples: payment processing, legal authority statements, fair-housing copy.)

The matrix is per-task-class, not per-skill. Example matrix excerpt for marketing-agencies pack:

| Task class                             | Default classification         | Customer can override during onboarding to                                    |
| -------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| Inbox triage (read, categorize, log)   | Autonomous                     | (no escalation)                                                               |
| Email draft (compose for owner review) | Autonomous (draft creation)    | (no escalation)                                                               |
| Email send to internal team            | Autonomous after 30-day shadow | Draft-for-review for first 60 days                                            |
| Email send to client                   | Draft-for-review               | Autonomous only after Day-90 + zero substantive errors over preceding 30 days |
| Status report assembly                 | Draft-for-review               | Autonomous after 60 days of zero corrections required                         |
| Invoice generation                     | Autonomous                     | (no escalation)                                                               |
| Invoice send to client                 | Draft-for-review               | Autonomous after Day-90                                                       |
| Asset collection follow-up to client   | Autonomous                     | Draft-for-review for first 30 days                                            |
| Brand-voice publication (social, blog) | Draft-for-review               | (not eligible for autonomous escalation in Phase 1)                           |
| Paid-media campaign changes            | Draft-for-review               | (not eligible for autonomous escalation)                                      |
| Financial decisions / commitments      | Refused                        | (never autonomous)                                                            |

**The matrix is not contractual fine print — it's the SOW's central exhibit.** It's reviewed line-by-line with the customer during the Day-1 kickoff and updated by mutual agreement during the engagement.

### Out-of-scope triggers

Some customer requests fall outside the productized SKU. When they arise, SMD does not silently absorb them — we surface the trigger and offer the customer a path forward.

Triggers:

1. **Additional vertical packs** — customer wants the agent to do work outside the v1 vertical pack. Path: scope expansion at $200/hr or new packaged module if available.
2. **Custom integrations** — customer needs the agent to integrate with a system not covered by Native MCP or Composio. Path: scoped integration project quoted separately.
3. **High-volume processing** — customer's load consistently exceeds expected token spend (>2x median customer). Path: usage-based overage charge negotiated upfront, or move to a higher-tier package.
4. **Compliance certifications** — customer requires SOC2, HIPAA, or other certified compliance posture. Path: this is beyond the productized SKU; refer to a scoped engagement or partner who provides it.
5. **Dedicated infrastructure** — customer requires single-tenant deployment or specific data residency. Path: scoped engagement, not productized.
6. **Major architectural changes** — customer wants the agent rebuilt on a different harness, hosted differently, or with custom memory shape. Path: this is a scoped engagement under SMD's primary consulting funnel, not AI Employee.

### Scope-creep protocol

Following the spirit of [Decision #11](../adr/decision-stack.md#decision-11---scope-creep-protocol) for scope-based engagements, productized customers also have a parking-lot mechanism:

- Day 1: customer is told that requests outside the SOW scope go into a parking lot — they don't get lost, but they don't auto-execute
- Each parking-lot item is reviewed at the monthly cadence call with one of three outcomes: (a) absorb into included scope if minor, (b) propose as scope expansion at $200/hr, (c) decline with explanation
- The parking-lot review is the natural conversation for surfacing scope drift before it becomes a margin problem

---

## 4. SLA shape

The SLA is bounded; this is not an enterprise contract.

### Incident classification

**Severity 1 (S1) — customer-facing artifact error.** Agent sent an email to a customer with a hallucinated fact, populated a CRM with wrong data, posted incorrect content publicly, etc. Anything that puts the customer's reputation or relationship at risk.

- Acknowledgment: **4 business hours**
- Initial remediation: **24 business hours**
- Root-cause analysis with mitigation plan: **5 business days**

**Severity 2 (S2) — internal-only error.** Agent's internal action was wrong but didn't reach the customer's customers. Misclassified an email, populated wrong field internally, scheduled a meeting at wrong time, etc.

- Acknowledgment: **1 business day**
- Resolution: **3 business days**

**Severity 3 (S3) — feature request, customization request, ambient question.** Anything that isn't an active error.

- Acknowledgment: **2 business days**
- Resolution: **best-effort, within the steady-state hours**

### Business hours

- Phase 1: SMD business hours are 8a-6p MST Monday-Friday. No on-call coverage outside business hours.
- Phase 1.5+: as customer count grows, evaluate adding on-call coverage. Phase 2 likely includes a 12-hour weekday window minimum.

This is explicit in the SOW. Customers buying the SKU know they're buying business-hours support, not 24/7 ops.

### Excluded from SLA

- Customer-side outages (their Gmail down, their CRM down)
- Third-party API outages (Anthropic, Cloudflare, Fly.io, Composio, AgentMail)
- Customer's own configuration changes that break the agent
- Acts of God, force majeure

In any of those cases, SMD coordinates a response best-effort but the SLA clock does not run.

### SLA credits

For Phase 1, SLA breaches do not trigger automatic financial credits. The relationship is too early-stage for credit-based escalation. Instead, breach triggers:

- Written incident report within 5 business days
- Customer success outreach within 1 business day
- Voluntary partial refund offered if the customer experienced material reputational harm (case-by-case)

Phase 1.5+ may introduce formal SLA credits (e.g., 10% credit per S1 missed). Defer until we have data.

---

## 5. Customer success cadence

Mandatory cadence — not optional. The pricing analysis identifies day-60-90 as the cancellation cliff; customer success cadence is the mitigation.

### Phase 1

| Touchpoint                 | Format            | Agenda                                                          |
| -------------------------- | ----------------- | --------------------------------------------------------------- |
| **Day 7**                  | 30-min video call | How is shadow mode going? What surprised you? What worries you? |
| **Day 30**                 | 45-min video call | Review post-graduation tasks; shared KPI dashboard walkthrough  |
| **Day 60**                 | 30-min video call | Renewal-decision orientation; what's working / not working      |
| **Day 90**                 | 45-min video call | Continue / cancel decision; if continuing, review forward shape |
| **Monthly** (after Day 90) | 30-min video call | Parking-lot review, dashboard review, planning                  |

### Phase 1.5+

Reduced cadence as the operating motion matures. Day-30 / Day-90 / quarterly. Continue Day-7 only during onboarding.

### Shared KPI dashboard

By Day 30, the customer has access to a live dashboard showing:

- Tasks the agent completed (by class)
- Tasks drafted for review and the customer's approval rate
- Errors (defined per the trust ceiling matrix) and their disposition
- Support hours consumed against the 10 hr/week cap
- Vendor health (gateway uptime, MCP availability)

The dashboard is the antidote to "I can't tell if this is working" — the second-most-cited reason for AI agent service cancellation per the functional shape research.

---

## 6. Termination process

When the engagement ends — whether by Day-90 evaluation termination, end-of-initial-term, mid-term default termination, or mutual wind-down — the termination process is:

### Pre-termination (T-30 to T-0)

- Customer notified of pending termination per the relevant notice clause
- SMD inventories the customer's deployment: connectors, skills, vault contents, conversation history
- Customer chooses data handoff format: zip export, structured export, or selective hand-back

### At termination (T-0)

- Agent shut down at the customer's request (or kept running through T-14 if customer prefers a wind-down period)
- Connector OAuth tokens revoked
- AgentMail inbox archived (90 days) then deleted
- Customer-data exports delivered within 14 days

### Post-termination (T+1 onward)

- SMD retains anonymized operational data for 12 months (aggregate token spend, error rates, support patterns) for internal improvement
- Customer-identifiable data is purged at T+30 unless customer requests longer retention for re-engagement

### Re-engagement

Former customers may re-engage within 12 months at the then-current pricing. SMD does not pursue cold re-engagement.

---

## 7. The captain-level guardrail

There is one circumstance where SMD terminates an engagement before its end date: **the customer asks the agent to do something that creates legal, reputational, or compliance exposure beyond what the SOW authorized.**

Examples:

- Customer asks the agent to send marketing emails to non-consented contacts (TCPA exposure)
- Customer asks the agent to publish content that misrepresents facts about a competitor (defamation)
- Customer asks the agent to file documents containing AI-generated legal citations (hallucination + bar exposure)
- Customer asks the agent to share data that violates the customer's own privacy commitments

In any of these cases, the agent refuses, Captain is alerted, and Captain has a conversation with the customer. If the request is repeated or systemic, **SMD terminates the engagement with 30 days notice** and refunds any unearned portion of the current month. This protects the firm's standing in a way that the SOW's trust ceiling cannot — some requests aren't about task autonomy; they're about whether the engagement should continue at all.

---

## Status

Contract shape adopted as documented above. Closes #773. Unblocks #774 (service name), #775 (copy/surfaces — landing pages + SOW template drafting), and #776 (stack build — informs which monitoring/observability/HITL features are mandatory).

---

## Risks tracked

- **Customer pushback on the 90-day evaluation termination clause.** Some prospects will see the no-penalty exit as a feature; others will read it as "this might not work." Sales conversation: frame as "we want both sides to confirm fit before locking in." If pushback is consistent, consider tightening the window or adding a referral-credit benefit for evaluation-period customers who refer.
- **Customer pushback on the 10 hr/week support cap.** Customers who arrive expecting "unlimited support" will push back. The pricing analysis is clear that the cap is non-negotiable; the conversation should be "this is the same operating model that lets us guarantee SLA — bounded scope, bounded support, predictable outcome."
- **Trust ceiling matrix complexity.** A SOW exhibit with 15+ task-class rows risks becoming legalese the customer skims. Mitigation: walk through the matrix in the Day-1 kickoff in plain language; the matrix is a conversation artifact, not a defensive document.
- **Day-60-90 cancellation conversations.** Even with the structured cadence, some customers will cancel. Important: keep them amicable. The customer who cancels at Day-90 amicably is a referral source down the road; the customer who cancels angrily is a public-review risk.
- **SLA breach handling pre-credit-structure.** Phase 1 has no formal credits; reliance on voluntary refunds + incident reports requires Captain time and judgment. Track this carefully; the data informs whether to formalize credits in Phase 1.5+.
- **Out-of-scope creep.** Particularly common at customer 1-2 because we're still learning what's "in scope." Strict parking-lot discipline from Day 1.

---

## Sources

- [Pricing analysis companion doc](./ai-employee-pricing-2026-05-13.md)
- [Functional shape research](./ai-employee-functional-shape-2026-05-13.md) — trust ceiling map, failure modes, customer success cadence
- [Stack evaluation](./ai-employee-stack-evaluation-2026-05-13.md) — monitoring, watchdog, observability shape
- [ADR 0004 — Productized AI Employee Offering](../adr/0004-productized-ai-employee-offering.md)
- [Decision Stack #11 — Scope creep protocol](../adr/decision-stack.md#decision-11---scope-creep-protocol) — parking-lot mechanism (adapted for productized customers)
- [Decision Stack #14 — Payment terms](../adr/decision-stack.md#decision-14---payment-terms) — note: AI Employee uses retainer-monthly, not the deposit-at-signing structure
- [Decision Stack #27 — Post-handoff safety net](../adr/decision-stack.md#decision-27---post-handoff-safety-net) — analog for scope-based engagements; AI Employee is structurally different
- [Decision Stack #28 — Internal champion](../adr/decision-stack.md#decision-28---internal-champion) — applies to AI Employee customer-side champion requirement
