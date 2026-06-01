---
title: Operator Positioning Doctrine — Portable Persona, Firm-Owned Memory, Reviewer-as-Sender as Ethics Architecture
date: 2026-05-21
status: accepted
captain: Scott Durgan
supersedes: none
renamed-by: 0034-operator-product-naming.md
related-prd: docs/pm/operator/platform-prd.md §2, §3, §10, §13, §16; docs/pm/operator/law-firm-prd.md §3, §8
related-issue: https://github.com/venturecrane/ss-console/issues/828
---

# ADR 0013 — Operator Positioning Doctrine

**Status:** Accepted, **renamed 2026-06-01 by [ADR 0034](./0034-operator-product-naming.md).** The product's brand name is now **Operator**. The positioning doctrine in this ADR — portable persona, firm-owned editable memory as the headline pillar, reviewer-as-sender as ethics architecture, the Eve wedge, the legal-vertical opener — is name-independent and stands. Where this ADR says "Operator," read "Operator."

**Status (original):** Accepted. Locks the marketing, sales, and demo positioning for the product across the cross-vertical brand and the PI law-firm vertical specifically. Doctrine inputs synthesized from a three-round external competitive analysis engagement (May 2026) and Captain decisions on positioning, voice, and demo flow.

**Source:** Captain decisions across the round-1, round-2, and round-3 competitive analysis conversations with the external research team (deliverables filed at [`docs/pm/operator/prd-contributions/round-2/`](../pm/operator/prd-contributions/round-2/) and [`docs/pm/operator/prd-contributions/round-3/`](../pm/operator/prd-contributions/round-3/)). The architectural facts the doctrine rests on are already locked: reviewer-as-sender ([ADR 0005](./0005-reviewer-as-sender.md)), capability-adapter pattern ([ADR 0006](./0006-capability-adapter-pattern.md)), customer-owned memory artifact ([ADR 0008](./0008-customer-owned-memory-artifact.md)), per-customer OAuth token storage ([ADR 0010](./0010-per-customer-oauth-token-storage.md)), and multi-persona schema lock ([ADR 0011](./0011-multi-persona-per-customer.md)). This ADR records how those facts get spoken about.

---

## Context

Three rounds of external competitive analysis revealed the legal AI market has moved hard toward "AI workforce" and "AI operating system" language since the initial product framing. Eve Legal 2.0 publicly sells "AI Workforce" with Agents, Auditor, and Analyst. EvenUp PLAAS positions as a managed pre-litigation operating model with flat-fee pricing. Law Practice AI sells an "AI Operation System for Your Law Firm." Microsoft is moving Copilot agents from Word into Outlook, calendar, and long-running cowork patterns. Harvey raised $200M at an $11B valuation and is expanding agent capabilities downmarket.

The product framing Operator originally relied on — "AI staffer that works across surfaces" — no longer differentiates on its own. Several competitors are linguistically adjacent and could ship surface-level versions of the named-persona pattern within 3-9 months. The architectural moats (reviewer-as-sender, customer-owned editable memory, capability adapters, portable persona) are real, but they were being marketed as features rather than as a coherent category position.

The doctrine question this ADR resolves is: **how does Operator position against a market where adjacent language is being commoditized?** And the related operational question: **how does the PI law-firm vertical demo, in June 2026, against partners who have likely already encountered Eve, EvenUp, or Law Practice AI?**

Three positioning paths were available:

1. **Feature-led.** Sell each architectural decision (memory, reviewer-as-sender, adapters, portability) as a distinct feature against the competitor matrix. Wins on feature-comparison sheets, loses on category narrative because each feature reads as defensive against a specific competitor.
2. **Category-creation language.** Adopt "AI Workforce" or "AI Operating System" language and try to out-execute Eve and Law Practice AI inside their own frame. Loses immediately. The category is theirs to name; we cannot outspend or out-brand them on terrain they already own.
3. **Architectural narrative.** Reframe the architectural decisions as a single combined position — an ethics architecture for governable AI labor — and treat ownership, portability, and human-as-actor-of-record as the load-bearing claims. Wins by changing the axis of comparison from capability to governance.

Path 3 is the only one that holds against a market that has already commoditized "AI does the work." It also matches where regulatory pressure is moving (State Bar of Arizona AI guidance, Florida Opinion 24-1, ABA Formal Opinion 512, California SB 574, the Nippon Life v. OpenAI UPL litigation) — see [round-3/openai-upl-strategic-read.md](../pm/operator/prd-contributions/round-3/openai-upl-strategic-read.md) for the litigation exposure analysis.

---

## Decision

### 1. The cross-vertical brand position

Operator is a **portable, firm-owned, human-reviewed AI staffer** for businesses that need operational leverage without sacrificing control of their voice, their memory, or their actor-of-record.

Across all SMD-published surfaces (smd.services marketing pages, outbound, proposals, collateral, demo openers), the brand language is:

- **"First hire your business doesn't have to make"** stays as the cross-vertical hook. It is the strongest non-jargon framing of the value proposition.
- The persona is described as a **named AI staffer** with a job, a voice, a memory, and a reviewer.
- Memory is described as **firm-owned, editable, and portable**, not as "context" or "knowledge base."
- Reviewer-as-sender is described as **the responsibility model regulators are moving toward**, not as "safer than competitors" and not as "compliant." We do not use the word "compliant" without counsel review.

### 2. The legal-vertical demo opener

In legal-vertical demos and any context where a managing partner is the buyer, the opener is:

> **A managed AI staffer your team reviews before anything leaves the firm.**

This replaces "first hire your business doesn't have to make" for the legal demo only. The softer line is the right opener for legal because:

- The "first hire" framing invites the "are you replacing employees?" objection in a vertical where staff-replacement anxiety is heightened by bar guidance on supervision duties.
- Florida Opinion 24-1 explicitly states that AI chatbots communicating with clients or third parties must include a disclaimer that the chatbot is not a lawyer or employee of the firm. The disclaimer requirement applies to AI that communicates directly. Reviewer-as-sender means our AI does not communicate directly, so the disclaimer rule may not bind us the same way, but the optics of "first hire" language still risks the wrong opening question. Counsel review pending on the precise FL Op 24-1 application.

The cross-vertical brand language remains "first hire." The legal-vertical demo language is the softer line. This is a vertical-specific variation, not a brand replacement.

### 3. Memory as a headline pillar, not a feature

The customer-owned editable memory artifact ([ADR 0008](./0008-customer-owned-memory-artifact.md)) is the single strongest wedge in the architecture. It elevates from "architectural detail" to "top-line marketing claim."

The frame:

> **Firm-owned memory: the readable, editable operating manual for your AI staffer.**

The competitive evidence supports this. Across the full external competitor set (Eve, EvenUp PLAAS, Law Practice AI, Filevine AI, Clio, CoCounsel, Microsoft Legal Agent, CASEpeer, SmartAdvocate), no public evidence exists of a customer-readable, customer-editable, version-controlled memory artifact that the customer can inspect, edit, and export as the contract surface between the firm and the AI. Most competitors expose some form of style learning, knowledge base, or context configuration, but none expose the AI's belief state as a readable artifact the customer governs.

This is a category position, not a feature differentiator. The five partner-level fears it answers simultaneously: trust ("what does this AI think it knows?"), control ("can we correct it?"), continuity ("does it improve without becoming a black box?"), portability ("can we leave with our institutional knowledge?"), and ethics ("can we audit the rules it was supposed to follow?").

Marketing surfaces (landing page, deck templates, demo prep) will be reordered to lead with memory ownership and portability before operational presence.

### 4. The Eve wedge

The Eve competitive answer (used in demos, in proposals, and in any context where the prospect asks "how is this different from Eve 2.0?"):

> **Eve is a plaintiff AI platform. Operator is a portable AI staffer with firm-owned memory.**

That is the line. It changes the axis of comparison from capability ("what can the AI do?") to ownership and portability ("whose AI is it, and what happens if you leave?"). Eve gives a firm AI agents that operate inside Eve's platform. Operator gives a firm a persona that lives in the firm's own inbox, calendar, and case system, configured to the firm's voice, with memory that belongs to the firm. The persona doesn't move when the firm changes its case-management system. If the firm churns off our platform, the persona leaves with its memory artifact intact and exportable.

The 30-second managing-partner answer is:

> Eve is a plaintiff-firm AI platform. It is strong, but the AI lives inside Eve's product. Operator is different: the persona lives in your firm's inbox, calendar, and case system, works through your reviewer, follows your voice rules, and carries a firm-owned editable memory artifact. We are not asking you to move your firm into our platform. We are giving you a staffer-shaped operating layer that can follow your firm across systems.

This answer is approved cross-vertical and may be adapted in tone but not in substance.

### 5. Reviewer-as-sender as regulatory foresight

The reviewer-as-sender architecture ([ADR 0005](./0005-reviewer-as-sender.md)) is positioned externally as alignment with where bar guidance and AI ethics are heading. The frame:

> **Built for the responsibility model legal AI is moving toward.**

We do not say "compliant" without counsel review. We do not claim our architecture satisfies any specific bar opinion without that opinion being cited and verified. We do say the architecture preserves a clear human actor of record, which matches the direction of State Bar of Arizona AI guidance, Florida Opinion 24-1, ABA Formal Opinion 512, and California SB 574.

The Nippon Life v. OpenAI UPL litigation (Reuters, March-May 2026) is the most relevant strategic signal. Whatever the outcome, the case highlights the boundary Operator already respects: the AI cannot externalize legal-style communications on its own. Reviewer-as-sender is the architectural answer to that exposure. See [round-3/openai-upl-strategic-read.md](../pm/operator/prd-contributions/round-3/openai-upl-strategic-read.md) for the full read.

External language: "reviewer-as-sender reduces litigation exposure by preserving a clear human actor of record." Internal language: the AI cannot send. There is no override flag. The runtime enforces it.

### 6. The combined ethics architecture

Memory and reviewer-as-sender are positioned as a single combined moat, not two separate features.

The frame:

> **Memory is the audit surface. Reviewer-as-sender is the action boundary. Together they form the ethics architecture for legal AI.**

A legal AI system creates risk in two places: what it believes and what it does. Customer-owned editable memory controls the first risk. Reviewer-as-sender controls the second. Most legal AI products are converging on output review ("lawyers should verify"). That is necessary but incomplete. If the firm cannot inspect and correct the AI's durable assumptions, review becomes whack-a-mole — the reviewer catches bad outputs one by one but cannot govern the underlying operating model.

The architectural analogues in other regulated industries reinforce the category position:

- **Aviation:** autopilot did not remove the pilot. It created a higher-order control model: machine assistance under human command, with checklists, logs, and defined authority. Memory artifact is the checklist. Reviewer-as-sender is the pilot-in-command authority. Audit log is the flight recorder.
- **Healthcare:** clinical decision support can suggest, rank, flag, and draft. The licensed clinician remains responsible for diagnosis, orders, and patient communication. Operator prepares operational and legal support work. The attorney-reviewer remains actor of record.
- **Finance:** regulated workflows separate the preparer from the approver. Maker-checker is the operative pattern. Persona drafts and prepares. Reviewer approves and sends. No override to externalize directly.

These analogies are for internal positioning and demo prep, not marketing copy. See [round-3/ethics-architecture.md](../pm/operator/prd-contributions/round-3/ethics-architecture.md) for the full deep-dive.

### 7. What comes off the moat stack

**Flat-monthly per-firm pricing is not a moat.** EvenUp PLAAS publicly markets "predictable flat-fee pricing." We are not alone in flat-fee. The original moat stack erroneously listed flat-monthly as a differentiator; it is a feature, not a moat. The actual moat stack is:

1. Portable persona, not platform-bound agent
2. Customer-owned editable memory, not hidden context
3. Reviewer-as-sender enforced by runtime, not by policy
4. Capability adapters, not practice-management lock-in
5. Managed runtime, not DIY configuration

Flat pricing belongs in the SKU shape ([ADR 0004](./0004-productized-operator-offering.md)), not in the competitive narrative.

### 8. Multi-persona positioning at v1

The multi-persona feature is schema-locked at v1 with N=1 ([ADR 0011](./0011-multi-persona-per-customer.md)). External positioning must reflect that reality without overclaiming.

The approved answer to "can we have one AI for intake and another for case management?":

> In v1, the system runs one persona, but the schema is already designed for multiple personas under one firm account. Intake and case-management personas are on the committed roadmap once a paying customer needs them.

We do not publish per-persona pricing. We do not commit timing. We do not pretend the runtime supports N>1 today. The schema-lock posture preserves the option without selling vapor.

---

## Consequences

### Positive

- **Category position, not feature comparison.** The doctrine moves Operator out of the "legal AI" feature-comparison fight and into a defensible "governable AI labor" category position. Eve, EvenUp, and Law Practice AI can copy individual features, but copying the combined ownership-plus-actor-of-record architecture requires reworking their business model, not just shipping a feature.
- **Regulatory tailwind.** Reviewer-as-sender and memory ownership are aligned with where state bar guidance and AI ethics opinions are moving. As regulatory pressure increases, our architecture appears prescient rather than reactive.
- **Demo coherence.** The locked Eve wedge line, the legal-vertical opener, and the combined ethics architecture frame give the beta-1 demo prep a coherent narrative spine. The 6-step memory demo flow ([beta-1-demo-flow.md](../pm/operator/beta-1-demo-flow.md)) is the on-stage centerpiece.
- **Cross-vertical brand integrity.** "First hire your business doesn't have to make" remains the brand-level hook. Legal gets a vertical-specific opener. Other verticals (home services, professional services, retail) keep the original framing without erosion.

### Negative / accepted

- **More partner-level objection handling.** The category position invites sophisticated questions about how the architecture actually enforces what we claim. The demo and proposal motions need to anticipate these. The vendor-demo capture template ([round-3/vendor-demo-capture-template.md](../pm/operator/prd-contributions/round-3/vendor-demo-capture-template.md)) and the 10-objection demo-floor risk list (round-1 deliverable) are the prep artifacts.
- **Counsel review pending on FL Opinion 24-1.** The Florida disclaimer requirement question is open until counsel reviews. If the disclaimer rule binds us, the legal-vertical demo language and any customer-facing AI-generated messaging may need adjustment. The brand-level positioning is not affected; only the surface-level execution.
- **Loss of "flat-fee" as a sales talking point.** We can still say flat-fee pricing internally and in proposals. We just cannot claim it as a differentiator. EvenUp PLAAS already has it.
- **Memory demo requires UI surface that does not yet exist.** The 6-step memory demo flow depends on a "Why did it write it this way?" surface that exposes the memory rule, allows inline edit, and triggers versioned regeneration. This is engineering scope that must land before beta-1. Filed as a follow-on against ADR 0008 implementation.

### Out of scope

- **Pricing band.** The final beta-1 monthly price is a Captain decision tied to stack-cost analysis and is not locked in this ADR. The external research team's $3,500-$7,500/month band recommendation is captured in [round-2/competitive-analysis.md](../pm/operator/prd-contributions/round-2/competitive-analysis.md) as market context, not as a price commitment.
- **Buyer-side competitive intelligence.** Quote-grade pricing on Eve, EvenUp PLAAS, and Law Practice AI is not in the public domain. The external research team confirmed this is outside their delivery shape. Internal motion or a specialist BD contractor is the path forward. See [round-3/vendor-demo-capture-template.md](../pm/operator/prd-contributions/round-3/vendor-demo-capture-template.md) for the collection plan.
- **Phoenix prospect list.** The external research team's Super Lawyers-derived target list is reconnaissance-grade only. Real beta-1 prospect targeting runs through warmer channels (Vistage, EO Arizona, AAJ Arizona, State Bar PI specialization section). Captured in beta-1 sales planning, not in this ADR.
- **Microsoft 365 Copilot Legal Agent.** Not a PI v1 competitor. Long-term it compresses the "operates across surfaces" wedge as Copilot expands from Word into Outlook, calendar, and cowork patterns. The doctrine here is sized for the 12-month window; longer-horizon positioning is a separate exercise.

---

## Verification

Doctrine is enforced through three mechanisms:

### Demo prep

The beta-1 demo flow ([beta-1-demo-flow.md](../pm/operator/beta-1-demo-flow.md)) implements the doctrine on-stage. The 6-step memory demo, the Eve wedge line, the legal-vertical opener, and the combined ethics architecture frame all appear in the demo script.

### Marketing surfaces

The landing page (smd.services), Operator product page, deck templates, and outbound templates are updated to reflect:

- Memory as a headline pillar
- Reviewer-as-sender as regulatory foresight (not "compliant")
- The Eve wedge line where Eve is named
- "First hire" cross-vertical, softer opener in legal contexts
- Flat-monthly absent from the moat stack

Marketing surface updates are filed as follow-on PRs.

### Forbidden-strings test

The repo's `tests/forbidden-strings.test.ts` adds entries for:

- "compliant" in AI-related marketing copy (requires counsel review override)
- "AI Workforce" in our own copy (Eve owns it; we do not co-opt)
- "AI Operating System" in our own copy (Law Practice AI owns it; we do not co-opt)
- "litigation insurance" in AI-related marketing copy (overclaim)
- Variants of the "first hire" line in legal-vertical surfaces

This is the merge gate that prevents doctrine drift back into marketing copy.

---

## References

- [ADR 0004](./0004-productized-operator-offering.md) — productized Operator SKU
- [ADR 0005](./0005-reviewer-as-sender.md) — reviewer-as-sender architecture
- [ADR 0006](./0006-capability-adapter-pattern.md) — capability-adapter pattern
- [ADR 0008](./0008-customer-owned-memory-artifact.md) — customer-owned memory artifact
- [ADR 0010](./0010-per-customer-oauth-token-storage.md) — per-customer OAuth token storage
- [ADR 0011](./0011-multi-persona-per-customer.md) — multi-persona per customer
- [ADR 0014](./0014-pi-vertical-adapter-build-priority.md) — PI vertical adapter build priority
- [Platform PRD](../pm/operator/platform-prd.md)
- [Law-firm PRD](../pm/operator/law-firm-prd.md)
- [Round-2 competitive analysis](../pm/operator/prd-contributions/round-2/competitive-analysis.md)
- [Round-3 ethics architecture](../pm/operator/prd-contributions/round-3/ethics-architecture.md)
- [Round-3 OpenAI UPL strategic read](../pm/operator/prd-contributions/round-3/openai-upl-strategic-read.md)
- [Round-3 vendor demo capture template](../pm/operator/prd-contributions/round-3/vendor-demo-capture-template.md)
- [Beta-1 demo flow](../pm/operator/beta-1-demo-flow.md)
- [Issue #828](https://github.com/venturecrane/ss-console/issues/828)
