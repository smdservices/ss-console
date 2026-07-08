---
date: 2026-06-25T18:28:44Z
from: Christa@ashtonandprice.com
to: smdurgan@smdurgan.com
subject: RE: Intro meeting with Scott Durgan
gmail_message_id: 19f000adae2d4d88
status: CANONICAL inbound — the scope-defining email (mandates the full CA PI lifecycle)
---

# Christa → Scott: tech stack + answers to the 7 questions + EXPANDED SCOPE

_Verbatim body (firm confidentiality footer and quoted prior message trimmed). This is the
email that expanded the engagement from discovery-only to the full CA PI litigation lifecycle,
and it is what the proposal (`../CLIENT-PROPOSAL.md`) was written to answer. **It contains no
data-handling questions.**_

Thank you for putting this together — this is exactly the kind of concrete picture we needed to react to, and it tells me you understand what we're actually trying to build. The discovery workflow you mapped is largely right. I want to use this reply to answer your questions, clarify our tech stack, and expand the scope so we're building the full Operator architecture from day one.

## OUR TECH STACK

Here is what we're working with so you can map integrations:

- Smokeball — matter management, documents, tasks, deadlines (central hub)
- Microsoft Office — Outlook (email + calendar), Word, Teams
- Claude — AI drafting, summarization, document analysis
- Adobe — PDF handling, Bates stamping, exhibit prep, e-signing
- BriefPoint — written discovery responses and objections
- InfoTrak — process serving, service of process tracking, e-filing, and direct document and invoice import into Smokeball per client matter; also provides E-Sign integrated within Smokeball
- Greenfiling — e-filing
- YoCierge — medical records vendor; automatically uploads ordered records and invoices directly into each Smokeball client matter
- Dropbox — sharing exhibits, medical records, demands, and documents with clients and defense counsel
- CoCounsel (Thomson Reuters) — meeting scheduled this Friday to evaluate; not yet onboarded

Note on the Smokeball x Thomson Reuters partnership: I received the announcement this week and have a meeting scheduled to learn more about how the integration works in practice. I want to make sure the Operator architecture accounts for how CoCounsel ultimately connects to Smokeball once that picture is clearer.

A few integration points I want to make sure are on your radar:

- Discovery arrives by mail and email before being manually filed into Smokeball. Both channels need to be accounted for — the Operator needs to close that handoff gap regardless of how it arrives.
- InfoTrak service confirmations should automatically trigger responsive pleading deadlines in Smokeball — this should not be a manual step.
- Client verifications should route through Smokeball E-Sign (powered by InfoTrak) with the Operator tracking completion and chasing automatically if unsigned.
- The Operator should trigger paralegal and attorney updates at defined case milestones, coordinating with YoCierge on records status where applicable.
- Once we confirm how CoCounsel integrates, I want to discuss how to position Claude vs. CoCounsel vs. BriefPoint within the Operator's drafting logic to avoid redundancy and manage cost.

## YOUR QUESTIONS — OUR ANSWERS

1. Does this match how A&P actually runs discovery? Where is it off?
   Broadly yes. A few nuances:

- Discovery arrives by mail and email before being manually filed into Smokeball. Both paths need to be on the Operator's radar.
- Meet-and-confer letters are sometimes handled informally before a formal letter goes out. The Operator should flag that decision point to the attorney rather than auto-drafting every time.
- We want the Operator to track discovery we propound, not just respond to what is served on us — including following up on outstanding responses from opposing counsel and flagging when to move to compel.

2. Which parts cost the most time or cause the most slippage?

- Client verification tracking — falls through the cracks consistently.
- Deadline calendaring — especially with extensions, stipulations, and amended service.
- Drafting separate statements for motions to compel — extremely time-consuming.
- Medical chronology maintenance as new records arrive throughout the case.

3. Where does served discovery land first?
   Mail and email, then manually filed into Smokeball. Closing this gap across both channels is a priority.

4. How do we collect client verifications today?
   Currently a mix of e-signature and manual. We want to standardize through Smokeball E-Sign and have the Operator own that process end to end.

5. BriefPoint vs. CoCounsel — how are they used?

- BriefPoint: written discovery responses and objections.
- CoCounsel: we are meeting with Thomson Reuters this Friday and have not yet onboarded. We will have a clearer picture of the integration and use case after that meeting and the Smokeball partnership discussion next week.
  Neither is fully integrated into a consistent Smokeball folder structure yet. We want the Operator to establish and enforce that structure once the CoCounsel integration picture is clear.

6. Where do we keep discovery deadlines?
   Currently split between Smokeball tasks and Outlook calendar. We want the Operator to consolidate into Smokeball as the single source of truth.

7. Which courts do we practice in?
   Primarily Sacramento County Superior Court, with matters across Northern California courts. The Operator will need to handle court-specific local rules, formatting requirements, and e-filing protocols across those venues. For e-filing we currently use InfoTrak and Greenfiling, and the Operator should integrate with or guide filing through those platforms and/or Odyssey/eCourt as applicable.

## EXPANDED SCOPE — FULL CALIFORNIA PI LITIGATION LIFECYCLE

The discovery workflow is the right place to start, but I want the architecture built to support the full case lifecycle from day one. Here is the complete scope:

1. COMPLAINT FILING & CASE INITIATION

- Draft complaint, summons, and cover sheet (CM-010)
- Track defendant service deadlines; integrate with InfoTrak for service confirmation to auto-trigger responsive pleading deadlines in Smokeball
- Calendar responsive pleading deadlines once service is confirmed
- E-filing workflow via InfoTrak, Greenfiling, and/or Odyssey/eCourt depending on venue
- Court-specific local rule compliance for Sacramento and Northern California courts

2. FULL DISCOVERY LIFECYCLE

- Everything in your mapped workflow, plus:
- Track propounded discovery and follow up on outstanding opposing responses
- Flag when to move to compel on our own propounded discovery

3. MOTIONS PRACTICE

- MSJ, opposition, reply
- Motions in limine
- Ex parte applications
- Format and procedural compliance by court and department

4. MINOR'S COMPROMISE WORKFLOW
   This is a significant part of our practice and needs dedicated Operator support:

- MC-350 and MC-351 preparation
- Petition for approval of minor's compromise
- Court hearing scheduling and follow-up
- Guardian ad litem appointment tracking
- Net settlement calculations and fee disclosures
- California Probate Code compliance
- Post-approval funding and structured settlement coordination where applicable

5. TRIAL PREPARATION

- Trial brief drafting
- Exhibit and witness list preparation
- Deposition summary integration
- Trial binder organization in Smokeball

6. MEDIATION & SETTLEMENT

- Mediation brief and settlement conference statement drafting
- Damages summary with liability and comparative fault analysis
- Lien tracking and resolution workflow (ERISA, Medi-Cal, Medicare, provider liens)

7. PARALEGAL TRAINING FUNCTION
   This is a core requirement, not a nice-to-have. We want the Operator to function as an embedded training tool for litigation paralegals:

- SOPs built into each workflow step so staff know what to do, why, and what comes next
- Procedural checklists at each stage (e.g., how to file a complaint in Sacramento Superior, how to prepare an MC-350 packet)
- Escalation logic that teaches staff when to involve the attorney versus proceed independently
- A junior paralegal working alongside the Operator should be able to develop real competency in California civil litigation procedure through the work itself over time

This has real potential to transform how our litigation team operates. Excited to see this in action!

C. Barrera
Operations Manager
Ashton & Price, LLP
(916) 727-9027 Direct
(916) 726-0678 Fax
