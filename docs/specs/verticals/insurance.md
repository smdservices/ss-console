---
title: 'Vertical Spec: Insurance Agency (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0035-operator-thesis.md, 0005-reviewer-as-sender.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Insurance Agency

The brief that drives the insurance pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0035](../../adr/0035-operator-thesis.md), the Operator competes with a **hire** (the service/renewal desk), not with software; the agency management system is a **connection target, not a competitor**.

The substance is here: the domain read, the personas, the twelve specified skills, and the connector map. The manifest (`operator/verticals/insurance/vertical.yaml`) declares the identifiers; the runtime skill bodies and the AMS BUILD adapter are built from this spec in `hermes-smd-overlay`.

> **Read this first, it differs from law.** Insurance is the inverse of the law pack on two axes. (1) **Integration is the hard path, not the easy one.** Law rode Clio's MCP and needed no BUILD adapter for its system of record; the insurance system of record is an agency management system (AMS) with no MCP, so the pilot **requires a `build:` adapter** before the first customer onboards. (2) **The market is contested, not open.** The native-AMS AI and a cluster of funded entrants are already in this space. That is evidence of demand, not a reason to avoid it, but it changes the wedge: we do not claim an open seat. See "Competitive read" below.

## The agency service desk's world

An independent property-and-casualty agency runs on systems that do not talk to each other. The inquiry arrives by web form, phone, or referral. The book of business lives in the AMS. Carrier data, renewal downloads, billing status, cancellation and non-renewal notices, dec pages, flows into that AMS through IVANS/AL3 download. Quotes run through a comparative rater. Certificates go out to third parties. Endorsements route to the carrier. Signatures run through e-sign. Documents land in storage.

The connective work is servicing the book: moving a new inquiry to a producer, running the renewal cadence so policies do not lapse, assembling the certificate a client's customer demands, relaying the endorsement request to the carrier and confirming it back, answering the routine billing question, routing the first notice of loss to the carrier, and chasing the cancellation notice before a policy goes away. It is the same chain whether the agency writes personal lines, small commercial, or both; the lines change, the coordination does not.

That coordination is a real seat, the customer service representative or account manager who services the book while the producer sells. An agency covers it with a person, or splits it across people who would rather be writing new business. The Operator takes the connective layer so the seat is covered, or the person is freed for higher-value account work. We make no assumption about which it is for a given agency.

## Personas (the seat, described by role)

- **Account manager / CSR** (`account-manager`) at an independent agency: services a book of policies, renewals, endorsements, certificates, billing questions, the routine client back-and-forth. The seat the pack fills.
- **Service team lead** (`service-team-lead`) at a multi-CSR agency: runs the service team. The Operator can cover an open desk or overflow, or take the routine so the team goes to the account work that needs a person.
- **Producer's assistant** (`producer-assistant`), unlicensed: supports a producer and handles service. The reason the coverage-advice and binding lines have to be architectural, not a matter of remembering to be careful.

## Skill catalog

Twelve insurance-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send sits at the reviewer-as-sender floor ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) unless the engagement authors otherwise.

### New business intake

**`new-business-intake`** | a quote inquiry becomes a structured opportunity plus a drafted acknowledgment, routed to a producer. | _trigger:_ inbound lead (web form / email / referral) | _reads_ the inquiry, AMS contacts (dedupe), the agency's lines and carrier appetite -> _writes_ a draft contact and opportunity, a draft reply, an internal log | PracticeManagement, Email | record draft autonomous, send draft-for-review, quote and bind always a producer | never quotes a premium, never represents coverage or appetite; routes to a licensed producer.

**`quote-info-gatherer`** | gathers the exposure information a quote needs and routes it to the producer or rater. | _trigger:_ after intake, or on producer request | _reads_ the line of business' required fields (drivers, vehicles, property, prior policy) -> _writes_ a structured exposure worksheet, a follow-up draft for missing items | PracticeManagement, Email | gather autonomous, send draft-for-review | collects facts only; no coverage recommendation, no rating, no eligibility judgment.

### The renewal desk

**`renewal-radar`** | surfaces upcoming renewals on the agency's cadence and assembles the worklist. | _trigger:_ scheduled scan (e.g. 60 / 45 / 30 days out, per agency) | _reads_ AMS policy expiration dates and renewal status -> _writes_ a renewal worklist for the team, per-policy flags (rate change, carrier non-renewal) | PracticeManagement | surfacing autonomous | flags what is approaching; the remarket and coverage decisions are the producer's.

**`renewal-review-outreach`** | reaches the client ahead of renewal to confirm details and surface changes. | _trigger:_ a policy enters the renewal window | _reads_ the policy, last-known exposures -> _writes_ an outreach draft asking for changes (new vehicle, address, business change) | PracticeManagement, Email | send draft-for-review | asks for facts; offers no coverage advice or renewal recommendation.

**`remarket-carrier-follow`** | chases the carrier or underwriter for the renewal or remarket answer. | _trigger:_ an open submission past the follow-up cadence | _reads_ submission status as it lands in the AMS or from the producer -> _writes_ a follow-up to the carrier contact, a status note on the file | PracticeManagement, Email | send draft-for-review | logistics only; never negotiates terms or accepts a quote.

### The service desk

**`coi-request-handler`** | intakes a certificate request, assembles it from the system of record, routes for review, delivers. | _trigger:_ a certificate request (email / portal) | _reads_ the policy's coverage as recorded in the AMS, the holder's requirements -> _writes_ a draft certificate assembled from the AMS, a cover note | PracticeManagement, DocumentStorage, Email | assemble autonomous, send draft-for-review (non-raisable) | reflects only coverage on record; never adds coverage, limits, or additional-insured status not already on the policy. A misstated certificate is errors-and-omissions exposure.

**`endorsement-request-router`** | intakes a policy-change request, routes it to the carrier, confirms back to the client. | _trigger:_ a change request (add a vehicle, change an address, add an additional insured) | _reads_ the policy, the requested change -> _writes_ a structured change request to the carrier or producer, a client acknowledgment, a file note | PracticeManagement, Email | intake and route autonomous, client send draft-for-review, the change itself carrier or producer | relays the request; never binds, effects, or confirms a change until the carrier confirms it.

**`policy-document-responder`** | fulfills ID-card, dec-page, and policy-copy requests from the system of record. | _trigger:_ a document request routed by inbox-triage | _reads_ the requested document in the AMS or carrier record -> _writes_ the document and a cover note | PracticeManagement, DocumentStorage, Email | retrieve autonomous, send draft-for-review | sends only documents already on file; no coverage interpretation.

**`billing-status-responder`** | answers routine billing and payment-status questions from the record. | _trigger:_ a billing question routed by inbox-triage | _reads_ direct-bill status as it lands in the AMS via carrier download, or agency-bill status in Payments -> _writes_ a status reply draft | PracticeManagement, Payments, Email | send draft-for-review | reports status only; never advises on payment, reinstatement, or the coverage consequences of non-payment, which route to a producer.

**`fnol-intake-router`** | captures a first notice of loss and hands it to the carrier's claims line; never adjudicates. | _trigger:_ a client reports a loss | _reads_ the loss details, the policy and carrier claims contact -> _writes_ a structured FNOL, the handoff to the carrier claims intake, a client acknowledgment with the claim path | PracticeManagement, Email | capture autonomous, send and carrier handoff draft-for-review | records and routes the notice; never opines on whether the loss is covered or what the client should do.

### Retention and proactive

**`cancellation-notice-chaser`** | on a carrier non-pay or pending-cancellation notice, reaches the client to cure before the policy lapses. | _trigger:_ a cancellation or non-pay notice lands in the AMS via carrier download | _reads_ the notice, the policy, the cure amount and date -> _writes_ an urgent client outreach with the cure path, a file note, a team flag | PracticeManagement, Email | send draft-for-review (time-sensitive; authorable to a tighter exposure per agency) | relays the carrier's notice and cure terms exactly; never states the policy is or is not reinstated.

**`account-rounding-nudge`** | surfaces a monoline client for the producer to round out the account. | _trigger:_ scheduled scan | _reads_ the book for single-line clients (auto without home, and the like) -> _writes_ a flagged list for the producer with the gap noted | PracticeManagement | surfacing autonomous | surfaces the opportunity; the cross-sell conversation and any coverage recommendation are the producer's.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill. **`status-report-assembler`** compiles the digests.

## Connector map (the real independent-agency stack)

| Capability         | Common tools                           | Backend                                                  | Used by                                            |
| ------------------ | -------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| PracticeManagement | EZLynx, HawkSoft, Applied Epic, AMS360 | `build:ezlynx` / `build:hawksoft` / `build:applied-epic` | every skill (system of record; carrier data sink)  |
| Email              | M365, Google                           | `mcp:m365-mail` / `build:google-gmail`                   | intake, service, outreach                          |
| Calendar           | M365, Google                           | `mcp:m365-calendar` / `build:google-calendar`            | renewal cadence                                    |
| DocumentStorage    | SharePoint, Drive                      | `mcp:softeria/ms-365-mcp-server` / `build:google-drive`  | certificates, ID cards, document requests          |
| ESign              | DocuSign, AMS e-sign                   | `build:docusign`                                         | applications, renewal signatures                   |
| Payments           | ePayPolicy (agency-bill)               | `build:epaypolicy`                                       | agency-bill status (direct-bill reads via the AMS) |

**The AMS is load-bearing, and it is a BUILD adapter.** Unlike law (Clio MCP, no BUILD adapter for the system of record), no insurance AMS ships an MCP server. The pilot needs a `build:` adapter for whichever AMS the pilot agency runs. **EZLynx** is the likely pilot AMS: dominant in independent personal lines, a documented API, and it co-locates rating and CRM. The adapter is per-AMS; HawkSoft and Applied Epic each have an API and are the next two. This adapter is the first and largest overlay hand-off, the equivalent of the work law did not have to do.

**Carrier data arrives through the AMS, not through carrier portals.** Renewal downloads, billing status, cancellation and non-renewal notices, and dec pages flow into the AMS via IVANS/AL3 download. The Operator reads them through PracticeManagement; there is no per-carrier portal connector. That is why the AMS adapter is the system of record and the carrier-data sink at once.

**Rating rides the AMS adapter where co-located.** EZLynx is both AMS and rater. The Operator gathers exposure information and routes to the producer; it does not operate the rater or quote autonomously, because quoting and binding are licensed acts. No separate rater capability is modeled in v1.

## Compliance floor (authored, not assumed)

Per [ADR 0035](../../adr/0035-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised.

- **Coverage-advice boundary** — connective service only. Never coverage advice, never a recommended limit or carrier, never an opinion on whether a loss is covered. The twelve skills are intake, renewal logistics, certificates, endorsement relay, document retrieval, billing status, FNOL routing, and retention nudges. This scope discipline is the insurance analog of the law pack's UPL boundary.
- **No binding authority** — the Operator never binds, changes, cancels, or reinstates coverage. Those acts route to a licensed producer or the carrier.
- **Reviewer-as-sender floor** — external mail ships under a human reviewer's identity ([ADR 0005](../../adr/0005-reviewer-as-sender.md)), one authored exposure option ([ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)); the insurance pack pins it **non-raisable for certificates** and any representation of coverage to a third party, because a misstated certificate is direct E&O exposure.
- **Nonpublic personal information** — agencies hold a great deal of NPI (Social Security numbers, dates of birth, license numbers, VINs, property details) under GLBA and, in the states that have adopted it, the NAIC Insurance Data Security Model Law. NPI stays inside the agency's surfaces; the Operator does not exfiltrate it.
- **Licensed-producer routing** — quotes, binding, coverage questions, and claims-coverage questions route to a licensed producer; the Operator handles logistics only.

## Labor-market context (the demand, without presumption)

Insurance is the strongest labor hook of any vertical, and it pulls in both directions at once. The frontline service role is acutely **hard to fill**: the workforce is aging (about a quarter is already 55 or older, and a large share will retire within fifteen years), younger workers enter the field in small numbers, and service and account-management roles are the hardest-hit entry points. At the same time, the sector is under **cost pressure** and has been shedding frontline headcount. Either way, the service work, renewals, certificates, endorsements, billing, FNOL, does not go away.

We do not presume which pressure applies to a given agency: some cannot keep the desk staffed and want it covered, some want to free an existing person for account work, some are cutting and still have to service the book. Keep dated figures in outreach and channel timing, not on the evergreen landing page, and do not imply pre-knowledge of any agency's situation.

## Competitive read (system-features excluded, and the seat is contested)

Per the corrected lens: **system-features are connection targets, not rivals; only true employee-replacers count.** Unlike law, the employee-replacer column here is populated.

- **Connection targets (zero threat):** AMS-native AI, EZLynx Virtual Assistant (account summarization, coverage-gap surfacing), Applied's embedded vertical AI, AI-assisted rating. Features inside the AMS we connect across. They make a CSR faster inside one system; they do not run the cross-system connective desk.
- **Employee-replacers (the real column, and it is occupied):** funded entrants are here. AI quoting agents target the new-business and quoting lane; point-automation vendors do end-to-end endorsement automation (reported handle time of roughly fourteen minutes down to about two, with human approval). The new-business/quoting lane and the single-task endorsement lane are the most contested.

The honest read: insurance is a hot, contested market, and that is evidence of demand and willingness to pay, not a reason to avoid it. It changes the wedge. We do not claim an open seat. We win on four things, none of which is a single feature (ADR 0035 Tenet 4, the moat is harness + guide + memory):

1. **The connective whole**, the full service, renewal, and retention desk, not a single point bot bolted onto one task.
2. **Configurability** to the agency's own book, carriers, cadence, and voice, the substrate, not a fixed product.
3. **The integration barrier itself**, the legacy AMS with no open API is exactly what leaves the long tail of agencies underserved by the native-AMS AI, and the harness that crosses it is the moat.
4. **Competing with a hire**, priced against a service salary, not a per-seat software line.

## The wedge

> The service-and-renewal desk at independent P&C agencies: answer the new-client inquiry and route it to a producer, run the renewal cadence, assemble the certificate, relay the endorsement, answer the billing question, route the first notice of loss, and chase the cancellation notice before a policy lapses. Connects to the agency's management system and reads carrier data as it downloads there, runs the connective layer only, and stays clear of coverage advice and binding. It enters a contested market on the connective whole rather than a single automation, on configurability to the agency's own book, and on an integration barrier, the legacy AMS, that the moat is built to cross.

## Base vs. add-on

- **`insurance` (base):** independent P&C agency service desk, personal-lines lead. The cleanest renewal-and-service desk and the lowest-friction entry.
- **`insurance/commercial` (add-on):** commercial-lines connective skin, high-volume certificate management with holder lists and renewal tracking, additional-insured handling, and premium-audit coordination. Additive on the base; rides the same AMS.

## Channel

Agency networks and aggregators (SIAA, Smart Choice, ISU, Keystone) are the cheapest path to many agencies at once. Independent-agent associations (the Big "I" / IIABA and state affiliates). AMS ecosystems and user communities (EZLynx, HawkSoft, Applied). Agency-management media (Insurance Journal, IA Magazine, Rough Notes) and agency-perpetuation consultants. Commercial add-on: warm intros through commercial-heavy agencies and wholesale brokers.
