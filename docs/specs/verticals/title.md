---
title: 'Vertical Spec: Title & Escrow (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0035-operator-thesis.md, 0005-reviewer-as-sender.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Title & Escrow

The brief that drives the title pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0035](../../adr/0035-operator-thesis.md), the Operator competes with a **hire** (the closing coordinator and escrow assistant), not with software; the title production system is a **connection target, not a competitor**.

> **The safety line here is wire fraud, and it is absolute.** A title and escrow file moves real money, and seller impersonation and wire-instruction fraud are the dominant threats in the industry. The Operator **never transmits, confirms, or changes wire instructions, and never moves or disburses escrow funds.** Any inbound message touching wire instructions or banking details is routed to a human through the company's verified process, fail-closed. This is the title analog of the clinical packs' emergency router.

## The closing desk's world

A title and escrow company runs a transaction across many parties who do not share a system: the buyer, seller, two agents, the lender, the payoff lenders, the HOA, the surveyor, the tax authority, and the notary. The order, the commitment, the figures, and the documents live in the title production system. Money sits in escrow under strict controls. Recording and the final policy come after closing.

The connective work is moving the file from open to recorded and keeping every party current: opening the order from the contract, chasing the documents the file needs (payoffs, HOA estoppel, survey, tax certificates, lender instructions), scheduling the signing, telling every party where the file stands at each milestone, coordinating the clear-to-close with the lender, confirming the signing, and tracking recording and final-policy issuance after closing. It is the same chain whether the deal is a purchase or a refinance; the parties change, the coordination does not.

That coordination is a real seat, the closing coordinator or escrow assistant who keeps the file and the parties moving while the escrow officer handles the funds and the legal work. It is a high-volume, deadline-driven seat. A company covers it with people, or buries an overloaded desk. The Operator takes the connective layer so the seat is covered, or the person is freed for the escrow and signing work only a licensed person can do. We make no assumption about which it is for a given company.

## Personas (the seat, described by role)

- **Closing coordinator** (`closing-coordinator`): opens orders, chases documents, updates the parties, schedules signings. The connective seat.
- **Title processor** (`title-processor`): assembles the file, orders search and payoffs, prepares for closing. The file seat.
- **Escrow / branch manager** (`escrow-manager`): owns the funds and the close. The reason the no-disbursement and wire-safety lines have to be architectural, not a matter of remembering to be careful.

## Skill catalog

Twelve title-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the reviewer-as-sender floor ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) unless the engagement authors otherwise.

### Opening and documents

**`order-intake`** | a contract becomes a structured order plus a drafted acknowledgment to the opening party. | _trigger:_ a new order (contract from an agent or lender) | _reads_ the contract, TPS orders (dedupe), the company's order template -> _writes_ a draft order, an acknowledgment, an internal log | PracticeManagement, Email | order draft autonomous, send draft-for-review | captures the order; never opines on title, marketability, or the contract terms.

**`document-collector`** | chases the documents the file needs to close. | _trigger:_ a required item open past the cadence | _reads_ the file's open-item list (payoffs, HOA estoppel, survey, tax certs, lender instructions) -> _writes_ per-item request and chase drafts, updates the list as items land | PracticeManagement, DocumentStorage, Email | chase send draft-for-review, list update autonomous | chases the items on the file's list; never judges whether a document clears title.

**`payoff-requester`** | requests mortgage and lien payoffs from the lenders. | _trigger:_ a payoff is needed | _reads_ the loan and lienholder info on the file -> _writes_ a payoff request, logs the response | PracticeManagement, Email | request send draft-for-review | requests and logs; never negotiates a payoff or interprets it.

### The party loop (the connective heart)

**`milestone-status-updater`** | tells every party where the file stands at each milestone. | _trigger:_ a milestone changes (title in, cleared, scheduled, closed, recorded) | _reads_ the file status, the party list -> _writes_ per-party status drafts (buyer, seller, both agents, lender) | PracticeManagement, Email | send draft-for-review | reports status from the file; gives no legal or closing-figure opinion.

**`title-commitment-deliverer`** | delivers the authored title commitment or prelim to the parties. | _trigger:_ the commitment is issued by the company -> | _reads_ the issued commitment -> _writes_ a delivery cover note to the parties | PracticeManagement, DocumentStorage, Email | send draft-for-review | delivers the authored document; never interprets exceptions or requirements.

**`clear-to-close-coordinator`** | coordinates the clear-to-close and figures handoff with the lender. | _trigger:_ approaching closing | _reads_ the lender's CTC and the file's figures status -> _writes_ a coordination draft to the lender and a team flag | PracticeManagement, Email | send draft-for-review | coordinates the handoff logistics; never produces or alters the closing figures, which the escrow officer owns.

**`realtor-lender-coordinator`** | keeps the agents and lender in the loop and chases their items. | _trigger:_ an item owed by an agent or lender is open | _reads_ the open third-party items -> _writes_ chase drafts to the agent or lender | PracticeManagement, Email | send draft-for-review | chases logistics; no legal or financial commitment.

### Closing and after

**`closing-scheduler`** | coordinates the signing time, place, and notary. | _trigger:_ the file is ready to schedule | _reads_ party availability, signing requirements -> _writes_ the signing appointment and a confirmation | PracticeManagement, Calendar, Email | scheduling autonomous within rules, confirmation send draft-for-review | scheduling logistics only.

**`signing-confirmation`** | confirms the signing and sends what each party should bring. | _trigger:_ ahead of the signing | _reads_ the signing details, the company's authored bring-list -> _writes_ a confirmation with the bring-list (ID, etc.) | PracticeManagement, Email | send draft-for-review | logistics and the authored bring-list only. **Never includes wire or banking instructions** (see the wire-safety floor).

**`earnest-money-receipt-logger`** | acknowledges receipt of earnest money per the file. | _trigger:_ the file records earnest money received | _reads_ the recorded receipt -> _writes_ an acknowledgment to the depositing party, a file note | PracticeManagement, Email | send draft-for-review | acknowledges what the file records; **never moves, requests, or directs funds.**

**`post-closing-tracker`** | tracks recording and final-policy issuance after closing and notifies. | _trigger:_ after closing | _reads_ recording and policy status -> _writes_ status notes to the parties, a team flag if delayed | PracticeManagement, Email | send draft-for-review | tracks and notifies; **never confirms disbursement and never moves funds.**

**`wire-instruction-safety-router`** | the safety skill: any inbound message touching wire instructions or banking details is routed to a human through the verified process, never acted on. | _trigger:_ an inbound message about wire instructions, account changes, or where to send funds | _reads_ the message -> _writes_ an immediate routing to the verified human process, a holding note that the company will confirm any wire details only through its secure channel | PracticeManagement, InternalComms, Email | route autonomous; **never transmits, confirms, or changes wire instructions** | fail-closed on money: the Operator never sends wire instructions, and it warns the party that wire details are confirmed only through the company's verified process.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill and is the first gate the wire-safety router hooks. **`status-report-assembler`** compiles the digests.

## Connector map (the real closing stack)

| Capability         | Common tools             | Backend                                                 | Used by                           |
| ------------------ | ------------------------ | ------------------------------------------------------- | --------------------------------- |
| PracticeManagement | Qualia, SoftPro, ResWare | `build:qualia` / `build:softpro` / `build:resware`      | every skill (system of record)    |
| Email              | M365, Google             | `mcp:m365-mail` / `build:google-gmail`                  | order, documents, party updates   |
| Calendar           | M365, Google             | `mcp:m365-calendar` / `build:google-calendar`           | signing scheduling                |
| DocumentStorage    | SharePoint, Drive        | `mcp:softeria/ms-365-mcp-server` / `build:google-drive` | commitment and document delivery  |
| InternalComms      | Slack, Teams             | `mcp:slack` / `build:teams`                             | wire-safety routing, team digests |

**Qualia is the pilot title production system** (modern cloud, dominant after absorbing ResWare and RamQuest, documented API); SoftPro and ResWare are the next adapters. No escrow, banking, or disbursement system is connected, by design: the Operator never touches funds. There is no Payments connector in this pack on purpose.

## Compliance floor (authored, not assumed)

Per [ADR 0035](../../adr/0035-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised.

- **No legal or title advice** — connective coordination only. Never an opinion on title, marketability, exceptions, requirements, or the contract. This is the title analog of the law pack's UPL boundary.
- **No fund movement or disbursement** — the Operator never moves, requests, directs, or confirms the disbursement of escrow funds. Funds are the escrow officer's, under the company's controls.
- **Wire-instruction safety (fail-closed)** — the Operator never transmits, confirms, or changes wire instructions. Any message touching wire or banking details routes to the verified human process, and the party is told wire details are confirmed only through the company's secure channel. Seller impersonation and wire fraud are the dominant industry threats; this floor is non-raisable.
- **NPI / GLBA and ALTA Best Practices** — nonpublic personal information stays inside company surfaces, consistent with ALTA Best Practices and GLBA.
- **Reviewer-as-sender floor** — external mail ships under a human reviewer's identity ([ADR 0005](../../adr/0005-reviewer-as-sender.md)).

## Labor-market context (the demand, without presumption)

Title and escrow staffing is high-volume, deadline-driven, and tied to real-estate transaction volume, with experienced processors and closers hard to find and the seat under constant pressure. We do not presume which pressure applies to a given company: some cannot keep the desk staffed, some want to free closers for the funds-and-signing work, some are riding volume swings. Keep dated figures in outreach, not on the evergreen landing page.

## Competitive read (a crowd of vendors is not a closed seat)

Per the corrected lens: **system-features are connection targets; only a true employee-replacer counts; and the seat is closed only when the company stops needing the coordinator.** Title volume still needs the closing desk, so the seat is open.

- **Connection targets (zero threat):** TPS-native AI and tools, Qualia's embedded AI, SoftPro and ResWare features, and the fraud-prevention layer (CertifID and the like, which we route to, not compete with). The systems we connect across.
- **Slice-automators (vendors, not seat-replacers):** point-automation tools (Alanna, Pythonic and similar) integrate into the TPS for order entry, document review, and client updates, the connective slices. None runs the whole closing desk across every party with the wire-safety discipline, configured to the company.

The honest read: a high-volume seat the company still needs, and only slice automation around it. We win on four things, none of which is a single feature (ADR 0035 Tenet 4, the moat is harness + guide + memory):

1. **The connective whole**, opening through recording across every party, not a single automation.
2. **The wire-safety discipline as a feature**, a coordinator that provably never touches funds or wire instructions is safer than a generic bot in the one place that matters most.
3. **Configurability** to the company's workflow, parties, and voice, the substrate, not a fixed product.
4. **Competing with a hire**, priced against a coordinator salary in a deadline-driven, hard-to-staff seat.

## The wedge

> The closing-coordinator seat at title and escrow companies: open the order, chase the payoffs and the HOA and the survey, deliver the commitment, keep every party current at each milestone, coordinate the clear-to-close, schedule and confirm the signing, and track recording after close. Connects to the title production system over its API, runs the connective layer only, and never touches funds or wire instructions. It wins on the connective whole across every party, on a wire-safety discipline that is a feature in the place fraud lives, and on a deadline-driven seat the company still has to staff.

## Base vs. add-on

- **`title` (base):** residential purchase-and-refinance closing coordination. The lowest-friction entry. No add-on in v1; the base covers the file end to end.

## Channel

Title production system ecosystems (Qualia's marketplace and community first). Land title associations (ALTA and state land-title associations). Title and escrow operations consultants, and the industry media (The Title Report, October Research). Real-estate and lender referral relationships that already feed the company's order flow.
