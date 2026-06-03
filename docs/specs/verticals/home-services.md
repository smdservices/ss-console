---
title: 'Vertical Spec: Home Services (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0035-operator-thesis.md, 0005-reviewer-as-sender.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Home Services

The brief that drives the home-services pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0035](../../adr/0035-operator-thesis.md), the Operator competes with a **hire** (the office CSR and dispatcher), not with software; the field-service management platform is a **connection target, not a competitor**.

> **Two boundaries up front.** (1) **Phone is out of scope on purpose.** The home-services AI market is crowded with phone-answering and AI-receptionist bots, and the FSM platforms have native AI dispatch. The Operator is the **async connective office**, not the phone line, which is exactly where those products sit. (2) **The safety line is the emergency dispatch.** A gas leak, an active flood, no heat in a freeze, an electrical hazard, these are routed to a person immediately and never handled async, and the Operator never diagnoses the problem or commits a price.

## The service office's world

A home-services contractor (HVAC, plumbing, electrical) runs jobs across systems and the field: the FSM platform (ServiceTitan, Housecall Pro, Jobber) holds customers, jobs, the dispatch board, estimates, and invoices; the techs are in the field; the customers want to know when someone is coming. The office CSR and dispatcher are the connective tissue.

The connective work is running the office around the field: intaking the service request and getting it scheduled, confirming and reminding with the arrival window, telling the customer the tech is on the way or running late, following up on the estimate that has not been approved, following the unpaid invoice, coordinating the maintenance membership, recalling customers for seasonal service, asking for the review, scheduling the return visit when a part arrives, and routing an emergency to a person. It is the same chain whether the trade is HVAC, plumbing, or electrical; the work changes, the coordination does not.

That coordination is a real seat, the CSR or dispatcher who keeps customers and jobs moving while the techs do the work. It is a seat contractors fight to staff. A shop covers it with people, or buries an overloaded office. The Operator takes the async connective layer so the seat is covered, or the person is freed for the live calls and field coordination only a person can do. We make no assumption about which it is for a given shop.

## Personas (the seat, described by role)

- **Dispatcher** (`dispatcher`): the board, the techs, the arrival windows, the day's coordination. The operations seat.
- **CSR / office coordinator** (`csr-coordinator`): requests, scheduling, reminders, the routine customer back-and-forth. The connective seat.
- **Office manager** (`office-manager`): estimates, invoices, memberships. The reason the no-pricing-commitment and emergency lines have to be architectural.

## Skill catalog

Twelve home-services-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the reviewer-as-sender floor ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) unless the engagement authors otherwise.

### Intake and scheduling

**`service-request-intake`** | a service request becomes a structured job plus a drafted acknowledgment, with an offer to schedule. | _trigger:_ an inbound request (web / email / text) | _reads_ the request, FSM customers (dedupe), the company's services -> _writes_ a draft job, a draft reply, an internal route | PracticeManagement, Email | job and ack autonomous, send draft-for-review | an emergency (gas, fire, flood, no heat in a freeze, electrical hazard) routes to a person immediately (see `emergency-dispatch-escalation-router`); never diagnoses the problem or quotes a price.

**`job-scheduler`** | offers windows, books, confirms the service visit, async. | _trigger:_ a scheduling request or after intake | _reads_ dispatch availability, job-type duration -> _writes_ the job on the board and a confirmation | PracticeManagement, Calendar, Email | scheduling autonomous within rules, confirmation send draft-for-review | scheduling logistics only; never the diagnosis or the price.

**`appointment-reminder-confirmer`** | sends reminders with the arrival window, captures confirm or reschedule. | _trigger:_ scheduled ahead of the visit | _reads_ upcoming jobs -> _writes_ reminder drafts, applies confirm or reschedule | PracticeManagement, Email | send per authored exposure | reminder and window logistics only.

**`dispatch-status-updater`** | tells the customer the tech is en route or running late. | _trigger:_ a dispatch status change | _reads_ the tech's status from the board -> _writes_ an en-route or delay update | PracticeManagement, Email | send draft-for-review (or authored exposure) | relays the board's status; never states what the tech will find or what it will cost.

### Money and retention

**`estimate-quote-followup`** | follows up on a sent estimate that has not been approved. | _trigger:_ an estimate sent and not approved past the cadence | _reads_ the estimate status -> _writes_ a follow-up draft offering to schedule the work | PracticeManagement, Email | send draft-for-review | scheduling and approval logistics; **never quotes, adjusts, or commits a price**, the estimate is the company's.

**`invoice-payment-followup`** | follows the unpaid invoice. | _trigger:_ an invoice open past the cadence | _reads_ the invoice status -> _writes_ a statement-reminder draft | PracticeManagement, Email | send draft-for-review | billing logistics; no pressure.

**`membership-plan-coordinator`** | coordinates maintenance-membership reminders and renewals. | _trigger:_ a membership benefit due or a renewal approaching | _reads_ the membership record -> _writes_ a benefit or renewal draft | PracticeManagement, Email | send draft-for-review | membership logistics; relays the company's authored plan terms.

**`maintenance-recall`** | surfaces customers due for seasonal maintenance per the company's cadence. | _trigger:_ scheduled scan | _reads_ the service history and the company's recall cadence -> _writes_ an overdue list and per-customer recall drafts | PracticeManagement, Email | surfacing autonomous, send draft-for-review | surfaces what the company's cadence marks due; no diagnostic claim.

**`parts-followup`** | notifies the customer when a special-order part arrives and schedules the return visit. | _trigger:_ a part marked received | _reads_ the part and the related job -> _writes_ a notify-and-schedule draft | PracticeManagement, Calendar, Email | send draft-for-review | logistics only.

### Proactive and safety

**`review-referral-request`** | asks a satisfied customer for a review or referral after a completed job. | _trigger:_ scheduled after a completed job | _reads_ the job -> _writes_ a review or referral ask draft | PracticeManagement, Email | send draft-for-review | reputation logistics; never fabricates a review.

**`reactivation-winback`** | surfaces customers not served in the company's window and drafts a reconnect. | _trigger:_ scheduled scan | _reads_ last-service dates -> _writes_ a list and per-customer winback drafts | PracticeManagement, Email | surfacing autonomous, send draft-for-review | reconnect logistics; no diagnostic claim.

**`emergency-dispatch-escalation-router`** | detects a possible emergency in any inbound message and routes it to a person and the on-call dispatcher immediately. | _trigger:_ an inbound message triage flags as a possible emergency | _reads_ the message -> _writes_ an immediate escalation to the on-call channel and a holding acknowledgment with the emergency path (and 911 for life-safety) | PracticeManagement, InternalComms, Email | escalation autonomous and immediate; never an autonomous diagnosis or quote | never assesses the hazard itself, errs toward escalation, fail-open to a person; gas and life-safety direct to 911.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill and is the first gate the emergency router hooks. **`status-report-assembler`** compiles the digests.

## Connector map (the real shop stack)

| Capability         | Common tools                        | Backend                                                   | Used by                        |
| ------------------ | ----------------------------------- | --------------------------------------------------------- | ------------------------------ |
| PracticeManagement | ServiceTitan, Housecall Pro, Jobber | `build:servicetitan` / `build:housecall` / `build:jobber` | every skill (system of record) |
| Email              | M365, Google                        | `mcp:m365-mail` / `build:google-gmail`                    | intake, reminders, follow-up   |
| Calendar           | M365, Google                        | `mcp:m365-calendar` / `build:google-calendar`             | scheduling, return visits      |
| DocumentStorage    | SharePoint, Drive                   | `mcp:softeria/ms-365-mcp-server` / `build:google-drive`   | estimates, invoices            |
| InternalComms      | Slack, Teams                        | `mcp:slack` / `build:teams`                               | emergency-dispatch escalation  |

**ServiceTitan, Housecall Pro, and Jobber all expose APIs**, so a `build:` adapter on a modern API. The pilot targets whichever the shop runs. **Phone is out of scope on purpose** (that is the AI-receptionist crowd's lane); the Operator is the async office. No CallTracking connector in v1.

## Compliance floor (authored, not assumed)

Per [ADR 0035](../../adr/0035-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised.

- **No diagnosis or pricing commitment** — connective coordination only. The Operator never states what is wrong, what the fix is, or what it will cost as a commitment; the tech diagnoses and the company prices. Estimates and quotes are the company's authored numbers.
- **Emergency-dispatch escalation (fail-open to a human)** — a possible emergency (gas, fire, flood, no heat in a freeze, electrical hazard) routes to a person and the on-call dispatcher immediately, and life-safety issues are pointed to 911. Never handled async, never diagnosed.
- **No payment authority** — the Operator follows up on invoices but never processes a payment.
- **Reviewer-as-sender floor** — external mail ships under a human reviewer's identity ([ADR 0005](../../adr/0005-reviewer-as-sender.md)).

## Labor-market context (the demand, without presumption)

Home-services office staffing, CSRs and dispatchers, is a hard-to-fill, high-turnover seat, and the work is dominated by exactly the async coordination this pack targets. We do not presume which pressure applies to a given shop: some cannot keep the office staffed, some want to free the dispatcher for live coordination, some are scaling crews faster than the office. Keep dated figures in outreach, not on the evergreen landing page.

## Competitive read (a crowd of vendors is not a closed seat)

Per the corrected lens: **system-features are connection targets; only a true employee-replacer counts; and the seat is closed only when the shop stops needing the office.** Jobs still need coordinating, so the seat is open.

- **Connection targets (zero threat):** FSM-native AI, ServiceTitan's Titan Intelligence (Atlas assists CSRs, Dispatch Pro for AI dispatching), Housecall Pro and Jobber features. Powerful, inside the systems we connect across.
- **Slice-automators (vendors, not seat-replacers):** the AI answering and receptionist field for contractors is crowded, and it is the phone-and-booking slice. None runs the whole async office, estimate follow-up, invoicing, memberships, recall, parts, and the emergency routing, configured to the shop. And it is the phone lane the Operator deliberately does not enter.

The honest read: a hard-to-staff seat the shop still needs, with native AI inside the FSM and a crowd of phone bots around it. We win on four things, none of which is a single feature (ADR 0035 Tenet 4, the moat is harness + guide + memory):

1. **The connective whole**, the async office around the field, not a phone bot.
2. **The money and retention work**, estimate follow-up, invoicing, memberships, and recall, where the recoverable revenue is.
3. **Configurability** to the shop's services, cadence, and voice, the substrate, not a fixed product.
4. **Competing with a hire**, priced against an office salary in a high-turnover seat.

## The wedge

> The CSR-and-dispatch office seat at home-services contractors, worked async: intake the request and schedule it, confirm with the arrival window, tell the customer the tech is on the way, follow the unapproved estimate and the unpaid invoice, coordinate memberships and seasonal recall, schedule the return visit when a part arrives, and route an emergency straight to a person. Connects to the FSM platform over its API, runs the async connective layer only, and stays clear of diagnosis, pricing, and the phone line. It wins on the async office the phone bots do not run, on the money and retention work where revenue leaks, and on a hard-to-staff seat the shop still needs.

## Base vs. add-on

- **`home-services` (base):** the async office for an HVAC, plumbing, or electrical contractor. The lowest-friction entry. No add-on in v1; the base covers the office.

## Channel

FSM platform ecosystems and marketplaces (ServiceTitan, Housecall Pro, Jobber). The trade's contractor groups and best-practice networks (Nexstar, Service Nation, ACCA and PHCC chapters), home-services consultants and coaches, and the success groups where office-coordination pain is openly discussed.
