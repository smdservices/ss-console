# PRD Review Synthesis — Round 1

**Date:** 2026-05-19
**Reviewers:** Product Manager, Technical Lead, Business Analyst, UX Lead, Target Customer (20-yr PI partner), Competitor Analyst
**Input:** 6 contribution files in `round-1/`
**Output:** Change recommendations for `platform-prd.md` and `law-firm-prd.md`

---

## Executive summary

The six reviewers converged on three sets of changes that block Phase 1 and one set that hardens the demo. The PRDs are architecturally sound after the prior critique pass; what they lack is the implementation-level precision required to ship code and the competitive-currency required to walk into the PI meeting without being out-flanked by a prospect's prior reading.

The most concentrated convergence is around five Phase-1-blocking gaps that every technical and operational reviewer surfaced independently: **(1) the multi-user dashboard role model** (Principal + Operator + Compliance) — currently listed as "deferred" but beta-1 cannot ship without it; **(2) the OAuth token lifecycle** — completely unspecified and the most likely cause of a demo-day or week-3 trust collapse; **(3) `customer.yaml` schema with secret-exclusion enforcement** — needed before any provisioning script can run safely; **(4) capability interface contracts** — named but undefined, blocking adapter implementation; **(5) the cross-PRD Phase 1 connector scope mismatch** — platform PRD says "1 PM adapter in 7 days," law-firm PRD says "all 6 Tier-1 PMs pre-built," and these cannot both be true.

The competitive section needs an emergency refresh. Four of the PRDs' competitive characterizations are factually outdated (Harvey pricing floor, Eve 2.0 AI Workforce, EvenUp PLAAS launched May 13, Lawmatics AI Suite), one major competitor is missing entirely (Law Practice AI, 300+ PI firms, April 2026 launch), and the "no competitor ships the four-pillar combo" claim is still technically true but the window for landing it without challenge is narrowing. The PI partner reviewer explicitly said Eve will be a name the prospect has already heard; the PRD must be ready for that conversation.

The Target Customer's reading anchors what beta-1 success actually requires: a frictionless 60-second mobile approval loop (not just described — designed and demoed), a complete and readable audit log (not aspirational), trust accounting enforced architecturally (not by configuration), a pricing number or framework by the end of the meeting, and Maria the paralegal in the room. Several of these are addressed in the PRDs in concept; only some are addressed in form.

---

## Consensus recommendations (flagged by 2+ roles)

Grouped by theme. Priority codes: **P0** = must fix before commit; **P1** = must fix before beta-1 sign; **P2** = nice-to-have.

### Theme 1: Multi-user dashboard role model is undefined and blocks beta-1

- **Issue:** Platform PRD §19 lists the multi-user role model as "deferred post-demo." Law-firm PRD §16 lists it as an open decision. But every operational reviewer (PM, Tech Lead, BA OQ-004, UX Gap 1, Target Customer "Maria in the meeting") identified that beta-1 cannot ship without it. Margaret (partner), Ramon/Maria (paralegal), and Susan (compliance counsel) must all have dashboard access at distinct permission levels, and the role schema must be specified before provisioning begins.
- **Roles flagging:** PM (R6, OD-2), Tech Lead (#10 in Blocking Items table), BA (OQ-004), UX (Gap 1), Target Customer ("Maria in the meeting" as a sign-or-no-sign condition)
- **Recommended change:** Promote the multi-user role model from "deferred" to "required for beta-1" in both PRDs. Specify minimum-viable three-role schema in **platform PRD §11** (a new §11.6 or extension of §11.2) and reference it from **law-firm PRD §11.8** and §17 Phase 2:
  - **Principal** — full access, trust-ceiling promotion authority, send-approval authority
  - **Operator** — full access except cannot promote trust ceiling above customer-configured maximum without Principal confirmation
  - **Compliance** — read-only access to Audit tab only; no draft approval, no memory edit
    Update platform PRD §19 and law-firm PRD §16 to remove this as an open decision.
- **Priority:** P0 (blocks beta-1 architecture; required before provisioning script can be written)

### Theme 2: OAuth token lifecycle is completely unspecified

- **Issue:** Both PRDs depend on connector OAuth tokens for every external integration (Microsoft Graph, Filevine, Clio, DocuSign, LawPay, QuickBooks, etc.) but neither specifies: where refresh tokens are stored, who refreshes them, what happens when refresh fails, how the customer re-authorizes. Tech Lead flags this as HIGH severity — the most likely cause of a demo-day or week-3 morning-digest failure. Target Customer explicitly named "connector outage" anxiety.
- **Roles flagging:** Tech Lead (Risk 1, ADR proposal, #1 in Blocking Items table), PM (implied in R3 demo-collapse risk), BA (EC-004/EC-005/EC-006 + OQ-007 connector health check)
- **Recommended change:** Add **new platform PRD §7.9 OAuth token lifecycle** (between §7.8 Stack pin and §8). Specify: tokens stored in Infisical at `/ai-employee/{customer-slug}/`, refresh 10 minutes before expiry, refresh failure triggers graceful degradation to "connector unavailable" state with Captain alert and customer notification, customer re-authorization is a Captain-initiated OAuth re-consent flow. Cross-reference from §18 (Risks) and add OAuth-lifecycle ADR to §19 ADR list. Reference from law-firm PRD §7 Connector Strategy.
- **Priority:** P0 (blocks all connector adapter implementation)

### Theme 3: `customer.yaml` needs a formal schema with secret-exclusion enforcement

- **Issue:** Platform PRD §7.3 provides one example `customer.yaml` but no schema, no validation contract, no explicit prohibition on secret values. If a secret lands in `customer.yaml` (which is git-committed), it lands in history permanently. For a law firm tenant, this is a privilege-breach with bar-discipline consequences. Tech Lead flagged HIGH severity.
- **Roles flagging:** Tech Lead (Risk 2, ADR proposal, #3 in Blocking Items table), PM (implied in R5 — fabrication discipline enforcement), BA (BR-001, BR-007 — scope and trust ceilings enforced from customer.yaml)
- **Recommended change:** Add `customer.yaml` formal schema to **platform PRD §7.3** (extend the existing example with the typed schema skeleton in Tech Lead contribution). Specify the reference pattern for secrets (`connector_token_ref: "filevine-oauth-{customer-slug}"` resolved at provision time). Add to §19 ADR list: "`customer.yaml` secret-exclusion policy ADR." Add pre-commit validation hook to Phase 1 scope in §20.
- **Priority:** P0 (blocks provisioning script and all secret handling)

### Theme 4: Capability interface contracts are named but not defined

- **Issue:** Platform PRD §7.2 names 11 capability interfaces (PracticeManagement, Email, ESign, CourtAccess, Calendar, DocumentStorage, Payments, Accounting, IntakeCRM, CallTracking, InternalComms) but only provides one concrete method example. Skills cannot be authored and adapters cannot be written without full method signatures. Phase 1 build cannot start.
- **Roles flagging:** Tech Lead (Risk 1 / Architecture, #2 in Blocking Items table), BA (US-001 through US-026 all assume adapters that don't yet have contracts), UX (Queue tab draft-detail "what Marcus used" sourcing surface depends on adapter capability disclosure)
- **Recommended change:** Add **new platform PRD §7.2.1 Capability interface specifications** with TypeScript signatures for all 11 interfaces. Tech Lead's contribution includes Phase-1-minimum signatures for PracticeManagement, Email, ESign, and CourtAccess — adopt these. Author the remaining 7 (Calendar, DocumentStorage, Payments, Accounting, IntakeCRM, CallTracking, InternalComms) before Phase 1 build begins. Also resolve the Email Pattern A (draft to Outlook drafts) vs Pattern B (platform-orchestrated send) distinction — Tech Lead notes the PRD conflates them.
- **Priority:** P0 (blocks adapter implementation)

### Theme 5: Cross-PRD Phase 1 connector scope mismatch

- **Issue:** Platform PRD §20 Phase 1 says "Microsoft Graph + CourtListener + DocuSign + LawPay + QuickBooks Online + one PM adapter built within 7 days of the first meeting." Law-firm PRD §17 Phase 1 says "Tier-0 connectors live (Microsoft Graph + Google Workspace + CourtListener + DocuSign + QuickBooks + LawPay) AND Tier-1 connectors live: Filevine, SmartAdvocate, Clio, CASEpeer-via-Zapier, Neos, MyCase." This is six PM adapters pre-built vs. one built reactively.
- **Roles flagging:** PM (C1 — explicit contradiction), Tech Lead (Cross-PRD Contradiction 1 — Phase 1 skill count, same shape), Competitor Analyst (implied — Filevine adapter readiness is part of demo credibility)
- **Recommended change:** Align platform PRD §20 Phase 1 connector scope to match law-firm PRD §7.5 pre-build sequence (the more detailed/authoritative source on demo-readiness). Distinguish in the law-firm PRD between "demo-readiness target" (all Tier-1 pre-built read-only) and "production-deployment minimum" (one PM adapter operational write-capable post-meeting). Add explicit mapping table in law-firm PRD §17 preamble: "Law-firm Phase N corresponds to Platform Phase M."
- **Priority:** P0 (blocks Captain's work-planning for next 3 weeks)

### Theme 6: Competitive section is factually outdated in multiple places

- **Issue:** Both PRDs' competitive characterizations are based on pre-2026 data. Five material updates are required.
- **Roles flagging:** Competitor Analyst (sole reviewer; findings are factual corrections requiring no consensus to act on), Target Customer (independently confirmed "Eve Legal will be in the room" — partner has heard the name)
- **Recommended changes (apply to platform PRD §6 and law-firm PRD §10):**
  - **Harvey:** Update pricing from "$100-$1200/seat/mo" to **"$1,200-$2,000+/seat/mo; 20-seat minimum"**. Add a note about March 2026 $200M raise + mid-market expansion intent as a Phase 3-4 horizon threat (not v1).
  - **Eve Legal:** Replace "episodic tasks + nightly auditor" with **"AI Workforce model (Agents + Auditor + Analyst); autonomous task execution; nightly case-wide value detection; 1,000+ plaintiff firm installed base."** Update differentiation claim from "continuous vs. episodic" to **"reviewer-as-sender governance architecture + customer-editable memory vs. task-execution focus."**
  - **EvenUp:** Replace "per-case; demand-only" with **"full pre-litigation lifecycle via PLAAS managed service (AI + human case managers); demand letter + settlement negotiation execution."** Add an explicit PLAAS response paragraph to law-firm PRD §10 — see Missing Artifact M3 below.
  - **Lawmatics:** Replace "stops at conversion" with **"intake + early-lifecycle agentic operations (QualifyAI + EngageAI + MerlinAI launched March 2026); front-of-funnel and early matter operations; no matter-lifecycle continuity."**
  - **Microsoft Robin AI note:** Adjust "absorbed Robin AI tech, April 2026" to **"hired Robin AI's engineering team + IP (Robin AI shuttered as a going concern)."** Minor precision improvement.
- **Priority:** P0 (Captain will be wrong in the demo room without these)

### Theme 7: Law Practice AI is missing from the competitive landscape

- **Issue:** Law Practice AI launched April 2026 with **300+ PI firm clients** and a "five-solution AI operating system" framing that is conceptually adjacent to Operator's "one identity, every surface" framing. Both PRDs omit it entirely.
- **Roles flagging:** Competitor Analyst (sole; high-priority addition with no offsetting case)
- **Recommended change:** Add **Law Practice AI** as a new row in platform PRD §6 competitive table and law-firm PRD §10.1 named competitive set. Threat level: medium (high install base, no verified persistent-identity / reviewer-as-sender / editable-memory architecture). Note in PRD that this is unverified — they may or may not be a direct competitor depending on what their "five solutions" actually do.
- **Priority:** P0 (Captain may be asked about it in the demo)

### Theme 8: The "no competitor ships the four-pillar combo" framing needs sharpening

- **Issue:** Both PRDs lead with the four-pillar differentiation claim (named persistent agent + versioned editable memory + reviewer-as-sender + flat-monthly per-customer SKU). Competitor Analyst's verdict: still technically accurate for the exact combination, but each individual pillar is being eroded by 2026 launches. Target Customer corroborates: a 20-year partner is research-oriented and will probe this claim.
- **Roles flagging:** Competitor Analyst (Section 4.2, Uncomfortable Truth 6.1), Target Customer (implicit — "Eve will be in the room")
- **Recommended change:** In **platform PRD §6 (Competitive Positioning)** and **law-firm PRD §10.3 (demo-day one-liner)**, sharpen the framing to the most defensible version: **"No one ships an editable customer-owned memory + reviewer-as-sender + flat-per-firm model under one identity."** This narrower claim survives Eve 2.0, EvenUp PLAAS, and Law Practice AI scrutiny because the specific combination remains uncopied. Do NOT broaden it further; the precision is the defensibility.
- **Priority:** P1 (must be ready by demo day, but the broader claim survives one more meeting if it has to)

### Theme 9: Approval UX must be demoed, not just described

- **Issue:** Platform PRD §12 describes the dashboard at the IA level but does not specify the screen-by-screen flow for the critical 60-second mobile approval loop. UX Lead designed it in detail; Target Customer explicitly named it as a sign/no-sign condition ("I'd want to see the actual approval UX during the demo. Not described. Shown.")
- **Roles flagging:** UX (full §"User Journey" section, plus Gap 6), Target Customer ("daily digest from my phone" as one of 7 sign-conditions)
- **Recommended change:** Add **new platform PRD §12.6 V1 mobile approval flow** specification, capturing UX Lead's design: digest email → Today tab on phone → Card tap → Full draft → Send / Flag / Reject actions, with the "What Marcus used to write this" sourcing block in the draft detail view. The sourcing block (`Sources: Matter record (Filevine), 2 memory rules, 3 voice samples`) is the trust-building element that's currently implicit but not specified. Specify it explicitly.
- **Priority:** P1 (must be demo-ready, but content-level spec is the bridge between architecture and demo)

### Theme 10: Voice gate failure has no defined fallback path

- **Issue:** Platform PRD §9.6 requires ≥80% blind-test indistinguishability before first external draft. Gate is clear. But neither PRD specifies what happens when the gate fails after two calibration rounds. Without this, a failed blind-test has no documented response and risks an awkward customer conversation. Target Customer named this as existential: "If a client ever says 'did you write this?' I'm done. The 80% blind-test gate before any external drafts is the right call. Do not rush past it."
- **Roles flagging:** PM (R4), BA (EC-012, EC-013, EC-014), UX (Error State: Voice Gate Failure), Target Customer (Make-or-Break)
- **Recommended change:** Extend **platform PRD §9.6** with a three-state fallback:
  - **Pass (≥80%):** first external draft ships
  - **Near-pass (60-79%):** additional 1-week calibration cycle with 10 more scenarios; re-test
  - **Fail (<60% after two rounds):** Captain discloses to partner; offers internal-drafts-only mode at reduced retainer while calibration continues, or pauses beta-1 with transparent explanation
    Cross-reference from law-firm PRD §11.9 Calibration session split.
- **Priority:** P1 (operational doctrine for the most likely beta-1 awkward moment)

### Theme 11: Invariant #8 (fabrication discipline) enforcement is circular at the runtime layer

- **Issue:** Platform PRD §7.5 invariant #8 says "skill catalog's authoring template enforces this; `context-detector` skill flags drafts." Tech Lead identified the circularity: `context-detector` is itself a skill, so if it has `trust: disabled` or has a bug, invariant #8 has no enforcement. The pattern should match invariant #6 (citation-refusal) — a pre-output filter at the runtime level, not a skill call.
- **Roles flagging:** Tech Lead (Risk 5), PM (R5 — different shape, same gap: enforcement at skill-authoring time)
- **Recommended change:** In **platform PRD §7.5**, restate invariant #8 enforcement as a runtime pre-output filter (parallel to invariant #6), with `context-detector` as a supplementary check, not the primary enforcement. Update §8.4 Skill anatomy to require a `client_facing_fields` block in each SKILL.md tagging every output field with `sourced_from: [memory_rule | person_mapping | matter_attribute | system_of_record | none]` — fields tagged `none` must render empty-state by skill contract (per PM R5).
- **Priority:** P1 (architectural soundness; without this, CLAUDE.md fabrication policy has no enforcement)

### Theme 12: Pricing — Captain needs a response framework before the meeting

- **Issue:** No pricing number anywhere in the PRDs. Platform PRD §15 correctly defers to the pricing strategy doc, gated on COGS modeling. But the meeting is 2-3 weeks away. Target Customer named pricing-or-framework as one of seven sign-conditions: "I'm not committing without a cost. A number. Or a range. Or a framework for how the pricing works."
- **Roles flagging:** PM (R1, OD-1), Target Customer (Sign condition #6), Competitor Analyst (§5 — market context for the pricing conversation)
- **Recommended change:** In **platform PRD §15**, add an explicit deadline: COGS modeling for the three customer profiles (Light/Medium/Heavy per §15.1) **must complete before the first customer meeting**. If not complete, Captain enters the meeting with a defined response: _"Pricing is flat-monthly per firm; I'll have the specific number for you within 5 business days post-meeting while we scope your connector set."_ Document this fallback explicitly. Cross-reference from law-firm PRD §11.7 The order-taking moment.
- **Priority:** P0 (Captain cannot walk into the meeting without a pricing response)

### Theme 13: `pi-demand-letter-text-only` status appears in three sections with three different answers

- **Issue:** Law-firm PRD §0 says "only if Captain authorizes." Law-firm PRD §16 says "Captain decision: ship with first demo or hold for beta-1." Law-firm PRD §6.2 says "Pulled from v1, deferred to Phase 3+, replaced by evidence-packet."
- **Roles flagging:** PM (OD-3 partial — they recognized the resolution), Tech Lead (Cross-PRD Contradiction 2 — they identified the three-way inconsistency)
- **Recommended change:** Pick §6.2's resolution (evidence-packet replaces text-only; demand-letter text deferred to Phase 3+). Update §0 and §16 to match. Remove the "Captain may authorize text-only in advance" language from §0; remove the "ship with first demo or hold for beta-1" decision from §16.
- **Priority:** P0 (drafting consistency; trivial to fix)

### Theme 14: Litify pre-build classification is inconsistent across three references

- **Issue:** Law-firm PRD §7.2 Tier-1 table lists Litify with "Read-only adapter shipped in v1 pre-build; write capability in Phase 2." Same §7.2 has Litify under "build-when-discovered." §7.5 pre-build sequence does not include Litify. Three references, three meanings.
- **Roles flagging:** PM (C2), Tech Lead (Cross-PRD Contradiction 4)
- **Recommended change:** Choose one: either Litify is pre-built read-only (then add to §7.5 sequence, remove from build-when-discovered list) or it is build-when-discovered (then remove from §7.2 pre-build table). PM and Tech Lead both recommend keeping it in the pre-built read-only set per its Devil's Advocate addition.
- **Priority:** P1 (drafting consistency)

### Theme 15: Phase numbering across the two PRDs is misaligned

- **Issue:** Platform PRD §20: Phase 0-5. Law-firm PRD §17: Phase 1-4. Platform Phase 2 = "First vertical pack (law-firm)" = Law-firm Phase 1 (PI overlay + first demo). Confusing cross-reference.
- **Roles flagging:** PM (C3)
- **Recommended change:** Add explicit mapping table at the top of **law-firm PRD §17**: "Law-firm Phase 1 = Platform Phase 2, Law-firm Phase 2 = Platform Phase 2 second half, Law-firm Phase 3 = Platform Phase 3, etc." Or renumber law-firm phases to match platform. Either works; mapping table is faster.
- **Priority:** P1 (clarity, not soundness)

### Theme 16: Decommissioning script — drain window for in-flight calls is unspecified

- **Issue:** Tech Lead identified that `bin/decommission-customer.sh` step 7 (D1 deletion) creates a race condition with in-flight LLM calls that may write to D1 after deletion. BR-013 (BA) requires decommission to cover all substrates, but the order is sensitive.
- **Roles flagging:** Tech Lead (Critical gap section + #6 in Blocking Items), BA (BR-013, EC-008)
- **Recommended change:** In **platform PRD §20 Phase 1** deliverables, expand the `bin/decommission-customer.sh` line to include drain-window semantics (allow in-flight calls 60s grace period, then hard-kill). Cross-reference to BA EC-008 atomic-wipe pattern.
- **Priority:** P1 (compliance requirement; not blocking demo but blocking beta-1 termination scenarios)

### Theme 17: Cost telemetry has no event-emission specification

- **Issue:** Platform PRD §15.1 describes what to track (9 cost drivers) and what to model (three customer profiles) but not how data is emitted. The Phase 1 cost telemetry requirement risks being "done" with empty tables.
- **Roles flagging:** Tech Lead (Risk 6), PM (R7 — Composio cost-per-action stress test missing from COGS model)
- **Recommended change:** Add **new platform PRD §15.2 Cost telemetry event emission specification** describing: Claude API token counts captured per-call from Anthropic response, Fly.io billing attribution via Machine naming, Composio usage pulled by nightly job per connection ID, and a Captain CLI command for logging time against a customer. Add to §20 Phase 2 (not Phase 1): "Cost telemetry instrumentation live and producing per-customer-per-day reports before beta-1 customer generates usage" per PM Phase 2 addition.
- **Priority:** P1 (without this, the §17.1 per-customer COGS/MRR ≤40% kill criterion is unobservable)

### Theme 18: Skill loader workaround creates compounding token cost and drift risk

- **Issue:** Platform PRD §8.4 acknowledges Hermes' skill-loader limitation and front-loads voice rules in SKILL.md description. Tech Lead identifies two compounding problems: (1) per-draft token overhead grows linearly with active skills (1000-2800 tokens at 5-7 active skills); (2) duplicated voice rules drift between description and `references/voice.md`.
- **Roles flagging:** Tech Lead (Risk 3), PM (Issue 5 — Phase 5 Hermes fix needs explicit tracking)
- **Recommended change:** Do not defer the loader fix to Phase 5. Move to Phase 1 or Phase 2. Estimate per Tech Lead: 1-2 days engineering. Track in a GitHub issue or ADR. Update **platform PRD §20 Phase 5** to remove the loader fix from Phase 5 scope and move it to a tracked technical-debt item in Phase 1 or 2.
- **Priority:** P1 (token cost + drift accumulate from customer #1)

### Theme 19: D1 schema needs voice samples, draft queue, recipient cohorts, sent-folder cursor

- **Issue:** Platform PRD §10.1 describes memory layers in prose. Tech Lead provided concrete D1 schema and identified missing tables: voice samples index, per-recipient cohort definitions, sent-folder watch state, escalation event log. Without these, voice quality gate (§9.6) cannot be programmatically enforced and Layer 3 cohort routing requires parsing full YAML at draft time.
- **Roles flagging:** Tech Lead (D1 schema section + #12 in Blocking Items)
- **Recommended change:** Add **new platform PRD §10.6 D1 schema** section adopting Tech Lead's SQL table definitions. Specifically add: `voice_samples`, `recipient_cohorts`, `sent_folder_state`, `escalation_events`. Cross-reference R2 object naming convention and Vectorize index naming from Tech Lead's spec.
- **Priority:** P1 (blocks voice gate enforcement and connector binding)

### Theme 20: Captain operational time logging mechanism is unspecified

- **Issue:** Per-customer COGS/MRR ≤40% is a kill criterion (platform PRD §17.1). Captain operations time is one of nine cost drivers. Without a mechanism for Captain to log time against a customer, the margin model is incomplete and the kill criterion is unobservable. Tech Lead Risk 6 identifies this; BA US-026 implies it through the day-90 renewal data sourcing.
- **Roles flagging:** Tech Lead (Risk 6), BA (US-026 implicit), PM (P7 Captain hours/customer/week constraint)
- **Recommended change:** Specify a Captain CLI command for time-logging in **platform PRD §15.2** (Cost telemetry event emission, new section per Theme 17). Add to §20 Phase 1 deliverables.
- **Priority:** P1 (operational measurement)

### Theme 21: Add "What Marcus used to write this" sourcing block to draft detail view

- **Issue:** UX Lead identified this as a critical trust-building element implicit but not named in the PRDs. The draft detail view in Queue tab needs a sourcing block listing what data the agent accessed (matter record, memory rules, voice samples). Target Customer corroborates: "I'm not trying to break the product, I'm trying to trust it" + audit log as defense.
- **Roles flagging:** UX (Queue tab content block), Target Customer (Make-or-break: "complete and readable audit log")
- **Recommended change:** Add to **platform PRD §12.1 V1 dashboard surface** under Queue tab description: "Draft detail view includes 'What Marcus used to write this' sourcing block listing accessed matter records, memory rules invoked, and voice samples consulted. Expandable for compliance use case."
- **Priority:** P1 (trust mechanism; designed but not specified)

### Theme 22: "Teach Marcus" affordance from draft view (not just Memory tab)

- **Issue:** UX Lead identified that the most natural moment for rule-teaching is during draft review, but the PRDs route the rule-add flow through the Memory tab only. Operators will either not add rules or navigate out of workflow.
- **Roles flagging:** UX (Gap 2)
- **Recommended change:** Add to **platform PRD §10.3 The Memory tab** description: "Rule-add affordance is also available from the draft detail view in Queue (lightweight inline form, lands rule in Memory without leaving Queue context)."
- **Priority:** P2 (improves adoption; not blocking)

### Theme 23: Trust-ceiling promotion recommendation card on Today tab

- **Issue:** UX Lead identified that the law-firm PRD §11.8 mentions "trust ceiling promotions discussed" at week 4 as a milestone but the dashboard has no surface for the conversation. Currently the promotion is a hidden Skills-tab action.
- **Roles flagging:** UX (Gap 3)
- **Recommended change:** Add to **platform PRD §12.1 V1 dashboard surface** under Today tab: "When a skill has maintained ≥90% approval rate over 4 consecutive weeks, surface a 'Promotion ready?' recommendation card with one-click navigation to the Skills tab." This is the proactive promotion trigger.
- **Priority:** P2 (improves week-8 success metric; not blocking beta-1 sign)

---

## Cross-PRD contradictions to resolve

These are explicit contradictions both reviewers flagged. They must resolve to a single authoritative statement.

### Contradiction A: Phase 1 connector scope

- **Platform PRD §20:** 1 PM adapter built within 7 days of meeting
- **Law-firm PRD §17:** All 6 Tier-1 PM adapters pre-built
- **Resolution:** Law-firm PRD §7.5 is the demo-readiness target; platform PRD §20 needs to align to match. Add distinction between "demo-readiness" (broad pre-build) and "production-deployment minimum" (narrow). Files: platform PRD §20 Phase 1, law-firm PRD §17 Phase 1.
- See Theme 5.

### Contradiction B: `pi-demand-letter-text-only` status

- **Law-firm PRD §0:** Possible-with-Captain-authorization
- **Law-firm PRD §16:** Live Captain decision
- **Law-firm PRD §6.2:** Deferred to Phase 3+, replaced by evidence-packet
- **Resolution:** §6.2 wins. Update §0 and §16. Files: law-firm PRD §0, §6.2, §16.
- See Theme 13.

### Contradiction C: Litify adapter scope (three references, three meanings)

- **§7.2 Tier-1 table:** Pre-built read-only
- **§7.2 build-when-discovered list:** Build at discovery
- **§7.5 pre-build sequence:** Not listed
- **Resolution:** Pre-built read-only wins. Remove from build-when-discovered list. Add to §7.5 sequence. Files: law-firm PRD §7.2, §7.5.
- See Theme 14.

### Contradiction D: Phase numbering between platform and law-firm PRDs

- **Platform PRD §20:** Phase 0-5
- **Law-firm PRD §17:** Phase 1-4 (with different content)
- **Resolution:** Add explicit phase mapping table at top of law-firm PRD §17. Files: law-firm PRD §17 preamble.
- See Theme 15.

### Contradiction E: Voice Layer 3 "v1 vs deferred" status

- **Platform PRD §9.3:** "Layer 3 — Per-recipient voice cohorts (v1, not deferred)"
- **Platform PRD §19:** "Continuous voice sampling (per §9.3 Layer 3): v2 work; not specified in v1"
- **Resolution:** Continuous sampling (auto-resampling from sent folder) is v2; per-recipient cohort declaration in customer.yaml is v1. Clarify §19 wording. Files: platform PRD §19.
- See PM C4.

### Contradiction F: Phase 1 skill count "5-7" vs. authored count

- **Platform PRD §20:** "5-7 skills, not 30"
- **Law-firm PRD §17:** ~15+ skill files authored (6 primitives scaffolded + 4 cross-cutting + 4 law-specific + 1 PI overlay)
- **Resolution:** Clarify what "5-7 skills" means: authored, scaffolded, or enabled. Recommend: "5-7 enabled skills at Phase 1 close; broader authoring overhead acknowledged in scaffold count." Files: platform PRD §20 Phase 1.
- See Tech Lead Cross-PRD Contradiction 1.

### Contradiction G: Voice calibration session structure

- **Platform PRD §9.6 Gate 2:** "4-6 hour Captain session with the customer (typically reviewer + designated operator)"
- **Law-firm PRD §11.9:** Splits 4-6 hours between partner (90 min) and paralegal (4-6 hours)
- **Resolution:** Not contradictory but the platform PRD lacks an extension point. Update **platform PRD §9.6** to note that vertical PRDs may specify how the calibration session is structured within the time budget. Files: platform PRD §9.6.
- See Tech Lead Cross-PRD Contradiction 3.

### Contradiction H: 5 vs. 7 vs. 8 safety invariants in Phase 1 scope

- **Platform PRD §7.5:** 8 safety invariants defined
- **Platform PRD §20 Phase 0:** "Five base safety invariants"
- **Platform PRD §20 Phase 1:** Adds invariants #7 and #8 (= 7, not 8)
- **Resolution:** Phase 1 scope adds invariants #6, #7, #8 (citation-refusal #6 is in flight). Restate **platform PRD §20 Phase 1** as "Safety substrate expanded to 8 invariants: +citation-refusal (#6), +cross-Machine query prohibition (#7), +fabrication discipline (#8)." Files: platform PRD §20 Phase 1.
- See PM Issue 5.

---

## Missing artifacts (gaps no role can fill alone)

These are new artifacts both PRDs need that aren't currently anywhere.

### M1. Multi-user dashboard role schema specification

- **Gap:** Three roles (Principal / Operator / Compliance) with distinct permissions, currently undefined.
- **Recommended location:** New section **platform PRD §11.6** (Multi-user role model). Reference from law-firm PRD §11.8 onboarding flow.
- **Why it matters:** Beta-1 cannot ship without it. See Theme 1.

### M2. OAuth token lifecycle architecture

- **Gap:** Complete spec missing — storage, refresh, failure handling, re-authorization flow.
- **Recommended location:** New section **platform PRD §7.9** (OAuth token lifecycle). New ADR in §19.
- **Why it matters:** Most likely cause of demo-day or week-3 failure. See Theme 2.

### M3. EvenUp PLAAS competitive response paragraph

- **Gap:** PLAAS launched May 13, 2026 — 6 days before this review. PI prospects may have seen it. No prepared response.
- **Recommended location:** Add to **law-firm PRD §10 Competitive Positioning**, after the table. Captain needs a 30-second answer ready: PLAAS uses U.S. human staff (labor cost embedded), does not provide named AI teammate, does not expose customer-editable memory, Operator's reviewer-as-sender architecture is structurally different from PLAAS's managed-service model.
- **Why it matters:** Direct competitive comparison most likely to come up in the demo room. See Competitor Analyst §6.3.

### M4. Pricing response framework for Captain

- **Gap:** No pricing number. Captain has no documented response if asked.
- **Recommended location:** Add to **platform PRD §15** and **law-firm PRD §11.7 The order-taking moment**: "If COGS modeling is not complete by meeting day, Captain's response: 'Pricing is flat-monthly per firm; I'll have the specific number for you within 5 business days post-meeting while we scope your connector set.'"
- **Why it matters:** Target Customer named pricing as a sign-or-no-sign condition. See Theme 12.

### M5. Capability interface specifications (all 11 interfaces)

- **Gap:** Phase 1 build cannot start without these.
- **Recommended location:** New section **platform PRD §7.2.1**. Tech Lead's contribution has Phase-1-minimum signatures for 4 of 11; author remaining 7.
- **Why it matters:** Blocks adapter implementation. See Theme 4.

### M6. `customer.yaml` formal schema with secret-exclusion enforcement

- **Gap:** Schema undefined; secret-hygiene enforcement absent.
- **Recommended location:** Extend **platform PRD §7.3** with the full schema skeleton from Tech Lead's contribution.
- **Why it matters:** Blocks provisioning. See Theme 3.

### M7. D1 schema specification

- **Gap:** Memory layers described in prose; voice samples / draft queue / recipient cohorts / sent-folder cursor tables undefined.
- **Recommended location:** New section **platform PRD §10.6** (D1 schema).
- **Why it matters:** Voice gate cannot be programmatically enforced. See Theme 19.

### M8. R2 object key naming convention and Vectorize index naming

- **Gap:** Tech Lead identified that without conventions, decommissioning script cannot enumerate and delete customer objects, and Vectorize per-customer isolation isn't enforced.
- **Recommended location:** Extend **platform PRD §7.6 Storage architecture** with both conventions.
- **Why it matters:** Per-customer isolation (invariant #7); decommissioning correctness (BR-013). See Tech Lead Architecture section.

### M9. Compliance evidence packet content specification

- **Gap:** Platform PRD §13 and law-firm PRD §11.6 reference the packet but don't specify what's in it. UX Lead identified Susan's use case (handed to outside counsel, readable by non-technical lawyer) as the design constraint.
- **Recommended location:** New subsection **platform PRD §13.6** (Compliance evidence packet structure). Reference from law-firm PRD §11.6.
- **Why it matters:** UX cannot design the export without it. BR-011 enforcement depends on it. See UX Gap 4, BA US-011.

### M10. Day-1 onboarding screen sequence

- **Gap:** Platform PRD §16 describes the demo; law-firm PRD §11.8 describes Day-1 in prose. No screen-by-screen sequence for the first hour the customer is in the dashboard.
- **Recommended location:** Extend **law-firm PRD §11.8** with the screen sequence (UX Lead's contribution provides full design).
- **Why it matters:** Captain cannot operate the dashboard fluently in the meeting without this. See UX User Journey, Theme 9.

### M11. Cost telemetry event emission specification

- **Gap:** What to track is specified; how data is emitted is not.
- **Recommended location:** New section **platform PRD §15.2** (Cost telemetry event emission).
- **Why it matters:** §17.1 kill criterion unobservable without this. See Theme 17.

---

## Unresolved decisions (need Captain judgment)

These decisions surfaced by the panel are not blocked on missing information — they're Captain-level calls that the panel could not make.

### UD1. Sent-folder watching default for beta-1: opt-in or opt-out?

- **Options:** Tech Lead, BA, PM all describe sent-folder watching as opt-in per customer (default off). Voice quality gate may require it long-term to maintain ≥80% indistinguishability against drift.
- **Roles raising:** Tech Lead (Risk + invariant #4 / ADR proposal), BA (BR-007, EC-011), PM (P9 ADR list)
- **Recommended deferral:** Keep opt-in default for beta-1 (no production data flowing into voice training during first paid customer). Captain decision once beta-1 voice drift data is available at day 60.

### UD2. Frozen tier pricing

- **Options:** Defer to Phase 2; Captain decides at beta-1 renewal conversation.
- **Roles raising:** PM (OD-5), BA (OQ-006)
- **Recommended deferral:** Defer to Phase 2 (Captain decision before day-90 renewal). Add to operations runbook so Captain can describe at the renewal meeting.

### UD3. Engagement-letter clause library sourcing (external counsel review vs. in-house)

- **Options:** PM recommends external counsel review for at minimum PA (strictest) and AZ (home state); in-house for permissive states once PA/UT validated.
- **Roles raising:** PM (OD-4)
- **Recommended deferral:** Captain decision before Phase 2 close. Document as ADR.

### UD4. Trust-ceiling promotion timing for in-flight invocations

- **Options:** BA OQ-001 — symmetric demotion rule (immediate) vs. promotion rule (next invocation only) for safety bias.
- **Roles raising:** BA (OQ-001, EC-001)
- **Recommended:** Apply BA's recommendation: demotions immediate, promotions next invocation only. Document in §11 Trust Ceiling Model. Captain confirmation needed.

### UD5. Multi-email-system firms (e.g., Outlook + Gmail)

- **Options:** Does v1 `customer.yaml` schema support per-user connector binding within a single capability?
- **Roles raising:** BA (OQ-002, EC-007)
- **Recommended deferral:** Captain decision after PI demo if the firm has mixed email infrastructure; document fallback if no.

### UD6. Citation filter tuning access path

- **Options:** Can the citation filter's regex patterns / confidence thresholds be tuned via Captain control plane without a code deploy?
- **Roles raising:** BA (OQ-009)
- **Recommended:** Required for v1 given the "100% accuracy" target. Captain decision; if not available, false-positive corrections require a code release path — which is too slow for beta-1.

### UD7. Compliance/ethics counsel touchpoint in onboarding

- **Options:** Add proactive "Week 2 ethics-counsel touchpoint" to operations runbook.
- **Roles raising:** PM (Issue 4)
- **Recommended:** Yes. Add to operations runbook (not PRD). Captain confirmation.

---

## Material competitive updates

Captured in Theme 6, Theme 7, Theme 8 above. Consolidated here for the synthesis-application step:

1. **Harvey pricing floor** — update both PRDs from "$100-$1200/seat/mo" to "$1,200-$2,000+/seat/mo; 20-seat minimum."
2. **Eve Legal 2.0 AI Workforce** — update characterization from "episodic + Auditor" to "AI Workforce (Agents + Auditor + Analyst), 1,000+ plaintiff firms"; update differentiation from "continuous vs. episodic" to "reviewer-as-sender + editable memory vs. task execution."
3. **EvenUp PLAAS (May 13, 2026)** — update from "per-case; demand-only" to "full pre-litigation lifecycle managed service (AI + human staff)"; add prepared PLAAS-response paragraph to law-firm PRD §10.
4. **Lawmatics AI Suite (March 2026)** — update from "stops at conversion" to "intake + early-lifecycle agentic operations (QualifyAI + EngageAI + MerlinAI)."
5. **Microsoft Robin AI precision** — adjust "absorbed Robin AI tech" to "hired Robin AI's engineering team + IP (company shuttered)."
6. **Law Practice AI** — add as new competitor entry (April 2026 launch, 300+ PI firm clients, five-solution operating system, threat level medium, unverified pillar coverage).
7. **Smokeball + CoCounsel partnership (March 2026)** — add as a watch item noting PM-embedded research + drafting stack changes; not PI-relevant directly but signals PM vendor strategic direction.
8. **Harvey mid-market expansion** — add a Phase 3-4 horizon note ($200M raise March 2026, mid-market positioning explicit).
9. **Sharpen four-pillar claim** to "no one ships editable customer-owned memory + reviewer-as-sender + flat-per-firm under one identity" — narrower formulation that survives Eve 2.0 + PLAAS + Law Practice AI scrutiny.

---

## Recommended priority order for applying changes

Captain's time is finite and the meeting is 2-3 weeks out. Apply in this order:

**P0 — must complete before commit:**

1. Multi-user role model spec (Theme 1, M1) — unblocks beta-1 onboarding architecture
2. OAuth token lifecycle spec (Theme 2, M2) — unblocks all connector adapters
3. `customer.yaml` schema + secret-exclusion (Theme 3, M6) — unblocks provisioning
4. Capability interface specs (Theme 4, M5) — unblocks all adapter code
5. Phase 1 connector scope alignment (Theme 5, Contradiction A) — Captain workload depends on this
6. Competitive section refresh (Theme 6, Theme 7, all 9 items in Material Competitive Updates) — meeting credibility
7. Pricing response framework (Theme 12, M4) — Captain needs a defensible answer
8. `pi-demand-letter-text-only` three-way consistency (Theme 13, Contradiction B) — drafting cleanup
9. Safety-invariant count consistency (Contradiction H) — drafting cleanup

**P1 — must complete before beta-1 sign:** 10. Voice gate failure fallback path (Theme 10) 11. Invariant #8 runtime enforcement (Theme 11) 12. Mobile approval flow spec (Theme 9) 13. D1 schema (Theme 19, M7) 14. R2 + Vectorize naming conventions (M8) 15. Compliance evidence packet content (M9) 16. Day-1 onboarding screen sequence (M10) 17. Cost telemetry event emission (Theme 17, M11) 18. Decommissioning drain window (Theme 16) 19. Captain time-logging mechanism (Theme 20) 20. "What Marcus used" sourcing block (Theme 21) 21. Skill loader workaround → Phase 1/2 (Theme 18) 22. Litify three-way consistency (Theme 14) 23. Phase numbering map (Theme 15) 24. Voice Layer 3 v1/v2 clarification (Contradiction E) 25. Skill count clarification (Contradiction F) 26. Voice calibration session vertical extension point (Contradiction G) 27. Four-pillar claim sharpening (Theme 8) 28. Sharpen Eve 2.0 differentiation language (subset of Theme 6)

**P2 — nice-to-have:** 29. "Teach Marcus" from draft view (Theme 22) 30. Trust-ceiling promotion recommendation card (Theme 23)

**Out-of-scope for this synthesis (defer):**

- UD1-UD7 unresolved decisions — Captain judgment required, not document edits
- Operations runbook content (not PRD) — Captain decides separately
- ADR authoring (12 proposed ADRs) — PM's recommendation that 5 are load-bearing before beta-1; these are separate documents, not PRD edits

---

## What we'd want from a Round 2 (if run)

Round 2 isn't worth the spend. The Round 1 contributions are deep and convergent; the bottleneck is now applying changes, not gathering more signal. A Round 2 would risk diminishing returns and would delay the demo.

If Captain wants more signal on a specific dimension, the highest-leverage single targeted review would be:

- **A second Target Customer pass after the PRDs have been updated** — same persona, different firm profile (e.g., Estate Planning partner instead of PI, or a paralegal-first reviewer who would speak to Maria's POV more directly than Margaret's). This would validate whether the changes from Round 1 land for a different buyer profile and whether the Estate Planning + Probate fallback branch (per law-firm PRD §13 roadmap branch) is plausibly winnable.

But for the PRD itself, Round 1 plus the critique pass that preceded it is sufficient. Move to apply-and-ship.

---

_End of synthesis. The user applies these recommendations via Edit tool to `platform-prd.md` and `law-firm-prd.md`. `docs/pm/prd.md` (the consulting venture's client portal PRD) is not touched._
