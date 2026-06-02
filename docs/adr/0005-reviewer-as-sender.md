---
title: Reviewer-as-Sender — Every Customer-Bound Message Goes Out Under the Human Reviewer's Identity
date: 2026-05-20
status: accepted
captain: Scott Durgan
supersedes: none
amended-by: 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0035-operator-thesis.md
related-issue: https://github.com/venturecrane/ss-console/issues/828
---

# ADR 0005 — Reviewer-as-Sender

**Status:** Accepted, **amended 2026-05-29 by [ADR 0025](./0025-autonomy-ceilings-configurable-exposure-vs-initiation.md).** ADR 0025 overturns this ADR's central modality — the holding that reviewer-as-sender is "architectural, not configurable" (§Decision below). Under ADR 0025, reviewer-as-sender is retained as **(a) the default exposure configuration** and **(b) a vertical-pack-lockable floor** (the law pack pins it non-raisable), but it is no longer a global absolute: customers may configure autonomous external send on the exposure axis where no vertical floor forbids it. Everything else in this ADR — the internal/external persona split, the disclosure/liability reasoning (which becomes _why_ the default and the regulated-vertical floor exist), and the drafts mechanism — stands unchanged. Read this ADR with that amendment in mind. **Further amended by [ADR 0035 — The Operator Thesis](./0035-operator-thesis.md):** this ADR's competitive claim that "the platform's defensible position depends on this pattern remaining architectural" (Source, below) is superseded — reviewer-as-sender is one authored option, and the moat is the **harness + the guide + the memory**, never a single feature (ADR 0035, Tenet 4).

**Status (original):** Accepted (Captain decision; embedded in the Operator PRDs since first draft; recorded here as a standalone ADR per [#828](https://github.com/venturecrane/ss-console/issues/828)).

**Source:** The "reviewer is always the sender" principle and the internal-vs-external persona split. The platform's defensible competitive position depends on this pattern remaining architectural rather than configurable.

---

## Context

The Operator runs a named persona ("the Operator," "Sarah," whatever the customer chooses) across every internal surface: dashboard, internal Slack/Teams, audit log, voice samples, memory artifacts. Internally, the persona is fully visible — the customer's team interacts with their Operator as a teammate with a name and a face.

The product question this ADR resolves is: when the agent drafts an outbound message to a third party (a client, opposing counsel, a vendor, a court, a regulator), under whose identity does that message ship?

Three patterns were available:

1. **Agent-as-sender.** The persona has its own email account and sends directly. Recipient sees "the Operator from Smith Law Firm."
2. **Hybrid.** Some communications go out under the persona (transactional, low-stakes), others go out under the reviewer (high-stakes, regulated).
3. **Reviewer-as-sender.** The persona does not exist externally. Every outbound message is drafted into the reviewer's drafts folder. The reviewer reviews and clicks send from their own account. Recipient sees only the reviewer's signature.

Pattern 1 is the path of least friction at draft time but creates compounding problems downstream: disclosure obligations vary by jurisdiction and recipient class (PA/Utah AI-disclosure rules, ABA Formal Opinion 512, state-by-state bar guidance), liability for any agent error attaches to a non-human sender the customer cannot indemnify, and the "agent went rogue" failure mode loses the human-in-the-loop defense in any malpractice or regulatory inquiry.

Pattern 2 splits the rule and creates an enforcement gap. Once any outbound goes under the persona, the customer's compliance counsel has to police the boundary forever.

Pattern 3 is the only pattern that preserves the human-in-the-loop posture as an architectural property, not a configurable preference.

## Decision

**Every customer-bound external message ships under the human reviewer's identity. The agent persona does not exist as a sending identity to the outside world.**

This is architectural, not advisory. The control plane has no path that sends a customer-bound message under the agent's identity. The dashboard's approval surfaces draft into the reviewer's native drafts folder (per Email capability adapter); the reviewer reviews and sends from their own account.

Specifically:

- **External destinations.** Clients, opposing counsel, courts, regulators, vendors, counterparties, and any third party outside the customer's organization receive messages signed by and sent from the reviewer's account. The agent's email signature, name, and avatar appear only in the customer's internal surfaces.
- **Internal destinations.** The persona is fully visible. Internal Slack/Teams posts come from the persona. Dashboard interactions are authored as the persona. The persona has a working internal email address (via AgentMail or equivalent) for internal staff to address it.
- **Drafts.** The agent writes drafts into the reviewer's drafts folder. Drafts include a reviewer-visible "drafted by [persona] on [timestamp]" preamble that is stripped before send. The preamble is part of the audit trail.
- **Trust ceiling alignment.** Reviewer-as-sender is the architectural foundation of the platform's `draft_for_review` default for all external skills. Promotion to `autonomous` is not available for any skill whose output crosses the external boundary; this is locked in PRD §11.2.

## Consequences

**Positive.**

- The customer's clients never receive AI-authored communication that isn't acknowledged as such by a human signer. The disclosure obligation is satisfied structurally.
- Liability attaches to the human reviewer, the customer's employee or principal, in the same way it would if the reviewer had drafted from scratch. The agent is a drafting tool, not a sending agent.
- ABA Formal Opinion 512 and the various state-bar opinions on AI use in law practice all converge on a "supervising attorney" requirement; reviewer-as-sender is the cleanest implementation.
- "How do we know the AI didn't go off the rails" has a structural answer: it cannot send without you. The audit log shows draft, review, edit-diff, send — four data points the customer's compliance counsel can review and the customer's bar association can subpoena.
- The competitive moat narrows. The defensible competitive claim is the combination of editable customer-owned memory + reviewer-as-sender + flat-per-firm under one identity. The reviewer-as-sender pillar is the specific architectural commitment competitors with task-execution focus (Eve Legal, EvenUp PLAAS, Lawmatics) have not made.

**Negative / accepted.**

- Friction is higher per outbound. The reviewer has to open and send each draft (60-second mobile approval flow per PRD §12.6 is the answer; it has to be demoed not just described).
- The agent persona has no external presence — no LinkedIn, no externally facing email signature, no "from the Operator" inbound channel. Recipients cannot reply directly to the agent. This is the intended posture; replies route to the reviewer who then surfaces them back to the agent through the inbox-triage skill.
- Some customers will ask for the hybrid (Pattern 2). We will decline. The rule's load-bearing property is that it is architectural; weakening it to "configurable per skill" surrenders the moat.

**Out of scope.**

- Internal-comms persona presence is not affected. The agent remains a fully-visible named teammate inside the customer's organization. The split is external vs internal, not on vs off.
- Inbound watching (sent-folder structural-diff per PRD §10.4) is a separate decision with its own opt-in / opt-out. Reviewer-as-sender governs outbound only.

## References

- [Issue #828](https://github.com/venturecrane/ss-console/issues/828)
