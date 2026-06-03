---
title: 'Vertical Spec: Law Firm (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0035-operator-thesis.md, 0005-reviewer-as-sender.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md
---

# Vertical Spec: Law Firm

This is the brief that drives the Law pack's manifest, marketing surface, N=0 proof, and delivery SOP. It is the worked reference the other packs are skinned from. Per [ADR 0035](../../adr/0035-operator-thesis.md), the Operator competes with a **hire**, not with software; the firm's practice-management suite is a **connection target, not a competitor**.

## The role we digitize

The **intake and matter coordinator** — the person at a small firm who answers the new-client inquiry, books the consult, chases the signed engagement letter, keeps the practice-management system current, and nudges the matter that has gone quiet. At a solo or small firm this is often the owner, a paralegal wearing three hats, or a seat the firm keeps meaning to fill and can't keep filled. It is connective work: reading the inbound, updating the system of record, moving the next step, logging it.

## The residual connective layer

The firm already runs a practice-management system (Clio, MyCase), email, a calendar, document storage, e-sign, and the phone. Each does a slice. The human is what holds them together: the email that has to become a matter, the consult that has to land on the calendar, the engagement letter that has to be chased to signature, the document that arrives and has to be filed and acknowledged, the matter that stalls and needs a nudge. **More disconnected systems means more of this work, not less.** That residual layer is what the Operator takes.

## The connective tasks (the wedge surface)

Substance-free coordination only. None of these is legal advice.

1. **Intake acknowledgment** — a new inquiry lands; read it, capture the details that matter, draft the first response in the firm's voice, route it.
2. **Consult booking** — offer times, book the consult, put it on the calendar, send the confirmation.
3. **Engagement-letter / retainer chase** — track the unsigned engagement, nudge on a cadence, log the signature.
4. **Matter-status update** — the routine "where are we" the firm answers the same way every time, drawn from the system of record.
5. **Conflict-intake routing** — capture the parties on intake and route for the human conflict check (the Operator gathers and routes; it does not clear conflicts).
6. **Document-received logging** — a document arrives; acknowledge receipt, file it, log it where the team can see.
7. **Stalled-matter nudge** — watch matters in flight, surface the ones that went quiet, draft the follow-up.

## System stack and connector plan

| Capability         | Adapter                         | Backend                                                 | Notes                                                                                                                    |
| ------------------ | ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PracticeManagement | clio                            | `mcp:clio-oktopeak`                                     | Clio's developer program is open and self-serve; the vendor welcomes integrators. No BUILD adapter needed for the pilot. |
| PracticeManagement | mycase                          | `build:mycase`                                          | Follow-on; MyCase shipped a public API in 2023.                                                                          |
| Email              | m365-mail / google-gmail        | `mcp:m365-mail` / `build:google-gmail`                  | Per ADR 0020 bindings.                                                                                                   |
| Calendar           | m365-calendar / google-calendar | `mcp:m365-calendar` / `build:google-calendar`           |                                                                                                                          |
| DocumentStorage    | ms-365 / google-drive           | `mcp:softeria/ms-365-mcp-server` / `build:google-drive` |                                                                                                                          |
| ESign              | docusign                        | `build:docusign`                                        | MCP in beta; hold the BUILD adapter as prod.                                                                             |

The pilot rides Clio's MCP, so it needs **no BUILD adapter** — which is why Law is first through the line (lowest friction), not because it is the strongest market.

## Compliance floor (authored, not assumed)

Per [ADR 0035](../../adr/0035-operator-thesis.md) Tenet 3, there are no imposed defaults; these are floors the engagement authors, fail-closed until raised.

- **UPL boundary** — the Operator does connective work only. It never gives legal advice, recommends a legal course, or drafts legal substance. The seven tasks above are intake, scheduling, chasing, logging, status. This is the load-bearing scope discipline that keeps the pack clear of unauthorized-practice-of-law.
- **Reviewer-as-sender floor** — external messages ship under a human reviewer's identity by default ([ADR 0005](../../adr/0005-reviewer-as-sender.md)), one authored exposure option ([ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)); the law pack pins it as a non-raisable floor for client-bound and tribunal-bound mail.
- **Privilege and conflicts** — privileged content stays inside the firm's surfaces; conflict capture routes to a human, never auto-clears.
- **Supervision** — the posture maps to the supervising-attorney requirement (ABA Model Rule 5.3, ABA Formal Opinion 512) and to state AI-disclosure rules; the audit log records draft, review, edit, send.

## Labor-market dislocation (the demand hook)

Small firms are squeezed on the coordinator seat from two sides: it is expensive and hard to keep staffed, and it is the first cost a margin-compressed firm cuts. The PI add-on rides a specific, dated forcing function: California ballot **Initiative 25-0022** would cap auto/rideshare contingency fees at 25% (from 33-40%), fold case costs inside the cap, and bench medical liens, compressing PI economics and the cost a firm can carry per case. This hook belongs in **outreach and channel timing**, not on the evergreen landing page (we do not date the public surface to a ballot measure, and we do not imply pre-knowledge of any specific firm's situation).

## Competitive read (system-features excluded)

Per the corrected lens: **system-features are connection targets, not rivals; only true employee-replacers count.**

- **Connection targets (zero threat):** Clio Work, Lawmatics QualifyAI, MyCase AI, Clio Draft. These are features inside the systems we connect across. The firm still employs the coordinator; these tools eat a slice of the routine, and what remains is the cross-system connective layer the Operator takes.
- **Employee-replacers (the real column):** the funded legal-AI cluster (Eve, Supio, CaseFlood) sits in **PI/litigation drafting** — legal substance, not the connective intake-coordinator seat. The connective-coordinator seat is open.

## The wedge

> The intake-and-matter coordinator seat at solo and small firms: answer the new-client inquiry, book the consult, chase the signed engagement, keep the system of record current, nudge the stalled matter. Connects to Clio / MyCase over their open APIs, runs the connective layer only, stays clear of legal substance. It wins because the system of record is open and its vendor is an ally, the buyer is the most reachable of any vertical, and the seat is one firms already struggle to staff.

## Base vs. add-on

- **`law-firm` (base):** general small-firm coordination — immigration, family, estate, small-business. The lowest-friction, open-seat entry; lead here.
- **`law-firm/pi` (add-on):** PI-specific connective skin — medical-records request and follow-up, treatment-status tracking, lien-status logging, demand-package **assembly** (collation of authored components, never legal argument). Additive on the base; rides the Init. 25-0022 timing.

## Channel

Clio App Directory ecosystem and developer community; bar associations and legal-tech media; Clio Con / ABA TECHSHOW; active small-firm subreddits and forums. PI add-on: warm practitioner intros plus the Init. 25-0022 timing window.
