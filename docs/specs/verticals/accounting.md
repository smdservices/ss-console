---
title: 'Vertical Spec: Accounting Firm (Operator pack)'
date: 2026-06-02
status: draft
captain: Scott Durgan
related-adr: 0022-vertical-pack-architecture.md, 0037-operator-thesis.md, 0005-external-send-identity.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0020-connector-strategy.md
---

# Vertical Spec: Accounting Firm

The brief that drives the accounting pack's manifest, N=0 proof, marketing surface, and delivery SOP, skinned from the worked reference (`law-firm.md`). Per [ADR 0037](../../adr/0037-operator-thesis.md), the Operator competes with a **hire** (the firm administrator and client coordinator), not with software; the practice-management platform is a **connection target, not a competitor**.

> **Where accounting sits, the cleanest open seat in the dozen.** The labor shortage is the most severe of any vertical: the profession has lost 300,000+ accountants since 2020, roughly three-quarters of CPAs are at or near retirement, the pipeline is shrinking, unemployment sits near 1-2%, and firms are turning away clients for lack of capacity. The funded AI here, Basis, Truewind, Zeni, targets the **work** (the AI staff accountant doing close, entries, audit-prep), not the connective admin seat. The connective coordinator seat, onboarding, document chasing, deadlines, e-sign, billing, is open and the firm cannot hire for it either. Research even names the opening: every firm runs four to six disconnected tools, and the glue is a person.

## The firm coordinator's world

An accounting firm runs on systems that do not talk to each other. The client onboards by email and a portal. Work and deadlines live in the practice-management platform (Karbon, Canopy, TaxDome). The books live in QuickBooks or Xero. Engagement letters and e-file authorizations run through e-sign. Documents the client owes the firm (the "prepared-by-client" list) arrive late, in pieces, or not at all.

The connective work is moving the engagement forward and keeping every client current: onboarding the new client and getting the engagement letter signed, sending and collecting the organizer, chasing the documents the firm is waiting on, scheduling the working session, tracking the filing deadline, getting the e-file authorization signed, answering the routine "where's my return" question, tracking who is on extension, following the unpaid invoice, and rolling the client into next year's engagement. It is the same chain whether the firm does tax, bookkeeping, or advisory; the work product changes, the coordination does not.

That coordination is a real seat, the firm administrator or client coordinator who keeps the engagements moving while the accountants do the accounting. In a profession that cannot hire, it is often the seat that does not get filled at all, and the chasing lands on the preparers, who are the scarcest resource in the building. The Operator takes the connective layer so the seat is covered, or the accountants are freed for the work only a credentialed person can do. We make no assumption about which it is for a given firm.

## Personas (the seat, described by role)

- **Firm administrator / client coordinator** (`firm-administrator`): onboarding, document chasing, scheduling, deadlines, billing, the routine client back-and-forth. The seat that often goes unfilled.
- **Staff accountant handling client comms** (`staff-accountant`): does the work and chases the client on top of it. The Operator can take the chasing so that time goes to the engagement.
- **Firm owner / partner** (`firm-partner`): owns the client relationships and the advice. The reason the no-tax-advice line has to be architectural.

## Skill catalog

Twelve accounting-specific skills plus two spine skills reused as-is. Format per skill: **what** | trigger | reads -> writes | connectors | trust posture | guardrail. Trust posture follows [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md); external send follows the engagement's authored `external_send` ceiling (fail-closed when unauthored).

### Onboarding

**`client-onboarding`** | a new-client engagement becomes a structured record plus a drafted welcome, the engagement letter, and the document request list. | _trigger:_ a new engagement | _reads_ the client, the firm's service and engagement templates -> _writes_ a draft client record, a draft welcome with the engagement letter and request list, an internal log | PracticeManagement, ESign, Email | record draft autonomous, send draft-for-review | never advises on a tax position or scope; relays the firm's authored engagement terms.

**`engagement-letter-chaser`** | tracks the unsigned engagement letter and nudges on a cadence. | _trigger:_ sent and unsigned past the cadence | _reads_ e-sign status -> _writes_ a nudge draft, logs on signature | ESign, Email, PracticeManagement | send draft-for-review | never interprets the letter's terms.

**`prior-records-requester`** | requests the books and prior returns from the client or the predecessor firm. | _trigger:_ onboarding needs predecessor records | _reads_ what is needed -> _writes_ the records request to the client or predecessor | PracticeManagement, Email | send draft-for-review | gathers records; makes no use or judgment of their contents.

### Documents and deadlines (the connective heart)

**`organizer-distributor`** | sends the annual tax organizer or questionnaire and collects it back. | _trigger:_ engagement season opens | _reads_ the client list, the firm's organizer -> _writes_ the organizer send and follow-up drafts | PracticeManagement, Email | send draft-for-review | distributes and collects; never fills in or advises on an answer.

**`pbc-document-chaser`** | chases the prepared-by-client documents the firm is waiting on. | _trigger:_ a request list item open past the cadence | _reads_ the open request list, what has arrived -> _writes_ a per-item chase draft, updates the list as items land | PracticeManagement, DocumentStorage, Email | chase autonomous (sends draft-for-review), list update autonomous | chases the documents on the firm's list; never decides whether a document is sufficient.

**`appointment-scheduler`** | offers times, books, confirms the working session. | _trigger:_ a session needed or requested | _reads_ staff availability, session length -> _writes_ the appointment and a confirmation | Calendar, Email, PracticeManagement | booking autonomous within rules | scheduling logistics only.

**`deadline-filing-reminder`** | tracks the filing deadlines the firm has entered and surfaces what is approaching. | _trigger:_ scheduled | _reads_ the engagement's deadline fields (the firm's authored dates) -> _writes_ an approaching-deadline digest and client reminders | PracticeManagement, Calendar, Email | surfacing autonomous, send draft-for-review | tracks the dates the firm authored; never computes a filing requirement or due date itself, which is professional judgment.

**`efile-authorization-chaser`** | tracks the unsigned e-file authorization (e.g. Form 8879) and nudges. | _trigger:_ the return is ready and the authorization is unsigned | _reads_ e-sign status -> _writes_ a nudge draft, logs on signature | ESign, Email, PracticeManagement | send draft-for-review | chases the signature; never advises on the return or its contents.

### Status, billing, and renewal

**`client-status-responder`** | answers the routine "where's my return" from the system of record. | _trigger:_ a status question routed by inbox-triage | _reads_ engagement status, next step -> _writes_ a status reply draft | PracticeManagement, Email | send draft-for-review | reports status only; no tax opinion or prediction.

**`extension-status-tracker`** | tracks which clients are on extension and surfaces them. | _trigger:_ scheduled | _reads_ extension status across engagements -> _writes_ an extension digest and per-client reminders | PracticeManagement, Email | surfacing autonomous, send draft-for-review | tracks and surfaces; makes no judgment about whether to extend.

**`billing-invoice-followup`** | follows the unpaid invoice. | _trigger:_ an invoice open past the cadence | _reads_ the invoice and ledger status -> _writes_ a statement-reminder draft | PracticeManagement, Accounting, Email | send draft-for-review | billing and payment logistics; no pressure.

**`recurring-engagement-renewal`** | rolls the client into next period's engagement. | _trigger:_ the recurring engagement comes due | _reads_ the prior engagement -> _writes_ a re-engagement draft with the new engagement letter | PracticeManagement, ESign, Email | send draft-for-review | relays the firm's authored renewal terms; never re-scopes or re-prices on its own.

### Spine (reused as-is)

**`inbox-triage`** routes inbound to the right skill. **`status-report-assembler`** compiles the digests.

## Connector map (the real firm stack)

| Capability         | Common tools              | Backend                                                 | Used by                                |
| ------------------ | ------------------------- | ------------------------------------------------------- | -------------------------------------- |
| PracticeManagement | Karbon, Canopy, TaxDome   | `build:taxdome` / `build:karbon` / `build:canopy`       | every skill (system of record)         |
| Email              | M365, Google              | `mcp:m365-mail` / `build:google-gmail`                  | onboarding, chasing, status, billing   |
| Calendar           | M365, Google              | `mcp:m365-calendar` / `build:google-calendar`           | working-session scheduling             |
| DocumentStorage    | SharePoint, Drive, portal | `mcp:softeria/ms-365-mcp-server` / `build:google-drive` | document collection (PBC)              |
| ESign              | DocuSign, platform e-sign | `build:docusign`                                        | engagement letters, 8879, renewals     |
| Accounting         | QuickBooks, Xero          | `build:quickbooks` / `build:xero`                       | invoice and billing status (read-only) |

**The practice-management platforms have APIs.** TaxDome, Karbon, and Canopy expose documented APIs, so a `build:` adapter on a modern API, lighter than insurance's legacy AMS. **TaxDome** is a likely pilot (broad small-firm adoption, API). The `Accounting` connector (QuickBooks/Xero) is read-mostly, used for billing and invoice status, not for the books themselves.

## Compliance floor (authored, not assumed)

Per [ADR 0037](../../adr/0037-operator-thesis.md) Tenet 3, no imposed defaults; floors are fail-closed until raised.

- **No tax or accounting advice** — connective coordination only. Never a tax position, never a deduction or treatment, never an interpretation of financials, never a due-date computation. The twelve skills are onboarding, document chasing, scheduling, deadline relay, e-sign chasing, status, billing, and renewal. This is the accounting analog of the law pack's UPL boundary.
- **Taxpayer-information confidentiality (IRC §7216)** — taxpayer information is not disclosed or used beyond preparing the engagement without the consent the law requires. The Operator does not share or repurpose taxpayer data.
- **Deadline relay, never computation** — `deadline-filing-reminder` tracks the dates the firm authored; it never computes a filing requirement or due date, which is professional judgment.
- **Authored send posture** — outside sends follow the engagement's authored `external_send` ceiling, fail-closed when unauthored ([ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md), ADR 0035); `draft_for_review` is the recommended starting posture.
- **Records stay in firm surfaces** — client financial records stay inside the firm's systems; the Operator does not exfiltrate them.

## Labor-market context (the demand, without presumption)

Accounting has the most severe labor shortage in the dozen, and it is structural. The profession has lost hundreds of thousands of accountants since 2020, a large majority of CPAs are at or near retirement, the exam pipeline has shrunk for a decade, professional unemployment sits near historic lows, and firms are turning away work for lack of capacity. The connective admin seat is doubly squeezed: it competes for scarce labor, and when it goes unfilled the chasing falls on the preparers, the scarcest people in the firm. We do not presume which pressure applies to a given firm: some cannot fill the admin seat, some want to free the preparers, some are capping growth on capacity. Keep dated figures in outreach, not on the evergreen landing page.

## Competitive read (the funded AI is in the work, not the seat)

Per the corrected lens: **system-features are connection targets; only a true employee-replacer counts; and the seat is closed only when the firm stops needing the coordinator.** The firm cannot hire the coordinator, so the seat is open.

- **Connection targets (zero threat):** practice-management platform features and portals (Karbon, Canopy, TaxDome automations), QuickBooks and Xero. The systems we connect across.
- **Employee-replacers, but in a different lane:** the funded AI, Basis, Truewind, Zeni, is the **AI staff accountant**, doing the close, the entries, audit-prep, and consolidation. That is the credentialed work, not the connective admin seat. It competes with the preparer, not the coordinator. The coordinator seat, onboarding, PBC chasing, deadlines, e-sign, billing, is not what they are building.

The honest read: the most acute labor shortage in the dozen, and the funded competition is aimed at a different seat. We win on four things, none of which is a single feature (ADR 0037 Tenet 4, the moat is harness + guide + memory):

1. **The connective whole**, the full coordinator seat, onboarding through renewal, not a single automation.
2. **The chasing the firm cannot staff**, PBC document collection and deadline tracking, where the work actually stalls.
3. **Configurability** to the firm's engagement templates, deadlines, and voice, the substrate, not a fixed product.
4. **Competing with a hire**, priced against an admin salary in a profession that cannot fill it.

## The wedge

> The firm-administrator and client-coordinator seat at accounting firms: onboard the client and get the engagement letter signed, send and collect the organizer, chase the prepared-by-client documents, schedule the session, track the filing deadline, get the e-file authorization signed, answer the routine status question, track extensions, follow the unpaid invoice, and roll the client into next year. Connects to the practice-management platform over its API, runs the connective layer only, and stays clear of tax advice and due-date computation. It wins on the most acute labor shortage in the dozen, on the document chasing where engagements actually stall, and on a connective whole the work-focused AI is not building.

## Base vs. add-on

- **`accounting` (base):** the firm-coordinator seat for a tax-and-accounting practice. The lowest-friction entry.
- **`accounting/bookkeeping` (add-on):** monthly client-accounting-services connective skin, month-end close-status updates to the client, recurring report delivery, and relaying the recurring categorization or document questions a monthly engagement generates. Additive on the base; the same no-advice and §7216 floors apply, and the bookkeeping work itself stays with the firm.

## Channel

Practice-management platform ecosystems and communities (TaxDome, Karbon, Canopy). Accounting associations and networks (state CPA societies, AICPA PCPS, accounting-firm peer and mastermind groups). Accounting-firm consultants and coaches, and the practice-management media (Accounting Today, CPA Practice Advisor, the Karbon and TaxDome communities). Bookkeeping add-on: bookkeeping and CAS-focused networks and franchises.
