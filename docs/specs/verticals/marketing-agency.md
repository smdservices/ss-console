---
title: 'Vertical Spec: Marketing Agency (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0035-operator-thesis.md, 0005-reviewer-as-sender.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Marketing Agency

The brief that drives the marketing-agency pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0035](../../adr/0035-operator-thesis.md), the Operator competes with a **hire** (the account coordinator and project manager), not with software; the project-management platform is a **connection target, not a competitor**.

> **The lightest-regulated vertical, with one sharp line.** A marketing agency has no UPL, no HIPAA, no SEC. The one hard line is fabrication: the Operator delivers only authored deliverables, authored report metrics, and authored status, never an invented number, claim, or result. Client confidentiality (no cross-client leakage) and no unilateral scope or contract commitment round out the floor.

## The account desk's world

An agency runs client work across systems that do not fully talk: the project-management platform (Asana, Monday, ClickUp) holds projects, tasks, deliverables, and timelines; creative assets live in storage; the client lives in email; invoicing lives in the books. The account coordinators and project managers are the connective tissue between the agency's work and the client's attention.

The connective work is keeping projects and clients moving: onboarding the new client and gathering access and brand inputs, sending deliverable and milestone status, chasing the client assets and approvals that hold work up, routing deliverables for review and chasing sign-off, scheduling check-ins, turning the agency's authored meeting notes into tracked actions, reminding on deadlines, communicating timeline changes, following the unpaid invoice, delivering the authored reports, and coordinating the retainer renewal. It is the same chain whether the agency does brand, performance, or content; the work changes, the coordination does not.

That coordination is a real seat, the account coordinator or project manager who keeps clients and projects moving while the creatives and strategists do the work. It is a high-churn seat in a high-churn industry. An agency covers it with people, or buries an overloaded account team. The Operator takes the connective layer so the seat is covered, or the person is freed for the strategy and relationship work only a person can do. We make no assumption about which it is for a given agency.

## Personas (the seat, described by role)

- **Account coordinator** (`account-coordinator`): status, asset chasing, scheduling, the routine client back-and-forth. The connective seat.
- **Project manager** (`project-manager`): timelines, deliverable routing, deadlines. The delivery seat.
- **Account director** (`account-director`): owns the client relationship and the scope. The reason the no-scope-commitment line has to be architectural.

## Skill catalog

Twelve marketing-agency-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the reviewer-as-sender floor ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) unless the engagement authors otherwise.

### Onboarding and status

**`client-onboarding`** | a new client becomes a structured record plus a drafted kickoff and an access-and-inputs request list. | _trigger:_ a new client or engagement | _reads_ the client, the agency's onboarding template -> _writes_ a draft client record, a draft kickoff with the access/inputs list, an internal log | PracticeManagement, Email | record draft autonomous, send draft-for-review | relays the agency's authored onboarding; never commits scope or deliverables.

**`project-status-updater`** | sends deliverable and milestone status to the client. | _trigger:_ a milestone changes, or on cadence | _reads_ the project status in the PM platform -> _writes_ a status update draft | PracticeManagement, Email | send draft-for-review | reports status from the platform; never invents progress or a result.

**`client-status-responder`** | answers the routine "where's my project" from the platform. | _trigger:_ a status question routed by inbox-triage | _reads_ the project status, next step -> _writes_ a status reply draft | PracticeManagement, Email | send draft-for-review | reports status only; no fabricated metric or claim.

### The asset-and-approval chase (the connective heart)

**`asset-feedback-chaser`** | chases the client assets, inputs, and feedback that hold work up. | _trigger:_ a needed input or feedback open past the cadence | _reads_ the open-item list -> _writes_ per-item chase drafts, updates the list as items land | PracticeManagement, Email | chase send draft-for-review, list update autonomous | chases the items the agency is waiting on; never produces the missing input itself.

**`deliverable-review-router`** | routes a deliverable for client review and chases sign-off. | _trigger:_ a deliverable ready for review | _reads_ the deliverable and the review step -> _writes_ a review request with the authored deliverable, a sign-off chase | PracticeManagement, DocumentStorage, Email | send draft-for-review | routes the authored deliverable; never alters it or approves on the client's behalf.

**`meeting-notes-actionizer`** | turns the agency's authored meeting notes into tracked actions in the PM platform. | _trigger:_ authored meeting notes are filed | _reads_ the authored notes -> _writes_ tracked tasks in the platform, an optional recap draft | PracticeManagement, Email | task creation autonomous, recap send draft-for-review | works only from the agency's authored notes; invents no action or commitment not in them.

### Timelines and money

**`meeting-scheduler`** | offers times, books, confirms the client check-in. | _trigger:_ a meeting needed or requested | _reads_ availability, meeting length -> _writes_ the meeting and a confirmation | PracticeManagement, Calendar, Email | booking autonomous within rules | scheduling logistics only.

**`deadline-milestone-reminder`** | surfaces upcoming deadlines and reminds the internal team and the client of their items. | _trigger:_ scheduled | _reads_ the project deadlines -> _writes_ a reminder digest and per-party reminders | PracticeManagement, Email | surfacing autonomous, send draft-for-review | surfaces the platform's dates; makes no commitment about delivery.

**`timeline-change-communicator`** | when a date moves in the platform, tells the client. | _trigger:_ a timeline change in the PM platform | _reads_ the change -> _writes_ a client communication draft | PracticeManagement, Email | send draft-for-review | relays the authored change; never sets or promises a new date on its own.

**`invoice-payment-followup`** | follows the unpaid invoice. | _trigger:_ an invoice open past the cadence | _reads_ the invoice status -> _writes_ a statement-reminder draft | PracticeManagement, Accounting, Email | send draft-for-review | billing logistics; no pressure.

**`report-deliverer`** | delivers the agency's authored campaign and performance reports on cadence. | _trigger:_ scheduled reporting | _reads_ the agency's authored report -> _writes_ a delivery draft carrying the authored report | PracticeManagement, DocumentStorage, Email | send draft-for-review | delivers authored metrics and analysis only; **never invents, estimates, or adjusts a number or result**.

**`retainer-renewal-coordinator`** | coordinates the retainer renewal. | _trigger:_ the retainer approaching renewal | _reads_ the prior engagement -> _writes_ a renewal outreach draft with the agency's authored terms | PracticeManagement, Email | send draft-for-review | relays the agency's authored renewal terms; never re-scopes or re-prices on its own.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill. **`status-report-assembler`** compiles the digests.

## Connector map (the real agency stack)

| Capability         | Common tools           | Backend                                                 | Used by                           |
| ------------------ | ---------------------- | ------------------------------------------------------- | --------------------------------- |
| PracticeManagement | Asana, Monday, ClickUp | `build:asana` / `build:monday` / `build:clickup`        | every skill (system of record)    |
| Email              | M365, Google           | `mcp:m365-mail` / `build:google-gmail`                  | onboarding, status, chasing       |
| Calendar           | M365, Google           | `mcp:m365-calendar` / `build:google-calendar`           | check-in scheduling               |
| DocumentStorage    | SharePoint, Drive      | `mcp:softeria/ms-365-mcp-server` / `build:google-drive` | deliverables, reports             |
| Accounting         | QuickBooks, Xero       | `build:quickbooks` / `build:xero`                       | invoice / AR status (read-mostly) |

**The project-management platform is the system of record** (Asana, Monday, or ClickUp; all have APIs), and the pilot adapter targets whichever the agency runs. The `Accounting` connector is read-mostly, for invoice and AR status.

## Compliance floor (authored, not assumed)

Per [ADR 0035](../../adr/0035-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised. This is the lightest floor in the dozen, with one sharp line.

- **No fabrication** — the Operator delivers only authored deliverables, authored report metrics, and authored status. It never invents, estimates, or adjusts a number, result, or claim. This is the sharp line, reports and status carry only what the agency authored.
- **Client confidentiality** — no client's information, assets, or results cross into another client's communications.
- **No unilateral scope or commitment** — the Operator relays the agency's authored scope, terms, and timelines; it never commits scope, deliverables, dates, or price on its own.
- **Reviewer-as-sender floor** — external mail ships under a human reviewer's identity ([ADR 0005](../../adr/0005-reviewer-as-sender.md)).

## Labor-market context (the demand, without presumption)

Agency account and project coordination is a high-churn seat in a high-churn industry, and the work is dominated by the status, chasing, and coordination this pack targets. We do not presume which pressure applies to a given agency: some cannot keep coordinators staffed, some want to free the account team for strategy and relationships, some are scaling client load faster than headcount. Keep dated figures in outreach, not on the evergreen landing page.

## Competitive read (a crowd of vendors is not a closed seat)

Per the corrected lens: **system-features are connection targets; only a true employee-replacer counts; and the seat is closed only when the agency stops needing the coordinator.** Clients still need coordinating, so the seat is open.

- **Connection targets (zero threat):** PM-platform-native AI, Asana's AI intake and workflows, Monday's AI, ClickUp Brain. Workflow automation inside the systems we connect across, not a cross-system client-facing coordinator.
- **Slice-automators (vendors, not seat-replacers):** generic AI assistants and PM automations handle task routing and internal workflow, the internal slice. None runs the whole client-facing account-coordination seat, onboarding through renewal, configured to the agency and in its voice, under human review.

The honest read: a high-churn seat the agency still needs, with native AI automating internal workflow rather than running client coordination. We win on four things, none of which is a single feature (ADR 0035 Tenet 4, the moat is harness + guide + memory):

1. **The client-facing whole**, the account-coordination seat, not internal task automation.
2. **The asset-and-approval chase where projects stall**, the client inputs and sign-offs that hold work up.
3. **Configurability** to the agency's process, deliverables, and voice, the substrate, not a fixed product.
4. **Competing with a hire**, priced against a coordinator salary in a high-churn seat.

## The wedge

> The account-coordinator and project-manager seat at marketing agencies: onboard the client and gather inputs, send deliverable and milestone status, chase the client assets and approvals that hold work up, route deliverables for sign-off, schedule check-ins, turn authored notes into tracked actions, remind on deadlines, communicate timeline changes, follow the unpaid invoice, deliver the authored reports, and coordinate the renewal. Connects to the project-management platform over its API, runs the connective layer only, and never fabricates a metric or commits scope. It wins on the client-facing whole the internal-automation tools do not run, on the asset chase where projects stall, and on a high-churn seat the agency still has to staff.

## Base vs. add-on

- **`marketing-agency` (base):** account and project coordination for a brand, performance, or content agency. The lowest-friction entry. No add-on in v1; the base covers the account desk.

## Channel

Project-management platform ecosystems (Asana, Monday, ClickUp marketplaces). Agency networks and masterminds, the agency-operations communities and media. Agency-coaching groups where account-team capacity and churn are openly discussed.
