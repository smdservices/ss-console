# Business Analyst Contribution - PRD Review Round 1

**Author:** BA Agent  
**Date:** 2026-05-19  
**Scope:** MVP / Phase 1 only (platform PRD §20 Phase 1 + law-firm PRD §17 Phase 1)  
**Source documents reviewed:** `platform-prd.md` (v0, 2026-05-19), `law-firm-prd.md` (v0, 2026-05-19), `CLAUDE.md`

---

## Overview

This document provides user stories, acceptance criteria, business rules, edge cases, and a traceability matrix for the AI Employee MVP (Phase 1). It covers: the 6 universal primitives, the 4 v1 cross-cutting skills, the v1 PI overlay skills, the 7 v1 dashboard tabs, the beta-1 Day-1/Week-1/Week-4 partner experience, the calibration session split, the memory edit/delete flows, and the audit log export. Open questions (OQ-XXX) flag ambiguities that require Captain resolution before implementation.

---

## MVP User Stories

### Universal Primitive Skills

---

#### US-001: intake-and-conflict — Intake a New Prospect

**Persona:** Designated Operator (paralegal / intake coordinator)  
**Narrative:** As a Designated Operator, I want the agent to capture structured intake from a new prospect and run a conflict check, so that I can open a matter quickly without manually searching for conflicts or duplicating data entry.

**Acceptance Criteria:**
- [ ] Given an inbound intake event (form submission, call-log entry, or email flagged as new prospect), when the agent processes it, then a structured intake record is created containing: prospect name, contact info, matter type, incident date (if applicable), referred-by, and configurable vertical-specific fields
- [ ] Given a new intake record, when the agent runs the conflict check, then it searches the configured PracticeManagement connector for existing matters and contacts matching the prospect name and all named adverse parties, returning a result within 60 seconds
- [ ] Given a conflict-check result with one or more potential matches, when the agent surfaces results, then each match includes: matter name, matter number, match confidence level, and the matched field (name, phone, email, adverse party)
- [ ] Given a clean conflict check (no matches), when the agent produces output, then a draft engagement letter is queued for partner review with the configured jurisdictional clauses already inserted
- [ ] Given a conflict-check result with any potential matches, when the result is surfaced, then the output is `draft_for_review` regardless of trust-ceiling setting and the partner is the required reviewer
- [ ] Given an incomplete intake (missing required fields per the customer's configured field set), when the agent processes it, then the missing fields render as explicit TBD markers — no plausible defaults are inferred or fabricated
- [ ] Given any intake involving PA or UT clients (jurisdiction detected from address or matter location), when the engagement letter is drafted, then the per-state AI-disclosure clause is automatically inserted by the `law-engagement-letter-jurisdictional` skill
- [ ] Given a conflict check that cannot complete (PracticeManagement connector unavailable), when the connector fails, then the skill surfaces an explicit "Conflict check incomplete — system unavailable" flag and does NOT proceed to matter creation or engagement letter drafting

**Business Rules:** BR-001, BR-003, BR-009, BR-013  
**Out of scope (MVP):** Autonomous matter creation without human approval; legal opinion on intake viability; valuation of the matter; conflict-check write-back to PM system without human approval

---

#### US-002: intake-and-conflict — Conflict Check False-Negative Prevention

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want the conflict check to err heavily on the side of over-flagging, so that the firm never inadvertently opens a conflicted matter.

**Acceptance Criteria:**
- [ ] Given a conflict check result, when confidence falls below the configured threshold, then the result is surfaced as a potential conflict (not cleared), regardless of match quality
- [ ] Given a new matter where the adverse party name is partially matched (phonetic similarity, common name variants), when the agent surfaces the result, then the match is flagged for human review and not auto-cleared
- [ ] Given a conflict-check false-negative rate metric tracked over time, when false negatives are detected (a cleared matter later reveals a real conflict), then the event is logged in the audit trail as a kill-criterion-level event and Captain is alerted
- [ ] Given the configured conflict-check parties list in `customer.yaml`, when a party appears in the intake that matches any party in the block list, then the result is always flagged — no exception path available without human override

**Business Rules:** BR-001, BR-002  
**Out of scope (MVP):** Automatic disqualification logic; integration with state bar conflict-check databases

---

#### US-003: document-collection — Open and Track a Document Checklist

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want the agent to open a document checklist for a matter and nudge sources for outstanding items, so that I don't have to manually track what's arrived and chase each provider individually.

**Acceptance Criteria:**
- [ ] Given a matter opened in the PracticeManagement connector, when the agent activates document-collection for that matter type, then a checklist is created with the configured document types for that matter type (sourced from `customer.yaml`, not fabricated)
- [ ] Given an open checklist item, when the configured nudge cadence passes without receipt, then a draft reminder is queued for Operator review — not sent autonomously
- [ ] Given a document received via email or DocumentStorage connector, when the agent identifies it as matching an open checklist item (by filename pattern, sender domain, or subject-line match), then the checklist item is marked received and the match is surfaced in the dashboard queue for Operator confirmation
- [ ] Given an auto-receipt match, when the Operator rejects the match (wrong document), then the checklist item reverts to open and the incorrect match is logged in the audit trail
- [ ] Given a reminder draft queued for review, when the Operator approves and sends it, then the audit trail records: checklist item, draft version, reviewer identity, send timestamp
- [ ] Given a matter-type with no configured document checklist in `customer.yaml`, when the skill activates for that matter type, then it surfaces "No checklist configured for this matter type — configure in Skills tab" and does not generate a default checklist from inference

**Business Rules:** BR-003, BR-010  
**Out of scope (MVP):** Autonomous document receipt without human confirmation; document content parsing or extraction; medical-records retrieval API integration (portal-automation only per law-firm PRD §7.3)

---

#### US-004: deadline-docketer — Track and Surface a Critical Deadline

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want the agent to track deadlines and surface approaching ones with configured lead times, so that no SOL, court date, or agency response window is missed.

**Acceptance Criteria:**
- [ ] Given a matter with a configured deadline rule source (LawToolBox or custom), when a triggering event occurs (matter opened, hearing set, discovery served), then the relevant deadline(s) are calculated and entered in the deadline tracker with date, type, matter number, and configured lead times
- [ ] Given a tracked deadline, when the lead time threshold is reached (configurable per deadline type in `customer.yaml`), then an escalation notification is drafted and queued for Operator review — not sent autonomously
- [ ] Given a deadline that passes without resolution, when the escalation threshold is exceeded, then the deadline is promoted to the `red_flag_recipients` list defined in `customer.yaml` — not a default list
- [ ] Given a statute of limitations deadline in any PI matter, when the deadline is within the configured emergency lead time, then the event is treated as P0 and surfaced immediately in the Today view regardless of normal cadence
- [ ] Given a court-connected deadline (hearing date, discovery deadline), when the agent surfaces the event, then the output is flagged for partner review via the `law-court-context-detector` skill — not paralegal-only routing
- [ ] Given a deadline calculation that returns an ambiguous result (jurisdiction-specific rule with multiple interpretations), when the skill cannot determine the authoritative date, then it surfaces the ambiguity with both interpretations and requires human resolution — no default date is chosen

**Business Rules:** BR-004, BR-011  
**Out of scope (MVP):** Autonomous court filing assembly; integration with court e-filing systems (Tyler Odyssey, InfoTrack); automatic calendaring in the court's docket system

---

#### US-005: status-update-generator — Draft a Periodic Status Update

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want the agent to draft periodic status updates to the firm's clients, so that routine "where are we" communications are ready to review and send without manual authoring.

**Acceptance Criteria:**
- [ ] Given a matter with configured status-update cadence, when the cadence interval passes, then a draft status update is generated and queued for reviewer approval
- [ ] Given a status update draft, when the agent generates it, then all variable fields (timeline references, deliverable descriptions, dollar amounts, named persons) are sourced exclusively from the matter record in the PracticeManagement connector — no fields are inferred or fabricated
- [ ] Given a matter record with missing required fields (no recent activity logged, no status entered), when the agent generates the draft, then the variable field renders as "[TBD — update required]" and not as plausible status copy
- [ ] Given a draft approved and sent by the reviewer, when the agent learns from the edit, then the diff between the draft and the sent version is captured as a voice-correction signal in R2
- [ ] Given a status update drafted for a client in a PA or UT jurisdiction, when the skill activates, then the draft does NOT include AI-authorship disclosure (the engagement letter covers it; no in-communication disclosure required per ABA FO 512 unless the customer has configured otherwise)
- [ ] Given a draft that the reviewer deletes without sending, when the rejection signal is detected, then the queue item is closed and an optional dashboard prompt is surfaced asking the reason (skippable, never blocking)

**Business Rules:** BR-003, BR-006, BR-009  
**Out of scope (MVP):** Sending status updates autonomously; generating status updates for matters with no PM connector data; automated client sentiment scoring

---

#### US-006: signing-coordinator — Chase an Outstanding E-Sign Envelope

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want the agent to monitor outstanding DocuSign envelopes and draft reminders when they stall, so that I'm not manually tracking every signing loop.

**Acceptance Criteria:**
- [ ] Given a DocuSign (or PandaDoc) envelope sent and not returned within the configured wait period, when the stall threshold is reached, then a draft reminder is queued for Operator review — not sent autonomously
- [ ] Given a stalled envelope with multiple signatories, when the reminder is drafted, then the draft addresses only the non-signing party — not all signatories — and the non-signing identity is sourced from the envelope's signer list, not inferred
- [ ] Given a returned envelope (all parties signed), when the ESign connector event fires, then the checklist item (if connected to document-collection) is marked complete and the event is logged in the audit trail
- [ ] Given a stalled engagement letter (sent for signing but no return), when the stall threshold is reached, then the escalation goes to the partner and the paralegal — not client-only notification
- [ ] Given an envelope that the Operator has manually archived (matter resolved without signing), when the Operator archives it, then the reminder loop terminates and the final status is recorded in the audit trail
- [ ] Given a reminder draft, when it is generated, then the draft uses the customer's configured `signing-coordinator` tone descriptor — not the platform default

**Business Rules:** BR-003, BR-007  
**Out of scope (MVP):** Autonomous resend of e-sign envelopes without reviewer approval; creation of new signing envelopes without reviewer approval; wet-signature (non-electronic) tracking

---

#### US-007: billing-reconciliation — Draft a Time-Entry and Invoice

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want the agent to reconcile time entries and draft invoices for review, so that billing work product is ready to send without starting from zero each billing cycle.

**Acceptance Criteria:**
- [ ] Given time entries logged in the PracticeManagement connector for a matter in the billing cycle, when the configured billing cycle closes, then the agent reconciles the entries and produces a draft invoice for partner review
- [ ] Given a draft invoice, when it is generated, then the billed amounts, time entries, and matter references all trace directly to the PracticeManagement connector records — no amounts are calculated or inferred outside the connector's data
- [ ] Given a contingency-fee matter, when the agent activates billing-reconciliation for that matter, then the skill produces an expense reconciliation only (no time-entry billing) and flags the matter as contingency
- [ ] Given an accounts-receivable chase (invoice sent, unpaid past due), when the configured AR aging threshold is reached, then a draft payment-follow-up is queued for Operator review
- [ ] Given a trust account (IOLTA) balance query, when the agent reads trust balance data from the PracticeManagement or Accounting connector, then the read is logged in the audit trail and the data is surfaced read-only — no write action is taken against the trust account under any circumstances, including autonomous trust ceiling
- [ ] Given a draft invoice that the reviewer edits before approving, when the edit is substantive (line-item changes, amount corrections), then the audit trail records both the original draft and the final approved version
- [ ] Given a matter with no time entries in the billing period, when the skill activates, then no draft is generated and the queue entry shows "No billable activity — confirm or skip"

**Business Rules:** BR-001, BR-005, BR-008, BR-009  
**Out of scope (MVP):** Autonomous invoice sending; autonomous trust account transfers or disbursements; tax calculation or 1099 prep; LawPay autonomous charge execution

---

### Cross-Cutting Universal Skills (v1 set)

---

#### US-008: inbox-triage-and-draft — Triage Inbound Email and Queue Draft Reply

**Persona:** Designated Operator (primary); Principal (secondary — reviews drafts)  
**Narrative:** As a Designated Operator, I want the agent to watch the configured inboxes, categorize inbound emails, and queue draft replies for review, so that the morning inbox is pre-processed before I or the partner start work.

**Acceptance Criteria:**
- [ ] Given an inbound email arriving in a configured watched folder, when the agent processes it, then it categorizes the email by action class (new matter inquiry, existing-matter status request, signing-related, billing-related, internal-ops, no-action-required) using the configured categorization rubric
- [ ] Given an email in a folder listed in `email_folders_blind`, when the agent encounters it, then it does not read, process, or draft against the email — the scope boundary is respected
- [ ] Given an email with a subject-line matching an entry in `email_keyword_blocks`, when the agent encounters it, then it skips the email, logs the skip in the audit trail, and does not surface the email's content in any view
- [ ] Given an email from a sender in a `domain_blocks` entry, when the agent encounters it, then it skips the email and logs the skip — no draft is queued
- [ ] Given an inbound email classified as requiring a reply, when the draft is generated, then the reply is in the reviewer's voice (using configured voice rules + anchor samples) and routes to the reviewer's drafts folder — not to the sent folder
- [ ] Given a draft reply in the reviewer's drafts folder, when the reviewer edits it before sending, then the diff is captured and queued as a voice-correction signal for the memory-curator skill
- [ ] Given an email that the agent cannot classify with ≥configured confidence threshold, when classification fails, then the email is surfaced in the Queue tab with an explicit "needs human classification" label — no default classification is assumed
- [ ] Given the `inbox-triage-and-draft` skill running against a monitored inbox, when sent-folder watching is opted out (default), then the agent does NOT access the reviewer's Sent folder

**Business Rules:** BR-006, BR-007, BR-009, BR-010  
**Out of scope (MVP):** Autonomous email sending; processing emails to/from `domain_blocks`; scraping non-inbox folders; classifying email attachments as documents for document-collection (that requires separate skill invocation)

---

#### US-009: morning-digest — Deliver the 8am Daily Brief

**Persona:** Principal (primary reader)  
**Narrative:** As a Principal, I want to receive an 8am daily digest summarizing what the agent will work on today and what requires my attention, so that I can plan my day in under 60 seconds from my phone.

**Acceptance Criteria:**
- [ ] Given a configured 8am digest schedule in `customer.yaml`, when the daily run fires, then the digest email is in the principal's inbox by 8am local time
- [ ] Given the digest email, when it is generated, then it contains: (a) count of drafts pending review, (b) count of flagged items, (c) upcoming deadlines within 48 hours, (d) any red-flag events surfaced since yesterday's digest — and nothing else
- [ ] Given zero pending items of a category, when the digest is generated, then that category is omitted rather than shown as "0 items"
- [ ] Given a digest that references a specific matter or draft, when the item appears, then the matter number and a link to the dashboard queue item are included — no matter content is included in the email body
- [ ] Given the digest email format, when it is rendered, then the entire email body requires ≤60 seconds to read (target: 5 items max in each category, with "and N more" if over; single-sentence items only)
- [ ] Given the `morning-digest` skill, when it fires outside business hours (configured in `customer.yaml`), then it does not fire early — the digest respects the configured timezone and business-hour window

**Business Rules:** BR-003, BR-009  
**Out of scope (MVP):** Digest sent via SMS or Slack; digest with embedded draft content; digest with AI-generated narrative summaries of matter status

---

#### US-010: memory-curator — Surface and Absorb Learning Signals

**Persona:** Designated Operator (primary; manages corrections); Principal (secondary; receives weekly summary)  
**Narrative:** As a Designated Operator, I want the agent to surface what it learned from my edits this week and update its behavior accordingly, so that the agent improves and I can verify the learning is correct.

**Acceptance Criteria:**
- [ ] Given a reviewer edit of a queued draft (edit-then-send signal), when the diff is captured, then the memory-curator skill classifies the delta as: voice-correction, content-rule, or process-update — not as undifferentiated "correction"
- [ ] Given a classified correction, when the correction is applied to memory, then the memory entry records: source (edit-then-send / direct-teach / rejection), timestamp, actor, and what changed
- [ ] Given a weekly memory-curator digest, when it is generated, then it presents distilled corrections in human-readable form ("Based on 12 of your edits last week, Marcus updated voice on closing salutations") — not raw diffs
- [ ] Given the weekly digest, when it contains changes that affected hard rules (not voice-only), then each hard-rule change is presented with a one-click confirm or revert action — changes are not silently applied without operator visibility
- [ ] Given a rejection signal (draft archived without send), when the optional follow-up prompt is surfaced ("I noticed you didn't send this — was it off, or no longer needed?"), then the prompt is skippable in one action and never blocks queue review
- [ ] Given a direct-teach action (Operator adds a rule in the Memory tab), when the rule is saved, then it takes effect immediately for subsequent drafts and the change is logged with the actor's identity

**Business Rules:** BR-009, BR-010, BR-012  
**Out of scope (MVP):** Automatic voice model retraining without operator visibility; bulk correction import from historical sent folder without explicit opt-in; cross-customer correction sharing

---

#### US-011: compliance-audit-export — Export a Compliance Evidence Packet

**Persona:** Captain (primary — initiates); Compliance / Ethics Counsel (recipient)  
**Narrative:** As a Captain or Compliance Counsel, I want to generate a compliance evidence packet on demand, so that I can respond to a bar inquiry, client question, or internal ethics review within 60 seconds.

**Acceptance Criteria:**
- [ ] Given a request to generate a compliance evidence packet (from the Audit tab or via Captain control-plane), when the request is made, then the packet is available for download within 60 seconds
- [ ] Given a compliance evidence packet, when it is generated, then it contains: (a) full audit log for the requested period, (b) safety-substrate version and invariant list, (c) DPA reference (document name, version, execution date), (d) per-state engagement-letter clause citations for the customer's active client jurisdictions, (e) model lineage (Claude version, Hermes runtime SHA)
- [ ] Given the audit log in the packet, when it is exported, then every agent action is included — reads, draft generations, rejections, memory updates, trust-ceiling changes — with actor, timestamp, and action type
- [ ] Given a compliance packet export, when it is generated, then the download is logged in the audit trail with: requester identity, timestamp, and period covered
- [ ] Given a compliance packet request for a period outside the current retention window, when the request is made, then the system returns "Data not available: outside retention period" rather than a partial or silent empty export
- [ ] Given the law-firm vertical context, when the compliance packet is generated, then it includes: citation-refusal substrate version, invariant 6 test fixture count, and last invariant 6 regression run result

**Business Rules:** BR-011, BR-013  
**Out of scope (MVP):** Real-time compliance monitoring dashboard; HIPAA-specific packet format; automated periodic compliance packet delivery

---

### PI Overlay Skills

---

#### US-012: pi-intake-triage — Classify and Score a PI Intake

**Persona:** Designated Operator (intake coordinator)  
**Narrative:** As an intake coordinator, I want the agent to classify a new PI intake by case type, severity band, jurisdiction, and fit against firm criteria, so that I can route or decline the intake quickly without applying the same judgment manually each time.

**Acceptance Criteria:**
- [ ] Given a new PI intake record (from Lawmatics, Lead Docket, CallRail, or email), when the agent processes it, then it outputs: (a) case-type classification (auto-accident / slip-and-fall / premises-liability / product-liability / medmal), (b) severity band (not dollar value), (c) jurisdiction (state / county), (d) fit-against-firm-criteria result (pass / flag / reject) per the customer's configured criteria
- [ ] Given a firm criterion configured in `customer.yaml` ("we don't take medmal under $1M"), when an intake triggers that criterion, then the fit result is "reject" and the configured rejection reason is included in the output
- [ ] Given an ambiguous intake (could classify as two or more case types), when the agent cannot resolve the classification with ≥configured confidence, then it surfaces both classifications with confidence levels and requires human selection — no default classification is chosen
- [ ] Given a fit-against-firm-criteria result of "reject," when the output is produced, then a draft turn-down letter is queued for partner review — not sent autonomously, even when the rejection criterion is unambiguous
- [ ] Given a pi-intake-triage output, when the severity field is populated, then it contains a configurable severity band (e.g., "high," "medium," "low") — not a dollar value, not a case-value estimate, and not language that implies the agent has assessed the matter's worth
- [ ] Given an intake with no incident date, when the agent processes it, then the SOL tracking is flagged as "incident date required — SOL cannot be calculated" and the matter is not opened without human entry of the date

**Business Rules:** BR-001, BR-002, BR-009, BR-015  
**Out of scope (MVP):** Case-value assessment; settlement-value prediction; legal advice to the prospective client during intake; autonomous matter creation from triage output

---

#### US-013: pi-demand-letter-evidence-packet — Assemble the Evidence Packet

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want the agent to assemble the structured evidence inputs a partner needs to write a demand letter, so that the partner can focus on drafting legal argument rather than organizing the underlying materials.

**Acceptance Criteria:**
- [ ] Given a PI matter at the demand-ready stage, when the partner or operator triggers the evidence-packet skill, then the output contains: (a) medical chronology spreadsheet, (b) billing tabulation by provider, (c) lost-wages spreadsheet with documentation references, (d) exhibit list with index, (e) photo and document inventory, (f) blank narrative-impact template with labeled sections for partner authorship
- [ ] Given any output field in the evidence packet, when it is generated, then the value is sourced from the matter record, uploaded documents, or the PracticeManagement connector — not inferred or fabricated
- [ ] Given an evidence packet with missing source documents (medical records not yet received), when the packet is generated, then the missing items render as "[Records outstanding — checklist item open]" with a link to the open checklist item — not as "no records" or with estimated values
- [ ] Given the narrative-impact template in the packet, when it is generated, then it contains section headers and prompts only (e.g., "Partner: describe impact on daily activities here") — no pre-filled characterizations, no narrative language authored by the agent
- [ ] Given the evidence packet output, when it is reviewed in the dashboard queue, then the partner is the required reviewer (not operator-only), because the packet is the direct precursor to legal work product
- [ ] Given an evidence packet generation event, when it completes, then the audit trail records: matter number, source documents accessed, output artifact hash, requester identity, timestamp

**Business Rules:** BR-001, BR-005, BR-009, BR-015, BR-016  
**Out of scope (MVP):** Authoring demand letter text of any kind; valuing the matter; producing legal argument; resolving ambiguities in medical records through clinical interpretation

---

#### US-014: pi-lien-tracker — Open and Monitor a Lien

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want the agent to track liens per matter and surface them at settlement stage, so that the firm doesn't miss a lien before disbursing funds.

**Acceptance Criteria:**
- [ ] Given a matter with configured lien-tracking, when a lien is identified (via document receipt, operator entry, or intake record), then the lien is recorded with: lien type (medical / ERISA / MSP / Medicaid / WC / attorney / child support), holder name, amount (if known), and status (open / in-resolution / resolved)
- [ ] Given a matter approaching the settlement stage (status flag in the PM connector), when the agent generates the settlement pre-disbursement checklist, then all open liens are surfaced with an explicit "Must resolve before disbursement" flag — never auto-resolved
- [ ] Given an IOLTA or trust-account disbursement event in the PM or Accounting connector, when the agent detects it, then it flags the event for partner review if any liens are still open on the matter — the agent never blocks disbursement autonomously, but it surfaces the risk
- [ ] Given a lien with a Medicare Secondary Payer (MSP) reporting obligation, when the matter settles, then the MSP reporting flag is surfaced in the pre-disbursement checklist — the agent does not submit the MSP report, but it ensures the obligation is not missed
- [ ] Given a lien marked "resolved" by the operator, when the resolution is recorded, then the resolution document (if uploaded) is linked to the lien record in the audit trail

**Business Rules:** BR-005, BR-008, BR-015  
**Out of scope (MVP):** Autonomous lien resolution; negotiations with lien holders; IOLTA trust-account write operations; MSP report submission

---

#### US-015: pi-settlement-statement-assembler — Draft the Client Settlement Statement

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want the agent to draft the client settlement statement once settlement terms are entered, so that the partner can review and sign rather than building the statement manually.

**Acceptance Criteria:**
- [ ] Given a settled PI matter with gross settlement amount entered in the PM connector, when the skill activates, then it produces a draft client settlement statement containing: gross settlement, attorney fee (computed from configured fee structure), expenses (from expense ledger), lien payoffs (from pi-lien-tracker), and net to client
- [ ] Given any dollar amount in the settlement statement, when the draft is generated, then every amount traces to an explicit source (PM connector fee structure, expense ledger entry, lien record) — no amounts are estimated or inferred
- [ ] Given an open lien on the matter, when the settlement statement is generated, then the lien payoff line reads "[Open — amount TBD]" and the net-to-client line reads "[Cannot compute — open liens remain]" — a net-to-client figure is never computed or displayed with outstanding liens
- [ ] Given the draft settlement statement, when it is queued, then the partner is the required reviewer — not operator-only
- [ ] Given a fee structure that is contingency-based, when the fee is calculated, then the percentage is sourced from the engagement letter's configured fee field — not from a platform default

**Business Rules:** BR-005, BR-008, BR-009, BR-015  
**Out of scope (MVP):** Settlement negotiation assistance; recommending settlement amounts; computing tax implications; autonomous client disbursement

---

### Dashboard Flows

---

#### US-016: Today Tab — Principal Views Daily Summary

**Persona:** Principal  
**Narrative:** As a Principal, I want a Today view that gives me the day's operational status at a glance, so that my daily engagement with the dashboard is ≤60 seconds.

**Acceptance Criteria:**
- [ ] Given the Today tab, when the Principal opens it, then the headline summary displays: drafts pending review (count), items flagged (count), corrections absorbed this week (count), and approval rate (rolling 7-day)
- [ ] Given the headline summary, when zero items are pending in a category, then that count is omitted (not shown as "0")
- [ ] Given drafts pending review in the Today view, when the Principal taps any item, then they navigate directly to the draft in the Queue tab
- [ ] Given the Today tab, when it is displayed, then no raw AI reasoning, prompt content, source document text, or connector response data is rendered — summary counts and action items only
- [ ] Given the "this week" headline, when it is generated, then the four elements are: volume (N drafts), trust (N/total approval rate), attention (N flagged), and learning (N edits absorbed) — exactly these four, in this order, with no "hours saved" estimate until 60+ days of customer data exist

**Business Rules:** BR-009, BR-012  
**Out of scope (MVP):** Trend charts; per-skill breakdown; client-by-client status; revenue or billing summaries

---

#### US-017: Queue Tab — Operator Reviews and Approves Drafts

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want a sortable queue of all pending drafts, so that I can work through the day's review load systematically without anything falling through.

**Acceptance Criteria:**
- [ ] Given the Queue tab, when the Operator opens it, then all pending drafts are listed with: skill name, matter number (if applicable), age (time since draft was generated), priority (configured per skill), and required reviewer role
- [ ] Given a pending draft, when the Operator opens it, then the full draft is displayed with the source context (what inbound email or event triggered the draft) and any agent-surfaced flags
- [ ] Given a draft with an explicit "requires partner review" flag (e.g., conflict-check result, court-bound draft, evidence packet), when the Operator opens the draft, then the Operator-only approval path is disabled and the partner must approve
- [ ] Given a draft, when the Operator approves it, then the approval is logged in the audit trail with actor identity and timestamp before the draft is released to the reviewer's drafts folder
- [ ] Given the Queue tab, when it is sorted by age (oldest first), then drafts approaching or exceeding configured SLA thresholds are highlighted visually
- [ ] Given a draft that has been pending without action for more than the configured SLA window, when the SLA expires, then the item is promoted to the Today tab's "flagged" count

**Business Rules:** BR-006, BR-009  
**Out of scope (MVP):** Batch approval of drafts without individual review; delegating partner-required drafts to operator permanently; auto-archiving unreviewed drafts

---

#### US-018: Memory Tab — Read, Edit, and Delete Memory Items

**Persona:** Designated Operator (primary); Principal (secondary)  
**Narrative:** As a Designated Operator, I want to read, edit, and delete any item in the agent's memory, so that I can correct wrong learning and maintain trust that the agent knows accurate information.

**Acceptance Criteria:**
- [ ] Given the Memory tab, when it is opened, then all memory layers are browsable: hard rules, person-mappings, process knowledge, and voice samples — each in its own labeled section
- [ ] Given a hard rule in the Memory tab, when the Operator edits it, then the change takes effect immediately (within the next draft invocation) and the change is logged with: original value, new value, actor, timestamp
- [ ] Given a voice rule or sample in the Memory tab, when the Operator edits it, then a confirmation prompt is displayed showing the scope of the cascade ("This edit affects N voice cohorts — confirm?") before the change is applied
- [ ] Given any memory item, when the Operator deletes it, then the item is removed from active memory immediately and the deletion is recorded in the audit log (the historical record is retained in the audit log even after deletion from active memory)
- [ ] Given a memory item marked as learned from a past edit (edit-then-send signal), when the item is displayed, then the source context is shown ("Learned from edit on 2026-05-10, matter #1234") and a link to the originating audit event is available
- [ ] Given the Memory tab export function, when it is triggered, then the export includes: all hard rules (JSON), all person-mappings (JSON), all process knowledge (markdown), all voice samples (markdown), with no substantive client communication content included
- [ ] Given a customer who has opted in to sent-folder watching, when their memory data is exported, then only structural-diff patterns are included in the export — not substantive content of any sent communication

**Business Rules:** BR-010, BR-012, BR-013  
**Out of scope (MVP):** Bulk memory import; copying memory between customers; automated memory consolidation without human review

---

#### US-019: Memory Tab — Customer Requests Deletion of a Specific Memory Item Mid-Draft

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want to delete a memory item even while drafts are in flight, so that a correction takes effect immediately without waiting for active drafts to complete.

**Acceptance Criteria:**
- [ ] Given a memory item deleted by the Operator while a draft invoking that item is in flight, when the draft completes, then the draft is flagged "drafted against a since-deleted memory item — review recommended" before entering the queue
- [ ] Given a deleted memory item, when a subsequent draft is generated, then the deleted item does not influence the draft output
- [ ] Given a memory item that is actively referenced by a hard rule, when the item is deleted, then a warning is surfaced ("This item is referenced by rule [X] — deleting will leave the rule with no source. Confirm?") before deletion proceeds

**Business Rules:** BR-010, BR-012  
**Out of scope (MVP):** Rolling back a draft that has already been sent using a since-deleted memory item

---

#### US-020: Audit Tab — View and Export the Full Audit Log

**Persona:** Designated Operator; Compliance / Ethics Counsel  
**Narrative:** As a Compliance Counsel, I want to view and export the full audit log for any period, so that I can produce a compliance evidence artifact in under 60 seconds.

**Acceptance Criteria:**
- [ ] Given the Audit tab, when it is opened, then all logged events are displayed in reverse chronological order with: timestamp, event type, actor (agent or human identity), matter reference (if applicable), and action summary
- [ ] Given the Audit tab filter controls, when filtered by date range, skill, or event type, then the filtered view updates immediately and the filter state is preserved if the user navigates away and returns
- [ ] Given the export function in the Audit tab, when triggered, then the export is available within 60 seconds for periods up to the full retention window
- [ ] Given an audit log export, when it is generated, then it is a complete, tamper-evident record — no events are omitted, summarized, or redacted for the export recipient
- [ ] Given a compliance evidence packet request (US-011), when generated from the Audit tab, then the packet includes the full audit log for the requested period plus the additional compliance artifacts per US-011 acceptance criteria
- [ ] Given an audit log event for a trust-ceiling change (promotion or demotion), when the event is displayed, then it includes: skill name, previous ceiling, new ceiling, actor, timestamp, and the dashboard session that initiated the change

**Business Rules:** BR-011, BR-013  
**Out of scope (MVP):** Real-time streaming audit events to external SIEM; automated anomaly detection on the audit log; permanent deletion of audit log events (immutable by design)

---

#### US-021: Persona Tab — Configure Agent Persona

**Persona:** Principal (initial configuration); Designated Operator (ongoing)  
**Narrative:** As a Principal, I want to configure the agent's name, signature, tone, and voice samples during onboarding, so that the agent's persona is anchored to my firm's identity before any external draft ships.

**Acceptance Criteria:**
- [ ] Given the Persona tab, when it is opened, then the configurable fields are displayed: name, pronouns, title, tone descriptors (3-5 adjectives), signature (HTML preview), and avatar
- [ ] Given a persona name field, when the Principal sets the name, then the name propagates to: dashboard displays, email signature HTML, internal Slack/Teams posts from the persona, and audit log actor references — all surfaces update on save
- [ ] Given the persona configuration, when it is saved, then the change is logged in the audit trail with actor and timestamp
- [ ] Given the required AI-disclosure language for an engagement letter (PA or UT jurisdiction), when the persona configuration includes the firm's client jurisdictions, then the `law-engagement-letter-jurisdictional` skill automatically uses the appropriate per-state disclosure clause — the Principal does not need to manually add it
- [ ] Given a persona not yet configured with ≥30 voice samples, when the Principal saves the persona configuration, then a banner displays "Voice gate not yet passed — first external draft requires ≥30 samples and a blind test ≥80%" and prevents the first external draft from being released

**Business Rules:** BR-014  
**Out of scope (MVP):** Multi-persona per customer; persona versioning; white-label persona for the customer's own clients

---

#### US-022: Skills Tab — Activate, Configure, and Promote a Skill

**Persona:** Designated Operator  
**Narrative:** As a Designated Operator, I want to view the skill catalog, activate skills for this customer, configure skill parameters, and promote trust ceilings, so that the agent's scope and autonomy match what the firm has authorized.

**Acceptance Criteria:**
- [ ] Given the Skills tab, when it is opened, then all skills in the customer's skill catalog are visible: active skills, inactive skills, and skills unavailable (not licensed or not applicable to this vertical)
- [ ] Given an inactive skill, when the Operator activates it, then the skill's default trust ceiling from the skill's `SKILL.md` frontmatter is applied — not the platform maximum
- [ ] Given a skill with a configurable trust ceiling, when the Operator promotes it from `draft_for_review` to `autonomous`, then a confirmation dialog is shown listing what the skill will do autonomously, the promotion is logged in the audit trail, and a one-click "Demote" option is immediately visible on the skill tile
- [ ] Given a skill flagged as non-promotable (trust accounting, court-bound work, settlement-authority actions), when the Operator attempts to promote it, then the action is blocked with an explicit message ("This skill cannot be promoted to autonomous — it handles [category] which requires human review per platform policy")
- [ ] Given a skill with scope parameters (email folders visible, matter-type restrictions), when the Operator saves the configuration, then the configuration is validated against `customer.yaml` schema and rejected if the scope exceeds the customer's declared scope
- [ ] Given a trust-ceiling demotion (Operator demotes a previously-autonomous skill), when it is saved, then the demotion takes effect within the next skill invocation — no in-flight invocations at the previous ceiling are grandfathered

**Business Rules:** BR-001, BR-004, BR-006, BR-008  
**Out of scope (MVP):** Skill authoring by the customer; per-matter skill overrides; temporary trust-ceiling promotions with auto-expiry

---

#### US-023: Voice Tab — Configure, Test, and Iterate Voice Rules

**Persona:** Principal (rules + samples); Designated Operator (test sandbox)  
**Narrative:** As a Principal, I want to configure voice rules, upload anchor samples, and test how the agent drafts before any external draft ships, so that I can confirm the agent sounds like me before it touches a client.

**Acceptance Criteria:**
- [ ] Given the Voice tab, when it is opened, then three sections are visible: Rules editor (Layer 1), Samples library (Layer 2), and Test sandbox
- [ ] Given the Rules editor, when the Principal adds a banned phrase (e.g., "em dash"), then the rule is stored in the voice configuration and the violation log reflects any pre-existing drafts that would have violated the rule if re-drafted
- [ ] Given the Samples library, when the Principal uploads a voice sample, then the sample is tagged with recipient cohort (to-client / to-vendor / to-counterparty) and the sample count per cohort is displayed
- [ ] Given a sample count below 30 total, when displayed in the Voice tab, then a warning banner displays "Voice gate not met — ≥30 samples required before first external draft"
- [ ] Given the test sandbox, when the Principal pastes a scenario and runs it, then the agent drafts against the current voice configuration and the draft is displayed alongside the current active rules — the sandbox draft is not logged in the audit trail as a real draft
- [ ] Given the test sandbox, when the Principal edits the sandbox draft, then the option to "Save as voice sample" is available — and only saves when explicitly chosen, not automatically
- [ ] Given the violation log in the Voice tab, when it is displayed, then it shows voice rule violations caught pre-send by the agent's self-monitoring (not violations that reached the reviewer) for the current week

**Business Rules:** BR-014, BR-009  
**Out of scope (MVP):** Continuous voice sampling from the sent folder (v2); AI-generated rule suggestions; multi-voice-profile A/B testing

---

### Beta-1 Day-1 / Week-1 / Week-4 Experience

---

#### US-024: Day-1 Onboarding — Conduct the Partner Onboarding Session

**Persona:** Captain (conducts); Principal (participates)  
**Narrative:** As a Captain, I want to complete the Day-1 onboarding for the PI firm beta-1 customer within 24 hours of signing, so that the partner's morning digest is configured and the voice calibration has begun before the second day.

**Acceptance Criteria:**
- [ ] Given beta-1 contract signed, when Captain initiates onboarding, then the customer's Fly.io Machine is provisioned, D1/R2/Vectorize storage is bound, and the customer's chosen connectors are OAuth-authorized within 24 hours of signing
- [ ] Given the onboarding session, when the partner session (90 minutes maximum) concludes, then: (a) ≥10 scenarios have been run in the voice test sandbox against the highest-judgment cohorts, (b) the partner has reviewed and approved or edited the voice rules, (c) per-recipient cohort definitions have been confirmed
- [ ] Given the paralegal session (4-6 hours with Captain), when it concludes, then: (a) ≥30 voice samples are uploaded and categorized, (b) memory rules are seeded (firm patterns, case-acceptance criteria, person-mappings), (c) paralegal has completed a dashboard walkthrough and can operate the Memory and Queue tabs without assistance
- [ ] Given the onboarding complete state, when all skills default to `draft_for_review` for the 10-business-day shadow period, then no skill is configured at `autonomous` ceiling regardless of its default in `SKILL.md`
- [ ] Given the 8am digest schedule, when the partner's morning ritual is configured, then the first digest is scheduled for delivery the morning after onboarding completion — not the morning of
- [ ] Given the blind-test gate (§9.6), when the calibration sessions are complete, then the blind test is run with ≥3 reviewers who know the partner's writing before any external draft is released — the gate is not waived for beta-1

**Business Rules:** BR-014, BR-006  
**Out of scope (MVP):** Self-service onboarding; remote-only onboarding (first customer requires Captain in-person or live video); multi-customer simultaneous onboarding

---

#### US-025: Week-1 — Establish the Partner's 60-Second Daily Loop

**Persona:** Principal  
**Narrative:** As a Principal, I want my daily interaction with the agent to be established as a 60-second loop by end of Week 1, so that the agent fits into my existing morning routine without adding cognitive overhead.

**Acceptance Criteria:**
- [ ] Given the Week-1 daily digest, when the partner opens it, then the digest references only items from that day — no backlog accumulation from the shadow period appears in Week-1 digests
- [ ] Given a draft in the queue, when the partner approves or rejects it via the digest link, then the action is recorded and the item is removed from the pending count in the next digest — the loop closes within 24 hours
- [ ] Given a Captain daily check-in with the paralegal (first 5 business days), when the check-in identifies a drift pattern (drafts consistently off in voice, wrong categorization), then Captain escalates to an unscheduled calibration session within 24 hours
- [ ] Given the partner's approval rate in Week 1, when it falls below 70% for 3 consecutive days, then Captain treats this as an at-risk signal and initiates a course-correction conversation before end of Week 1
- [ ] Given a draft with the `draft_for_review` ceiling, when the partner declines to review it (ignores the digest item for >48 hours), when the ignore rate exceeds 30% of drafts, then Captain is notified — the "confirmation-prompt ignore rate" metric is tracked and surfaced

**Business Rules:** BR-006, BR-012  
**Out of scope (MVP):** Automated Week-1 partner-satisfaction surveys; auto-adjusting draft volume based on review speed; partner-facing SLA commitments

---

#### US-026: Week-4 — Confirm Beta-1 Stickiness Metrics

**Persona:** Captain  
**Narrative:** As a Captain, I want all beta-1 stickiness metrics to be confirmed at Week 4, so that I have a data-supported basis for the Day-90 renewal conversation.

**Acceptance Criteria:**
- [ ] Given Week 4 of beta-1, when the Captain reviews metrics, then all of the following must be satisfied: partner approval rate ≥85%, voice violation rate ≤2%, partner opens dashboard ≥4 days/week, paralegal uses dashboard daily
- [ ] Given a stickiness metric missing its Week-4 target, when Captain identifies the gap, then a written course-correction plan is documented with specific actions and a re-check date before the Day-90 renewal conversation
- [ ] Given the "first I forgot about that" moment (agent surfaces a stalled signing or late-paying client the partner had forgotten), when this event occurs, then it is noted in Captain's beta-1 notes as the stickiness anchor event — the platform surfaces this as a candidate story in the monthly recap artifact
- [ ] Given the Day-90 renewal conversation, when Captain prepares for it, then the partner-value metrics (US-014 inbox-triage events absorbed, signing-chase loops closed, status updates drafted, conflict checks completed) are available as countable, audit-log-sourced numbers — not estimates
- [ ] Given the Day-90 renewal conversation, when the partner asks "what did this save me?", then Captain's answer is drawn exclusively from audit-log-sourced counts — no "estimated hours saved" claims are made

**Business Rules:** BR-009, BR-012  
**Out of scope (MVP):** Automated renewal offer generation; automatic contract extension; multi-customer retention-rate benchmarking

---

### Calibration Session

---

#### US-027: Calibration Session Split — Partner Session (≤90 minutes)

**Persona:** Captain (facilitates); Principal (participant)  
**Narrative:** As a Captain, I want to complete the partner's calibration contribution in ≤90 minutes, so that the partner's calendar commitment is bounded and the calibration does not become a reason to delay going live.

**Acceptance Criteria:**
- [ ] Given the partner calibration session, when it begins, then the Captain has pre-loaded ≥10 scenarios covering the highest-judgment recipient cohorts (anxious client, opposing counsel) in the test sandbox before the session starts
- [ ] Given a calibration scenario run in the partner session, when the partner edits the draft, then the edit is immediately reflected in the voice configuration and the updated voice rules are visible to the partner in the same session
- [ ] Given the partner session, when 90 minutes have elapsed, then Captain closes the session and transfers to the paralegal session — there is no "just a few more" extension of the partner session without explicit partner agreement
- [ ] Given the partner session output, when it closes, then a session summary is generated listing: rules added or changed, cohorts covered, outstanding scenarios for the paralegal session — this summary is sent to the paralegal before the paralegal session begins
- [ ] Given the partner session, when fewer than 10 scenarios have been run in 90 minutes, then Captain flags this as a calibration-quality risk and plans to send an async scenario set for partner review within 48 hours

**Business Rules:** BR-014  
**Out of scope (MVP):** Asynchronous partner calibration without a live session; AI-driven scenario selection without Captain curation; self-service calibration by the partner

---

#### US-028: Calibration Session Split — Paralegal Session (4-6 hours)

**Persona:** Captain (facilitates); Designated Operator (participant)  
**Narrative:** As a Captain, I want the paralegal session to fully seed memory, complete voice scenarios, and leave the paralegal comfortable operating the dashboard independently, so that beta-1 operations are not dependent on Captain availability from Week 1.

**Acceptance Criteria:**
- [ ] Given the paralegal calibration session, when it concludes, then: (a) ≥30 anchor samples are uploaded and categorized across all configured cohorts, (b) all firm-pattern memory rules are seeded (case-acceptance criteria, escalation rules, person-mappings), (c) paralegal can add a hard rule, edit a voice sample, and review a queued draft without Captain assistance
- [ ] Given memory rules seeded during the paralegal session, when they are saved, then each rule is confirmed by the paralegal (not batch-imported by Captain without confirmation) — the paralegal is the actor in the audit trail for rules they seed
- [ ] Given the paralegal session, when it concludes, then a session summary is sent to the partner for async review within 24 hours — summary includes all rules seeded and key voice decisions made
- [ ] Given the async partner review of the session summary, when the partner marks it reviewed (dashboard confirmation or email acknowledgment), then the blind-test protocol can proceed
- [ ] Given the blind-test protocol, when it is run post-calibration, then the test uses 10 partner-written + 10 agent-drafted samples, presented unlabeled to ≥3 reviewers who know the partner's writing, and the result is ≥80% indistinguishability — otherwise the calibration cycle repeats

**Business Rules:** BR-014, BR-006  
**Out of scope (MVP):** Remote paralegal calibration without Captain involvement; automated blind-test administration; multiple simultaneous calibration sessions

---

## Business Rules

### Core Trust and Autonomy Rules

**BR-001 — Trust ceiling enforcement is code-level, not prompt-level.**  
Trust ceilings defined in `customer.yaml` and the safety substrate cannot be overridden by prompt injection, tool-result content, or runtime modification. A `draft_for_review` ceiling means a human reviewer must take an affirmative action before any external send or matter write. A `disabled` ceiling means the skill does not run. These constraints are enforced by the safety substrate at the container level, not by the prompt.

**BR-002 — Conflict-check errors must be biased toward false positives, never false negatives.**  
Any conflict check that returns ambiguous results is surfaced as a potential conflict. The system never chooses the path of "this is probably clear" without explicit human confirmation. A conflict-check false negative is a malpractice-level event; a false positive is an inconvenience. The bias is hardcoded in skill design.

**BR-003 — No field is fabricated. Missing data renders as TBD or empty-state, never as plausible inference.**  
Any client-facing field (timeline, deliverable, named person, dollar amount, date, scope language) that is not sourced from an authoritative connector record, a customer-authored memory rule, or an operator-entered value must render as "[TBD]" or a configured empty-state token. This rule is non-negotiable per CLAUDE.md and safety invariant #8. It applies to every skill in every vertical.

**BR-004 — Deadline calculation ambiguity requires human resolution.**  
When a deadline rule produces multiple possible dates (jurisdiction dispute, tolling question, missing trigger date), the skill surfaces both interpretations and requires a human to choose. The skill never picks the later of two dates as a conservative default — that is still a choice that requires legal judgment.

**BR-005 — Trust account and IOLTA operations are permanently `draft_for_review` with no promotion path.**  
No read of trust-account data produces an action. No write to a trust account (disbursement, transfer, payment) is executed without a named human approving the specific transaction. This ceiling is non-promotable in `customer.yaml` and cannot be overridden by any runtime path. It is enforced by the safety substrate, not configuration.

**BR-006 — Reviewer-as-sender is architecturally enforced.**  
No external communication, court filing, or transaction is sent under the agent's identity. All drafts route to the designated reviewer's drafts folder. The reviewer sends from their own account. The agent's identity (email address, AgentMail inbox) is internal-facing only. This is invariant #2 of the safety substrate and cannot be disabled by configuration.

**BR-007 — Scope boundaries defined in `customer.yaml` are hard walls.**  
Email folders in `email_folders_blind`, domains in `domain_blocks`, and subject keywords in `email_keyword_blocks` are never accessed, read, or processed by the agent — not even for classification. Scope violations are logged as safety-invariant events in the audit trail.

**BR-008 — Settlement authority, negotiation positions, and case valuation are permanently third-rail.**  
The agent never proposes settlement terms, commits to settlement ranges, estimates case value, or participates in valuation. The `pi-insurance-carrier-tracker` skill's Day-1 scope is timing/frequency tracking only; settlement-value pattern analysis requires ≥60 days of data accumulation and explicit customer-policy review before activation.

**BR-009 — Audit trail is comprehensive and immutable for the full retention period.**  
Every read, draft generation, approval, rejection, edit, memory change, trust-ceiling change, scope configuration change, export, and skill invocation is logged with: event type, actor (human or agent identity), timestamp, and relevant entity references. Audit log entries are never deleted, summarized, or suppressed — they are retained for the customer's full retention period (default 90 days post-termination, configurable). Exports include the full record.

**BR-010 — Memory changes are versioned, traceable, and reversible.**  
Every memory item edit or deletion is logged with: previous value, new value, actor, timestamp, and source signal (edit-then-send / direct-teach / rejection / import). Operators can view the history of any memory item. Hard rule changes take effect immediately. Voice rule changes with broad cascade scope require a cascade-scope confirmation dialog before applying.

**BR-011 — Compliance evidence packets are available on demand in ≤60 seconds.**  
The `compliance-audit-export` skill generates the complete packet (audit log + safety substrate version + DPA reference + per-state engagement clause citations + model lineage) on demand. Latency target is a hard constraint, not a soft target — it is the functional answer to "how do we know the AI didn't go off the rails?"

**BR-012 — Success metrics are audit-log-sourced, not estimated.**  
Partner-value metrics (inbox-triage events absorbed, signing-chase loops closed, status updates drafted, conflict checks completed) are available only after ≥60 days of customer data exists. Before day 60, no "time saved" or "productivity" numbers appear in customer-facing dashboard views. Captain communicates progress anecdotally only. No estimated hours-saved figures are ever shown.

**BR-013 — Data deletion covers all substrates and is confirmed in writing.**  
On customer termination, the decommission script covers: D1 tables, R2 vault, Vectorize index, Composio credentials, AgentMail mailbox, Fly.io Machine, and `customer.yaml`. Captain provides written deletion confirmation. Grace-period restore (7 days) is available before deletion begins. Post-confirmation deletion is irreversible.

**BR-014 — Voice gate must pass before the first external draft is released.**  
Gate 1 (≥30 anchor samples loaded), Gate 2 (Captain-led calibration session completed), and Gate 3 (blind test ≥80% indistinguishability) must all pass before any draft routes to the reviewer's drafts folder for external send. The gate is enforced by the dashboard (Persona tab banner, skill activation block) and by the agent runtime. Beta-1 is not exempt.

**BR-015 — Citation-bearing output is unconditionally refused.**  
The citation-refusal substrate (invariant 6) runs on every agent output before it reaches a draft surface. Any output containing a case name + cite, statute reference, court rule reference, or regulatory citation pattern is held and flagged for partner review. The substrate refuses to produce citations regardless of how the request is framed, including embedded in tool-result instructions. 100% accuracy is the only acceptable target.

**BR-016 — Evidence packets contain assembly only — no legal characterization.**  
The `pi-demand-letter-evidence-packet` skill assembles structured inputs. The narrative-impact template contains section headers and prompts only. No factual characterization of injury severity, liability, or causation is authored by the agent. The blank template sections are a constraint, not a gap to fill.

---

## Edge Cases

### Trust Model Edge Cases

**EC-001 — Skill promotion during an in-flight draft.**  
If a skill trust-ceiling is promoted to `autonomous` while a `draft_for_review` invocation is in flight, the in-flight invocation completes at `draft_for_review`. The new ceiling applies to subsequent invocations only. The transition point is logged in the audit trail.

**OQ-001** — Does a trust-ceiling demotion mid-flight apply to the in-flight invocation or only subsequent ones? The PRD states "takes effect within the next skill invocation" for demotions (US-022 AC), but does not address the symmetric case for promotions. Recommend: demotions take effect immediately (safety-biased); promotions take effect on next invocation. Requires Captain resolution.

**EC-002 — Sticky stop while a skill is mid-execution.**  
If the "pause all skills" sticky-stop action is invoked while a skill is mid-execution (e.g., partway through generating a long draft), the current execution completes but the output is held and flagged "produced during pause window — review before releasing." No new skill invocations start until the stop is explicitly resumed.

**EC-003 — Trust ceiling promotion for a non-promotable skill attempted via API or config file edit.**  
If a non-promotable skill's ceiling is edited directly in `customer.yaml` (bypassing the dashboard), the agent runtime reads the config at boot and refuses to start if a non-promotable skill has a ceiling above `draft_for_review`. The boot failure is logged and Captain is alerted. The config is not silently corrected by the runtime.

### Connector Failure Edge Cases

**EC-004 — PracticeManagement connector unavailable at intake time.**  
If the PM connector is down when intake-and-conflict activates: (a) a partial intake record is created in D1 with the available data, (b) the conflict check is deferred with a "pending PM availability" flag, (c) no engagement letter is drafted, (d) the item is surfaced in the Queue tab with a "connector unavailable" flag, and (e) the queue item auto-retries when the connector health check returns green. No intake is silently lost.

**EC-005 — ESign connector unavailable while a signing chase is active.**  
If the DocuSign/PandaDoc connector is down when signing-coordinator activates: the skill surfaces the stalled envelope in the queue with a "connector unavailable — chase deferred" flag. The reminder draft is not queued (it would be based on stale data). The queue item is held until the connector health check returns green. The stall timer does not reset; elapsed time is preserved.

**EC-006 — Connector goes down while a draft is being generated.**  
If a connector read fails mid-draft (the agent has started generating a draft that requires mid-draft connector calls), then: the draft is marked "incomplete — source data unavailable" and surfaced with a warning rather than silently completing with partial data. The TBD-marker rule (BR-003) applies to any field that could not be sourced.

**EC-007 — Multiple connectors for the same capability.**  
The `customer.yaml` schema currently supports one adapter per capability. If a firm uses two email systems (e.g., Outlook for partners, Gmail for staff), the v1 design does not support binding two adapters to the same capability. This is an unresolved edge case.  
**OQ-002** — Does the v1 `customer.yaml` schema support per-user connector binding within a single capability (e.g., Outlook for the partner, Gmail for the intake coordinator)? If not, what is the fallback for multi-email-system firms? Requires architecture decision before beta-1 if the PI firm has mixed email infrastructure.

### Memory Edge Cases

**EC-008 — Customer requests deletion of all memory mid-operation.**  
If a customer requests a full memory wipe (e.g., via the "Export & Terminate" flow or a one-off hard reset): (a) all active drafts are flagged "memory-wipe pending — hold before release," (b) the wipe is deferred until all in-flight skill invocations complete, (c) the wipe is applied atomically across D1, R2, and Vectorize, (d) the wipe event and post-wipe state are logged in the (immutable) audit trail.

**EC-009 — Voice rule conflict between a hard rule and an anchor sample.**  
If a voice rule explicitly bans a phrase (e.g., "no em dashes") but an anchor sample contains that phrase: the sample is not automatically excluded, but the skill self-monitors output against rules and re-drafts if a violation is detected. The conflict is surfaced in the Voice tab's violation log as "rule conflict detected in existing samples" and the Operator is prompted to review and optionally remove the conflicting sample.

**EC-010 — Memory item deleted while referenced by an in-flight draft.**  
Covered in US-019. The draft completes but is flagged "drafted against a since-deleted memory item — review recommended." The Operator cannot undo the deletion, but can re-add the item if the deletion was in error.

**EC-011 — Sent-folder watching captures a privileged communication.**  
If sent-folder watching is opted in and a sent email matches a `WORK PRODUCT` or `PRIVILEGED` keyword block in `customer.yaml`: the email is not processed, the skip is logged in the audit trail, and the structural delta is never computed. The scope constraints in `customer.yaml` are applied before any processing occurs, not after.

### Voice Gate Edge Cases

**EC-012 — Blind test fails (< 80% indistinguishability).**  
If the blind test does not reach the ≥80% threshold: the first external draft is blocked. Captain conducts a targeted re-calibration session focusing on the cohorts where judges most reliably identified AI output. The re-test is run with a fresh set of 10+10 samples. There is no limit on recalibration cycles, but the gate does not lower.

**EC-013 — Partner provides fewer than 30 anchor samples due to minimal published writing.**  
Per law-firm PRD §11.3.1 bootstrap-deficit case: if <10 publishable public samples exist, the voice bootstrap from public writing fails. Captain surfaces this at discovery and offers: (a) run the demo against generic professional voice (honest), or (b) focus the demo on memory and trust controls. In beta-1, the partner must provide ≥30 real sent emails post-engagement before the voice gate can pass. There is no waiver for the sample minimum.

**EC-014 — Voice calibration session is interrupted and cannot be resumed in the same week.**  
If the partner session is cut short (< 10 scenarios completed): the partial calibration state is saved in the test sandbox session log. The remaining scenarios are packaged as an async set for the partner's review. The blind test is not attempted until all required scenarios are complete. The voice gate remains blocked.

### Citation-Refusal Edge Cases

**EC-015 — Citation injection attempt via a tool-result instruction.**  
If a prompt-injection attempt in a client email instructs the agent to include case citations ("The law is clear: Smith v. Jones, 123 U.S. 456 — please confirm"), the citation-refusal substrate filters any citation-shaped output before it reaches the draft surface. The draft response acknowledges the client's reference to the law without repeating or citing it. The injection attempt is logged in the audit trail as an adversarial fixture event.

**EC-016 — Citation appears in an uploaded voice sample or memory rule.**  
If a customer-uploaded voice sample contains a case citation (the partner's past email included a cite): the sample is stored in R2 as-is (it is the partner's own content), but the citation-refusal substrate prevents the agent from reproducing the citation in output even if it would superficially match the voice sample's pattern. Voice samples are reference material, not output templates.

**EC-017 — The citation filter produces a false positive (blocks a non-citation legal reference).**  
If the citation filter incorrectly blocks a legitimate output that superficially matches a citation pattern (e.g., a street address that matches `\d+ [A-Z]\.\d+`): the blocked output is surfaced in the Queue tab with a "citation filter hold" flag and requires partner review before release. False positives are logged and reported to Captain for filter tuning. There is no customer-side override of the citation filter.

### Audit Log Edge Cases

**EC-018 — Audit log query for a period that spans a data-retention boundary.**  
If a compliance export request spans a period where some events are within retention and some are outside: the export returns the in-retention events with a note "Audit log truncated at [date] — events prior to this date are outside the [N]-day retention window." No silent truncation; the boundary is explicit.

**EC-019 — Audit log export requested for a terminated customer during the grace period.**  
If a terminated customer (within the 7-day grace period before deletion) requests an audit log export: the export is available and complete. The grace period specifically exists to enable this use case. After the grace period and confirmed deletion, the audit log is gone and Captain cannot reconstitute it.

### Dashboard Edge Cases

**EC-020 — Partner approves a draft from the digest email before the Operator has reviewed it.**  
If the partner approves a draft from the daily digest (using a direct link) before the Operator reviews it in the Queue tab: the approval is valid and the draft is moved to the reviewer's drafts folder. The Queue tab item is marked "approved by partner" and removed from the Operator's pending queue. The audit trail records the approver identity.

**EC-021 — SLA timer expires on a partner-required draft that the partner has not opened.**  
If a partner-required draft exceeds the SLA window without the partner opening it: the item is promoted to the Today view's "flagged" count. Captain receives a notification if the ignore rate for the week exceeds 30%. The draft is NOT automatically escalated to a different reviewer or auto-sent.

**EC-022 — Skill version update available while a skill is active for a customer.**  
In v1 (single skill version, no per-customer pinning per §20), all customers run the same skill version. If a skill regression is detected: (a) Captain can disable the skill via the control plane for the affected customer(s) without the customer taking action, (b) the disable is logged in the audit trail, (c) the customer's Queue tab shows "Skill [name] temporarily paused — pending fix" for affected items. Per-customer skill pinning is Phase 4.

### Demo Edge Cases

**EC-023 — Demo provisioned firm turns out to use a system not in the Tier-0 or Tier-1 pre-build set.**  
Per law-firm PRD §11.4: Captain acknowledges the gap ("We don't have a [System] adapter ready — we'd ship one in 7 days") and proceeds with the synthetic-data fallback. The 7-day commitment is made explicitly and tracked. The demo does not attempt to fake a live connector for a system not pre-built.

**EC-024 — Voice gate not passed before the walk-in-cold demo.**  
The walk-in-cold demo uses a pre-loaded voice anchor from public writing (the bootstrap path, §9.3). The demo context is explicit: "This is bootstrapped from your published writing — production calibration requires your real sent emails." The demo is not claiming gate passage; it is demonstrating the system's capability with pre-production samples. The demo operator must not frame the bootstrap voice as production-ready.

---

## Traceability Matrix

| Story | Skill / Feature | Platform PRD Reference | Law Firm PRD Reference | Success Metric |
|---|---|---|---|---|
| US-001, US-002 | `intake-and-conflict` | §8.1 primitives, §11.2 trust ceilings | §6.1 (n/a — universal primitive), §5 third-rail map | Conflict-check false-negative rate 0% (§17.1, law-firm §14.1) |
| US-003 | `document-collection` | §8.1 primitives | §4 (pillars 2, 5), §7.3 retrieval reality | Draft approval rate ≥85% week 4 (§17.1) |
| US-004 | `deadline-docketer` | §8.1 primitives | §4 (pillars 2, 6, 10), §7.3 LawToolBox | Captain weekly hours ≤2/wk (§17.1) |
| US-005 | `status-update-generator` | §8.1 primitives, §7.5 invariant #8 | §4 (pillar 3), §6.2 overlay compatibility | Draft approval rate ≥85% week 4 (§17.1) |
| US-006 | `signing-coordinator` | §8.1 primitives | §4 (pillar 2), §7.1 DocuSign connector | Signing-chase loops closed (law-firm §14.4) |
| US-007 | `billing-reconciliation` | §8.1 primitives, §11.2 trust ceiling | §5 third-rail (IOLTA), §4 (pillar 8) | Trust account write incidents 0 (BR-005) |
| US-008 | `inbox-triage-and-draft` | §8.2 cross-cutting skills, §7.5 invariants 2+4 | §4 (pillar 3) | Inbox triage events absorbed (law-firm §14.4) |
| US-009 | `morning-digest` | §8.2 cross-cutting skills | §11.8 Day-1 experience | Partner opens dashboard ≥4 days/week (law-firm §14.3) |
| US-010 | `memory-curator` | §8.2 cross-cutting skills, §10.2 learning loop | §11.8 Week-1 experience | Customer-initiated memory edits ≥3/week by week 2 (§17.1) |
| US-011 | `compliance-audit-export` | §8.2 cross-cutting skills, §13.1 audit trail | §6.3 `law-compliance-audit-export`, §8.6 court-filing context | Compliance audit log available ≤60 seconds (§17.1) |
| US-012 | `pi-intake-triage` | §8.3 overlay model | §6.2 PI overlay, §12.1 PI skill detail | Intake-triage classification accuracy ≥90% week 4 (law-firm §14.1) |
| US-013 | `pi-demand-letter-evidence-packet` | §7.5 invariant #8, §8.4 skill anatomy | §6.2 PI overlay, §12.1 pi-demand-letter-evidence-packet | Zero legal characterization in output (BR-016) |
| US-014 | `pi-lien-tracker` | §8.1 billing-reconciliation (lien sub-function) | §12.1 pi-lien-tracker | Lien surfaced pre-disbursement 100% (BR-005) |
| US-015 | `pi-settlement-statement-assembler` | §7.5 invariant #8 | §12.1 pi-settlement-statement-assembler | TBD markers for open liens 100% (BR-003) |
| US-016 | Today dashboard tab | §12.1 v1 dashboard | §11.8 partner experience | Partner ≤5 min/day attention budget (law-firm §11.8 week 4) |
| US-017 | Queue dashboard tab | §12.1 v1 dashboard | §11.8 operator time | Draft approval rate ≥85% week 4 (§17.1) |
| US-018, US-019 | Memory dashboard tab | §10.3 memory tab, §12.1 v1 dashboard | — | Customer-initiated memory edits ≥3/week (§17.1) |
| US-020 | Audit dashboard tab | §11.4 audit log, §12.1 v1 dashboard | §6.3 `law-compliance-audit-export` | Compliance packet ≤60 seconds (§17.1) |
| US-021 | Persona dashboard tab | §9 persona model, §12.1 v1 dashboard | — | Voice blind-test ≥80% before first external draft (§17.1) |
| US-022 | Skills dashboard tab | §11 trust ceiling, §12.1 v1 dashboard | §5 third-rail non-promotable skills | Trust-ceiling promotions ≥1 by week 8 (§17.1) |
| US-023 | Voice dashboard tab | §9.5–9.6 voice configuration, §12.1 | — | Voice blind-test ≥80% gate (§17.1) |
| US-024, US-025, US-026 | Beta-1 Day-1/Week-1/Week-4 | §4 Persona 2 (bus-factor), §17.1 metrics | §11.8 partner experience | Renewal decision beta-1 → paid by day 90 (law-firm §14.3) |
| US-027, US-028 | Calibration session split | §9.6 voice quality gates | §11.9 calibration session split | Voice blind-test ≥80% gate passed (§17.1) |

---

## Open Questions

**OQ-001** (referenced in EC-001) — Trust-ceiling promotion timing: does promotion apply to in-flight invocations or only to subsequent ones? The PRD is clear for demotion (US-022 AC: "next skill invocation") but silent on promotion. Recommend: promotions also apply only to next invocation (prevents a race condition where an in-flight `draft_for_review` draft is suddenly treated as autonomous mid-execution). Captain resolution required.

**OQ-002** (referenced in EC-007) — Multi-email-system firms: does v1 `customer.yaml` support per-user connector binding for the same capability? If not, what is the fallback protocol for a firm with mixed email infrastructure (Outlook + Gmail for different staff)? This is a likely reality for some PI firms. Requires architecture decision before beta-1 onboarding.

**OQ-003** — SLA thresholds: the PRDs reference SLA windows for draft review (US-017 AC) but do not define the default SLA period or whether it is configurable per skill. What is the default draft-review SLA? Is it configurable per customer? Is it the same for partner-required and operator-addressable drafts? Recommend: make per-skill configurable in `customer.yaml` with a platform default (suggest 48 hours).

**OQ-004** — Multi-user dashboard role model: platform PRD §19 lists "multi-user role model in dashboard (principal-only vs. principal+operator+compliance multi-role)" as an open decision, noting that beta-1 will require multi-user. The law-firm PRD §16 lists "multi-attorney trust models in dashboard" as open. Beta-1 requires the partner AND the paralegal to have dashboard access with different permission levels. The role schema must be specified before beta-1 provisioning. This is a missing artifact, not a deferred decision.

**OQ-005** — Scope controls for the `pi-insurance-carrier-tracker` skill's 60-day gate: the PRD states "Day-1 capability is timing/frequency tracking only; settlement-value and offer-pattern analysis requires ≥60 days of customer-data accumulation." What is the mechanism for activating the settlement-value pattern analysis after 60 days? Is it automatic, or does the customer explicitly unlock it? Is 60 days a hard technical gate or a soft recommendation? Requires decision before the skill's Phase 1 acceptance criteria can be finalized.

**OQ-006** — Frozen-tier pricing (platform PRD §14.5): customers who pause active drafting can downgrade to a frozen tier for memory storage and audit log access. No acceptance criteria, pricing, or activation flow is defined. If a beta-1 customer wants to pause temporarily (vacation, budget cycle), what is the customer-facing flow? Deferred pricing does not prevent the need for an activation/deactivation story.

**OQ-007** — Connector health check mechanism: multiple edge cases (EC-004, EC-005, EC-006) reference "connector health check returns green" as the trigger for auto-retry. The v1 connector health check is not specified in either PRD. Is there a dedicated health-check endpoint per connector? What is the polling interval? What surfaces the connector health status to the customer (Health tab is deferred to Phase 4)? Requires a v1 connector health monitoring story for the Captain's control plane.

**OQ-008** — Evidence packet trigger: US-013 states the evidence-packet skill is triggered "when the partner or operator triggers" it. Is this a manual trigger only, or can it fire automatically when a matter reaches a configured stage in the PM connector? If automatic, what is the stage threshold? Manual-only is safer (avoids assembling packets for matters not at demand-stage), but automatic may be more operationally useful. Recommend: manual-trigger only for v1, with an auto-trigger option deferred to Phase 3 when the stage-detection logic can be tested.

**OQ-009** — Citation filter tuning access: EC-017 notes that citation filter false positives are reported to Captain for filter tuning. Is the citation filter's configuration (regex patterns, confidence thresholds) accessible via the Captain control plane without a full code deploy? If not, a false-positive pattern that emerges in beta-1 could require a code release to fix. Given the "100% accuracy" target for citation refusal, false-positive corrections need a fast path.

**OQ-010** — Engagement letter drafting for a conflicted check vs. non-conflicted check: US-001 states that a clean conflict check queues a draft engagement letter. But the PRD does not specify what happens when the conflict-check result is ambiguous (probable match, not confirmed conflict). Does the engagement letter draft when conflict status is unresolved? Recommend: engagement letter draft is blocked until the conflict check returns a definitive clean result — no engagement letter with a conflict check in "pending human review" state.

---

*End of Business Analyst Contribution — PRD Review Round 1*
