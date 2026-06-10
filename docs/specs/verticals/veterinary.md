---
title: 'Vertical Spec: Veterinary Clinic (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0037-operator-thesis.md, 0005-external-send-identity.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Veterinary Clinic

The brief that drives the veterinary pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0037](../../adr/0037-operator-thesis.md), the Operator competes with a **hire** (the front-desk client coordinator), not with software; the practice information management system is a **connection target, not a competitor**.

The substance is here: the domain read, the personas, the twelve specified skills, and the connector map. The manifest (`operator/verticals/veterinary/vertical.yaml`) declares the identifiers; the runtime skill bodies and the PIMS BUILD adapter are built from this spec in `hermes-smd-overlay`.

> **Where vet sits relative to law and insurance.** On the one axis that varies, integration cost, vet is **in between**: the cloud PIMS (ezyVet, Vetspire, Provet Cloud) expose open APIs, so the pilot needs a `build:` adapter, but on a modern API, lighter than insurance's legacy AMS and heavier than law's ready Clio MCP. On demand, the seat is wide open: front-desk turnover is the worst-staffed role in the dozen (see "Labor-market context"). There is a crowd of "AI vet receptionist" vendors, but they take slices, phone answering and symptom triage, and one of those slices, triage, is veterinary medical judgment we deliberately do not touch. See "Competitive read."

## The clinic front desk's world

A companion-animal clinic runs on systems that do not talk to each other. The client calls, texts, or fills out a form. The patient record lives in the PIMS. The schedule lives in the PIMS or a connected calendar. Reminders, refill requests, lab results, estimates, boarding bookings, and discharge notes all move through the front desk. Diagnostics flow back from the lab into the record.

The connective work is running the front of house: booking the appointment, reminding and confirming it, rebooking the no-show, surfacing the patient overdue for wellness care, relaying the refill request to the doctor, getting the released result to the client, following up on the estimate, coordinating boarding, checking in after a visit, and reconnecting the client who has not been seen in a while. It is the same chain whether the clinic is a single-doctor practice or a four-doctor hospital; the case mix changes, the coordination does not.

That coordination is a real seat, the client service representative or receptionist who runs the front desk while the doctors and technicians work in the back. It is also the hardest seat in the building to keep filled. A clinic covers it with a person, or splits it across a team pulled in every direction. The Operator takes the connective layer so the seat is covered, or the person is freed for the in-clinic work only a person can do. We make no assumption about which it is for a given clinic.

## Personas (the seat, described by role)

- **Client service representative** (`client-service-rep`) at a general practice: the front desk, phones, scheduling, reminders, refill requests, the routine client back-and-forth. The seat the pack fills, and the one with the highest turnover in the building.
- **Practice manager** (`practice-manager`): runs clinic operations. The Operator can cover an open front desk or overflow, or take the routine so the team goes to the in-clinic work that needs a person.
- **Veterinary assistant working front of house** (`assistant-front-of-house`), not a veterinarian or technician: the reason the no-medical-advice and emergency-escalation lines have to be architectural, not a matter of remembering to be careful.

## Skill catalog

Twelve veterinary-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the external-send draft floor unless the engagement authors otherwise.

### New client and scheduling

**`new-client-intake`** | a new-client inquiry becomes a structured client and patient record plus a drafted acknowledgment, with an offer to book. | _trigger:_ inbound inquiry (web form / email / referral) | _reads_ the inquiry, PIMS clients (dedupe), the clinic's services -> _writes_ a draft client and patient, a draft reply, an internal log | PracticeManagement, Email | record draft autonomous, send draft-for-review | no medical advice; if the inquiry describes a possible emergency, hands to the clinic immediately rather than handling it async (see `emergency-escalation-router`).

**`appointment-scheduler`** | offers times, books, confirms, puts it on the schedule. | _trigger:_ a booking request, or after intake | _reads_ provider and room availability, appointment-type duration -> _writes_ the appointment and a confirmation | PracticeManagement, Calendar, Email | booking autonomous within the clinic's rules, confirmation per authored exposure | schedules by the appointment type the clinic defines; never assigns clinical urgency or decides whether a case is an emergency.

**`appointment-reminder-confirmer`** | sends reminders and captures the confirm or reschedule. | _trigger:_ scheduled ahead of appointments | _reads_ upcoming appointments -> _writes_ reminder drafts, applies the confirm or reschedule | PracticeManagement, Email | send per authored exposure for reminders | reminder logistics only.

**`no-show-rebooker`** | follows up on a missed appointment to get it rebooked. | _trigger:_ a no-show or late cancellation | _reads_ the missed appointment -> _writes_ a rebooking outreach draft | PracticeManagement, Email | send draft-for-review | rebooking logistics; makes no judgment about the clinical urgency of rebooking.

### The recall engine (the retention spine)

**`wellness-recall`** | surfaces patients overdue for wellness or vaccines per the clinic's protocol and drafts the reminder. | _trigger:_ scheduled scan | _reads_ PIMS recall and due dates (the clinic's authored protocols) -> _writes_ an overdue list, per-client recall drafts | PracticeManagement, Email | surfacing autonomous, send draft-for-review | surfaces what the clinic's own protocol marks due; never sets the protocol or decides what care a patient medically needs.

### The service desk

**`refill-request-router`** | intakes a prescription-refill request, routes it to the doctor for authorization, confirms back to the client. | _trigger:_ a refill request | _reads_ the patient, the prescription on record -> _writes_ a structured refill request to the doctor or technician, a client acknowledgment, a file note | PracticeManagement, Email | intake and route autonomous, client send draft-for-review, authorization always the doctor | relays the request; never authorizes a refill, never advises on dosing, flags controlled substances for the doctor.

**`results-callback-coordinator`** | once a result is released by the doctor, coordinates getting it to the client. | _trigger:_ a doctor releases a result or marks it ready to share | _reads_ the released result and the doctor's authored note -> _writes_ a callback or notify draft conveying only what the doctor authored | PracticeManagement, Email | send draft-for-review | conveys only the doctor's authored result and instructions; never interprets a result or adds medical commentary.

**`estimate-followup`** | follows up on a treatment estimate the clinic sent. | _trigger:_ an estimate sent and not yet approved | _reads_ the estimate status -> _writes_ a follow-up draft | PracticeManagement, Email | send draft-for-review | approval and payment logistics; no pressure and no medical framing of the consequences of declining.

**`boarding-grooming-coordinator`** | books and confirms boarding or grooming and captures the requirements. | _trigger:_ a boarding or grooming request | _reads_ availability, the patient's vaccine status as recorded -> _writes_ the booking, a requirements checklist draft | PracticeManagement, Calendar, Email | booking autonomous within rules, send draft-for-review | states vaccine status as recorded; never makes a medical clearance decision.

### Proactive and safety

**`post-visit-followup`** | a day-after check-in on the clinic's cadence. | _trigger:_ scheduled after a visit | _reads_ the visit and the doctor's authored discharge note -> _writes_ a check-in draft carrying the discharge summary as authored | PracticeManagement, Email | send draft-for-review | conveys only the doctor's authored discharge content; if the client replies with a medical concern, hands to the clinic rather than advising.

**`lapsed-client-winback`** | surfaces clients not seen in the clinic's window and drafts a reconnect. | _trigger:_ scheduled scan | _reads_ last-visit dates -> _writes_ a list and per-client winback drafts | PracticeManagement, Email | surfacing autonomous, send draft-for-review | reconnect logistics; makes no medical claim about what the patient is due for.

**`emergency-escalation-router`** | the safety skill: detects a possible emergency in any inbound message and hands it to a human at the clinic immediately, never queues it. | _trigger:_ an inbound message that triage flags as possibly urgent | _reads_ the message -> _writes_ an immediate escalation to the clinic's on-call or front-desk channel, plus a holding acknowledgment telling the client to call or come in | PracticeManagement, InternalComms, Email | escalation autonomous and immediate; never an autonomous medical reply | never assesses urgency clinically itself, errs toward escalation, and follows the rule "when in doubt, hand it to a person now." This is fail-open to a human, the one place the pack is deliberately not async.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill, and is the first gate the `emergency-escalation-router` hooks. **`status-report-assembler`** compiles the digests.

## Connector map (the real clinic stack)

| Capability         | Common tools                                | Backend                                                 | Used by                                          |
| ------------------ | ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| PracticeManagement | ezyVet, Vetspire, Provet Cloud, Cornerstone | `build:ezyvet` / `build:vetspire` / `build:provet`      | every skill (system of record)                   |
| Email              | M365, Google                                | `mcp:m365-mail` / `build:google-gmail`                  | intake, reminders, recall, service               |
| Calendar           | M365, Google                                | `mcp:m365-calendar` / `build:google-calendar`           | scheduling, boarding                             |
| DocumentStorage    | SharePoint, Drive                           | `mcp:softeria/ms-365-mcp-server` / `build:google-drive` | discharge notes, records, requirement checklists |
| InternalComms      | Slack, Teams                                | `mcp:slack` / `build:teams`                             | emergency escalation, team digests               |

**The PIMS is a BUILD adapter, but a lighter one than insurance.** No PIMS ships an MCP today, so the pilot needs a `build:` adapter, the same shape as insurance. The difference is the API underneath: the cloud PIMS (ezyVet, Vetspire, Provet) expose modern, documented REST/GraphQL APIs, where the insurance AMS is a legacy platform. **ezyVet** is the likely pilot PIMS for reach (IDEXX flagship, large cloud install base); **Vetspire** is the cleanest API (open GraphQL) if the pilot clinic runs it. The adapter is per-PIMS; the legacy server systems (Cornerstone, AVImark) are the harder tail and come later.

**Phone is out of scope on purpose.** The clinic front desk is phone-heavy, and the AI-vet-receptionist crowd is mostly phone-answering bots. The Operator is the async connective desk, not the phone line. No CallTracking connector in v1, this is a deliberate boundary, not a gap.

## Compliance floor (authored, not assumed)

Per [ADR 0037](../../adr/0037-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised.

- **No veterinary medical advice** — connective front-desk work only. Never a diagnosis, never a treatment recommendation, never an interpretation of a result, never a urgency or triage judgment. The twelve skills are intake, scheduling, reminders, recall, refill relay, result delivery of authored content, estimates, boarding, follow-up, and escalation. This scope discipline is the veterinary analog of the law pack's UPL boundary.
- **Emergency escalation (fail-open to a human)** — a message that may describe an emergency is handed to a person at the clinic immediately, never handled async and never answered with medical content. `emergency-escalation-router` errs toward escalation by design.
- **No prescription authorization** — refill requests route to the doctor for authorization; the Operator never authorizes a refill, sets a dose, or advises on medication, and flags controlled substances for the doctor.
- **External-send draft floor** — external mail ships under a human reviewer's identity, one authored exposure option ([ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)).
- **Records stay in clinic surfaces** — client and patient records stay inside the clinic's systems; the Operator does not exfiltrate them.

## Labor-market context (the demand, without presumption)

Veterinary is one of the two strongest labor hooks in the dozen, and it is concentrated in exactly the seat this pack fills. The front desk is the worst-staffed role in the building: receptionist turnover runs around a third per year, more than half of receptionists leave inside two years, and the role is named as the most burnout-prone, first and last contact with emotional clients, constant phones, and little training. Turnover is expensive (industry analyses put the cost of a single lost staffer in the low tens of thousands for a typical clinic, and the cost of burnout industry-wide in the billions).

We do not presume which pressure applies to a given clinic: some cannot keep the front desk staffed and want it covered, some want to free the team for in-clinic work, some are managing constant churn. Keep dated figures in outreach and channel timing, not on the evergreen landing page, and do not imply pre-knowledge of any clinic's situation.

## Competitive read (a crowd of vendors is not a closed seat)

Per the corrected lens: **system-features are connection targets, not rivals; only a true employee-replacer counts; and the seat is closed only when the clinic stops needing the front desk.** Veterinary has many AI vendors and an unfilled seat at the same time, and the seat is the worst-staffed in the dozen.

- **Connection targets (zero threat):** PIMS-native and bolt-on client comms, IDEXX Vello, Vetspire 2-Way Messaging, PetDesk reminders. Reminders, texting, online booking. Slices inside or beside the PIMS we connect across. They do not run the cross-system connective desk.
- **Slice-automators (vendors, not seat-replacers):** the AI-vet-receptionist space is crowded, and it is mostly two slices. **Phone answering**, 24/7 call coverage, FAQ, book-by-phone (a long list of answering-service vendors). **Symptom triage**, urgency rating and symptom checking (e.g. Petriage). Neither is the full connective coordinator running scheduling, recall, refill relay, results, estimates, boarding, and follow-up across the PIMS, configured to the clinic and in its voice. The connective seat is unfilled twice over: by humans (the clinic cannot keep it staffed) and by competitors (who take slices).

The triage slice is one we **will not** take, on safety grounds: assessing urgency is veterinary medical judgment, and the hybrid services already concede that a human handles emergency symptom assessment. Our `emergency-escalation-router` does the opposite of triage, it routes a possible emergency to a person without judging it. That is both the compliance floor and a clean line between us and the triage vendors.

The honest read: veterinary is a hot market with the most open seat in the dozen. We win on four things, none of which is a single feature (ADR 0037 Tenet 4, the moat is harness + guide + memory):

1. **The connective whole**, the full front desk, not a phone bot or a symptom checker bolted onto one task.
2. **Configurability** to the clinic's own protocols, schedule, services, and voice, the substrate, not a fixed product.
3. **The safety line as a feature**, we route emergencies to a person and never play doctor, which the triage vendors cannot claim.
4. **Competing with a hire**, priced against a front-desk salary the clinic cannot keep filled, not a per-seat software line.

## The wedge

> The front-desk client-coordinator seat at companion-animal clinics: book and confirm the appointment, rebook the no-show, surface the patient due for wellness care, relay the refill to the doctor, deliver the released result, follow the estimate, coordinate boarding, check in after the visit, and route a possible emergency straight to a person. Connects to the clinic's management system over its open API, runs the connective layer only, and stays clear of medical advice, triage, and prescription authorization. It wins on the worst-staffed seat in the dozen, on the connective whole the slice vendors do not cover, and on a safety line, never play doctor, that doubles as the differentiator.

## Base vs. add-on

- **`veterinary` (base):** companion-animal general-practice front desk. The cleanest, highest-turnover seat and the lowest-friction entry.
- **`veterinary/specialty-er` (add-on):** specialty and emergency hospital connective skin, inbound referral intake from referring veterinarians (rDVMs), referral-status updates back to the rDVM, and discharge-summary routing to the rDVM. Additive on the base; the same no-medical-advice and emergency-escalation floors apply, and the referral coordination is connective only.

## Channel

PIMS ecosystems and app marketplaces (ezyVet, Vetspire, Provet partner programs). The Veterinary Hospital Managers Association (VHMA) and practice-manager communities, the buyers closest to the front-desk pain. Veterinary conferences (VMX, WVC, Fetch) and practice-management media (Today's Veterinary Business, dvm360). Buying groups and independent-practice networks. Specialty-ER add-on: referral-hospital networks and specialty associations.
