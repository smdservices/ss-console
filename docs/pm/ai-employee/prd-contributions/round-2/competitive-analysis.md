# Competitive Analysis — Round 2 Findings

**Author:** External competitive analysis team (engagement May 2026)
**Date:** 2026-05-21
**Scope:** Sharpened Eve wedge, customer-owned memory deep-dive, regulatory signal on reviewer-as-sender, updated competitor matrix with threat tier shifts, vendor pricing intelligence
**Prior round:** [round-1/competitor-analyst.md](../round-1/competitor-analyst.md)

---

## Executive readout

The market has moved hard toward "AI workforce" and "AI operating system" language since round 1. The white space identified in round 1 is still real but narrower than initially scoped. AI Employee should not position as "legal AI." That lane is crowded and increasingly dominated by well-funded vendors. It should position as a managed, named AI staffer that works through the firm's existing human review chain. That framing keeps AI Employee out of direct feature-comparison hell with Eve, Law Practice AI, Filevine, Clio, CoCounsel, and EvenUp.

The strongest competitive moats are **portability and ownership**, not "what the AI does." Two architectural facts (customer-owned editable memory and reviewer-as-sender) form a combined ethics architecture position that no competitor in the reviewed set publicly matches. Both individually are defensible for 9-18 months; combined, they are a category position rather than a feature differentiator.

The doctrine outputs of this round are locked in [ADR 0012](../../../adr/0012-ai-employee-positioning-doctrine.md).

---

## 1. Sharpened Eve wedge

### The problem with round-1 framing

Round 1 characterized Eve as "nightly AI Auditor; case evaluation, demand-drafting, discovery" — a description rooted in Eve 1.x. Eve 2.0 (January 2026) launched "AI Workforce" with three agent roles: AI Agents for autonomous task execution, AI Auditor for nightly case review, and AI Analyst for firm-wide operational intelligence. The "no continuous teammate" claim from round 1 is partially inaccurate against Eve 2.0.

Eve has also taken the "AI Workforce" language. They can make that sound bigger than us if we try to compete on the same axis.

### The correct competitive wedge

The wedge is not capability. It is system of residence and ownership.

> **Eve is a plaintiff AI platform. AI Employee is a portable AI staffer with firm-owned memory.**

Eve gives a firm AI agents that operate **inside Eve's platform**. AI Employee gives a firm a persona that lives in the firm's **own** inbox, calendar, and case system, configured to the firm's voice, with memory that belongs to the firm. The persona does not move when the firm changes its case-management system. If the firm churns off the AI Employee platform, the persona leaves with its memory artifact intact and exportable.

This wedge changes the axis of comparison from "what can the AI do?" to "whose AI is it, and what happens if you leave?"

### The 30-second managing-partner answer

Approved cross-vertical demo answer:

> Eve is a plaintiff-firm AI platform. It is strong, but the AI lives inside Eve's product. AI Employee is different: the persona lives in your firm's inbox, calendar, and case system, works through your reviewer, follows your voice rules, and carries a firm-owned editable memory artifact. We are not asking you to move your firm into our platform. We are giving you a staffer-shaped operating layer that can follow your firm across systems.

### Stress test: questions a sophisticated partner will ask

**"Isn't this just semantics? Eve also says agents do case work."**

No. The boundary is not "does it do case work?" The boundary is system of residence. Eve's public copy says Eve is "the only legal AI that works your whole case with you" and lists intake, discovery, demand letters, drafting, and auditor capabilities. AI Employee's argument is that the persona is not a feature inside a vendor workspace. It is a firm-operating identity connected to the firm's existing surfaces.

**"If Eve already learns writing style, what is different about your memory?"**

Eve publicly says it learns tone, style, formatting, argument structure, language, level of detail, letterhead, headers, and can create separate drafting agents for attorneys, case types, or jurisdictions. That is meaningful and should not be dismissed.

But that is still style learning and drafting-agent configuration based on sample documents. It is not public evidence of a human-readable, firm-owned, version-controlled memory artifact that the customer can inspect and edit as the contract surface between firm and AI.

**"What happens if we leave you?"**

The strongest answer: you leave with the memory artifact. The AI staffer's operating memory is not trapped in our hidden prompt layer or proprietary case database. The customer's contract grants them ownership of every artifact in their namespace ([ADR 0008](../../../adr/0008-customer-owned-memory-artifact.md)). Offboarding produces a portable export and then verifiable deletion.

That is a real ownership wedge. It resonates with a managing partner who has been burned by software lock-in.

---

## 2. Customer-owned editable memory deep dive

### Finding

Across the reviewed competitor set — Eve, EvenUp PLAAS, Law Practice AI, Filevine AI, Clio, CoCounsel, Microsoft Legal Agent, CASEpeer, SmartAdvocate — there is **no public evidence** of a customer-readable, customer-editable, version-controlled memory artifact that says what the AI believes about the firm, its people, voice, rules, workflows, and preferences.

That does not mean competitors have no internal configuration, prompt libraries, style profiles, knowledge bases, or uploaded context. They almost certainly do. But the standard is narrower and more powerful: can the customer literally open the AI's operating memory, read it, edit it, version it, audit it, and export it?

On public evidence, the answer is no across the reviewed set.

### Competitor evidence

| Competitor              | Public evidence of memory/context                                                                                                              | Meets SMD's memory standard? |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Eve Legal               | Learns tone, style, formatting from completed demand letters. Can create separate drafting agents for attorneys, case types, or jurisdictions. | No public evidence           |
| EvenUp PLAAS            | "Firmwide Knowledge Base" applies institutional knowledge and drafting standards automatically across documents.                               | No public evidence           |
| Law Practice AI         | "Personalized for your practice"; automates demand letters, case summaries, intake, document collection, and litigation support.               | No public evidence           |
| Filevine AI             | Strong case-system grounding and AI products (medical chronologies, deposition analysis). Platform-centered, not memory-centered.              | No public evidence           |
| Microsoft Legal Agent   | Uses structured legal workflows, playbooks, tracked changes, Word-native review.                                                               | No public evidence           |
| Clio, CoCounsel, others | Contextual AI or practice-management grounding depending on product.                                                                           | No public evidence           |

### Why this is category-level, not feature-level

Most legal AI vendors are converging on some version of: upload documents, learn style, ground in matters, configure workflows, apply playbooks, create firmwide knowledge base, maintain audit logs. Those are useful, but they keep the AI's belief state mostly opaque.

SMD's customer-owned memory artifact (per [ADR 0008](../../../adr/0008-customer-owned-memory-artifact.md)) is the **firm-readable operating manual** for the AI staffer. That positioning answers five partner-level fears simultaneously:

1. **Trust:** "What does this AI think it knows?"
2. **Control:** "Can we correct it?"
3. **Continuity:** "Does it improve without becoming a black box?"
4. **Portability:** "Can we leave with our institutional knowledge?"
5. **Ethics:** "Can we audit the rules it was supposed to follow?"

The conclusion: customer-owned memory is not a feature differentiator. It is a category position. Marketing surfaces should be reordered to lead with it.

### Recommended demo move

Do not show memory as a settings page.

Show it as the moment of trust:

1. Persona drafts a client update.
2. Reviewer clicks "Why did it write it this way?"
3. UI shows the exact memory rule: tone, signer preference, escalation rule, client-contact rule.
4. Reviewer edits the rule in YAML or simplified UI.
5. System versions the change.
6. Same draft regenerates differently.

That sequence lands harder than any "AI workforce" claim. It is locked as the beta-1 demo centerpiece in [beta-1-demo-flow.md](../../beta-1-demo-flow.md).

---

## 3. Reviewer-as-sender as regulatory foresight

### Finding

The regulatory signal supports reviewer-as-sender as a regulatory-foresight position, not just as a "safer than competitors" feature claim. The signal moves through three converging channels:

1. Lawyer responsibility for AI output.
2. Supervision duties for AI and nonlawyer-assistant analogs.
3. Restrictions or disclosure requirements when AI communicates with clients or third parties.

The likely future is not necessarily "every AI message must be sent by a human." The more likely future is:

> Any AI-generated legal or client-facing communication must be attributable to, reviewed by, and controlled by a responsible lawyer or firm representative, with disclosure or disclaimers where the AI directly communicates.

That makes reviewer-as-sender ([ADR 0005](../../../adr/0005-reviewer-as-sender.md)) a strong "already where the puck is going" position.

### Regulatory evidence

**State Bar of Arizona** says legal professionals must exercise caution, independent judgment, and verification when integrating generative AI into legal work. Particularly relevant because beta-1 is Phoenix-first.

**Florida Opinion 24-1** says lawyers may use generative AI but must protect confidentiality, provide accurate and competent services, avoid improper billing, and comply with advertising restrictions. Critically: AI chatbots communicating with clients or third parties must include a disclaimer that the chatbot is an AI program and not a lawyer or employee of the law firm.

**ABA Formal Opinion 512** addresses competence, confidentiality, communication, fees, candor, and supervision when using generative AI. Reuters summarized it as warning lawyers to comply with ethical obligations including risk of sanctions for misuse.

**California SB 574 (proposed amendments, 2026)** would require lawyers to verify AI-generated materials used in court filings, correct false or biased AI outputs, and avoid entering confidential or personally identifying information into public AI tools.

### UPL litigation as live signal

The Nippon Life Insurance v. OpenAI lawsuit (filed March 4, 2026) is the most direct live signal. ChatGPT allegedly helped a pro se claimant draft 44 post-settlement legal filings including a fabricated case citation. OpenAI has moved to dismiss, arguing ChatGPT is not a person, does not practice law, and users are told not to treat outputs as legal advice. Reuters calls it among the first cases accusing a major AI platform of unauthorized legal practice.

Full strategic read in [round-3/openai-upl-strategic-read.md](../round-3/openai-upl-strategic-read.md).

### External language

Approved: "reviewer-as-sender reduces litigation exposure by preserving a clear human actor of record."

Not approved without counsel review: "compliant with [any bar opinion]," "litigation insurance," "legally safe."

The architectural language (internal) is stronger: the AI cannot send. There is no override flag. The runtime enforces it.

---

## 4. Updated competitor matrix and threat tiers

### Threat tier updates from round 1

| Competitor      | Round-1 tier | Round-2 tier | Why                                                                                                                                                                                                     |
| --------------- | ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eve Legal       | HIGH         | HIGH         | Increased linguistic adjacency via "AI Workforce." Still highest pattern-competitor threat. Wedge is portability and memory ownership, not capability.                                                  |
| EvenUp PLAAS    | MEDIUM       | HIGH         | PLAAS is explicitly a managed-service operating model with expert case managers and AI. Uses "predictable flat-fee pricing" publicly. Removes flat-fee as a unique SMD claim.                           |
| Law Practice AI | HIGH         | HIGH         | Closest demo-floor threat for PI prospects. "AI Operation System for Your Law Firm" language creates buyer confusion. Wedge is persona-led + memory-owned + reviewer-controlled vs solution-module-led. |
| Microsoft       | MED-HIGH     | MEDIUM       | Not a PI v1 killer but a narrative compressor. As Copilot expands from Word to Outlook/calendar/cowork, "AI operates across surfaces" becomes commoditized. Forces the wedge onto memory and review.    |
| Harvey          | LOW          | LOW          | Confirmed: BigLaw-only at $1,200-$2,000/seat/month with 20-seat minimum. Not a PI v1 threat. Long-horizon platform pressure if they discount downmarket.                                                |
| Filevine AI     | MEDIUM-HIGH  | MEDIUM-HIGH  | Embedded in case system. Strongest objection from prospects already on Filevine. Wedge is the cross-surface architecture vs the platform-embedded feature menu.                                         |

### Defensibility timeline (revised)

| Differentiator                                             | Defensibility window      | Risk                                                                                                        |
| ---------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Persistent named persona                                   | 3-9 months                | Easy for competitors to copy superficially                                                                  |
| Persona inbox + signature + voice                          | 6-12 months               | Requires deeper workflow design                                                                             |
| Customer-editable versioned memory                         | 9-18 months               | Strong if executed well; most vendors prefer hidden context stores                                          |
| Reviewer-as-sender doctrine                                | 12-24 months              | Competitors can say "human in loop"; hard architectural enforcement is rarer                                |
| Flat monthly per-firm SKU                                  | **Not a moat**            | EvenUp PLAAS already uses flat-fee pricing publicly                                                         |
| Multi-persona per customer                                 | 6-12 months post-traction | Currently paper commitment per [ADR 0011](../../../adr/0011-multi-persona-per-customer.md); do not oversell |
| Combined ethics architecture (memory + reviewer-as-sender) | 18-30 months              | Highest defensibility. Requires reworking both business model and architecture to copy.                     |

The combined ethics architecture is the longest-lived moat. Both pieces individually are defensible for 9-18 and 12-24 months. The combination is a category position rather than a feature stack.

---

## 5. Pricing posture (deferred to internal decision)

The external research team recommended a $3,500-$7,500/month band with a $5,000/month anchor for beta-1. The Captain decision is to defer pricing to internal analysis tied to stack cost. The band recommendation is captured here as market context only.

Three points worth preserving for internal use:

- **Software floor.** Clio Duo at $39/user/month and Clio base plans starting at $49/user/month set the floor below which AI Employee appears to be "another AI add-on."
- **Managed-service ceiling.** EvenUp PLAAS (flat-fee, sales-led pricing) sets the upper boundary below which AI Employee should price to avoid full managed-service comparison.
- **Per-seat pressure.** Harvey at $1,200-$2,000/seat/month with 20-seat minimum, CoCounsel Core historically cited at $225/user/month — per-seat economics make AI Employee's flat-monthly look generous for 5-20 attorney firms and tight for 3-attorney firms.

Final price is locked elsewhere.

---

## 6. Doctrine outputs

This round's outputs are locked in two ADRs:

- **[ADR 0012](../../../adr/0012-ai-employee-positioning-doctrine.md)** — AI Employee positioning doctrine: portable persona, firm-owned memory, reviewer-as-sender as ethics architecture; Eve wedge line; legal-vertical opener ("a managed AI staffer your team reviews before anything leaves the firm"); combined moat stack; flat-monthly removed from moat list.
- **[ADR 0013](../../../adr/0013-pi-vertical-adapter-build-priority.md)** — Practice-management adapter build priority: Filevine first, CASEpeer second, SmartAdvocate third.

---

## References

- [ADR 0005](../../../adr/0005-reviewer-as-sender.md) — reviewer-as-sender architecture
- [ADR 0006](../../../adr/0006-capability-adapter-pattern.md) — capability-adapter pattern
- [ADR 0008](../../../adr/0008-customer-owned-memory-artifact.md) — customer-owned memory artifact
- [ADR 0011](../../../adr/0011-multi-persona-per-customer.md) — multi-persona per customer
- [ADR 0012](../../../adr/0012-ai-employee-positioning-doctrine.md) — AI Employee positioning doctrine
- [ADR 0013](../../../adr/0013-pi-vertical-adapter-build-priority.md) — PI vertical adapter build priority
- [Round-1 competitor analyst contribution](../round-1/competitor-analyst.md)
- [Round-3 ethics architecture](../round-3/ethics-architecture.md)
- [Round-3 OpenAI UPL strategic read](../round-3/openai-upl-strategic-read.md)
- [Round-3 vendor demo capture template](../round-3/vendor-demo-capture-template.md)
- [Beta-1 demo flow](../../beta-1-demo-flow.md)
