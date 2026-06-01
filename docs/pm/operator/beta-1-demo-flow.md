# Beta-1 Demo Flow

**Status:** Approved. The 6-step memory demo is the beta-1 demo centerpiece. Locked in [ADR 0013](../../adr/0013-ai-employee-positioning-doctrine.md) §6 (ethics architecture as combined moat) and informed by the round-2 and round-3 competitive analysis deliverables.

**Audience:** Beta-1 demo attendees (managing partners and operations leads at 3-20 attorney PI plaintiff firms in Phoenix). The flow is calibrated for in-person demonstrations to sophisticated buyers.

**Demo length:** 30-45 minutes including discovery, the 6-step demo sequence, objection handling, and proposal next-steps. The on-stage demo sequence runs 8-12 minutes.

---

## The strategic frame

The strongest demo story is **not** "watch the AI answer a question." It is the moment of trust: the reviewer asks the AI why it wrote something the way it did, sees the rule that fired, edits the rule, and watches the same draft regenerate differently.

That sequence demonstrates both moats simultaneously:

- **Customer-owned editable memory.** The reviewer sees and edits the AI's belief state.
- **Reviewer-as-sender.** The reviewer is the one who sends from their own identity after review.

It is the on-stage version of the combined ethics architecture frame (memory is the audit surface, reviewer-as-sender is the action boundary).

---

## Pre-demo discovery (5-10 minutes)

Before opening the demo, the consultant asks the firm:

1. What is your current intake follow-up process?
2. Where are the bottlenecks in case-status visibility?
3. Who currently drafts client status updates? How long does it take?
4. What practice-management system are you on? (Confirms which adapter to use in the demo.)
5. What does a "good" AI tool look like to you?

These questions ground the demo in the firm's actual operations. They also surface whether the firm has demoed Eve, EvenUp PLAAS, Law Practice AI, or any other vendor, which dictates which objection-handling approach to use.

---

## The opener (legal-vertical)

Per [ADR 0013](../../adr/0013-ai-employee-positioning-doctrine.md) §2:

> **A managed Operator your team reviews before anything leaves the firm.**

Do not lead with "first hire your business doesn't have to make" in legal demos. The softer line is the right opener because it disarms the staff-replacement objection upfront.

Follow with the one-sentence positioning:

> The persona has a name, an inbox, a memory, and a reviewer. It drafts the routine operational work your team already knows how to review. But it never sends, commits, advises, or files on its own.

---

## The 6-step memory demo

This is the on-stage centerpiece. Run it on a representative scenario (intake follow-up, client status update, demand package check-in) that matches the firm's discovery answers.

### Step 1: Draft generated

The demo opens with a fresh inbound (a sample client email, an intake form submission, a calendar event needing follow-up). The AI persona triages it, checks matter context, and produces a draft response in the firm's voice.

What the buyer sees: a complete, contextually-aware draft that looks like something the firm's own staff would write.

What the buyer feels: "It can actually draft this."

### Step 2: Reviewer asks "Why did it write it this way?"

The reviewer (the demo operator) clicks a "Why?" button or equivalent surface element next to the draft. The UI surfaces the specific memory rules that shaped the draft.

What the buyer sees: a list of cited memory rules, each one tied to a specific phrase or decision in the draft. Examples:

- Tone rule: "Warm-but-professional, never apologetic for delays."
- Signer preference: "Cc paralegal Sarah on all intake follow-up."
- Escalation rule: "Flag mention of new injury for case manager review before sending."
- Voice envelope: "Match this client's preferred greeting (from voice library sample #12)."

What the buyer feels: "The AI is not a black box. I can see what it thinks it knows."

### Step 3: Reviewer edits the rule

The reviewer clicks one of the cited rules and edits it in place. Example: changes the tone rule from "warm-but-professional" to "formal and direct" for this particular client class.

What the buyer sees: a simple edit surface (form input, dropdown, or YAML editor depending on rule type). The change is immediate.

What the buyer feels: "I am in control of this. I can correct the AI without writing a prompt."

### Step 4: System versions the change

The UI shows the change recorded in the memory's version history. The new rule supersedes the old; both are retained in the audit log. No data is lost.

What the buyer sees: a small "v12 → v13" indicator or equivalent. A "history" link shows what changed.

What the buyer feels: "If I make a mistake editing the rule, I can revert. The audit log is real."

### Step 5: Same draft regenerates differently

The reviewer clicks "Regenerate" (or the AI automatically re-drafts after the rule change). The same inbound produces a new draft using the updated rule.

What the buyer sees: a side-by-side or before-after view showing how the draft changed. The new tone is formal and direct, matching the edited rule. Other unchanged rules (signer preference, escalation) still apply.

What the buyer feels: "I just trained the AI. And I can see what changed."

### Step 6: Reviewer sends from their own identity

The reviewer reviews the regenerated draft, makes one or two small inline edits if needed, and clicks Send. The message ships from the reviewer's own email account with their signature.

What the buyer sees: confirmation that the email left from the reviewer's account, not from the AI's identity. The audit log shows: AI drafted → reviewer reviewed → reviewer edited (diff visible) → reviewer sent.

What the buyer feels: "I am the actor of record. The AI helped, but I sent it."

---

## What the demo answers without saying

The 6-step flow answers several partner-level objections without the consultant having to deliver them as canned responses:

| Objection                                               | Demo step that answers it                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| "How do I know the AI isn't going to go off the rails?" | Step 6 — the AI cannot send without you                                                      |
| "What does the AI think it knows about us?"             | Step 2 — readable memory rules cited per draft                                               |
| "What if we want to change how it behaves?"             | Step 3 — edit the rule in place, no prompt engineering                                       |
| "Will I have to retrain it constantly?"                 | Step 4 — versioned change, persists forward, audit log retained                              |
| "Will it actually understand our firm?"                 | Step 1 — contextually-aware draft using actual matter context and voice library              |
| "Can the AI send emails to clients?"                    | Step 6 — no, the AI drafts; the reviewer sends from their own account                        |
| "Are you replacing our staff?"                          | Opener — "managed Operator your team reviews"; demo shows the reviewer in control throughout |

Letting the demo answer the objection is more persuasive than answering it verbally. The consultant's job is to choose the right scenario for the firm's actual operations and let the architecture speak.

---

## Eve and competitor objection handling

Some prospects will have demoed Eve Legal, EvenUp PLAAS, or Law Practice AI before the SMD demo. Prepare for the comparison.

### "How are you different from Eve 2.0?"

Use the locked wedge line ([ADR 0013](../../adr/0013-ai-employee-positioning-doctrine.md) §4):

> Eve is a plaintiff AI platform. Operator is a portable operator with firm-owned memory.

Follow with the 30-second managing-partner answer:

> Eve is a plaintiff-firm AI platform. It is strong, but the AI lives inside Eve's product. Operator is different: the persona lives in your firm's inbox, calendar, and case system, works through your reviewer, follows your voice rules, and carries a firm-owned editable memory artifact. We are not asking you to move your firm into our platform. We are giving you an operator-shaped operating layer that can follow your firm across systems.

If the prospect pushes on "can Eve also learn our writing style?":

> Yes, Eve publicly says it learns tone, style, formatting, and can create separate drafting agents. Our difference is that style is only one part of the persona. Operator exposes the operating memory itself: the firm can read, edit, version, audit, and export what the persona knows about voice, people, rules, workflows, and review boundaries.

### "Why not just use Filevine AI / Clio AI / CASEpeer AI?"

> Those tools help inside their own platforms. Operator works across your inbox, calendar, documents, client follow-up, case system, audit, and firm voice, with a human reviewer in the loop. It is a cross-surface operator, not a feature menu inside one vendor's product.

### "Does this give legal advice?"

> No. The AI can triage, summarize, draft operational communications, collect documents, flag deadlines, and prepare review packets. Legal advice, settlement authority, filings, trust activity, and citation-bearing legal arguments stay with attorneys. The architecture preserves this boundary at the runtime level. There is no override flag.

### "What happens if it makes something up?"

> The system is designed so AI errors become reviewable draft defects, not external firm actions. Outputs are gated, logged, and routed through human approval before anything leaves the firm. If a draft contains a hallucination, your reviewer catches it. The AI cannot externalize on its own.

### "Why should we trust a founder-operated beta?"

> Because the beta is intentionally narrow: one vertical, one practice-area overlay, one persona, 5-7 skills, one practice-management adapter, human-reviewed sends, and auditability from day one. The goal is reliable operational leverage, not magic.

---

## Multi-persona at v1

If asked "can we have one AI for intake and another for case management?":

> In v1, the system runs one persona, but the schema is already designed for multiple personas under one firm account. Intake and case-management personas are on the committed roadmap once a paying customer needs them.

Do not commit timing. Do not publish per-persona pricing. The schema-lock posture ([ADR 0011](../../adr/0011-multi-persona-per-customer.md)) preserves the option without selling vapor.

---

## Practice-management integration

If asked which systems we integrate with:

> v1 includes one practice-management adapter selected around your stack. We build first for Filevine, second for CASEpeer, third for SmartAdvocate, with other systems built on demand. The persona is decoupled from the practice-management system. The skill model is not hard-coded to one vendor.

This matches [ADR 0014](../../adr/0014-pi-vertical-adapter-build-priority.md). If the prospect is on a system outside the priority list (Clio, MyCase, Litify, Neos), be transparent: the adapter will be built on signing, with a deployment timeline that reflects the build.

---

## Post-demo motion

After the 6-step demo, the consultant transitions to scope and proposal:

1. Confirm the firm's most pressing operational pain points (from discovery).
2. Confirm the practice-management system (dictates the adapter build).
3. Walk through the engagement structure (beta partnership, scope envelope, 90-day initial term, success criteria).
4. Discuss pricing (final number per Captain decision; not in this document).
5. Schedule the next conversation (typically a signing call or a follow-up with the firm's compliance or operations lead).

The demo's job is to make the architecture real. The proposal's job is to make the engagement concrete. Do not conflate them.

---

## Pre-demo readiness checklist

Before delivering the demo to a beta-1 prospect:

- [ ] The "Why did it write it this way?" UI surface exists and is functional. This is the load-bearing demo element. Without it, the 6-step flow does not work.
- [ ] At least one realistic memory rule is loaded for the demo scenario, with citation surface working end-to-end (rule visible per draft, editable in place, versioning persistent).
- [ ] The audit log is visible and shows the full draft → review → edit → send chain.
- [ ] The reviewer-sends-from-own-identity flow works on the actual integration (Microsoft Graph or Google Workspace, whichever the prospect uses).
- [ ] The practice-management adapter for the prospect's system is functional in the demo environment. If it is not (because the prospect's system is not in the priority list), the demo uses a Filevine-based scenario with explicit framing about the adapter approach.

The first item is the most important and most likely to be the blocker. The 6-step demo is not viable without the memory citation surface. This is filed as a follow-on against [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md) implementation.

---

## References

- [ADR 0005](../../adr/0005-reviewer-as-sender.md) — reviewer-as-sender architecture
- [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md) — customer-owned memory artifact
- [ADR 0011](../../adr/0011-multi-persona-per-customer.md) — multi-persona per customer
- [ADR 0013](../../adr/0013-ai-employee-positioning-doctrine.md) — Operator positioning doctrine
- [ADR 0014](../../adr/0014-pi-vertical-adapter-build-priority.md) — PI vertical adapter build priority
- [Round-2 competitive analysis](prd-contributions/round-2/competitive-analysis.md)
- [Round-3 ethics architecture](prd-contributions/round-3/ethics-architecture.md)
- [Round-3 OpenAI UPL strategic read](prd-contributions/round-3/openai-upl-strategic-read.md)
- [Platform PRD](platform-prd.md) §16 (demo flow framework)
- [Law-firm PRD](law-firm-prd.md) — PI vertical overlay
