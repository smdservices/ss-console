---
title: 'Vertical Spec: RIA / Wealth Management (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0035-operator-thesis.md, 0005-reviewer-as-sender.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: RIA / Wealth Management

The brief that drives the RIA pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0035](../../adr/0035-operator-thesis.md), the Operator competes with a **hire** (the client service associate), not with software; the advisor CRM and custodian are **connection targets, not competitors**.

> **Read this first, two warnings.** (1) **This is the most contested vertical in our own lane.** Jump and Zocks have raised $170M+ and are explicitly building "agentic operating systems that orchestrate work across the advisor stack", the same connective layer this pack is. They are notetaker-origin advisor copilots expanding outward; the seat we target is the **client service associate (CSA)**, which the research names directly ("CSAs spend hours chasing signatures, re-entering intake data into the CRM, and tracking document status"). We compete here, eyes open, like dental. (2) **This is the heaviest compliance floor in the dozen**, SEC/state RIA rules, the fiduciary advice line, Reg S-P privacy, SEC books-and-records, the Marketing Rule, and no money movement. The pack is connective-only and fail-closed on advice and on money.

## The client-service desk's world

An RIA runs client service across systems that do not share state: the CRM (the data of record), the custodian (Schwab, Fidelity), the planning tool, the portfolio system, and a document portal. The advisor advises; everyone else keeps the operation running.

The connective work is keeping clients and accounts in order: onboarding the new client and getting the account-opening paperwork in good order at the custodian, chasing the not-in-good-order (NIGO) items, coordinating a client's money-movement _request_ (never executing it), scheduling reviews and assembling the prep packet from the firm's authored materials, reminding clients of required actions the firm tracks, collecting documents, routing account-maintenance paperwork, answering routine status questions, following advisory-fee billing, and coordinating the annual review. It is the same chain whether the firm does financial planning, investment management, or both; the service mix changes, the coordination does not.

That coordination is a real seat, the client service associate who keeps the accounts and paperwork moving while the advisor advises. It is a seat firms struggle to staff and that drowns in signature-chasing and data re-entry. The Operator takes the connective layer so the seat is covered, or the associate is freed for the high-touch client work only a person can do. We make no assumption about which it is for a given firm.

## Personas (the seat, described by role)

- **Client service associate** (`client-service-associate`): onboarding, paperwork, scheduling, document chasing, the routine client back-and-forth. The seat the pack fills.
- **Operations associate** (`operations-associate`): account maintenance, money-movement processing, custodian coordination. The reason the no-money-movement line has to be architectural.
- **Advisor / principal** (`advisor-principal`): owns the advice and the fiduciary relationship. The reason the no-investment-advice line has to be architectural.

## Skill catalog

Twelve RIA-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the reviewer-as-sender floor ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) unless the engagement authors otherwise.

### Onboarding and accounts

**`client-onboarding-paperwork`** | a new client becomes a structured record plus the account-opening packet and a drafted welcome. | _trigger:_ a new client | _reads_ the client, the firm's onboarding and account templates -> _writes_ a draft client record, a draft welcome with the account-opening packet, an internal log | PracticeManagement, ESign, Email | record draft autonomous, send draft-for-review | relays the firm's authored paperwork; never advises on accounts or investments.

**`account-opening-tracker`** | tracks the not-in-good-order items on custodian paperwork and chases them. | _trigger:_ a NIGO item open past the cadence | _reads_ the open-item status -> _writes_ per-item chase drafts, updates the list as items clear | PracticeManagement, Email | chase send draft-for-review, list update autonomous | chases the items the firm or custodian flagged; never decides whether paperwork is in good order.

**`account-maintenance-router`** | routes account-maintenance requests (beneficiary, address, title changes) to the right paperwork. | _trigger:_ a maintenance request | _reads_ the request, the required form -> _writes_ the paperwork relay and a client acknowledgment | PracticeManagement, ESign, Email | relay autonomous, send draft-for-review | relays the paperwork; never makes the change itself or advises on it.

### The money line (request only)

**`money-movement-request-coordinator`** | gathers a client's distribution or transfer _request_ and routes it to operations for execution, never executes it. | _trigger:_ a client requests a distribution or transfer | _reads_ the request details, the account on record -> _writes_ a structured request to operations, a client acknowledgment that the team will process it | PracticeManagement, Email | gather and route autonomous; **never executes a money movement** | the Operator never moves, transfers, or distributes funds; it gathers the request and routes it to the firm's verified human process.

### Reviews, reminders, and documents

**`meeting-scheduler`** | offers times, books, confirms the client review. | _trigger:_ a review needed or requested | _reads_ advisor availability, meeting length -> _writes_ the meeting and a confirmation | PracticeManagement, Calendar, Email | booking autonomous within rules | scheduling logistics only.

**`meeting-prep-assembler`** | assembles the review prep packet from the firm's authored materials. | _trigger:_ ahead of a review | _reads_ the firm's authored agenda and reports for the client -> _writes_ a prep packet draft from those materials | PracticeManagement, DocumentStorage, Email | assemble autonomous, send draft-for-review | assembles authored materials only; adds no analysis, recommendation, or commentary of its own.

**`required-action-reminder`** | surfaces required actions the firm tracks (such as required minimum distributions) and reminds. | _trigger:_ scheduled | _reads_ the required-action dates the firm authored -> _writes_ a reminder digest and client reminders | PracticeManagement, Email | surfacing autonomous, send draft-for-review | surfaces the actions the firm tracks; **never computes an amount or advises on a distribution**, those are the advisor's.

**`document-collector`** | chases client documents the firm is waiting on. | _trigger:_ a requested document open past the cadence | _reads_ the open request list -> _writes_ per-item chase drafts | PracticeManagement, DocumentStorage, Email | send draft-for-review | chases documents; makes no use or judgment of their contents.

### Status, billing, and reviews

**`client-status-responder`** | answers the routine "where's my transfer / paperwork" from the CRM. | _trigger:_ a status question routed by inbox-triage | _reads_ the item status, next step -> _writes_ a status reply draft | PracticeManagement, Email | send draft-for-review | reports status only; no investment or account opinion.

**`billing-fee-followup`** | follows advisory-fee billing logistics. | _trigger:_ a billing item needs follow-up | _reads_ the fee billing status -> _writes_ a logistics draft | PracticeManagement, Email | send draft-for-review | billing logistics; never explains or justifies fee calculations as advice.

**`annual-review-coordinator`** | coordinates the annual review across scheduling and prep. | _trigger:_ the annual review comes due | _reads_ the client's review cadence -> _writes_ scheduling and prep-assembly drafts | PracticeManagement, Calendar, Email | send draft-for-review | coordination only; no advice content.

**`money-movement-safety-router`** | the safety skill: any inbound instruction to move money or change banking details is never executed and is routed to the firm's verified process. | _trigger:_ an inbound message instructing a distribution, transfer, or banking change | _reads_ the message -> _writes_ an immediate routing to the verified process, a holding note that the firm confirms such requests through its secure channel | PracticeManagement, InternalComms, Email | route autonomous; **never executes or confirms a money movement** | fail-closed on money: the Operator never acts on a money-movement instruction; it routes to the firm's verified human process.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill and is the first gate the money-movement safety router hooks. **`status-report-assembler`** compiles the digests.

## Connector map (the real RIA stack)

| Capability         | Common tools              | Backend                                                 | Used by                               |
| ------------------ | ------------------------- | ------------------------------------------------------- | ------------------------------------- |
| PracticeManagement | Wealthbox, Redtail (CRM)  | `build:wealthbox` / `build:redtail`                     | every skill (data of record)          |
| Email              | M365, Google              | `mcp:m365-mail` / `build:google-gmail`                  | onboarding, chasing, status           |
| Calendar           | M365, Google              | `mcp:m365-calendar` / `build:google-calendar`           | review scheduling                     |
| DocumentStorage    | SharePoint, Drive         | `mcp:softeria/ms-365-mcp-server` / `build:google-drive` | paperwork, prep packets               |
| ESign              | DocuSign, platform e-sign | `build:docusign`                                        | account-opening and maintenance forms |
| InternalComms      | Slack, Teams              | `mcp:slack` / `build:teams`                             | money-movement safety routing         |

**The CRM is the data of record** (Wealthbox or Redtail; both have APIs), and the pilot adapter targets whichever the firm runs. **No custodian, banking, or trading system is connected, by design**: the Operator coordinates paperwork and requests; operations executes at the custodian. There is no Payments or trading connector in this pack on purpose.

## Compliance floor (authored, not assumed)

Per [ADR 0035](../../adr/0035-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised. This is the heaviest floor in the dozen.

- **No investment advice or recommendation** — connective coordination only. Never a recommendation, never an opinion on a holding, allocation, market, or product, never a distribution amount. Advice is the investment-adviser representative's fiduciary act. This is the RIA analog of the law pack's UPL boundary, and it is the brightest line.
- **No money movement** — the Operator never moves, transfers, distributes, or trades. It gathers a client's request and routes it to the firm's verified human process for execution.
- **Reg S-P privacy** — client nonpublic personal information stays inside the firm's surfaces; the Operator does not exfiltrate or repurpose it.
- **SEC books-and-records** — client communications are retained and archivable (SEC Rule 204-2). Reviewer-as-sender and the audit log give every external message a reviewer of record and a retained trail.
- **Marketing Rule** — any review or testimonial-adjacent ask complies with the SEC Marketing Rule (Rule 206(4)-1); the Operator does not solicit or relay testimonials outside the firm's compliant process.
- **Reviewer-as-sender floor** — external mail ships under a human reviewer's identity ([ADR 0005](../../adr/0005-reviewer-as-sender.md)).

## Labor-market context (the demand, without presumption)

RIA operations and client-service roles are hard to staff, and the work is dominated by exactly the connective drudgery this pack targets: signature chasing, intake re-entry across the CRM and planning and portfolio systems, and document-status tracking. We do not presume which pressure applies to a given firm: some cannot staff the CSA seat, some want to free associates for client relationships, some are scaling AUM faster than headcount. Keep dated figures in outreach, not on the evergreen landing page.

## Competitive read (contested in our lane, and we say so)

Per the corrected lens: **system-features are connection targets; only a true employee-replacer counts; and the seat is closed only when the firm stops needing the associate.** The firm still needs the CSA seat, so it is open, but this is the most contested vertical for our specific thesis.

- **Connection targets (zero threat):** the CRM and its AI agents (Wealthbox, Redtail), planning and portfolio tools. The systems we connect across.
- **Real competitors, in our lane:** Jump and Zocks ($170M+ raised) began as AI meeting-notetakers and are expanding into "agentic operating systems" that orchestrate across the advisor stack, the connective layer. They are real and well-funded, and we do not pretend otherwise.

The honest wedge: Jump and Zocks are advisor-copilot tools, anchored in the meeting and the advisor's productivity, expanding outward. The Operator is the **client-service-associate seat itself**, a configured employee competing with a hire, doing the onboarding, NIGO chasing, money-movement-request coordination, and document work under the firm's compliance regime, with reviewer-as-sender and a retained audit trail built for SEC books-and-records. We win on four things, none of which is a single feature (ADR 0035 Tenet 4, the moat is harness + guide + memory):

1. **The operations seat, not the advisor's copilot**, the CSA work the research names, not meeting notes expanding outward.
2. **Compliance built into the substrate**, money fail-closed, advice fail-closed, comms retained for books-and-records, in the most regulated vertical in the dozen.
3. **Configurability** to the firm's custodian workflow, paperwork, and voice, the substrate, not a fixed product.
4. **Competing with a hire**, priced against a CSA salary in a hard-to-staff seat.

This is a "proceed with eyes open" vertical: real demand and a real seat, against real funded competition in our exact lane.

## The wedge

> The client-service-associate seat at RIAs: onboard the client and get the account paperwork in good order, chase the NIGO items, coordinate a client's money-movement request without ever executing it, schedule reviews and assemble the prep packet from the firm's authored materials, remind clients of required actions, collect documents, and follow billing. Connects to the advisor CRM over its API, runs the connective layer only, and is fail-closed on investment advice and on money. It wins on the operations seat the funded copilots are not building, on compliance baked into the substrate, and on competing with a hire, against real competition, eyes open.

## Base vs. add-on

- **`ria` (base):** client-service-associate coordination for an independent RIA or wealth-management firm. The lowest-friction entry. No add-on in v1; the base covers the client-service desk.

## Channel

Advisor-CRM and custodian ecosystems (Wealthbox, Redtail; Schwab and Fidelity advisor networks). RIA custody and platform conferences, advisor study groups and networks, and the advisor-tech media (Kitces, WealthTech Today, Citywire RIA). Compliance and operations consultants who serve independent RIAs.
