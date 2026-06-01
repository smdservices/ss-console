# Ethics Architecture Deep-Dive — Round 3

**Author:** External competitive analysis team (engagement May 2026)
**Date:** 2026-05-21
**Scope:** Combined positioning of customer-owned editable memory + reviewer-as-sender as a category-defining ethics architecture, with regulated-industry analogues
**Prior rounds:** [round-1/competitor-analyst.md](../round-1/competitor-analyst.md), [round-2/competitive-analysis.md](../round-2/competitive-analysis.md)

---

## Thesis

Firm-owned editable memory plus reviewer-as-sender is defensible as **category leadership**, not just feature differentiation.

The combined frame:

> **Memory is the audit surface. Reviewer-as-sender is the action boundary. Together they form the ethics architecture for legal AI.**

That position is stronger than selling either feature alone.

---

## Why the combination matters

A legal AI system creates risk in two places:

1. **What it believes.** The AI's durable assumptions about the firm: voice, rules, people, workflows, escalation criteria, case-acceptance standards.
2. **What it does.** The AI's outbound actions: emails sent, filings produced, communications externalized.

Customer-owned editable memory controls the first risk. Reviewer-as-sender controls the second.

Most legal AI products are converging on a partial answer: **output review**. The industry consensus is "lawyers should verify AI output before it goes out." That is necessary but incomplete. If the firm cannot inspect and correct the AI's durable assumptions, review becomes whack-a-mole. The reviewer catches bad outputs one by one but cannot govern the underlying operating model.

The AI keeps drafting from the same flawed assumptions until those assumptions are surfaced and corrected. Without a readable memory artifact, the only way to correct the assumptions is to keep correcting outputs — which is rework, not governance.

### The governance loop

SMD's combined architecture creates a closed loop:

1. AI drafts a communication or work product.
2. Human reviewer reads the draft.
3. Reviewer asks: "Why did the AI write it this way?"
4. UI surfaces the specific memory rule (tone, person-mapping, escalation, case-acceptance) that shaped the draft.
5. Reviewer edits the rule in place.
6. System versions the change to memory.
7. Same draft regenerates differently. Future drafts improve under audit.

That is not "AI settings." That is **operational governance** of the AI's behavior.

The closed loop is the part competitors cannot easily replicate. They can ship a "configure your AI" surface. They can ship style learning. They can ship knowledge bases. What they cannot easily ship is a memory artifact the customer **owns** (legally and operationally), can **inspect** (down to the rule that fired on a specific draft), and can **modify** (with versioning, audit trail, and immediate effect on subsequent drafts).

---

## Regulatory support signal

The regulatory direction supports this positioning. Several jurisdictions and bodies are moving toward governance-of-AI requirements that map onto SMD's architecture more cleanly than they map onto competitors.

### State Bar of Arizona

Says legal professionals must use caution, independent judgment, and verification when integrating AI into legal work. Warns that legal professionals must critically review and refine AI-generated legal research, citations, arguments, and documents before submission. Phoenix-first beta-1 is in this jurisdiction.

### Florida Opinion 24-1

Says lawyers may use generative AI but must protect confidentiality, provide accurate and competent services, avoid improper billing, and comply with advertising restrictions. Critically: AI chatbots communicating with clients or third parties must include a disclaimer that the chatbot is an AI program and not a lawyer or employee of the firm.

The disclaimer requirement is specifically tied to direct AI-to-client communication. Reviewer-as-sender means SMD's AI does not communicate directly with clients. The disclaimer rule's application to SMD's architecture is a counsel question, but the architectural fact (the AI does not externally communicate on its own) is a strong starting position.

### ABA Formal Opinion 512

Addresses competence, confidentiality, communication, fees, candor, and supervision when lawyers use generative AI. Reuters summarized the ABA guidance as warning lawyers to comply with ethical obligations including competence, confidentiality, client communication, fees, and risk of sanctions for misuse.

### California SB 574 (proposed amendments, 2026)

Would require lawyers to verify AI-generated materials used in court filings, correct false or biased AI outputs, and avoid entering confidential or personally identifying information into public AI tools. California is pushing further toward formal AI governance than any other state.

### Combined signal

The regulatory direction is **not** "ban AI." It is "lawyers remain responsible for AI-assisted work product, AI must be supervisable, AI-generated communications must be attributable to a human." That direction maps onto reviewer-as-sender architecturally and onto customer-owned editable memory as the supervision surface.

---

## Analogues from other regulated industries

The best analogy is not "SaaS audit logs." That framing is too weak. It implies governance is a logging concern. It is not. Governance is a control concern.

The strongest analogues come from regulated industries that have already faced the question of how to incorporate machine assistance without removing human responsibility. Three are particularly relevant.

### Aviation: checklist plus pilot-in-command

Autopilot did not remove the pilot from the cockpit. Instead, aviation created a higher-order control model: machine assistance operating under human command, with checklists, logs, defined authority, and clear actor-of-record.

The architectural parallel:

| Aviation                          | Operator                  |
| --------------------------------- | ------------------------- |
| Checklist / operating manual      | Memory artifact           |
| Pilot-in-command authority        | Reviewer-as-sender        |
| Flight recorder                   | Audit log                 |
| Autopilot suggests, pilot decides | AI drafts, reviewer sends |

Aviation's record on this is strong evidence for the model. Commercial aviation has integrated automation for fifty years without abdicating human responsibility, and the regulatory framework (FAA, ICAO, EASA) makes the pilot the actor-of-record regardless of how much the machine assists.

### Healthcare: clinical decision support

Clinical decision support (CDS) systems can suggest, rank, flag, and draft. They can recommend a differential diagnosis, prioritize follow-up actions, flag drug interactions, draft discharge summaries. They do not diagnose. They do not order treatment. They do not communicate with patients on the clinician's behalf.

The licensed clinician remains responsible for diagnosis, orders, and patient communication. CDS is assistance under supervision, with clear delineation of what the machine recommends and what the clinician decides.

The architectural parallel:

| Healthcare CDS                    | Operator                                |
| --------------------------------- | --------------------------------------- |
| Suggests differential diagnosis   | Drafts client communications            |
| Flags drug interactions           | Flags escalation criteria, deadlines    |
| Drafts discharge summaries        | Drafts demand letters, intake responses |
| Clinician orders and communicates | Reviewer reviews and sends              |
| EHR governs CDS knowledge base    | Memory artifact governs AI knowledge    |
| Physician of record               | Attorney of record                      |

Healthcare's CDS is particularly relevant because clinicians, like lawyers, operate under malpractice exposure. The model that works in healthcare (machine prepares, clinician acts) is the model that works in legal.

### Finance: maker-checker controls

Regulated financial workflows separate the preparer from the approver. A trader, a treasury analyst, or a back-office clerk prepares a transaction. A separate authorized party approves it. The system is designed so high-risk actions require approval before execution. No single human can both prepare and execute a regulated transaction above a threshold.

The architectural parallel:

| Finance maker-checker            | Operator                           |
| -------------------------------- | ---------------------------------- |
| Maker prepares transaction       | AI persona drafts message          |
| Checker approves transaction     | Human reviewer approves message    |
| Hard boundary, not policy        | Runtime-enforced, no override flag |
| Audit log of preparer + approver | Audit log of drafter + sender      |

Finance's maker-checker model is the closest structural analogue because the boundary is **architectural**, not advisory. The system literally cannot execute without a separate approver. That is the same posture as reviewer-as-sender: the AI cannot externalize without a human in the loop.

---

## Category leadership claim

Use internally:

> The winning legal AI architecture will not be the model that drafts the most. It will be the model that makes AI-assisted work **governable**. SMD's position is governable AI labor: readable memory, enforced human action boundary, auditability by design.

That claim is defensible because:

1. The regulatory direction (Arizona, Florida, ABA, California, UPL litigation) is moving toward attributable, supervisable, reviewable AI.
2. The combined architecture (memory + reviewer-as-sender) implements that direction at the runtime level, not at the policy level.
3. The competitor set is converging on output review without converging on belief-state review or hard action boundaries.
4. The architecture composes with other locked decisions ([ADR 0006](../../../adr/0006-capability-adapter-pattern.md) capability adapters, [ADR 0007](../../../adr/0007-per-customer-machine-isolation.md) per-customer isolation, [ADR 0011](../../../adr/0011-multi-persona-per-customer.md) multi-persona schema) into a coherent product story.

---

## What this changes for Operator

### In the demo

The combined ethics architecture is the spine of the beta-1 demo. The 6-step memory demo flow ([beta-1-demo-flow.md](../../beta-1-demo-flow.md)) demonstrates both features simultaneously: the reviewer sees the memory rule, edits it, watches the AI regenerate, then sends from their own identity. Memory ownership and reviewer-as-sender are not pitched separately; they are shown as one architecture.

### In the marketing

Memory becomes a headline pillar per [ADR 0013](../../../adr/0013-operator-positioning-doctrine.md). Reviewer-as-sender is positioned as regulatory foresight, not as "safer than competitors." The two are framed together in higher-context materials (deck, proposal, demo opener) and separately only at the feature-level on the website.

### In the proposal

The combined ethics architecture appears as a single section in proposals, not as two bullet points. The aviation, healthcare, and finance analogues are available for managing-partner-level conversations where the prospect is sophisticated enough to value the regulatory framing.

### In objection handling

The combined frame answers several objections simultaneously:

- "How do we know the AI didn't go off the rails?" → Memory and reviewer-as-sender combined.
- "Can the AI send emails to clients?" → Reviewer-as-sender architecture.
- "What does the AI think it knows about us?" → Memory artifact, readable in the dashboard.
- "What if we want to change how it behaves?" → Edit the memory rule, system versions and regenerates.
- "What if we leave?" → Memory artifact is portable, persona identity is released.

---

## What does not change

- The capability-adapter pattern ([ADR 0006](../../../adr/0006-capability-adapter-pattern.md)) is unchanged. The ethics architecture is a positioning frame; the adapter pattern is a code structure.
- The customer-owned memory artifact ADR ([ADR 0008](../../../adr/0008-customer-owned-memory-artifact.md)) is unchanged. This deep-dive reinforces the positioning value of the architecture already locked.
- The reviewer-as-sender ADR ([ADR 0005](../../../adr/0005-reviewer-as-sender.md)) is unchanged. This deep-dive reframes the external language around it.
- The multi-persona schema lock ([ADR 0011](../../../adr/0011-multi-persona-per-customer.md)) is unchanged. Multi-persona positioning at v1 is governed by [ADR 0013](../../../adr/0013-operator-positioning-doctrine.md) §8.

---

## References

- [ADR 0005](../../../adr/0005-reviewer-as-sender.md) — reviewer-as-sender architecture
- [ADR 0008](../../../adr/0008-customer-owned-memory-artifact.md) — customer-owned memory artifact
- [ADR 0013](../../../adr/0013-operator-positioning-doctrine.md) — Operator positioning doctrine
- [Round-2 competitive analysis](../round-2/competitive-analysis.md)
- [Round-3 OpenAI UPL strategic read](./openai-upl-strategic-read.md) — UPL litigation as the most direct live regulatory signal
- [Beta-1 demo flow](../../beta-1-demo-flow.md) — the 6-step memory demo that embodies the combined architecture on-stage
