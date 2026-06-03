---
title: 'Vertical Spec: Mortgage (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0035-operator-thesis.md, 0005-reviewer-as-sender.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Mortgage

The brief that drives the mortgage pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0035](../../adr/0035-operator-thesis.md), the Operator competes with a **hire** (the loan processor and loan-officer assistant), not with software; the loan origination system is a **connection target, not a competitor**.

> **The thesis, in the industry's own words.** Mortgage-technology analysts describe 2026's direction as "AI orchestration layered on top of existing LOS platforms, not a replacement," and note that the Encompass SDK and APIs let third-party software push data, attach documents, and read loan state, "exactly what an orchestration layer needs." That orchestration seat is the loan processor. The funded AI here is largely in document processing and underwriting-prep (the work); the borrower-coordination and condition-chasing seat is the opening. The safety line, as in title, is wire fraud at closing.

## The loan desk's world

A mortgage shop runs a loan across many parties who do not share a system: the borrower, the real-estate agent, the loan officer, the underwriter, the appraiser, the title company, and the verifiers of income, assets, and employment. The application, conditions, and loan state live in the LOS, often fed by a point-of-sale and document portal.

The connective work is moving the loan from application to closing and keeping every party current: intaking the application, chasing the conditions and stipulations underwriting asks for, collecting income, asset, and employment documents, ordering and tracking the appraisal and title, sending status to the borrower and the agent, watching the key dates, coordinating the closing, and following up after. It is the same chain whether it is a purchase or a refinance; the loan type changes, the coordination does not.

That coordination is a real seat, the loan processor or loan-officer assistant who keeps the file and the parties moving while the loan officer originates and the underwriter decides. It is a cyclical seat, cut in downturns and impossible to fill in booms. A shop covers it with people, or buries the processors it has. The Operator takes the connective layer so the seat is covered, or the processor is freed for the judgment work. We make no assumption about which it is for a given shop.

## Personas (the seat, described by role)

- **Loan processor** (`loan-processor`): chases conditions, collects documents, orders services, keeps the file moving. The connective seat.
- **Loan-officer assistant** (`lo-assistant`): supports the loan officer, status and coordination. The relationship seat.
- **Branch / operations manager** (`branch-manager`): owns the pipeline. The reason the no-lending-advice and wire-safety lines have to be architectural.

## Skill catalog

Twelve mortgage-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the reviewer-as-sender floor ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) unless the engagement authors otherwise.

### Application and conditions

**`application-intake`** | an application becomes a structured file plus a drafted acknowledgment, routed to the loan officer. | _trigger:_ a new application (POS / referral) | _reads_ the application, LOS records (dedupe) -> _writes_ a draft file, a borrower acknowledgment, an internal log | PracticeManagement, Email | record draft autonomous, send draft-for-review, the loan decision always the LO/underwriter | never advises on loan products, rates, or eligibility; routes to a licensed loan officer.

**`condition-stip-chaser`** | chases the conditions and stipulations underwriting asks for. | _trigger:_ a condition open past the cadence | _reads_ the open condition list -> _writes_ per-condition chase drafts to the borrower, updates the list as items land | PracticeManagement, Email | chase send draft-for-review, list update autonomous | chases the items underwriting set; never decides whether a condition is satisfied.

**`doc-collection-tracker`** | collects the income, asset, and employment documents and tracks them into the LOS. | _trigger:_ documents needed or arriving | _reads_ the document checklist, what has arrived -> _writes_ request and reminder drafts, updates the checklist | PracticeManagement, DocumentStorage, Email | request send draft-for-review, checklist update autonomous | collects and tracks; never assesses or interprets a document's contents.

### Services and verifications

**`appraisal-order-tracker`** | orders and tracks the appraisal. | _trigger:_ appraisal needed | _reads_ the order and its status -> _writes_ the order request, status notes, a flag if delayed | PracticeManagement, Email | order and status send draft-for-review | logistics only; never comments on value.

**`title-order-coordinator`** | coordinates with the title company and chases its items. | _trigger:_ title items owed | _reads_ the open title items -> _writes_ coordination and chase drafts to the title company | PracticeManagement, Email | send draft-for-review | logistics only.

**`voe-vod-requester`** | requests verifications of employment and deposit. | _trigger:_ a verification needed | _reads_ the employer or institution info on file -> _writes_ the verification request, logs the response | PracticeManagement, Email | request send draft-for-review | requests and logs; never interprets the result.

### Status, dates, and closing

**`borrower-status-updater`** | answers the routine "where's my loan" from the LOS. | _trigger:_ a status question routed by inbox-triage | _reads_ loan state, next step -> _writes_ a status reply draft | PracticeManagement, Email | send draft-for-review | reports status only; no opinion on approval, rate, or timing certainty.

**`realtor-lo-status-updater`** | keeps the agent and loan officer in the loop. | _trigger:_ a milestone changes | _reads_ loan state, the contact list -> _writes_ per-party status drafts | PracticeManagement, Email | send draft-for-review | reports status; no commitment on terms or close.

**`milestone-reminder`** | surfaces the key dates the file carries. | _trigger:_ scheduled | _reads_ the file's key dates (rate-lock expiration, financing contingency, closing) -> _writes_ a reminder digest and per-party reminders | PracticeManagement, Calendar, Email | surfacing autonomous, send draft-for-review | surfaces the dates the file records; **never advises whether to lock, extend, or act**, those are licensed-LO and borrower decisions.

**`closing-coordination`** | coordinates the clear-to-close and the closing with title and the borrower. | _trigger:_ approaching closing | _reads_ the CTC status, the closing logistics -> _writes_ coordination drafts to title and the borrower | PracticeManagement, Calendar, Email | send draft-for-review | coordinates logistics; never produces or alters figures, and **never communicates wire instructions** (see the wire-safety floor).

**`post-closing-followup`** | follows up after closing. | _trigger:_ scheduled after closing | _reads_ the closed loan, any authored follow-up content -> _writes_ a thank-you / review-ask / first-payment-reminder draft | PracticeManagement, Email | send draft-for-review | relationship logistics; relays only authored servicing details, no advice.

**`wire-instruction-safety-router`** | the safety skill: any inbound message touching wire instructions or banking details routes to a human through the verified process, never acted on. | _trigger:_ an inbound message about wire instructions, account changes, or where to send funds | _reads_ the message -> _writes_ an immediate routing to the verified process, a holding note that wire details are confirmed only through the secure channel | PracticeManagement, InternalComms, Email | route autonomous; **never transmits, confirms, or changes wire instructions** | fail-closed on money, as in title.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill and is the first gate the wire-safety router hooks. **`status-report-assembler`** compiles the digests.

## Connector map (the real loan stack)

| Capability         | Common tools             | Backend                                                 | Used by                              |
| ------------------ | ------------------------ | ------------------------------------------------------- | ------------------------------------ |
| PracticeManagement | Encompass, Floify, Arive | `build:encompass` / `build:floify` / `build:arive`      | every skill (system of record / POS) |
| Email              | M365, Google             | `mcp:m365-mail` / `build:google-gmail`                  | intake, chasing, status              |
| Calendar           | M365, Google             | `mcp:m365-calendar` / `build:google-calendar`           | dates, closing coordination          |
| DocumentStorage    | SharePoint, Drive        | `mcp:softeria/ms-365-mcp-server` / `build:google-drive` | document collection                  |
| InternalComms      | Slack, Teams             | `mcp:slack` / `build:teams`                             | wire-safety routing, team digests    |

**Encompass is the LOS system of record** (ICE; SDK and APIs documented), with Floify (POS and document collection) and Arive (broker all-in-one) as the modern points of integration. The pilot adapter targets whichever the shop runs. No banking or wire system is connected, by design.

## Compliance floor (authored, not assumed)

Per [ADR 0035](../../adr/0035-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised.

- **No lending or mortgage advice** — connective coordination only. Never advises on loan products, rates, whether to lock, or eligibility; never negotiates or commits terms. Advising and negotiating loan terms is licensed loan-officer activity (and implicates RESPA, TILA, and loan-officer-compensation rules). This is the mortgage analog of the law pack's UPL boundary.
- **No credit or underwriting decision** — the Operator never approves, denies, or conditions a loan; the underwriter decides.
- **Wire-instruction safety (fail-closed)** — the Operator never transmits, confirms, or changes wire instructions; any such message routes to the verified human process. Closing wire fraud is a real threat; this floor is non-raisable.
- **NPI / GLBA** — nonpublic personal information stays inside the shop's surfaces.
- **Reviewer-as-sender floor** — external mail ships under a human reviewer's identity ([ADR 0005](../../adr/0005-reviewer-as-sender.md)).

## Labor-market context (the demand, without presumption)

Mortgage operations staffing is cyclical and rate-sensitive: processors and assistants are cut when volume falls and cannot be found fast enough when it rises, so the coordination capacity is chronically mismatched to the pipeline. We do not presume which pressure applies to a given shop: some cannot staff for a refi wave, some want to free processors for judgment work, some are running lean through a slow stretch. Either way the loans still have to be coordinated. Keep dated figures in outreach, not on the evergreen landing page.

## Competitive read (the funded AI is in the work, the seat is open)

Per the corrected lens: **system-features are connection targets; only a true employee-replacer counts; and the seat is closed only when the shop stops needing the processor.** Loans still need coordinating, so the seat is open.

- **Connection targets (zero threat):** LOS and POS features and AI (Encompass, Floify's auto-verification, Arive). The systems we connect across, and the industry frames AI as orchestration on top of them.
- **Employee-replacers, mostly in a different lane:** the funded mortgage AI concentrates on document processing and underwriting-prep, classifying and extracting from documents, the work, not the borrower-coordination seat. The cross-party chasing and status seat is the opening, and the industry literally describes the future as an orchestration layer on the LOS, which is what this pack is.

The honest read: a cyclical seat the shop still needs, with the funded competition aimed at document processing rather than coordination. We win on four things, none of which is a single feature (ADR 0035 Tenet 4, the moat is harness + guide + memory):

1. **The connective whole**, application through closing across every party, not a document classifier.
2. **The condition-chasing where loans stall**, the open-stip follow-up that holds up closings.
3. **Configurability** to the shop's process, investors, and voice, the substrate, not a fixed product.
4. **Competing with a hire**, priced against a processor salary in a seat that swings with the rate cycle.

## The wedge

> The loan-processor and assistant seat at mortgage shops: intake the application, chase the conditions and stips, collect income and asset documents, order and track the appraisal and title, send status to the borrower and the agent, watch the key dates, and coordinate the closing. Connects to the LOS over its API, runs the connective layer only, and stays clear of lending advice and never touches wire instructions. It wins on the connective whole the document-processing AI is not building, on the condition-chasing where loans stall, and on a cyclical seat the shop still has to staff, the orchestration layer the industry already says the LOS needs.

## Base vs. add-on

- **`mortgage` (base):** purchase-and-refinance loan coordination for a broker or lender. The lowest-friction entry. No add-on in v1; the base covers the file end to end.

## Channel

LOS and POS ecosystems (Encompass, Floify, Arive marketplaces and communities). Mortgage broker and lender associations (AIME, MBA and state associations), wholesale-lender account-executive relationships, and the industry media (National Mortgage News, HousingWire, The Mortgage Collaborative). Real-estate-agent referral relationships that already feed the pipeline.
