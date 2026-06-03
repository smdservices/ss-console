---
title: 'Vertical Spec: Dental Practice (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0035-operator-thesis.md, 0005-reviewer-as-sender.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Dental Practice

The brief that drives the dental pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0035](../../adr/0035-operator-thesis.md), the Operator competes with a **hire** (the front-desk and treatment coordinator), not with software; the practice-management system is a **connection target, not a competitor**.

> **Read this first, dental is the most contested vertical in the dozen.** The seat is open by the labor test (42% of practices carry a front-desk vacancy, 45-60 days to fill, structural shortage). But unlike the others, dental has a real, funded, multi-function competitor: Arini (YC-backed, deployed across hundreds of DSOs) answers calls and handles scheduling, insurance verification, and recall with bidirectional integration into Dentrix, Eaglesoft, and Open Dental. That is not a slice, it is a genuine front-desk product. Our honest wedge is the **async connective whole Arini's phone-first product does not run**, treatment-plan follow-up, claims and billing follow-up, reactivation, records, and the cross-system glue, plus a configurable substrate rather than a fixed receptionist. We enter against a real incumbent here, not an open field. See "Competitive read."

## The dental front desk's world

A dental practice runs on systems that do not talk to each other. The patient calls, texts, or fills out a form. The chart, schedule, ledger, and recall list live in the PMS. Claims go to the payer through a clearinghouse and come back. Statements go out. Treatment plans get presented and, often, sit unscheduled.

The connective work is running the front of house and the money behind it: booking and confirming the visit, working the hygiene recall list, verifying the patient's benefits before the visit, chasing the treatment plan the patient accepted but never scheduled, following the claim the payer has not paid, following the patient balance, collecting the new-patient forms, and reactivating the patient who fell off the schedule. It is the same chain whether the practice is a single GP, a group, or a small DSO; the procedure mix changes, the coordination does not.

That coordination is two real seats, the front-desk coordinator who runs scheduling and recall, and the treatment coordinator who presents plans and handles financing and benefits. Both are among the hardest in the practice to keep filled. A practice covers them with people, or splits the work across an overloaded front desk. The Operator takes the connective layer so the seat is covered, or the person is freed for the chairside and patient-facing work only a person can do. We make no assumption about which it is for a given practice.

## Personas (the seat, described by role)

- **Front-desk coordinator** (`front-desk-coordinator`): scheduling, recall, reminders, the routine patient back-and-forth. The seat with the highest turnover in the practice.
- **Treatment coordinator** (`treatment-coordinator`): presents treatment plans, handles benefits and financing, follows the unscheduled plan. The revenue seat.
- **Office manager** (`office-manager`): runs claims, billing, and the books. The reason the no-clinical-advice and benefits-relay lines have to be architectural.

## Skill catalog

Twelve dental-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the reviewer-as-sender floor ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) unless the engagement authors otherwise.

### New patient and scheduling

**`new-patient-intake`** | a new-patient inquiry becomes a structured patient record plus a drafted acknowledgment, with the intake forms and an offer to book. | _trigger:_ inbound inquiry (web form / email / referral) | _reads_ the inquiry, PMS patients (dedupe), the practice's services -> _writes_ a draft patient, a draft reply with forms, an internal log | PracticeManagement, Email | record and forms autonomous, send draft-for-review | no clinical advice; routes a dental emergency to a person (see `emergency-escalation-router`).

**`appointment-scheduler`** | offers times, books, confirms, async (not by phone, that is the competitor's lane). | _trigger:_ a booking request, or after intake | _reads_ provider and operatory availability, appointment-type duration -> _writes_ the appointment and a confirmation | PracticeManagement, Calendar, Email | booking autonomous within rules, confirmation per authored exposure | schedules by the appointment type the practice defines; never assigns clinical urgency.

**`appointment-reminder-confirmer`** | sends reminders, captures confirm or reschedule, works the ASAP/short-call list. | _trigger:_ scheduled ahead of appointments, or an opening | _reads_ upcoming appointments, the ASAP list -> _writes_ reminder and fill drafts, applies confirm or reschedule | PracticeManagement, Email | send per authored exposure | reminder and fill logistics only.

**`no-show-rebooker`** | follows up on a missed appointment to rebook. | _trigger:_ a no-show or late cancellation | _reads_ the missed appointment -> _writes_ a rebooking outreach draft | PracticeManagement, Email | send draft-for-review | rebooking logistics; no clinical judgment.

### The recall engine (the retention spine)

**`recare-recall`** | surfaces patients overdue for hygiene or recall per the practice's interval and drafts the reminder. | _trigger:_ scheduled scan | _reads_ PMS recall and due dates (the practice's intervals) -> _writes_ an overdue list, per-patient recall drafts | PracticeManagement, Email | surfacing autonomous, send draft-for-review | surfaces what the practice's own interval marks due; never sets the interval or decides what care a patient needs.

### Benefits, treatment, and money

**`insurance-verification-relay`** | gathers and relays the patient's benefits as the payer or clearinghouse returns them, before the visit. | _trigger:_ ahead of an appointment, or on request | _reads_ the patient's plan and the returned eligibility -> _writes_ a structured benefits summary for the team, a patient note if authored | PracticeManagement, Email | gather and summarize autonomous, patient-facing send draft-for-review | relays benefits as the payer states them; never guarantees coverage, never quotes an out-of-pocket number as a promise.

**`treatment-plan-followup`** | follows up on a presented but unscheduled treatment plan. | _trigger:_ a plan presented and not scheduled past the cadence | _reads_ the plan status -> _writes_ a follow-up draft offering to schedule | PracticeManagement, Email | send draft-for-review | scheduling and logistics; never recommends or upsells a procedure, never frames the clinical need.

**`claims-status-followup`** | follows the submitted insurance claim the payer has not paid. | _trigger:_ a claim open past the cadence | _reads_ claim status -> _writes_ a follow-up to the payer or a team flag | PracticeManagement, Email | send draft-for-review | relays and chases status; never adjudicates a claim or disputes a clinical code.

**`patient-billing-followup`** | follows the patient balance or statement. | _trigger:_ a balance open past the cadence | _reads_ the ledger balance -> _writes_ a statement-reminder draft | PracticeManagement, Payments, Email | send draft-for-review | balance and payment logistics; no pressure, no clinical framing.

### Records and proactive

**`forms-and-records-collector`** | collects intake forms and requests records or radiographs from a prior office. | _trigger:_ a new patient or a records need | _reads_ what is missing -> _writes_ the forms request and the prior-office records request | PracticeManagement, DocumentStorage, Email | request autonomous, send draft-for-review | gathers documents; makes no clinical use of them.

**`reactivation-winback`** | surfaces patients with no visit in the practice's window and drafts a reconnect. | _trigger:_ scheduled scan | _reads_ last-visit dates -> _writes_ a list and per-patient winback drafts | PracticeManagement, Email | surfacing autonomous, send draft-for-review | reconnect logistics; no clinical claim about what is due.

**`emergency-escalation-router`** | detects a possible dental emergency in any inbound message and hands it to a person immediately, never triages. | _trigger:_ an inbound message triage flags as possibly urgent | _reads_ the message -> _writes_ an immediate escalation to the team, plus a holding acknowledgment telling the patient to call or come in | PracticeManagement, InternalComms, Email | escalation autonomous and immediate; never an autonomous clinical reply | never assesses urgency clinically, errs toward escalation, fail-open to a person.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill and is the first gate the emergency router hooks. **`status-report-assembler`** compiles the digests.

## Connector map (the real practice stack)

| Capability         | Common tools                              | Backend                                                   | Used by                            |
| ------------------ | ----------------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| PracticeManagement | Open Dental, Dentrix, Eaglesoft, Denticon | `build:open-dental` / `build:dentrix` / `build:eaglesoft` | every skill (system of record)     |
| Email              | M365, Google                              | `mcp:m365-mail` / `build:google-gmail`                    | intake, recall, treatment, billing |
| Calendar           | M365, Google                              | `mcp:m365-calendar` / `build:google-calendar`             | scheduling                         |
| DocumentStorage    | SharePoint, Drive                         | `mcp:softeria/ms-365-mcp-server` / `build:google-drive`   | forms, records                     |
| Payments           | clearinghouse / processor                 | `build:dental-payments`                                   | patient billing follow-up          |
| InternalComms      | Slack, Teams                              | `mcp:slack` / `build:teams`                               | emergency escalation, team digests |

**Open Dental is the pilot PMS for a clean reason: it has a documented open API.** Dentrix and Eaglesoft are the legacy server tail (Arini integrates them too, so it is doable, but harder). The pilot rides Open Dental's API; `build:open-dental` is the first overlay hand-off. **Phone is out of scope on purpose**, that is exactly where Arini is strong; the Operator is the async connective desk, not the phone line. No CallTracking connector in v1.

## Compliance floor (authored, not assumed)

Per [ADR 0035](../../adr/0035-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised.

- **No clinical advice** — connective front-desk and coordination work only. Never a diagnosis, never a treatment recommendation, never a clinical interpretation, never a urgency judgment. The twelve skills are intake, scheduling, recall, benefits relay, plan follow-up, claims and billing, records, and escalation. This is the dental analog of the law pack's UPL boundary.
- **Benefits relay, never a coverage guarantee** — `insurance-verification-relay` relays what the payer returns; it never guarantees coverage or states a patient's out-of-pocket as a promise.
- **Emergency escalation (fail-open to a human)** — a possible dental emergency goes to a person immediately, never handled async and never answered with clinical content.
- **HIPAA / PHI** — protected health information stays inside the practice's surfaces; the Operator does not exfiltrate it.
- **Reviewer-as-sender floor** — external mail ships under a human reviewer's identity ([ADR 0005](../../adr/0005-reviewer-as-sender.md)), one authored exposure option ([ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)).

## Labor-market context (the demand, without presumption)

Dental front-desk staffing is a structural shortage, not a cycle. A large share of practices carry an open front-desk or administrative seat, vacancies take roughly two months to fill, applicant volume is down sharply from pre-pandemic, and administrative turnover runs high. The seat competes for the same labor pool as medical, veterinary, and corporate reception, often at lower pay. We do not presume which pressure applies to a given practice: some cannot fill the seat, some want to free the team for chairside work, some are managing churn. Keep dated figures in outreach, not on the evergreen landing page.

## Competitive read (a real incumbent, and an honest wedge)

Per the corrected lens: **system-features are connection targets; only a true employee-replacer counts; and the seat is closed only when the practice stops needing the front desk.** The practice still cannot hire the seat, so by the labor test it is open. But dental is the one vertical where a funded competitor genuinely covers a large part of it, and we say that plainly.

- **Connection targets (zero threat):** PMS-native and bolt-on patient comms (Weave, Dental Intelligence, NexHealth reminders). Clinical AI in a different lane entirely (Pearl, Overjet read radiographs, that is not the front desk). Slices and adjacent products.
- **The real competitor:** Arini (YC-backed, hundreds of DSO deployments) is a phone-first AI receptionist that also schedules, verifies insurance, and runs recall, with bidirectional PMS integration. This is a genuine front-desk product, not a slice. The phone-answering category around it (a long list of voice vendors) is crowded.

The honest wedge: Arini owns the phone and the live-call slice of the seat. The Operator runs the **async connective whole that a phone receptionist does not**, the treatment-plan follow-up that recovers unscheduled production, the claims and patient-billing follow-up, reactivation, forms and records, and the cross-system glue, configured to the practice's protocols and voice, under human review. We win on four things, none of which is a single feature (ADR 0035 Tenet 4, the moat is harness + guide + memory):

1. **The async connective whole**, the back-of-front-desk a voice receptionist does not run.
2. **The money work**, unscheduled treatment, unpaid claims, and patient balances, where the recoverable dollars are.
3. **Configurability** to the practice's protocols, recall intervals, and voice, the substrate, not a fixed receptionist.
4. **Competing with a hire**, priced against a coordinator salary the practice cannot keep filled.

This is a "proceed with eyes open" vertical: the demand is real and the seat is unfilled, but we compete here, we do not walk into an empty room.

## The wedge

> The front-desk and treatment-coordinator seats at dental practices, worked async: book and confirm the visit, run the hygiene recall, verify benefits before the visit, chase the accepted-but-unscheduled treatment plan, follow the unpaid claim and the patient balance, collect forms and records, and route a dental emergency straight to a person. Connects to the PMS over its open API, runs the connective layer only, and stays clear of clinical advice and coverage guarantees. It wins on the async connective whole a phone-first competitor does not run, on the money work where the dollars are, and on configurability, against a real incumbent rather than an empty field.

## Base vs. add-on

- **`dental` (base):** general-practice front-desk and treatment coordination. The lowest-friction entry.
- **`dental/ortho` (add-on):** orthodontic connective skin, longer treatment arcs, contract and payment-plan coordination, appliance and adjustment recall, and retention-check reminders. Additive on the base; the same no-clinical-advice and emergency floors apply.

## Channel

PMS ecosystems and developer programs (Open Dental's open API community first). Dental practice-management consultants and coaching groups, DSO and group-practice operators, dental study clubs, dental practice-management media (Dental Economics, Dentistry IQ, Becker's Dental). State and local dental societies. Ortho add-on: orthodontic-specific consultants and study groups.
