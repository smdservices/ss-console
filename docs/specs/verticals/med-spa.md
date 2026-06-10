---
title: 'Vertical Spec: Med Spa (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0037-operator-thesis.md, 0005-external-send-identity.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Med Spa

The brief that drives the med-spa pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0037](../../adr/0037-operator-thesis.md), the Operator competes with a **hire** (the patient coordinator), not with software; the spa-management platform is a **connection target, not a competitor**.

> **Where med spa sits.** Integration is the easy end: the platforms (Boulevard, Zenoti, Mangomint) are modern cloud software with APIs, so a `build:` adapter on a clean API. The seat is open, the category is booming and staffing churns. The AI in the market is native-platform slices (Zenoti's AI Workforce, Boulevard's texting), booking and SMS inside the platform, not the connective whole. The med-spa-specific twist is compliance: treatments are medical, performed under medical direction, so the coordination has hard lines a salon does not.

## The med spa front desk's world

A med spa runs on systems that do not fully talk to each other. The lead comes from an ad, a referral, or a walk-in. Bookings, memberships, packages, and the client record live in the spa-management platform. Financing runs through a third party. Pre- and post-treatment instructions come from the provider. Reviews and referrals drive the next leads.

The connective work is running the patient journey: capturing the lead and booking the consult, confirming and reminding with the deposit and cancellation policy, coordinating the required good-faith medical exam, tracking the membership and package balance, sending the provider's authored pre- and post-care, following up after treatment, coordinating financing, asking for the review, and reactivating the client who lapsed. It is the same chain whether the spa does injectables, laser, or body work; the service menu changes, the coordination does not.

That coordination is a real seat, the patient coordinator or front desk who runs the journey while the providers treat. It is a high-churn seat in a fast-growing category. A spa covers it with a person, or splits it across a busy front desk. The Operator takes the connective layer so the seat is covered, or the person is freed for the in-room and high-touch sales work only a person can do. We make no assumption about which it is for a given spa.

## Personas (the seat, described by role)

- **Patient coordinator** (`patient-coordinator`): the front desk, leads, booking, reminders, memberships, the routine client back-and-forth. The high-churn seat.
- **Membership and sales coordinator** (`membership-coordinator`): packages, memberships, financing, the revenue follow-up. The retention seat.
- **Spa manager** (`spa-manager`): runs operations under the medical director. The reason the no-medical-advice and good-faith-exam lines have to be architectural.

## Skill catalog

Twelve med-spa-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the external-send draft floor unless the engagement authors otherwise.

### Lead and scheduling

**`new-lead-intake`** | a consult inquiry becomes a structured client record plus a drafted acknowledgment, with an offer to book the consult. | _trigger:_ inbound lead (ad / web form / referral) | _reads_ the inquiry, platform clients (dedupe), the spa's services -> _writes_ a draft client, a draft reply, an internal log | PracticeManagement, Email | record draft autonomous, send draft-for-review | no medical advice; an adverse-reaction message routes to a person (see `adverse-event-escalation-router`).

**`consult-scheduler`** | offers times, books, confirms the consult. | _trigger:_ a booking request or after intake | _reads_ provider availability, consult length -> _writes_ the appointment and a confirmation | PracticeManagement, Calendar, Email | booking autonomous within rules, confirmation per authored exposure | books by the service type the spa defines; never recommends a treatment.

**`appointment-reminder-confirmer`** | sends reminders with the deposit and cancellation policy, captures confirm or reschedule. | _trigger:_ scheduled ahead of appointments | _reads_ upcoming appointments, the spa's policy -> _writes_ reminder drafts, applies confirm or reschedule | PracticeManagement, Email | send per authored exposure | reminder and policy logistics only.

**`no-show-rebooker`** | follows up on a missed appointment to rebook. | _trigger:_ a no-show or late cancellation | _reads_ the missed appointment, deposit status -> _writes_ a rebooking outreach draft | PracticeManagement, Email | send draft-for-review | rebooking and deposit logistics.

### The good-faith-exam gate

**`good-faith-exam-scheduler`** | ensures the required medical exam is scheduled before a medical treatment. | _trigger:_ a treatment booking that requires a prior exam | _reads_ whether a valid exam is on record, the requirement -> _writes_ the exam booking or a flag that one is needed | PracticeManagement, Calendar, Email | booking autonomous within rules, flag autonomous | schedules the exam; never substitutes for it, never clears a client for treatment, that is the provider's call.

### Memberships, care, and money

**`membership-package-coordinator`** | tracks membership and package balances and renewals. | _trigger:_ a balance low, a membership due to renew | _reads_ the membership and package records -> _writes_ a balance or renewal draft | PracticeManagement, Email | send draft-for-review | balance and renewal logistics; never pressures or upsells a treatment.

**`pre-post-care-sender`** | sends the provider's authored pre- and post-treatment instructions on the cadence. | _trigger:_ before and after a treatment | _reads_ the booked treatment, the provider's authored care content -> _writes_ a draft carrying the authored instructions | PracticeManagement, Email | send draft-for-review | conveys only the provider's authored instructions; adds no medical content of its own.

**`treatment-followup`** | a post-treatment check-in on the spa's cadence. | _trigger:_ scheduled after a treatment | _reads_ the treatment and any authored aftercare note -> _writes_ a check-in draft | PracticeManagement, Email | send draft-for-review | a check-in only; if the client reports an adverse reaction, escalates rather than advising.

**`financing-coordinator`** | coordinates third-party financing logistics. | _trigger:_ a client pursuing financing | _reads_ the financing step the client is on -> _writes_ a logistics draft (apply here, status, next step) | PracticeManagement, Payments, Email | send draft-for-review | application logistics only; never advises on credit or terms.

### Proactive and safety

**`review-referral-request`** | asks a satisfied client for a review or referral after a visit. | _trigger:_ scheduled after a positive visit | _reads_ the visit -> _writes_ a review or referral ask draft | PracticeManagement, Email | send draft-for-review | reputation logistics; never fabricates a review or incentivizes against platform rules.

**`reactivation-winback`** | surfaces clients not seen in the spa's window and drafts a reconnect. | _trigger:_ scheduled scan | _reads_ last-visit dates -> _writes_ a list and per-client winback drafts | PracticeManagement, Email | surfacing autonomous, send draft-for-review | reconnect logistics; no medical claim.

**`adverse-event-escalation-router`** | detects a possible adverse reaction in any inbound message and hands it to the provider or medical director immediately, never advises. | _trigger:_ an inbound message triage flags as a possible adverse event | _reads_ the message -> _writes_ an immediate escalation to the provider/medical-director channel, plus a holding acknowledgment telling the client to call or seek care | PracticeManagement, InternalComms, Email | escalation autonomous and immediate; never an autonomous medical reply | never assesses the reaction clinically, errs toward escalation, fail-open to a person.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill and is the first gate the adverse-event router hooks. **`status-report-assembler`** compiles the digests.

## Connector map (the real spa stack)

| Capability         | Common tools                 | Backend                                                 | Used by                           |
| ------------------ | ---------------------------- | ------------------------------------------------------- | --------------------------------- |
| PracticeManagement | Boulevard, Zenoti, Mangomint | `build:boulevard` / `build:zenoti` / `build:mangomint`  | every skill (system of record)    |
| Email              | M365, Google                 | `mcp:m365-mail` / `build:google-gmail`                  | leads, reminders, care, retention |
| Calendar           | M365, Google                 | `mcp:m365-calendar` / `build:google-calendar`           | consults, good-faith exam         |
| DocumentStorage    | SharePoint, Drive            | `mcp:softeria/ms-365-mcp-server` / `build:google-drive` | consent forms, care instructions  |
| Payments           | Cherry, PatientFi, processor | `build:med-spa-payments`                                | financing and deposit logistics   |
| InternalComms      | Slack, Teams                 | `mcp:slack` / `build:teams`                             | adverse-event escalation, digests |

**Integration is the easy end.** The spa-management platforms are modern cloud software with documented APIs, so a `build:` adapter on a clean API, lighter than the legacy systems in insurance or dental. **Boulevard** is a likely pilot (strong API, med-spa adoption); Zenoti and Mangomint are the next adapters. Phone is out of scope in v1 (the async connective desk, not the phone line).

## Compliance floor (authored, not assumed)

Per [ADR 0037](../../adr/0037-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised.

- **No medical advice** — connective coordination only. Treatments are medical procedures performed under medical direction. Never a recommendation, never a clinical opinion, never an assessment of a reaction. The twelve skills are leads, scheduling, the exam gate, memberships, authored care delivery, financing, reviews, reactivation, and escalation.
- **Good-faith-exam gate** — the Operator schedules the required medical exam and never substitutes for it or clears a client for treatment; clearance is the provider's.
- **Authored care only** — pre- and post-care convey only the provider's authored instructions; the Operator adds none of its own.
- **Adverse-event escalation (fail-open to a human)** — a possible adverse reaction goes to the provider or medical director immediately, never handled async and never answered with medical content.
- **HIPAA / PHI and external send** — protected health information stays in spa surfaces; external mail ships under a human reviewer's identity ([ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md)).

## Labor-market context (the demand, without presumption)

The med-spa category is one of the fastest-growing in consumer healthcare, and the front-desk and coordinator seat churns with it: high turnover, constant hiring, and a role that blends reception, sales, and care coordination. We do not presume which pressure applies to a given spa: some cannot keep the seat staffed, some want to free the team for in-room and high-touch sales work, some are scaling faster than they can hire. Keep dated figures in outreach, not on the evergreen landing page.

## Competitive read (a crowd of vendors is not a closed seat)

Per the corrected lens: **system-features are connection targets; only a true employee-replacer counts; and the seat is closed only when the spa stops needing the coordinator.** The category is hiring constantly, so the seat is open.

- **Connection targets (zero threat):** platform-native AI and comms, Zenoti's AI Workforce (AI receptionist, SmartBot), Boulevard's texting, Mangomint automations. Booking and SMS slices inside the platform we connect across. They do not run the cross-system patient journey.
- **Slice-automators (vendors, not seat-replacers):** generic AI booking and answering services point at spas, the booking-and-SMS slice. None runs the connective whole, the good-faith-exam gate, memberships and packages, authored pre/post-care, financing, reactivation, and the safety escalation, configured to the spa and in its voice.

The honest read: a fast-growing category with a high-churn seat and only slice automation in the market. We win on four things, none of which is a single feature (ADR 0037 Tenet 4, the moat is harness + guide + memory):

1. **The connective whole**, the full patient journey, not a booking bot.
2. **The compliance gates as features**, the good-faith-exam gate and adverse-event escalation are coordination a generic booking bot cannot safely do.
3. **Configurability** to the spa's menu, memberships, and voice, the substrate, not a fixed product.
4. **Competing with a hire**, priced against a coordinator salary in a high-churn seat.

## The wedge

> The patient-coordinator seat at med spas: capture the lead and book the consult, confirm with the deposit and cancellation policy, make sure the required good-faith exam is scheduled, track memberships and packages, send the provider's authored pre- and post-care, follow up after treatment, coordinate financing, ask for the review, and route a possible adverse reaction straight to the provider. Connects to the spa-management platform over its modern API, runs the connective layer only, and stays clear of medical advice and clearance. It wins on the connective whole the booking bots do not run, on compliance gates that double as features, and on a high-churn seat the category cannot keep filled.

## Base vs. add-on

- **`med-spa` (base):** the patient-coordinator journey for an aesthetics and wellness spa. The lowest-friction entry. No add-on in v1; the base covers the journey end to end.

## Channel

Spa-management platform ecosystems and partner programs (Boulevard, Zenoti, Mangomint). Aesthetics conferences and groups (medical-aesthetics associations, injector and laser training networks, AmSpa). Med-spa consultants and franchise/MSO operators. Aesthetics media and practitioner communities.
