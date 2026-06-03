---
title: 'Vertical Spec: Property Management (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0037-operator-thesis.md, 0005-reviewer-as-sender.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Property Management

The brief that drives the property-management pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0037](../../adr/0037-operator-thesis.md), the Operator competes with a **hire** (the leasing and tenant coordinator), not with software; the property-management platform is a **connection target, not a competitor**.

> **The distinctive floor here is Fair Housing.** Every prospect-facing and resident-facing message is subject to the Fair Housing Act, and HUD has confirmed the FHA applies when AI is used in screening and advertising. The pack enforces it architecturally: consistent criteria applied the same way to everyone, no protected-class inference, no steering, an audit trail, and human escalation for any protected-class-sensitive question. The second floor is the maintenance emergency, a habitability emergency (no heat, flood, gas, fire) is routed to a person immediately, never handled async.

## The property-management desk's world

A property-management company runs the resident and owner lifecycle across systems that do not fully talk: the platform (AppFolio, Buildium, Yardi) holds the units, leases, work orders, and ledgers; listing sites bring prospects; vendors do the work; owners want reporting. The leasing and tenant coordinators are the connective tissue.

The connective work is running that lifecycle and keeping everyone current: fielding the leasing inquiry and qualifying it on consistent criteria, scheduling the tour, coordinating the application and screening, intaking and dispatching maintenance, reminding on rent and working delinquency on the authored process, coordinating lease renewals and move-ins and move-outs, delivering owner reports, coordinating vendors, and answering the routine resident question. It is the same chain whether the portfolio is single-family scattered-site or multifamily; the unit mix changes, the coordination does not.

That coordination is a real seat, the leasing or tenant coordinator who keeps prospects, residents, vendors, and owners moving while the property manager manages. With vacancy and maintenance costs rising, it is a squeezed, high-turnover seat. A company covers it with people, or buries an overloaded coordinator. The Operator takes the connective layer so the seat is covered, or the person is freed for the on-site and relationship work only a person can do. We make no assumption about which it is for a given company.

## Personas (the seat, described by role)

- **Leasing / tenant coordinator** (`leasing-coordinator`): leasing inquiries, tours, applications, the routine resident back-and-forth. The Fair-Housing-sensitive seat.
- **Property manager assistant** (`pm-assistant`): maintenance coordination, renewals, owner updates. The operations seat.
- **Portfolio / regional manager** (`portfolio-manager`): owns the portfolio. The reason the Fair-Housing and habitability-emergency lines have to be architectural.

## Skill catalog

Twelve property-management-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the reviewer-as-sender floor ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) unless the engagement authors otherwise.

### Leasing (Fair-Housing-sensitive)

**`leasing-inquiry-intake`** | a prospect inquiry becomes a structured lead, qualified on the company's consistent published criteria, with an offer to tour. | _trigger:_ an inbound leasing inquiry (listing site / web / email) | _reads_ the inquiry, the unit, the company's authored qualification criteria -> _writes_ a draft lead, a draft reply with the same criteria for everyone, an internal log | PracticeManagement, Email | record draft autonomous, send draft-for-review | applies the same criteria to every prospect; never infers or asks about protected-class status, never steers; a protected-class-sensitive question routes to a person.

**`tour-scheduler`** | offers tour times, books, confirms. | _trigger:_ a tour request | _reads_ availability (self-show or staffed), the unit -> _writes_ the tour and a confirmation | PracticeManagement, Calendar, Email | booking autonomous within rules | scheduling logistics only; same options for everyone.

**`application-status-coordinator`** | coordinates the application and routes it to screening, never decides it. | _trigger:_ an application submitted | _reads_ the application completeness, the screening step -> _writes_ a status acknowledgment, routes to the company's screening process | PracticeManagement, Email | route and status autonomous (send draft-for-review) | coordinates the application; **never makes or communicates the screening decision**, never applies criteria beyond completeness, the decision and any adverse action are the company's.

### Maintenance

**`maintenance-request-intake`** | intakes a maintenance request, creates the work order, routes it, and escalates an emergency. | _trigger:_ a maintenance request | _reads_ the request, the unit and resident -> _writes_ a work order, an acknowledgment, an internal route | PracticeManagement, Email | work-order and ack autonomous, send draft-for-review | a habitability emergency (no heat, flood, gas, fire) routes to a person immediately (see `maintenance-emergency-escalation-router`); never diagnoses the issue.

**`maintenance-dispatch-coordinator`** | coordinates the vendor or tech and confirms with the resident. | _trigger:_ a work order ready to schedule | _reads_ the work order, vendor availability -> _writes_ the scheduling coordination and a resident confirmation | PracticeManagement, Calendar, Email | scheduling autonomous within rules, send draft-for-review | coordination logistics only.

**`maintenance-emergency-escalation-router`** | detects a possible habitability emergency and routes it to a person and the emergency vendor immediately. | _trigger:_ an inbound message triage flags as a possible emergency | _reads_ the message -> _writes_ an immediate escalation to the on-call channel and a holding acknowledgment to the resident with the emergency path | PracticeManagement, InternalComms, Email | escalation autonomous and immediate; never an autonomous fix or diagnosis | never assesses the hazard itself, errs toward escalation, fail-open to a person.

### Residency and owners

**`rent-reminder`** | sends rent-due reminders and works delinquency on the company's authored process. | _trigger:_ rent due or past due | _reads_ the ledger status, the company's authored delinquency steps -> _writes_ a reminder or notice draft per the process | PracticeManagement, Email | send draft-for-review | follows the company's authored process; **never gives legal or eviction advice and never processes a payment**.

**`lease-renewal-coordinator`** | surfaces upcoming lease expirations and coordinates renewals. | _trigger:_ a lease approaching expiration | _reads_ the lease and the company's authored renewal terms -> _writes_ a renewal outreach draft | PracticeManagement, Email | surfacing autonomous, send draft-for-review | relays the company's authored renewal terms; never negotiates or sets terms.

**`move-coordinator`** | coordinates move-in and move-out logistics, inspections, and key handoff. | _trigger:_ a scheduled move-in or move-out | _reads_ the lease dates, inspection and key steps -> _writes_ scheduling and checklist drafts | PracticeManagement, Calendar, Email | scheduling autonomous within rules, send draft-for-review | logistics only; **never makes a security-deposit determination**, which the company authors.

**`owner-report-deliverer`** | delivers the company's authored owner reports and updates on cadence. | _trigger:_ scheduled, or an owner-relevant event | _reads_ the authored report or update -> _writes_ a delivery draft | PracticeManagement, Email | send draft-for-review | delivers authored content only; adds no analysis or commitment.

**`vendor-coordinator`** | coordinates vendors and chases their items (scheduling, certificates of insurance). | _trigger:_ a vendor item open | _reads_ the open vendor items -> _writes_ coordination and chase drafts | PracticeManagement, Email | send draft-for-review | logistics only; no commitment on scope or price.

**`resident-status-responder`** | answers the routine resident question from the platform. | _trigger:_ a status question routed by inbox-triage | _reads_ the item status (repair, deposit, request) -> _writes_ a status reply draft | PracticeManagement, Email | send draft-for-review | reports status only; no legal opinion, no protected-class-sensitive handling.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill and is the first gate the emergency router hooks. **`status-report-assembler`** compiles the digests.

## Connector map (the real PM stack)

| Capability         | Common tools              | Backend                                                 | Used by                          |
| ------------------ | ------------------------- | ------------------------------------------------------- | -------------------------------- |
| PracticeManagement | AppFolio, Buildium, Yardi | `build:appfolio` / `build:buildium` / `build:yardi`     | every skill (system of record)   |
| Email              | M365, Google              | `mcp:m365-mail` / `build:google-gmail`                  | leasing, maintenance, owners     |
| Calendar           | M365, Google              | `mcp:m365-calendar` / `build:google-calendar`           | tours, maintenance, moves        |
| DocumentStorage    | SharePoint, Drive         | `mcp:softeria/ms-365-mcp-server` / `build:google-drive` | leases, reports, checklists      |
| InternalComms      | Slack, Teams              | `mcp:slack` / `build:teams`                             | maintenance-emergency escalation |

**AppFolio is a likely pilot platform** (large install base, API access by tier); Buildium and Yardi are the next adapters. No payment-processing connector is included: the Operator reminds and coordinates but **never processes rent or deposits**.

## Compliance floor (authored, not assumed)

Per [ADR 0037](../../adr/0037-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised.

- **Fair Housing** — every prospect- and resident-facing message applies the company's consistent, published criteria the same way to everyone. The Operator never infers, asks about, or acts on protected-class status, never steers a prospect toward or away from a unit or area, and routes any protected-class-sensitive question to a person. Consistent rules, an audit trail, and human escalation are the architecture HUD's AI guidance calls for.
- **No screening or adverse-action decision** — the Operator coordinates the application and routes it; it never makes or communicates the screening decision or an adverse action, which the company owns.
- **Maintenance-emergency escalation (fail-open to a human)** — a possible habitability emergency goes to a person and the emergency vendor immediately, never handled async and never diagnosed.
- **No legal or eviction advice, no money movement** — the Operator follows the company's authored delinquency process, gives no legal or eviction advice, and never processes rent or deposits.
- **Reviewer-as-sender floor** — external mail ships under a human reviewer's identity ([ADR 0005](../../adr/0005-reviewer-as-sender.md)).

## Labor-market context (the demand, without presumption)

Property-management coordination is a squeezed, high-turnover seat, with vacancy and maintenance costs rising and companies under margin pressure. We do not presume which pressure applies to a given company: some cannot keep the coordinator staffed, some want to free the team for on-site and relationship work, some are scaling scattered-site portfolios faster than they can hire. Keep dated figures in outreach, not on the evergreen landing page.

## Competitive read (a crowd of vendors is not a closed seat)

Per the corrected lens: **system-features are connection targets; only a true employee-replacer counts; and the seat is closed only when the company stops needing the coordinator.** The portfolio still needs the coordinator, so the seat is open.

- **Connection targets (zero threat):** platform-native AI, AppFolio's Realm-X (native generative AI woven into the OS, saving users hours on busywork), Yardi and Buildium features. Powerful, and inside the systems we connect across, not a cross-system coordinator.
- **Slice-automators (vendors, not seat-replacers):** the AI leasing-assistant field (a crowded set of tools) automates the leasing and maintenance-triage slice. None runs the whole resident-and-owner lifecycle with Fair-Housing discipline and habitability escalation, configured to the company.

The honest read: a squeezed seat the company still needs, with native AI inside the platform and slice automation around leasing. We win on four things, none of which is a single feature (ADR 0037 Tenet 4, the moat is harness + guide + memory):

1. **The connective whole**, the full resident-and-owner lifecycle, not the leasing slice.
2. **Fair Housing and habitability as features**, consistent-criteria discipline and emergency escalation are coordination a generic leasing bot cannot safely do.
3. **Configurability** to the company's criteria, process, and voice, the substrate, not a fixed product.
4. **Competing with a hire**, priced against a coordinator salary in a high-turnover seat.

## The wedge

> The leasing-and-tenant-coordinator seat at property-management companies: field and consistently qualify the leasing inquiry, schedule the tour, coordinate the application to screening, intake and dispatch maintenance, remind on rent and work the authored delinquency process, coordinate renewals and moves, deliver owner reports, and route a habitability emergency straight to a person. Connects to the property-management platform over its API, runs the connective layer only, and stays clear of screening decisions, legal advice, and money. It wins on the connective whole the leasing bots do not run, on Fair-Housing and habitability discipline that double as features, and on a squeezed seat the company still has to staff.

## Base vs. add-on

- **`property-management` (base):** residential leasing and tenant coordination for a single-family or multifamily portfolio. The lowest-friction entry. No add-on in v1; the base covers the lifecycle.

## Channel

Property-management platform ecosystems and marketplaces (AppFolio, Buildium, Yardi). The National Association of Residential Property Managers (NARPM) and regional apartment associations. Property-management coaching and mastermind groups, and the single-family-rental operator networks where scattered-site coordination pain is highest.
