# Operator Service Agreement - Ashton & Price LLP (DRAFT)

> **Status: DRAFT for Captain review. Not sent. Not signed.** Review of record: the
> four-reviewer counsel panel of 2026-07-27 (SMD-side transactional, firm-side redline
> simulation, privacy/data-law specialist, cross-document consistency audit) plus the
> Captain's review; external licensed-counsel review waived by Captain 2026-07-27 for this
> engagement (family counterparty who is himself a litigator; scale- and stage-appropriate).
> This internal header block, the provenance table, and the open-items list are stripped
> from the client-facing final form.

## Term provenance (doctrine Law 5)

Every commercial term in the body traces to a recorded source. Terms with no source are
written as explicit bracketed TBDs, never filled with plausible content.

| Term                                                                                                     | Source                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| $5,000/month, fully managed                                                                              | ADR 0063; letter 10 §2 (sent 2026-07-27)                                 |
| $4,000 one-time stand-up fee, waived                                                                     | ADR 0063; letter 10 §2                                                   |
| Month to month; 30 days written notice                                                                   | Letter 10 §2                                                             |
| Billing begins when implementation testing wraps; no charge before                                       | Letter 10 §2                                                             |
| Billing-start deemed-confirmation mechanics (10 business days)                                           | Counsel panel 2026-07-27; **Captain ratification pending**               |
| All AI usage included; nothing metered; no per-task charges                                              | Letter 10 §2                                                             |
| Token-usage monitoring; re-scope together if work grows well beyond                                      | Letter 10 §2 (Captain edit, sent version)                                |
| Severity ladder; no uptime nines; no service credits                                                     | ADR 0064                                                                 |
| Security-incident notification within 24 hours of awareness                                              | ADR 0064; DPA §7                                                         |
| 14-day export; 30-day return-and-destruction; written attestation                                        | Letter 10 §5; ADR 0065; DPA §8                                           |
| Portal pause control (kill switch); firm-operable without SMD                                            | Letter 10 §6                                                             |
| Entitlement changes: portal self-service by Named Administrators, or by SMD at their request; all logged | Letter 10 §7; #2003                                                      |
| Operator mailbox in the firm's M365 tenant; AgentMail excluded                                           | Letter 10 §8; ADR 0078                                                   |
| Per-matter alert routing via Smokeball roles                                                             | Letter 10 (alert routing); #2004                                         |
| Stop-then-reconcile failure mode; Smokeball stays calendar of record                                     | Letter 10 §9                                                             |
| Routine grid + permanent caps (Schedule A-1)                                                             | Letter 07 grid verbatim; accepted letter 09; confirmed letter 10         |
| Verification = 3 attempts; treatment gap = 45 days (adjustable 30)                                       | Letters 09 and 10                                                        |
| No training on Customer Data; provider-terms backstop                                                    | Letter 10 §2; DPA §5                                                     |
| Dedicated machine + encrypted volume; per-customer isolation                                             | ADR 0007; letter 10 §4                                                   |
| Insurance limits: Tech E&O + Cyber $1M aggregate; CGL $1M/occ, $2M agg                                   | COI (ACORD 25, Vouch, 2026-07-24; policies eff 2026-07-27 to 2027-07-27) |
| Invoiced monthly in advance; due net 30; 1.5%/mo late interest                                           | Template standard (#827); ratified by Captain 2026-07-27                 |
| Payment-dispute mechanics; suspension after 15 days' notice of non-payment                               | Counsel panel 2026-07-27; **Captain ratification pending**               |
| Fee changes: 60 days written notice                                                                      | Template standard (#827); ratified by Captain 2026-07-27                 |
| Liability cap: greater of trailing-12-month fees paid or $60,000                                         | Captain decision 2026-07-27; wording per counsel panel                   |
| Confidentiality super-cap: 2x cap for non-willful breaches; uncapped for gross negligence/willful        | Counsel panel 2026-07-27; **Captain ratification pending**               |
| Prepaid-fee proration on termination                                                                     | Counsel panel 2026-07-27; **Captain ratification pending**               |
| Governing law: Arizona; Maricopa County forum                                                            | Captain decision 2026-07-27 (opening position)                           |

## Open items before this leaves the building

1. **Captain ratification of the counsel-panel structural terms** marked pending above: the confidentiality super-cap structure (§11.3(b)), the rebalanced indemnities (§12), the conformity warranty + design-description framing (§10), billing-start mechanics (§3.3), payment-dispute/suspension mechanics (§3.4, §3.7), and prepaid proration (§9.3(e)).
2. `[A&P ENTITY]` - confirm exact legal entity name and form ("Ashton & Price LLP" per letter 10 §3) and `[A&P ADDRESS]` - principal address. `[A&P ENTITY]` appears in the preamble, §10.7, and both signature blocks here and in Exhibit C.
3. `[SIGNATORY NAME]` / `[SIGNATORY TITLE]` - Chris Price and exact title (signature blocks in this document AND Exhibit C).
4. `[NAMED ADMINISTRATOR 1]` / `[NAMED ADMINISTRATOR 2]` - the two portal administrators the firm names (letter 10 §7).
5. `[PAYMENT METHOD]` (Exhibit A), `[EFFECTIVE DATE]` (preamble here and in Exhibit C; must match), and `[FIRM NOTICE EMAIL]` (§14.4).
6. SMD notice email in §14.4 is set to scott@smd.services - confirm or change (correspondence to date has run through smdurgan@smdurgan.com).
7. Insurance: CLOSED (limits from bound COI; endorsements verified vfy_01KYJKK5J2TQSVQ2YE8ANTX3XC; A&P-named COI requested 2026-07-27). Verify Sentry data-scrubbing configuration on the smd-operator project before signature (DPA Exhibit B-1 row represents technical error data only).
8. Held as ready concessions, deliberately NOT in this draft (negotiation posture in the dossier): SEV1 fee abatement, extended SMD-side termination notice, insurance-cancellation notice / higher limits, publicity clause.

---

# Operator Service Agreement

**This Operator Service Agreement (this "Agreement") is entered into as of [EFFECTIVE DATE] (the "Effective Date") by and between SMDurgan, LLC, an Arizona limited liability company doing business as SMD Services ("SMD"), and [A&P ENTITY], with its principal place of business at [A&P ADDRESS] ("Customer" or "the Firm"). SMD and Customer are each a "Party" and together the "Parties."**

## 1. Definitions

1.1 **"Operator"** means the configured, per-Customer instance of the SMD platform provisioned for the Firm: the Machine, the operational memory, the configured persona, the enabled skills and routines, and the bound connectors, as configured in Exhibit A and the Portal Configuration Record.

1.2 **"Customer Data"** means all information submitted to, generated within, or processed by the Operator on the Firm's behalf, including matter content read through the Firm's connected systems, the Operator's operational memory, drafts produced for the Firm, and the audit record. Customer Data does not include SMD Platform Materials.

1.3 **"Machine"** means the dedicated compute instance and encrypted storage volume provisioned for the Firm's exclusive use, as described in Section 4.

1.4 **"Entitlement Configuration"** means the per-action-class authorization the Firm authors for the Operator, recorded in Exhibit A and maintained in the Portal Configuration Record. For each class of action, the Firm authors how far the Operator may go on its own (autonomous, draft for review by a named person, or refused) and what the Operator may reach (recipients, folders, connectors). An action class for which the Firm has authored nothing is refused by default. The Operator enforces the Entitlement Configuration in code and cannot raise its own ceiling.

1.5 **"Portal Configuration Record"** means the configuration of record for the Firm's Operator as displayed in the client portal, including the routine settings, entitlement settings, connector grants, and audit record. SMD maintains a logged, timestamped history of changes to the Portal Configuration Record; that history, together with the audit record, is the evidence of the Entitlement Configuration in force at any given time for purposes of Sections 2.2, 2.4, 2.5, and 12.2.

1.6 **"Named Administrators"** means the individuals the Firm designates in Exhibit A as authorized to operate the pause control and change entitlement settings.

1.7 **"Implementation Testing"** means the joint testing period described in Exhibit A during which the Operator's configured routines are validated against live Firm matters before billing begins.

1.8 **"Service"** means the fully managed Operator service described in Section 2, including provisioning, configuration, operation, monitoring, maintenance, support, and offboarding.

1.9 **"SMD Platform Materials"** means the SMD platform and everything SMD brings to the engagement other than Customer Data: the Operator software, skills, routines, configuration templates, entitlement and audit architecture, tooling, documentation, and all improvements and derivatives of the foregoing, together with all intellectual property rights in them.

## 2. Scope of Service

2.1 **The Service.** SMD will provision, configure, operate, monitor, and maintain a dedicated Operator for the Firm that runs the litigation-lifecycle routines configured in Exhibit A, and is available beyond those routines: Firm personnel may assign it tasks and ask it questions in the ordinary course of work. The Service is fully managed: SMD provides the infrastructure, the AI usage, ongoing configuration, monitoring, support, and the partnership obligations in Section 2.6.

2.2 **The Operator acts only within the Entitlement Configuration.** The Operator takes an action only where the Firm has authored an entitlement for that action class, and only up to the authored ceiling. Unauthored action classes are refused by default. Every action is recorded in the audit record described in Section 4.5.

2.3 **Permanent caps.** Independent of any setting the Firm authors, the following caps from the agreed routine grid apply for the life of the engagement:

(a) Any communication to opposing counsel or to a court is prepared by the Operator for a person at the Firm to review and send; the Operator is not configured with, and SMD will not grant it, any send path to those recipients.

(b) Nothing touching deadlines or the movement of money is handled autonomously. Where the Operator surfaces a date, it reads that date from the Firm's systems (which compute court-rules deadlines) and records it as an item for attorney confirmation; the Operator does not calculate deadlines, and the Firm's practice-management system and the Firm's own docketing procedures remain the Firm's calendar of record and sole system for deadline management. The Operator is not granted fund-movement or trust-ledger tools and never moves funds or posts to ledgers.

(c) The medical chronology is an internal record. The Operator records dates, providers, and treatment entries as they appear in the file, and does not state medical opinions, causation conclusions, severity or impairment assessments, or valuations.

2.4 **Graduation.** Where the routine grid in Schedule A-1 records a higher ceiling than the starting setting, the Firm may graduate that routine at its discretion: a Named Administrator may make the change directly in the portal's entitlement settings, or request it of SMD in writing. Graduation is never automatic and never initiated by SMD or by the Operator, and no setting may be raised above the ceiling the grid records, by either Party or through the portal.

2.5 **Configuration changes.** Entitlement settings are changeable by two paths: Named Administrators change them directly in the portal, and SMD changes them only at the request of a Named Administrator. Every change, by either path, is recorded in the audit record with who made it and when. Other configuration changes (new or adjusted skills, connector grants, routine adjustments beyond the entitlement dials) are requested through a Named Administrator and implemented by SMD.

2.6 **Managed-service partnership.** As part of the Service, SMD follows the evolving technology landscape on the Firm's behalf, evaluates what is useful for the Firm's practice, and brings the Firm guidance, ideas, and ways to put the Operator to work. SMD will keep the Operator on the frontier AI models best suited to the Firm's work as they release, selecting among available models in its reasonable judgment based on suitability, safety, quality, and contractual availability. A change of model provider is a sub-processor change governed by the DPA.

2.7 **Re-scope.** All AI usage required to run the configured Service is included in the Fee; nothing is metered and there are no per-task charges. SMD monitors usage, and if the work grows well beyond what the Parties have configured together, the Parties will re-scope the engagement together by mutual written agreement. No fee change takes effect except under Section 3.5 or such a mutual agreement.

## 3. Fees and Payment

3.1 **Monthly fee.** The fee for the Service is $5,000 per month (the "Fee"), fully managed, covering the items in Section 2 and Exhibit A.

3.2 **Stand-up fee waived.** The one-time stand-up fee of $4,000 is waived for the Firm.

3.3 **Billing start.** No charge accrues before Implementation Testing is complete. Billing begins on the date Implementation Testing is complete (the "Billing Start Date"). SMD may notify the Firm in writing when it believes Implementation Testing is complete; Implementation Testing is complete on the earlier of (a) the Parties' written confirmation, or (b) the tenth (10th) business day after SMD's notice, unless the Firm has by then delivered a written objection identifying the configured routines that remain unvalidated, in which case the Parties will complete validation of the identified routines and confirm in writing. From the Billing Start Date, SMD invoices monthly in advance; each invoice is due within thirty (30) days of the invoice date. Payment method is as stated in Exhibit A.

3.4 **Late payment; disputes.** Any undisputed amount not paid when due accrues interest from the due date at the lesser of 1.5% per month or the maximum rate permitted by law. The Firm may withhold a disputed amount only by delivering, before the due date, written notice identifying the disputed amount and the basis for the dispute in reasonable detail; the Firm will pay all undisputed amounts when due, and the Parties will resolve the dispute under Section 13.

3.5 **Fee changes.** SMD may change the Fee only on at least sixty (60) days' written notice. The Firm's termination right under Section 9.1 is unaffected.

3.6 **No pass-through costs.** The Firm's own vendor relationships (practice management, filing, records retrieval, its Claude Enterprise subscription, and similar) remain the Firm's; SMD passes through no third-party costs under this Agreement unless the Parties agree otherwise in writing.

3.7 **Suspension for non-payment.** If any undisputed amount remains unpaid more than fifteen (15) days after SMD's written notice of non-payment, SMD may suspend the Service until payment is made. Suspension does not relieve the Firm of its payment obligations, is not a termination, and is without prejudice to SMD's other remedies. SMD will restore the Service promptly on payment.

## 4. Per-Customer Infrastructure and Security

4.1 **Dedicated Machine.** SMD operates a dedicated compute instance with its own encrypted storage volume, hosted in the United States, for the Firm's exclusive use. No other SMD customer shares the Firm's Machine or storage. This isolation is enforced by deployment architecture, not by policy. SMD will not relocate the Machine or volume outside the United States without the Firm's prior written consent.

4.2 **No copy of the Firm's matter files.** The Firm's business systems remain the systems of record. The Operator reads matter content through authorized API connections, performs the task, and writes results back into the Firm's systems. SMD does not warehouse copies of the data held in those systems. Two artifacts containing matter references live on the Firm's dedicated Machine: the audit record and the Operator's operational memory; both are governed by this Agreement, the DPA (Exhibit B), and the Confidentiality Addendum (Exhibit C). SMD's control plane holds account and billing records and high-level governance summaries, as described in the DPA.

4.3 **Credentials.** Connection credentials for the Firm's systems live only on the Firm's Machine at restricted permissions and are never written to logs. The most sensitive credentials are held behind a broker process the agent cannot read.

4.4 **Fail-closed permissions and inbound fencing.** The Operator's authority model is fail-closed: consequential actions it was not explicitly authorized to take are refused in code. Sending under a Firm principal's identity is banned in code. Inbound email is structurally fenced so that instructions hidden in it cannot drive autonomous actions. An automated output gate is applied to client-facing output to screen for fabricated or unsupported content before send.

4.5 **Audit record.** Every Operator action lands in a hash-chained, append-only audit log designed so the agent cannot rewrite it, kept for the life of the engagement, viewable by the Firm in the portal at any time, and delivered in full on termination per Section 9.3.

4.6 **Mail channel.** The Operator's mailbox is provisioned inside the Firm's Microsoft 365 tenant, under the Firm's retention and controls, visible to the Firm like any staff mailbox. At go-live the Parties jointly configure tenant-level scoping so the Operator can reach only its own mailbox; the Firm controls its tenant and is responsible for maintaining that configuration, and SMD will not request or use access beyond the Operator's own mailbox. AgentMail is not used in this engagement and is not a sub-processor for the Firm.

4.7 **Security program.** SMD maintains the security program described in the DPA (Exhibit B). In addition, SMD's software delivery pipeline runs automated dependency scanning that fails the build on high or critical findings, full-history secret detection, and static analysis on every change and daily; SMD maintains a threat model with regular review and runs periodic adversarial audits with remediation tracked to closure. SMD does not hold SOC 2 or ISO 27001 certification and says so plainly; sub-processor attestations are listed in the DPA.

## 5. Customer Data; SMD Property

5.1 **Ownership.** As between the Parties, the Firm owns Customer Data, including the Operator's operational memory and the audit record. SMD processes Customer Data only to provide the Service, under the DPA (Exhibit B).

5.2 **No training.** SMD does not use Customer Data to train, fine-tune, or otherwise modify any machine-learning model, and contracts with its model providers on terms under which content submitted for inference is not used to train models. SMD will not route Customer Data to any model provider whose terms permit training on it. What the Operator learns about the Firm's matters, processes, and people stays the Firm's and never benefits any other SMD customer.

5.3 **Protected information.** The Firm is a law firm; the handling of privileged communications, attorney work product, and client confidences is governed by the Confidentiality Addendum (Exhibit C), which controls over this Agreement as to that subject matter.

5.4 **SMD Property.** As between the Parties, SMD owns and retains all right, title, and interest in and to the SMD Platform Materials. Nothing in this Agreement transfers or licenses any SMD Platform Materials to the Firm except the right to receive and use the Service during the term. SMD may use the general knowledge, skills, and know-how retained in the unaided memory of its personnel, provided it discloses no Customer Data and breaches no obligation under Section 8 or Exhibit C.

## 6. Service Levels and Support

6.1 **Monitoring.** SMD monitors the Operator continuously through automated systems, including machine heartbeats, connector-health checks, and error tracking. Business hours for human response are Monday through Friday, Arizona time.

6.2 **Severity ladder.** SMD responds to incidents on the following ladder:

| Severity | Definition                                                                  | Response                                      | Communication to the Firm                                       |
| -------- | --------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| SEV1     | Operator down, or the Operator acted outside its authorized entitlements    | Work begins immediately on detection, any day | Notified within 24 hours; updates at least daily until resolved |
| SEV2     | Degraded service: a connector broken, a routine failing, drafts not flowing | Acknowledged and worked the same business day | Notified where Firm-visible; updates as material facts change   |
| SEV3     | Questions, cosmetic issues, configuration requests                          | Next business day                             | Response in the same thread                                     |

6.3 **Failure posture.** If a connected system or the mail channel is unreachable, the Operator stops rather than acting on stale or partial data. Scheduled routines read outstanding work from the Firm's systems on every run, so on reconnection the next run picks up exactly the work still pending; an outage delays work and does not lose it. Dates the Operator surfaces are handled per Section 2.3(b); the Firm's practice-management system remains the Firm's calendar of record, so an outage pauses the Operator's chasing without removing anything from the Firm's calendar. Connection and process failures alert SMD; system and technical monitoring is SMD's to own.

6.4 **Security incidents.** SMD notifies the Firm without undue delay, and in any case within twenty-four (24) hours of becoming aware of a security incident affecting Customer Data, per the DPA.

6.5 **Remedies.** SMD's commitment is detection, honest communication, and fast remediation on the ladder above. This Agreement does not carry uptime-percentage guarantees or service credits. The response commitments in this Section 6, together with the Firm's termination rights under Section 9 and the warranty in Section 10.2, are the Firm's remedies for Service unavailability or degradation; nothing in this Section 6.5 limits either Party's rights under Sections 8, 11.3, or 12 or for the other Party's gross negligence or willful misconduct.

## 7. The Firm's Controls and Responsibilities

7.1 **Pause control.** The portal provides a pause control that immediately stops all Operator activity and keeps it stopped until reenabled. Named Administrators can operate it without SMD's involvement. Every pause and resume is logged. Fees continue to accrue during a pause; a pause is not a suspension or termination of this Agreement and does not extend or toll any notice period under Section 9.

7.2 **Emergency disconnection.** The Firm may additionally revoke the Operator's access to its systems at any time through the Firm's own administrative controls (for example, its practice-management system owner or M365 tenant administrator).

7.3 **Alert routing.** Case-level alerts (verification stalls, deadline flags, drafts awaiting review) route per matter to the responsible attorney or assisting staff as assigned in the Firm's practice-management system, and tracked items land in the matter as assigned tasks. Nothing case-level funnels to a single inbox.

7.4 **Firm responsibilities.** The Firm will: (a) review, verify, and approve Operator output before relying on it in client work, sending it outside the Firm, or filing it; (b) maintain its own systems and vendor accounts (practice management, Microsoft 365, its Claude Enterprise subscription) in good standing, and be responsible for the accuracy of the data in its own systems; (c) keep portal credentials secure and designate replacement Named Administrators promptly when a designated individual departs or changes role; (d) use the Service only for the Firm's own practice and not make it available to any other firm or entity; and (e) not reverse-engineer the Service or use it to build a competing product.

## 8. Confidentiality

8.1 Each Party will protect the other's non-public information with no less than reasonable care, use it only to perform under this Agreement, and disclose it only as this Agreement permits or the law compels (with prompt notice where lawful). Customer Data is the Firm's confidential information. The Confidentiality Addendum (Exhibit C) governs privileged and professionally protected material.

## 9. Term and Termination

9.1 **Term.** This Agreement runs month to month from the Effective Date. Either Party may terminate for convenience on at least thirty (30) days' written notice.

9.2 **Termination for cause.** Either Party may terminate if the other materially breaches this Agreement and does not cure within thirty (30) days of written notice.

9.3 **Offboarding.** On termination for any reason:

(a) Matter data and drafts are already in the Firm's systems; there is nothing to return or delete from SMD for those.

(b) Within fourteen (14) days of the effective termination date, SMD delivers the audit record and the Operator's operational memory in exportable form.

(c) SMD revokes all access grants and connection credentials, destroys the Firm's dedicated Machine and volume, and deletes residual Customer Data from its control plane, excepting records SMD is required by law to retain for legal, tax, or accounting purposes, which remain subject to Section 8 and Exhibit C for as long as they are held. Return and destruction complete within thirty (30) days of termination, with written destruction attestation on request, subject to any litigation-hold suspension under the DPA.

(d) The Operator's mailbox lives in the Firm's M365 tenant and remains under the Firm's control; its disposition is the Firm's.

(e) The Firm pays Fees accrued through the effective termination date, and SMD refunds the prorated unused portion of any prepaid Fee for the period after that date.

9.4 **Survival.** Sections 1, 3 (as to amounts accrued before termination), 5, 8, 9.3, 10, 11, 12, 13, and 14, and any other provision that by its nature should survive, survive termination. The DPA and the Confidentiality Addendum survive per their own terms.

## 10. Warranties; Disclaimers; Insurance

10.1 **Mutual.** Each Party warrants it has authority to enter this Agreement and will comply with law applicable to its performance.

10.2 **SMD.** SMD warrants that (a) the Service will be performed in a professional and workmanlike manner, and (b) the Service will materially conform to the configuration stated in Exhibit A and the Entitlement Configuration in force. For breach of clause (b), SMD will correct the nonconformity promptly on written notice; if a material nonconformity remains uncured thirty (30) days after notice, the Firm may terminate under Section 9.2. If the Operator acts outside its authorized entitlements (a SEV1 event under Section 6.2), the Firm may terminate immediately on written notice without a cure period.

10.3 **The Firm.** The Firm warrants that (a) it has the right and authority to grant SMD and the Operator access to its systems and the Customer Data in them for the purposes of this Agreement, and has obtained all consents, authorizations, and client disclosures required by law and by the rules of professional conduct applicable to the Firm; (b) medical and health information within Customer Data is held by the Firm under valid authorizations from the individuals concerned; and (c) the Firm is not a HIPAA covered entity, and is not acting as a business associate of any covered entity, with respect to Customer Data made available to the Operator, and will notify SMD promptly if that ceases to be accurate.

10.4 **Nature of AI output.** The Operator uses generative artificial intelligence. Its output may be inaccurate, incomplete, or unsuitable for a particular use, and SMD does not warrant the accuracy, completeness, or legal sufficiency of any individual Operator output. The Firm is responsible for reviewing Operator output as Section 7.4(a) provides.

10.5 **No legal services.** SMD is not a law firm, does not practice law, and provides no legal advice. The Operator is a tool operating under the Firm's supervision and the Entitlement Configuration. The Firm's lawyers retain sole professional responsibility for client matters, legal judgments, work product, docketing and calendaring, and compliance with the rules of professional conduct applicable to the Firm.

10.6 **Disclaimer.** EXCEPT AS EXPRESSLY STATED IN THIS AGREEMENT, THE SERVICE IS PROVIDED "AS IS" AND SMD DISCLAIMS ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. The descriptions of the Service's design, architecture, and controls in Sections 2, 4, 5, 6, and 7 and in the DPA describe how the Service is built and operated and are commitments SMD stands behind through Section 10.2(b) and Section 6; they are not a guarantee that the Service will operate without error.

10.7 **Insurance.** During the term, SMD maintains technology errors & omissions and cyber liability coverage that includes AI-services coverage and privacy and regulatory coverage for personal and medical data, and commercial general liability coverage, with limits no less than those stated in Exhibit A. A certificate of insurance naming [A&P ENTITY] will be provided, and updated certificates on written request.

## 11. Limitation of Liability

11.1 EXCEPT FOR THE EXCLUSIONS IN SECTION 11.3, EACH PARTY'S AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THIS AGREEMENT, THE DPA, THE CONFIDENTIALITY ADDENDUM, OR THE SERVICE, WHETHER IN CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, STATUTE, OR ANY OTHER THEORY, WILL NOT EXCEED THE GREATER OF (a) THE FEES PAID BY THE FIRM UNDER THIS AGREEMENT IN THE TWELVE (12) MONTHS PRECEDING THE FIRST EVENT GIVING RISE TO THE CLAIM, OR (b) SIXTY THOUSAND DOLLARS ($60,000).

11.2 EXCEPT FOR THE EXCLUSIONS IN SECTION 11.3, NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR LOSS OF PROFITS, REVENUE, DATA, OR BUSINESS OPPORTUNITY, ARISING OUT OF OR RELATING TO THIS AGREEMENT, THE DPA, THE CONFIDENTIALITY ADDENDUM, OR THE SERVICE.

11.3 The limits in Sections 11.1 and 11.2 do not apply to:

(a) a Party's indemnification obligations under Section 12;

(b) a Party's breach of Section 8 or Exhibit C constituting gross negligence or willful misconduct, which is uncapped; for all other breaches of Section 8 or Exhibit C, including an unauthorized access to or disclosure of Customer Data or Protected Information not constituting gross negligence or willful misconduct, the breaching Party's aggregate liability will not exceed two (2) times the amount stated in Section 11.1, and Section 11.2 does not limit recovery of the Firm's reasonable costs of legally required breach notification and credit monitoring;

(c) a Party's gross negligence or willful misconduct; or

(d) the Firm's payment obligations under Section 3.

## 12. Indemnification

12.1 **By SMD.** SMD will defend and indemnify the Firm against third-party claims that the Service as provided by SMD infringes a U.S. patent, copyright, or trademark. If the Service becomes, or SMD believes it may become, the subject of such a claim, SMD may at its option and expense procure the right to continue use, modify or replace the affected component, or, if neither is commercially reasonable, terminate this Agreement and refund any prepaid unearned Fees. SMD has no obligation for claims arising from Customer Data, from modification or combination of the Service by anyone other than SMD, or from use in violation of this Agreement. This Section 12.1 states SMD's entire liability and the Firm's exclusive remedy for infringement claims.

12.2 **By the Firm.** The Firm will defend and indemnify SMD against third-party claims arising out of (a) a claim that Customer Data, as provided by the Firm, infringes or misappropriates a third party's rights or that the Firm lacked the right to provide it; (b) the Firm's use of the Service in violation of this Agreement or law; (c) an action taken by the Operator within a ceiling the Firm authored in the Entitlement Configuration, except to the extent the claim arises from SMD's negligence, from an action outside the authored configuration, or from SMD's failure to enforce the configuration as specified; or (d) claims by the Firm's clients or other third parties arising out of the Firm's professional services, legal judgments, or docketing and calendaring decisions, including the Firm's use of or reliance on Operator output it has reviewed.

12.3 **Procedure.** The indemnified Party will give prompt written notice, reasonable cooperation at the indemnifying Party's expense, and control of the defense to the indemnifying Party. The indemnifying Party will not settle a claim in a manner that imposes any obligation or admission on the indemnified Party without its written consent. The indemnified Party may participate with its own counsel at its own expense.

## 13. Disputes; Governing Law

13.1 The Parties first attempt informal resolution between authorized representatives. If a dispute is not resolved informally, either Party may deliver a written demand for non-binding mediation before a mutually agreed mediator (fees shared equally). If the dispute is not resolved within sixty (60) days after the written mediation demand, either Party may file in the state or federal courts located in Maricopa County, Arizona, to whose exclusive jurisdiction and venue the Parties consent. This Agreement is governed by the laws of the State of Arizona, without regard to conflicts rules.

13.2 This Section 13 does not prevent either Party from (a) commencing an action to collect amounts due under Section 3, or (b) seeking injunctive or other equitable relief for a breach of Section 8, Section 5.4, or Exhibit C, in each case in the courts specified in Section 13.1 without first mediating.

## 14. General

14.1 **Entire agreement.** This Agreement, together with its Exhibits, is the entire agreement between the Parties on its subject matter and supersedes all prior or contemporaneous agreements and understandings, written or oral.

14.2 **Order of precedence.** In the event of conflict: (a) the Confidentiality Addendum (Exhibit C) controls as to the treatment of Protected Information; (b) the DPA (Exhibit B) controls as to data protection; (c) the body of this Agreement controls otherwise; (d) Exhibit A follows the body. Notwithstanding the foregoing, Sections 10 through 13 of this Agreement govern warranties, limitation of liability, indemnification, and disputes for all claims arising out of or relating to this Agreement and its Exhibits, and no provision of an Exhibit expands or creates an exception to Section 11 except as Section 11.3 expressly provides.

14.3 **Amendment; waiver.** This Agreement may be amended only in a writing signed by both Parties. No waiver is effective unless in a signed writing, and a waiver in one instance is not a waiver in any other.

14.4 **Notices.** Notices must be in writing and delivered by hand, nationally recognized overnight courier, certified mail (return receipt requested), or email with confirmation of receipt, to: for SMD, SMDurgan, LLC, 5818 East Onyx Avenue, Paradise Valley, AZ 85253, email scott@smd.services; for the Firm, [A&P ADDRESS], email [FIRM NOTICE EMAIL]. Notice is deemed given on receipt. Either Party may update its notice address by notice.

14.5 **Assignment.** Neither Party may assign this Agreement without the other's prior written consent, except to a successor in a merger, acquisition, or sale of substantially all assets. Any other attempted assignment is void.

14.6 **Force majeure.** Neither Party is liable for failure or delay (other than payment obligations) caused by events beyond its reasonable control, including acts of God, war, terrorism, government action, internet or utility outages, or third-party infrastructure failures, provided the affected Party gives prompt notice and resumes performance as soon as reasonably practicable. If a force majeure event continues for more than thirty (30) days, either Party may terminate on written notice.

14.7 **Independent contractors.** The Parties are independent contractors. Nothing in this Agreement creates a partnership, joint venture, agency, or employment relationship.

14.8 **Severability.** If any provision is unenforceable, the remainder stays in effect and the provision is reformed to the minimum extent necessary to make it enforceable while preserving intent.

14.9 **Counterparts; electronic signature.** This Agreement may be executed in counterparts, including by electronic signature, each of which is an original and all of which together are one instrument.

14.10 **No third-party beneficiaries.** This Agreement is for the sole benefit of the Parties and their permitted successors and assigns. Nothing in this Agreement, the DPA, or the Confidentiality Addendum confers on any other person, including any client of the Firm, any right, benefit, or remedy.

---

**SMDurgan, LLC (d/b/a SMD Services)**

By: `______________________________`
Name: Scott Durgan
Title: Principal
Date: `______________________________`

**[A&P ENTITY]**

By: `______________________________`
Name: [SIGNATORY NAME]
Title: [SIGNATORY TITLE]
Date: `______________________________`

---

## Exhibit A: Statement of Work and Configuration

**Service.** The Litigation Lifecycle Operator, running the nineteen routines listed in Schedule A-1 at the starting settings there stated. The Portal Configuration Record is the configuration of record for settings the Firm controls; no portal change can exceed the graduation ceilings in Schedule A-1 or the permanent caps in Section 2.3, and every change is logged per Section 2.5.

**Confirmed settings.** Client verification escalates to a person after three (3) unanswered attempts; the treatment-gap flag is forty-five (45) days, adjustable to thirty (30) at the Firm's request.

**Permanent caps** (restating Section 2.3): opposing counsel and court communications always take a person's send; nothing touching deadlines or money auto-handles; the medical chronology is an internal record only.

**Connectors at go-live.** The Firm's practice-management system (Smokeball, the system of record); the Operator's mailbox in the Firm's Microsoft 365 tenant; the Claude-application connector providing direct Operator access for Firm-chosen users. The Claude connector rides the Firm's own Claude Enterprise account: the Firm procures and pays for its Claude Enterprise subscription and seats, and SMD sets up and maintains the connector access; SMD's Section 2.7 obligation covers AI usage on SMD's own accounts in operating the Operator. Additional connectors are granted by the Firm per Section 2.5.

**Named Administrators.** [NAMED ADMINISTRATOR 1], [NAMED ADMINISTRATOR 2]. (The two individuals the Firm names for portal administration: pause control and entitlement settings.)

**Alert routing.** Per matter, via the responsible-attorney and assisting-staff roles in the Firm's practice-management system, per Section 7.3.

**Implementation Testing.** The joint validation of configured routines against live Firm matters per the implementation plan, completed per Section 3.3.

**Payment method.** [PAYMENT METHOD].

**Insurance limits.** Technology errors & omissions and cyber liability: $1,000,000 policy aggregate. Commercial general liability: $1,000,000 each occurrence, $2,000,000 general aggregate.

**Pass-through cost categories.** None.

### Schedule A-1: Routine Grid (starting settings and graduation ceilings)

The tiers below are as agreed in the Parties' correspondence of July 9, 2026 and accepted July 23, 2026, stated verbatim. "Prepare-and-route" means the Operator prepares the work and routes it to a named person at the Firm; "flag-only" means the Operator surfaces the item and takes no further action; "auto-handle" means the routine runs without a per-item human step, within the permanent caps.

| #   | Routine                     | Starting setting              | Ceiling (graduation limit)                          |
| --- | --------------------------- | ----------------------------- | --------------------------------------------------- |
| 1   | Served discovery caught     | Flag-only                     | Flag-only (only surfaces)                           |
| 2   | Response deadlines          | Prepare-and-route             | Prepare-and-route (capped: deadline)                |
| 3   | Client verification         | Prepare-and-route             | Auto-handle (once you are comfortable)              |
| 4   | Separate statement          | Prepare-and-route             | Prepare-and-route (capped: before a judge)          |
| 5   | Opposing responses reviewed | Flag-only                     | Flag-only (an assist, not an authority)             |
| 6   | Meet-and-confer letter      | Prepare-and-route             | Prepare-and-route (capped: opposing counsel)        |
| 7   | Response inputs staged      | Prepare-and-route             | Auto-handle (once you are comfortable)              |
| 8   | New matter setup            | Prepare-and-route             | Auto-handle (once you are comfortable)              |
| 9   | Service confirmation        | Flag-only                     | Flag-only (capped: deadline)                        |
| 10  | Records chase               | Prepare-and-route             | Auto-handle (once you are comfortable)              |
| 11  | Medical chronology          | Runs on its own               | Internal record only (never characterizes)          |
| 12  | Motion calendar             | Flag-only                     | Flag-only (only surfaces)                           |
| 13  | Motion package              | Prepare-and-route             | Prepare-and-route (capped: before a judge)          |
| 14  | Minor's compromise packet   | Prepare-and-route             | Prepare-and-route (capped: money and court forms)   |
| 15  | Trial binder                | Prepare-and-route             | Prepare-and-route (capped: deadlines and court)     |
| 16  | Mediation and settlement    | Prepare-and-route             | Prepare-and-route (capped: deadline and settlement) |
| 17  | Lien ledger                 | Flag-only / prepare-and-route | Prepare-and-route (capped: money)                   |
| 18  | Settlement statement        | Prepare-and-route             | Prepare-and-route (capped: money)                   |
| 19  | Daily "what needs you"      | Flag-only                     | Flag-only (only surfaces)                           |

---

## Exhibit B: Data Processing Addendum

Attached as a separate document: [`data-processing-addendum.md`](./data-processing-addendum.md).

## Exhibit C: Confidentiality Addendum (Law Firm)

Attached as a separate document: [`confidentiality-addendum.md`](./confidentiality-addendum.md).
