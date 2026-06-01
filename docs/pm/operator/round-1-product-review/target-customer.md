# Target Customer Perspective — Round 1

**Author:** Target Customer PM · **Date:** 2026-05-20 · **Round:** 1

---

## Stance on existing material

**LAYER, with one structural correction.**

The architecture, third-rail map, citation-refusal substrate, and reviewer-as-sender pattern are correctly anchored. Synthesis correctly P0-flags architectural gaps. What needs layering: the persona stack is too coarse for the next deliverables, two of four personas are composites or imported from the wrong context, and two real personas are missing.

**The structural correction:** none of this is customer-validated. The round-0 partner voice in `prd-contributions/round-1/target-customer.md` is Claude-authored synthesis, not a transcribed interview. The persona system is self-consistent fiction the PRDs and synthesis treat as validated — the exact failure mode `feedback_no_pretend_to_know_business.md` warns against. Surfacing this is the most useful thing this contribution can do.

---

## What's right

- **Partner emotional landscape named correctly.** Trust-collapse fear elevated to kill criterion. Litigator skepticism met with adversarial set-pieces, not "never fails" hubris. Paralegal substitution anxiety addressed in platform PRD §6.5.
- **Third-rail map is the right axis.** Pillars 1-9 operational; 10-11 judgment. Cleanest articulation of "what we sell" the venture has produced.
- **Audit log as compliance-defense artifact.** Correctly positioned as feature. Round-0 voice cites it twice.
- **Framing-A vs Framing-B branching (platform PRD §6.5).** Most insightful buyer-empathy work in either PRD. Should not be diluted downstream.
- **The week-4 "Marcus surfaced something I'd forgotten" stickiness moment.** Renewal pivots on this, not volume.

---

## What's wrong

**1. Persona 2 is a composite.** Platform PRD §4 and law-firm PRD §3 collapse three categorically different roles into "Paralegal / Office Manager / Intake Coordinator." Round-0 distinguishes them: Maria manages 90 matters, Debra handles intake screening, a marketing-driven intake coordinator runs the funnel. Different JTBD, dashboards, authority. One Persona 2 forces a UI that serves none of them well.

**2. Persona 4 (Compliance / Ethics Counsel) is BigLaw shape.** Sub-50-attorney PI firms typically have no designated ethics counsel — compliance lives with the managing partner or escalates ad hoc. Synthesis Theme 1 compounds the error by promoting a three-role schema (Principal / Operator / Compliance) to P0. Better v1 default: two-role (P1 + P2); Compliance ships when a customer asks.

**3. The associate attorney is missing.** Round-0 names one explicitly. A modern PI associate drafts demand letters, takes depositions, manages 30-50 of the partner's untouched matters, uses PM heavily, and has their _own_ work reviewed by the partner. If the agent ghostwrites for the partner, who ghostwrites for the associate? Silent in PRDs. V1 question, not Phase 4.

**4. The firm administrator is missing.** At $300k+ firms, a non-attorney administrator holds procurement and vendor authority. Round-0 walks past it ("Debra set this meeting up"). No reporting artifact serves this role at renewal time.

**5. JTBD skews time-and-capacity, undermodels emotional jobs.** Two jobs round-0 names get less product surface than they need:

- _"Make me look like the firm that figured AI out, not the firm that got burned."_ Status job. Product surface: peer testimonials, the audit log as a story told at Vistage, a renewal artifact. Absent in v1.
- _"Make my paralegal feel like the product is for her, not against her."_ Power-dynamic job. The PRDs name the risk but not the partner's job — paralegal-buy-in. The Memory tab should look like Maria's curation surface, not the partner's.

**6. The buying conversation is undermodeled.** The PRDs assume a walk-in-cold demo closes. Real $18-30k/year PI decisions involve looping in 1-2 partners, the bookkeeper, an ethics-aware peer — over 2-4 weeks. The post-demo artifact set is absent. What does Margaret send her partners on Tuesday after the Monday demo?

**7. Two places drift toward condescension** (per `feedback_no_pretend_to_know_business.md`):

- Platform PRD §5: "an unmet demand: an experienced, operational team member..." This is the PM's diagnosis projected onto the customer. Round-0 says "Maria spends her morning chasing signatures," not "I have an unmet demand."
- Law-firm PRD §3 Persona 1: "the bottom 30% of work that drags down their hour value." Implies a hierarchy a 20-year partner may not share; signing-chase work isn't "bottom 30%," it's load-bearing operations.

**8. The price comparison anchors to the wrong framing.** Both PRDs anchor on "$55-95k loaded paralegal" — Framing A (substitution). Round-0 explicitly chose Framing B ("I'm not looking to replace them"). Under Framing B the math is _incremental-hire-deferred_, not headcount-replaced. The pricing strategy doc anchors Framing A; the buyer round-0 describes is Framing B. Structurally different math.

**9. "$300k+ settlement firm" anchoring conflicts with `feedback_no_revenue_band_anchoring.md`.** Don't anchor on revenue band; qualify on operational pattern. The law-firm PRD repeatedly anchors on $300k+ settlements. Either file the exception or reshape to qualify on pattern (intake volume, signing-chase load), with the pricing-floor handled separately. Synthesis missed this conflict.

---

## What's missing

- **Persona granularity:** associate attorney (P4 below), firm administrator (P3 below), bookkeeper/fractional CPA who reviews trust reconciliation, intake coordinator as distinct from office manager.
- **The "don't make me feel old" job.** The 20-year partner is technology-skeptical, not anti-technology. Agency-preservation — partner stays in control, partner stays the smart one in the room. The reviewer-as-sender architecture serves this; dashboard _language_ should reinforce ("Marcus drafted N replies for your review," not "Marcus completed N tasks").
- **The graceful-exit conversation at day-90 non-renewal.** §14.3 names the metric, not the conversation. A respected "no" becomes a referral; a stuck "no" becomes a reputation risk.
- **The warm-intro chain.** How did the 2026-06 meeting get on the calendar? Who referred it? What does the referrer expect to hear back? Unmodeled.

---

## Persona stack — what the team should actually have

Order is buyer-influence, not headcount.

| #      | Persona                                                       | Top JTBD                                                                      | Day-90 success                                                                                | Deal-breaker                                                                                                                                                                     |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | **Buyer-Partner** (managing/rainmaker, 3-15 attorney PI firm) | "Give me Tuesday morning back without my clients ever noticing."              | Approval ≥85%, zero AI-detection complaints, dashboard ≥4 days/wk, 1 peer referral            | Single citation in a draft; trust-account write capability; audit log gap                                                                                                        |
| **P2** | **Operator-Paralegal** (60-150 matters)                       | "Take signing-chases off my plate; make this feel like _mine_."               | Daily dashboard use; 30+ memory rules curated by them; describes the tool as "mine" or "ours" | Onboarding that frames them as replaced; partner editing memory invisibly; "first hire you don't have to make" line in their presence                                            |
| **P3** | **Firm Administrator / Office Manager**                       | "Tell me the renewal math at month 11; don't make this another unused login." | Articulates ROI in one sentence; sees the bill, doesn't flinch                                | No usage data; no renewal artifact; surprise charges                                                                                                                             |
| **P4** | **Associate Attorney** (4-10 yrs out)                         | "Help me get to partner-quality faster; don't replace work I need to learn."  | Uses the agent with _their own_ voice profile; doesn't feel deskilled                         | Agent only writes in partner-voice (associate invisible); agent doing associate's job (obsolete); agent doing for partner what the associate used to do (path to partner harder) |
| **P5** | **Client (indirect)**                                         | "Let me hear from my lawyer, not a system."                                   | Never knows the agent exists                                                                  | Any AI tell; communication conflicting with what the partner said by phone                                                                                                       |

Two notes for the next deliverable:

- **Multi-voice per customer is a v1 question.** P4 deal-breakers require partner-voice + associate-voice in `customer.yaml`. §9 has capability; the "one persona per customer" framing reads as singular.
- **Compliance role can wait.** Default to two-role (P1 + P2) v1. Promote to three-role (+ P3 budget view, not compliance) when asked.

---

## Customer-validation gap

The team has not learned, but should before more building:

1. **3-5 actual PI partners** (not beta-1 target), 30 min each. Validate Persona 1 JTBD, trust-collapse fear, audit-log-as-defensibility, the price math. Three confirmations = persona is real. No confirmations = round-0 is plausible fiction.

2. **3-5 actual senior paralegals — independently, not through their partners.** Surface their _positive_ JTBD. What would Maria _ask for_? What would make her show it off at a paralegal event? P2 is currently partner-projected; needs paralegal-validated.

3. **One or two Eve Legal or EvenUp customers.** What do they actually use it for? What did they expect that didn't happen? What would they need to switch? Competitive positioning is feature-axis; needs experience-axis.

4. **Treat the 2026-06 meeting as research first, sales second.** Walk in with the demo, walk out with a structured debrief. A "no" with feedback is more valuable than a "yes" with vague praise.

5. **Validate the buyer-decision flow _before_ the meeting.** Ask the inviter: "If you want to move forward, who else weighs in? What would you send them?" Build those artifacts beforehand.

6. **Run the demo with a friendly PI partner first.** Paid 60-minute UAT. The demo design has not been validated by anyone except Captain. Synthesis Theme 9 flags the gap implicitly but doesn't take the next step.

**The principle:** every persona claim, every JTBD, every "they would say X" assertion is a hypothesis. Until customer #1 confirms or refutes, treat all of them as projections, and build the lightest viable product that lets validation happen fastest.

---

_Target Customer perspective — PRD review round 1, 2026-05-20._
