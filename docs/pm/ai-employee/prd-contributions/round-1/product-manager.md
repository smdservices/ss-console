# Product Manager Contribution - PRD Review Round 1

**Author:** PM Agent
**Date:** 2026-05-19
**Scope:** MVP/Phase 1 only (platform PRD §20 Phase 1 + law-firm PRD §17 Phase 1)
**Source PRDs reviewed:** `platform-prd.md` v0, `law-firm-prd.md` v0

---

## Executive Summary

**Problem:** Small-to-mid professional service businesses need an experienced operational team member handling their daily business supply chain — intake, document collection, deadlines, status updates, billing — but can't afford, recruit, or manage the headcount required. The four existing responses (hire a human, buy software, buy AI features inside software, buy single-task AI point solutions) each fail the same way: no identity, no memory, no continuity, no voice.

**Solution:** AI Employee is a configurable, persistent AI agent provisioned and operated by SMD as a managed service. It runs under a named persona, drafts work in the customer's voice, never sends to external parties without named human review, and learns over time from every correction. The customer's relationship is with the agent and with SMD — not with infrastructure.

**Value statement:** For a fraction of the loaded cost of a paralegal or office manager, the customer gets a persistent team member who handles the bottom 30% of daily operational work — the volume that exhausts humans, erodes margins, and never requires the judgment the professional was hired for. The agent is never a replacement for judgment; it is a replacement for the work that doesn't require it.

**This is not a SaaS product.** SMD operates the runtime. The customer buys a service relationship, not a tool license. This distinction matters for sales framing, pricing, and competitive positioning, and must not drift in any downstream PRD section.

---

## Product Vision and Identity

**Working name:** AI Employee

**Per-deployment name:** Customer-configured persona (e.g., "Marcus," "Aiden"). The persona name is a first-class configuration artifact.

**Tagline (internal):** The first hire your business doesn't have to make.

**Tagline for buyer-fragile contexts:** "Sarah keeps her job. She stops doing the bottom 30%. You stop hiring Sarah #2 when you grow." (platform PRD §6.5 — two framing disciplines are required; see Product Principles P11 below.)

**What this is:**

A managed-service AI agent platform. SMD provisions and operates one dedicated runtime per customer. Each runtime has a persona, a set of active skills, pluggable connector bindings to the customer's actual operational systems, and a versioned human-readable memory the customer owns and can edit. Everything that varies between customers is configuration. The platform code is shared.

**What this is NOT:**

- Not a SaaS the customer self-installs or self-operates
- Not a chatbot (query/response surface)
- Not an autonomous decision-maker (reviewer-as-sender is architectural, not advisory)
- Not a build-your-own-agent toolkit (customers configure; SMD authors and operates skills)
- Not "AI inside" an existing tool the customer already uses
- Not a research desk, a demand-letter shop, or a single-skill point solution
- Not a product that positions "AI" as a selling noun — the agent does the work; the agent mentions AI when it is the right answer and says so plainly (per CLAUDE.md "AI & automation is a named capability" standard)

**Critical identity clarification not currently in either PRD:** The CLAUDE.md Claude-first rule ("platform preference only when AI is chosen; NOT firm shape, partnership status, or named stack components") means the marketing surface for AI Employee must not lead with "AI" as identity. The product is "the first hire your firm doesn't have to make" — it does operational work; it uses AI to do it. The AI is the method, not the identity. This distinction is currently absent from both PRDs and must be added to §2 of the platform PRD and §2 of the law-firm PRD before any marketing copy is derived from them.

---

## Product Principles

Listed in priority order. When two principles conflict, the higher-numbered principle yields.

**P1. Reviewer is always the sender.** No external communication, transaction, or filing goes out without a named human pressing send. This is architectural and non-negotiable. Any feature that requires relaxing this principle requires a Captain-level ADR before implementation.

**P2. Memory belongs to the customer — readable, editable, exportable.** The customer's ability to inspect, correct, and export what the agent has learned is the trust mechanism. Features that degrade memory legibility or exportability are design defects.

**P3. The audit trail is a feature, not a back-office artifact.** Every read, draft, edit, and send is logged and surfaced. This is both the compliance defense and the "it's working" proof the customer needs to justify renewal.

**P4. Configuration is the product surface; code is the platform.** Adding a customer is a `customer.yaml` and a provisioning script. Anything that requires per-customer code branching is a design failure and a Captain-time leak.

**P5. The operational supply chain, not the judgment-bearing core.** The agent handles the volume. The professional handles the judgment. This boundary is principled and constant. Features that push toward the judgment side require a third-rail review before authoring.

**P6. Closed-loop by construction.** Customer data never trains a public model. Per-customer storage is isolated. Cross-customer queries are architecturally prohibited. This is both the privacy posture and the competitive moat against horizontal Copilot-style products.

**P7. Captain operational budget is a hard constraint.** At steady state (week 4+), each customer must require ≤2 hours/week of Captain time. Features or workflows that exceed this budget are design defects, not customer-success investments.

**P8. Voice indistinguishability is a gate, not a metric.** The blind-test ≥80% gate must pass before any external draft ships. A product that drafts visibly-AI communications is not the product. This gate cannot be waived by a customer request.

**P9. No fabricated client-facing content.** Per CLAUDE.md: any field not sourced from an explicit memory rule, person-mapping, matter attribute, or system-of-record record must render as a "TBD" marker or empty-state token. Never infer plausible content for client-facing fields.

**P10. Exit is easy by design.** Month-to-month. No data clawback. Configuration artifacts export as JSON + markdown. The selling line "if we stop being worth what it costs, leaving is clean" must remain true at every feature decision.

**P11. Demo framing adapts to the buyer signal.** The "first hire you don't have to make" frame is buyer-fragile against staff-loyal customers. The Captain must listen for the signal (§6.5) and pick one framing, never blend. This is a sales execution requirement that must survive to the operations runbook.

---

## Success Metrics and Kill Criteria

### MVP (Phase 1 / beta-1) success definition

Beta-1 is the PI law firm meeting. Phase 1 succeeds if:

1. The demo runs without a citation in any output (citation-refusal substrate holds)
2. The demo results in a signed beta-1 agreement OR the firm explicitly passes and Captain identifies the gap
3. If signed: beta-1 customer reaches 85% approval rate by week 4

### Per-customer metrics (from platform PRD §17.1 — accepted as stated)

| Metric | Target | Notes |
|---|---|---|
| Weekly draft volume | >40/week | Active-customer indicator |
| Approval rate | ≥85% by week 4; ≥90% by week 12 | Primary quality signal |
| Voice blind-test pass | ≥80% indistinguishability | Gate before first external draft |
| Quarterly adversarial AI-detection | "AI-likely" ≤30% on LLM-judge sample | Drift detection |
| Customer memory edits | ≥3/week by week 2 | Loop-closing signal |
| Trust ceiling promotions | ≥1 by week 8 | Confidence-building signal |
| External AI disclosure incidents | 0 | Binary kill signal |
| Captain hours/customer/week | ≤2 hrs at steady state | Operational sustainability |
| Per-customer COGS/MRR | ≤40% | Margin floor |

### Kill criteria

**Customer-level kill signals:**
- Approval rate <70% sustained over 2+ weeks
- Zero memory edits over 4+ consecutive weeks (loop broken, customer not engaging)
- Any external AI disclosure incident (single incident)
- Any compliance failure (audit log incomplete, DPA breach, retention failure)
- Any safety invariant violation
- Voice "AI-likely" rate climbs above 30% and recalibration fails to correct within 2 weeks

**Platform-level kill criteria:**
- Any cross-customer data leakage (existential; triggers platform-wide audit and customer disclosure)
- Any cross-customer skill regression that breaks an active customer
- Customer churn >25% annualized over any quarter
- Captain time exceeds 3 hrs/week/customer at steady state across 2+ consecutive customers (signals the P7 constraint is structural, not customer-specific)

**Missing kill criterion — add to platform PRD §17.4:** The current platform-level kill criteria omit a cost-floor trigger. Add: "Per-customer COGS/MRR >60% sustained over any 60-day window triggers SKU repricing review; if repricing cannot defend the margin floor, the SKU is suspended until COGS is modeled down." Without this, the 40% COGS target (§17.1) is a per-customer monitoring metric with no platform-level enforcement consequence.

**Missing kill criterion — add to law-firm PRD §14.2:** The law-firm kill criteria omit a beta-1-specific decision gate. Add: "If the PI firm meeting (Phase 1 close) does not result in a signed beta-1 by day 45 post-meeting, Captain assesses the Round 1 pivot to Estate Planning + Probate (per §13 roadmap branch) and documents the decision in a new ADR." The 90-day gate in law-firm PRD §13 is too long to leave Captain without a decision signal.

---

## Risks and Mitigations

The platform PRD §18 table is thorough. The following are issues the critique pass missed or under-weighted.

### R1. Pricing commitment before COGS modeling is complete (P0)

**Risk:** The pricing strategy doc exists but COGS modeling is explicitly deferred to a pre-commitment deliverable (platform PRD §15.1). The beta-1 meeting is 2-3 weeks away. If the meeting results in a pricing question Captain cannot answer honestly, the close stalls or Captain makes a commitment SMD cannot defend.

**Gap:** Neither PRD specifies a deadline or a responsible party for the §15.1 COGS modeling deliverable. It is described as required before pricing commits but has no stated ship date.

**Mitigation (add to §15.1 and §19):** Name a ship deadline: COGS modeling for the three customer profiles (Light / Medium / Heavy per §15.1) must be complete before the first customer meeting. If it is not complete, Captain enters the meeting with a response to pricing questions: "Pricing is flat-monthly per firm; I'll have the specific number for you within 5 business days post-meeting while we scope your connector set." This is honest and avoids a premature commitment. The PRD currently has no guidance for this scenario.

### R2. Paralegal substitution anxiety is addressed in law-firm PRD but has no operational gate

**Risk:** Law-firm PRD §3 Persona 2 correctly identifies the paralegal as a co-buyer whose non-adoption is a beta-1 killer. But neither PRD has an explicit gate on paralegal-engagement success before the beta-1 is declared stable.

**Mitigation (add to law-firm PRD §14.3 beta-1 metrics):** Add "Designated paralegal uses dashboard daily by week 2" (it is listed but not as a kill signal). Clarify: if this metric misses, Captain triggers a paralegal-framing intervention before week 3; if still missed by week 4, Captain escalates to partner with a structured risk-assessment conversation. Silent paralegal non-adoption is the failure mode that looks like product churn but is actually a sales/onboarding failure.

### R3. Demo collapse on the 7-day PM adapter commitment is under-mitigated

**Risk:** The demo fallback for an unknown PM system is a 7-day adapter ship commitment (law-firm PRD §11.4 and §17). But neither PRD specifies what "7 days" means: read-only or read-write? Partial skill coverage or full? What is the scope of the adapter commitment Captain is making on stage?

**Mitigation:** The law-firm PRD §7.2 note on Litify is the model: "Read-only adapter shipped in v1 pre-build; write capability in Phase 2." Apply this discipline explicitly to the 7-day commitment: Captain commits to a read-only adapter in 7 days for demo/synthetic-data capability, and scopes write capability during onboarding. Add a one-sentence scope statement to the §11.4 fallback script so Captain never makes an over-wide verbal commitment in the meeting.

### R4. Voice quality gate (§9.6 blind-test) has no defined fallback path if it doesn't pass

**Risk:** Platform PRD §9.6 requires ≥80% blind-test indistinguishability before the first external draft ships. The gate is clear. But neither PRD specifies what happens when the gate fails after two calibration rounds: does beta-1 stall indefinitely? Does the customer get told "your voice is harder to model than average"? Is there a fallback SKU (e.g., internal-drafts-only) that keeps the customer engaged while voice calibration continues?

**Mitigation:** Add to platform PRD §9.6 a three-state fallback:
- **Pass (≥80%):** first external draft ships
- **Near-pass (60-79%):** additional 1-week calibration cycle; Captain and designated operator run 10 more scenarios; re-test
- **Fail (<60% after two rounds):** Captain discloses to partner that the voice model needs more samples from a broader set of the partner's outgoing communication; offers an internal-drafts-only mode at a reduced retainer rate while calibration continues, or pauses beta-1 with transparent explanation

Without this, a failed blind-test has no documented response path and risks an awkward customer conversation with no playbook.

### R5. The CLAUDE.md "no fabricated client-facing content" rule has no skill-authoring enforcement gate

**Risk:** Platform PRD §7.5 invariant #8 and §18 address fabrication at the runtime level. The CLAUDE.md policy is referenced. But neither PRD specifies how the skill-authoring template enforces this during skill development — only that "the skill authoring template enforces this" (§7.5). If the template doesn't have explicit field-typing rules that distinguish sourced vs. unsourced client-facing fields, the invariant relies on author discipline rather than architectural enforcement.

**Mitigation:** The skill anatomy spec (§8.4) must include a required `client_facing_fields` block in each SKILL.md that explicitly tags every output field as: `sourced_from: [memory_rule | person_mapping | matter_attribute | system_of_record | none]`. Fields tagged `none` must render as empty-state or TBD by the skill contract. This makes invariant #8 enforceable at skill-review time, not just at runtime.

### R6. Multi-user dashboard role model is unspecified for beta-1

**Risk:** Platform PRD §19 lists multi-user role model (principal-only vs. principal+operator+compliance multi-role) as an open decision deferred post-demo. But law-firm PRD §16 lists "Multi-attorney trust models in dashboard. Beta-1 will require multi-user dashboard (partner + paralegal + possibly compliance counsel)" as an open decision.

**These two open decisions are the same decision, and beta-1 requires it.** The demo can run partner-only. Beta-1 cannot — the paralegal is the day-to-day operator and needs dashboard access under a different role than the partner.

**Mitigation:** Escalate multi-user role model from "deferred post-demo" to "required for beta-1 onboarding." Minimum viable role schema for beta-1: two roles (Principal / Operator), with Principal having skill trust-ceiling promotion authority that Operator does not. Design and implement before beta-1 provisioning.

### R7. No COGS/margin consequence for connector cost at scale

**Risk:** Platform PRD §15.1 COGS model includes Composio per-action billing as a cost driver. The connector strategy in law-firm PRD §7 pre-builds 15 connectors. A heavy-use customer with 8 connectors active could generate significant Composio action volume the COGS model hasn't stress-tested. Composio's per-action pricing is not quoted in the PRD.

**Mitigation:** The §15.1 modeling deliverable must include a Composio cost-per-action estimate for the three customer profiles. If Composio per-action costs at the Heavy profile (150 drafts/week, 8 connectors) exceed 15% of MRR, evaluate native MCP wrappers or direct API calls for the highest-frequency connectors (Microsoft Graph is the obvious candidate — 70-80% of firms, highest action volume).

---

## Open Decisions and ADRs

### Decisions the PRDs have not resolved that block Phase 1

**OD-1. Pricing — must resolve before the meeting**

Neither PRD states a specific price. Platform PRD §15 defers to the pricing strategy doc, gated on COGS modeling. This is correct discipline. But the meeting is 2-3 weeks away, and Captain must walk in with a number or a principled "here's how we scope it" response. Resolution path: complete §15.1 COGS modeling, set a floor price based on the 40% COGS constraint, and document the per-customer scoping conversation Captain will use at the meeting.

**OD-2. Multi-user role model — must resolve before beta-1 provisioning**

Addressed in R6 above. Two roles minimum: Principal + Operator. Design decision needed now; implementation before beta-1 sign.

**OD-3. Captain-veto on pi-demand-letter-text-only (now pi-demand-letter-evidence-packet)**

Law-firm PRD §0 and §16 both note this as a Captain decision. The PRD has already resolved this correctly — the evidence-packet variant replaces the text-only variant for v1. What is still unresolved: the PRD says Captain "may decide not to ship it for the first meeting and instead position it as roadmap" but does not document the criteria for that decision. Add a decision criterion: if the partner's first 10 minutes of discovery reveal that they currently use EvenUp or another demand-letter tool and are satisfied, the demand-letter evidence-packet skill is positioned as roadmap so as not to force a head-to-head comparison the product hasn't earned yet.

**OD-4. Engagement-letter clause library sourcing**

Law-firm PRD §16: "Captain decision on whether to source via external counsel review vs in-house drafting against bar opinion text." This must be resolved before the first PA or Utah client is onboarded. Recommendation: external counsel review for at minimum PA (the strictest posture state) and the firm's home state (AZ). In-house drafting against bar opinion text is acceptable for permissive-posture states once the PA/UT templates are validated. This recommendation should be documented as a Captain decision before Phase 2 close.

**OD-5. Frozen tier pricing**

Platform PRD §14.5 references a frozen tier (pause drafting, keep memory and audit log) but it is unpriced and unspecified. For beta-1 this doesn't matter. For the renewal conversation at day 90, the frozen tier is a retention instrument. Defer to Phase 2, but add to the operations runbook so Captain can describe it at the renewal meeting if the customer is uncertain.

### ADRs the PRDs call for but have not been authored

The platform PRD §19 lists 9 proposed ADRs. The law-firm PRD §16 lists 3. Total: 12 proposed ADRs, none authored.

**For Phase 1 / beta-1, the following are load-bearing and must be authored before the first customer signs:**

| ADR | Why it must exist before signing |
|---|---|
| Reviewer-as-sender architecture | This is the product's core ethical and legal defense. The compliance moment in the demo cites it. Without a signed ADR, the posture could drift in implementation. |
| Fabrication discipline (invariant #8) | The CLAUDE.md "no fabricated client-facing content" rule is venture policy. Without an ADR, skill authors have no formal reference. |
| Sent-folder watching as opt-in with structural-diff-only storage | The DPA references this. The DPA is signed before first customer engagement. The ADR must pre-date the DPA. |
| Voice quality gates (blind-test ≥80%) | This is the gate before first external draft. Without an ADR, it is an informal Captain discipline rather than a platform commitment. |
| Citation-refusal substrate (law vertical) | Invariant 6. The demo depends on it. The substrate is in flight; the ADR formalizes the commitment. |

The remaining 7 proposed ADRs can be authored post-beta-1 but should not wait for Phase 4.

---

## Contradictions Between Platform PRD and Law-Firm PRD

The following are contradictions or misalignments between the two documents that must be resolved in the synthesis pass.

### C1. Connector pre-build scope mismatch

**Platform PRD §20 Phase 1** (connectors): "Microsoft Graph + CourtListener + DocuSign + LawPay + QuickBooks Online + one PM adapter built within 7 days of the first meeting."

**Law-firm PRD §17 Phase 1** (connectors): "Tier-0 connectors live (Microsoft Graph + Google Workspace + CourtListener + DocuSign + QuickBooks + LawPay)" AND "Tier-1 connectors live: Filevine, SmartAdvocate, Clio, CASEpeer-via-Zapier, Neos, MyCase."

The law-firm PRD's Phase 1 connector scope is significantly broader than the platform PRD's Phase 1 connector scope. The platform PRD says build one PM adapter within 7 days of the meeting; the law-firm PRD says pre-build all six Tier-1 PM adapters plus Google Workspace before the meeting.

**Resolution needed:** The law-firm PRD §7.5 (pre-build sequence) is the more detailed and likely authoritative source on what must be pre-built for the demo. But the platform PRD §20 is the binding scope statement. One of them must change. Recommendation: align platform PRD §20 Phase 1 connector scope to match the law-firm PRD's pre-build sequence, or explicitly note in the law-firm PRD that the Phase 1 pre-build set is the demo-readiness target while the platform PRD's Phase 1 scope is the minimum viable production deployment. The distinction matters for Captain's workload.

### C2. Litify listed in two different tiers

**Law-firm PRD §7.2** lists Litify under "Pre-built before the first walk-in demo" but also notes "(added per Devil's Advocate critic feedback)" suggesting it was added in revision. The same section has "Build-when-discovered (firm reveals at demo → 7-day adapter ship)" and lists "Litify (via Salesforce REST + Docrio)" — which means Litify appears in both the pre-build list AND the build-when-discovered list.

**Resolution:** Remove Litify from the build-when-discovered list. It is already in the pre-build list. Alternatively, clarify the split: read-only adapter pre-built (as noted in the pre-build entry), full write capability build-when-discovered. The current state is confusing.

### C3. Phase numbering mismatch

**Platform PRD §20** phase numbering: Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5.

**Law-firm PRD §17** phase numbering: Phase 1 (PI overlay + first demo), Phase 2 (beta-1 deployment), Phase 3 (WC + SSD), Phase 4 (multi-vertical).

Phase 2 in the platform PRD is "First vertical pack (law-firm)" — which corresponds to law-firm PRD Phase 1 (the demo). Platform Phase 3 is "Second vertical pack" — which corresponds to law-firm PRD Phase 3 (WC + SSD). The numbering is not aligned and will cause confusion in cross-reference.

**Resolution:** Either align the phase numbering between the two documents (preferred: platform PRD phases are the canonical reference; law-firm PRD phases should map to platform phases), or add an explicit mapping table in the law-firm PRD preamble showing "Law-firm Phase N = Platform Phase M."

### C4. Voice Layer 3 (per-recipient cohorts) v1 status

**Platform PRD §9.3** states: "Layer 3 — Per-recipient voice cohorts (v1, not deferred)" — explicitly promoted to v1.

**Platform PRD §19** lists "Continuous voice sampling (per §9.3 Layer 3): v2 work; not specified in v1" as an open decision.

These are different things (per-recipient cohorts vs. continuous voice sampling), but the platform PRD's phrasing in §19 refers to "§9.3 Layer 3" as deferred — which is the same section that in §9.3 says Layer 3 is promoted to v1. The reference in §19 needs to be clarified: continuous sampling (also in Layer 3 discussion) is deferred; the per-recipient cohort declaration is not. The current phrasing creates a false contradiction.

**Resolution:** Clarify §19 to read "Continuous voice sampling (§9.3 — the auto-resampling from sent-folder feature): v2 work; not specified in v1." The per-recipient cohort declaration in `customer.yaml` is v1 per §9.3 and is not deferred.

### C5. COGS model required before pricing commitment but no ship date exists in either PRD

Both PRDs reference the pricing strategy doc. Neither establishes a ship date for the §15.1 COGS modeling deliverable. The meeting is 2-3 weeks away. This is addressed in R1 above but the contradiction is also structural: platform PRD §15 says COGS modeling is "required before any pricing commitment to a customer" and yet the meeting is in the near term with no COGS model completed. This constraint needs a resolution path in the platform PRD, not just in this contribution document.

---

## Phased Development Plan

The platform PRD §20 phased plan is well-structured. The following clarifications and additions are warranted.

### Phase 0 (in progress — accepted as stated)

Foundation is largely complete. No changes recommended.

### Phase 1 — Platform spine + first-customer-ready v1

**Accepts platform PRD §20 Phase 1 scope as stated, with the following additions:**

**Gate criteria for Phase 1 completion** (missing from platform PRD §20):

Phase 1 closes when ALL of the following are true:
1. Citation-refusal substrate (invariant 6) passing 100+ adversarial fixtures
2. Voice blind-test gate documented and Captain has rehearsed calibration protocol
3. COGS modeling for Light/Medium/Heavy profiles complete and Captain has a pricing response
4. DPA template reviewed by external counsel and ready to execute
5. Operations runbook at `docs/runbooks/ai-employee-ops.md` drafted (not just planned)
6. The 5 load-bearing ADRs from the ADR section above are authored and merged
7. Multi-user role model (Principal + Operator, minimum) designed and implementation-ready
8. PI firm meeting scheduled or scheduled window documented

**What Phase 1 does not include (clarification):**

Platform PRD §20 is clear on this but the law-firm PRD §17 Phase 1 scope is broader than it should be if both documents are describing the same phase. Phase 1 scope is the platform spine + demo readiness + first-customer-ready v1. It is not "all Tier-1 PM adapters live." Law-firm PRD §17 Phase 1 lists all 6 Tier-1 PM adapters as in-scope, which conflicts with the platform PRD's "one PM adapter built within 7 days of the meeting" scope. Resolve per C1 above.

### Phase 2 — Law-firm vertical + first customer (beta-1)

**Closes when:** The PI firm meeting happens AND either (a) the firm signs as beta-1 and reaches week-4 success metrics, or (b) the firm passes and Captain documents the gap and activates the Estate Planning + Probate branch (per law-firm PRD §13 roadmap branch, with the day-45 decision gate per Kill Criteria addition above).

**Addition not in either PRD:** Phase 2 must include multi-user role model implementation (Principal + Operator) before beta-1 provisioning. This is currently unscheduled.

**Addition not in either PRD:** Phase 2 must include COGS monitoring instrumentation live and producing per-customer-per-day reports for Captain before the beta-1 customer generates any usage. Without this, the §17.1 margin kill criterion is unobservable.

### Phase 3 — Second vertical OR WC/SSD expansion

**Conditional on Phase 2 beta-1 outcome:**
- If beta-1 signs and passes week-4 gates: Phase 3 = WC + SSD overlay (law-firm PRD §17 Phase 3). Low lift — same connectors, same primitives, often same firm.
- If beta-1 stalls or firm passes: Phase 3 = Estate Planning + Probate vertical (law-firm PRD §13 roadmap branch). New customer profile; lower price point, faster sales cycle.

**The "Phase 3 = Second vertical" framing in platform PRD §20** is too abstract. The platform PRD should reference the law-firm PRD §13 roadmap branch and the day-45 decision gate explicitly so Phase 3 definition is not ambiguous.

### Phase 4 — Multi-customer operations at scale (≥3 customers)

Accepted as stated in platform PRD §20. No changes recommended except: the ≥3 customer gate must be calculated against paying customers post-beta-1, not total customers including the beta-1 if it is on a discounted or free beta rate. The gate should specify "≥3 paying customers at standard SKU price."

### Phase 5 — Continuous learning (v2 capabilities)

Accepted as stated. Note: the Hermes skill-loader architectural fix (§20 Phase 5 references "Phase A.6 deferred item") should have a reference to a specific GitHub issue or ADR tracking it. Platform PRD §8.4 describes the Phase A.6 discipline as a current workaround (front-loading voice rules in SKILL.md description rather than relying on references/ loading). This workaround has technical debt implications for all skill authoring from Phase 1 onward. The debt must be tracked explicitly, not just mentioned in passing in Phase 5 scope.

---

## Additional Issues Found in This Review Pass

### Issue 1: "Hours saved" is correctly deferred but the substitute metric is underpowered at beta-1 renewal

Platform PRD §12.3 correctly defers "hours saved" estimates to 60+ days of actual data. Law-firm PRD §14.4 provides the correct countable metrics from the audit log. But neither PRD addresses the renewal conversation posture at day 90 if the customer's primary question is "is this worth the money?"

At day 90, Captain will have 60+ days of audit log data. The §14.4 metrics (inbox triage events absorbed, signing-chase loops closed, etc.) are countable. But Captain needs a prepared frame for translating counts into value in the renewal conversation — e.g., "of the 340 inbox triage events Marcus handled, 290 required no partner time at all; at [partner's hourly rate], that represents approximately [X] hours of partner capacity recovered." The platform does not prevent this calculation at day 90; it just needs to be in the operations runbook so Captain has it ready.

### Issue 2: The morning-digest skill is listed in §20 Phase 1 skills but its spec is thin

The platform PRD §8.2 describes `morning-digest` as "First-thing-of-day brief: what's pending review, what's overdue, what's coming, what changed." This is the "60-second loop" the law-firm PRD §11.8 beta-1 day-1 experience depends on. But the morning-digest skill has no skill anatomy beyond a one-line description in §8.2. For a skill this load-bearing to the beta-1 adoption story, the SKILL.md + output-format.md + voice.md files need to be authored in Phase 1, not discovered from minimal spec.

### Issue 3: The "no lock-in" section (§14) has a duplicate section heading

Platform PRD §14 has two sections numbered §14.5 — "The marketing line" and "The frozen tier." This is a drafting error that will cause rendering and cross-reference issues. Renumber the frozen tier to §14.6.

### Issue 4: Law-firm PRD personas are law-specific but missing the compliance-counsel persona for beta-1

Law-firm PRD §3 Persona 4 is "The Firm's Compliance / Ethics Counsel." The beta-1 metrics (§14.3) include "Compliance audit packets generated: At least 1 (ethics counsel review trigger)." But there is no corresponding onboarding step that proactively schedules the ethics-counsel review during beta-1 onboarding. At a law firm, the compliance/ethics review can stall a tool adoption indefinitely if it is not structured into the engagement. The operations runbook should include a "Week 2 ethics-counsel touchpoint" step that proactively delivers the compliance audit packet to the firm's ethics counsel before they ask for it.

### Issue 5: The platform PRD lists 8 safety invariants but the Phase 1 scope table says "5 base safety invariants"

Platform PRD §7.5 defines 8 safety invariants. Platform PRD §20 Phase 0 says "Five base safety invariants (per §7.5)." Platform PRD §20 Phase 1 adds invariants #7 and #8. But the math is: 5 base (Phase 0) + #7 and #8 (Phase 1) = 7, not 8. This implies invariant #6 (citation-refusal) is also being added in Phase 1, which is correct (it is in-flight per §9). The Phase 1 scope table should explicitly list "Safety substrate expanded to 8 invariants: +citation-refusal (#6), +cross-Machine query prohibition (#7), +fabrication discipline (#8)" to make the Phase 1 deliverable unambiguous.

---

*PM Agent contribution complete. Synthesis step should apply changes to `platform-prd.md` and `law-firm-prd.md`; do not modify `docs/pm/prd.md`.*
