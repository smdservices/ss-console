# Operator Service Agreement - Ashton & Price LLP (DRAFT)

> **Status: DRAFT for Captain review. Not sent. Not signed.** Before this document goes
> to the firm it must be (1) reviewed by Captain and (2) reviewed by external counsel
> (A&P is the first external countersignature for this SKU; the signing-flow runbook's
> counsel gate applies here, not to any internal seat). This internal header block, the
> provenance table, and the open-items list are stripped from the client-facing final form.

## Term provenance (doctrine Law 5)

Every commercial term in the body traces to a recorded source. Terms with no source are
written as explicit bracketed TBDs, never filled with plausible content.

| Term                                                                                                     | Source                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| $5,000/month, fully managed                                                                              | ADR 0063; letter 10 §2 (sent 2026-07-27)                                 |
| $4,000 one-time stand-up fee, waived                                                                     | ADR 0063; letter 10 §2                                                   |
| Month to month; 30 days written notice                                                                   | Letter 10 §2                                                             |
| Billing begins when implementation testing wraps; no charge before                                       | Letter 10 §2                                                             |
| All AI usage included; nothing metered; no per-task charges                                              | Letter 10 §2                                                             |
| Token-usage monitoring; re-scope together if work grows well beyond                                      | Letter 10 §2 (Captain edit, sent version)                                |
| Severity ladder; no uptime nines; no service credits                                                     | ADR 0064                                                                 |
| Security-incident notification within 24 hours                                                           | ADR 0064; DPA §6                                                         |
| 14-day export; 30-day return-and-destruction; written attestation                                        | Letter 10 §5; ADR 0065; DPA §7                                           |
| Portal pause control (kill switch); firm-operable without SMD                                            | Letter 10 §6                                                             |
| Entitlement changes: portal self-service by Named Administrators, or by SMD at their request; all logged | Letter 10 §7; #2003                                                      |
| Operator mailbox in the firm's M365 tenant; AgentMail excluded                                           | Letter 10 §8; ADR 0078                                                   |
| Per-matter alert routing via Smokeball roles                                                             | Letter 10 (alert routing); #2004                                         |
| Stop-then-reconcile failure mode; Smokeball stays calendar of record                                     | Letter 10 §9                                                             |
| Routine grid + permanent caps                                                                            | Letter 07 grid; accepted letter 09; confirmed letter 10                  |
| Verification = 3 attempts; treatment gap = 45 days (adjustable 30)                                       | Letters 09 and 10                                                        |
| No training on Customer Data                                                                             | Letter 10 §2; DPA §5                                                     |
| Dedicated machine + encrypted volume; per-customer isolation                                             | ADR 0007; letter 10 §4                                                   |
| Insurance limits: Tech E&O + Cyber $1M aggregate; CGL $1M/occ, $2M agg                                   | COI (ACORD 25, Vouch, 2026-07-24; policies eff 2026-07-27 to 2027-07-27) |
| Invoiced monthly in advance; due net 30; 1.5%/mo late interest                                           | Template standard (#827); **Captain ratification pending**               |
| Fee changes: 60 days written notice                                                                      | Template standard (#827); **Captain ratification pending**               |
| Liability cap                                                                                            | **TBD: Captain + counsel**                                               |
| Governing law: Arizona                                                                                   | Captain decision, 2026-07-27 (opening position)                          |

## Open items before this leaves the building

1. `[LIABILITY CAP]` - Captain decision with counsel input.
2. Insurance: CLOSED. Limits filled in Exhibit A from the bound COI; the A&P-named certificate-holder COI was requested 2026-07-27 (1-2 business days). Endorsements verified on the bound CEM policy `HDG.CEM.7BB397E8.26` (verify `vfy_01KYJKK5J2TQSVQ2YE8ANTX3XC`): AI Endorsement CET 10-0052 present with $1M sub-limits (AI regulatory investigations, algorithm removal, algorithmic bias, AI IP); Privacy Liability $1M and Privacy Regulatory Liability $1M purchased; no health-data-processing exclusion. §10.5's warranted coverage matches the bound policy.
3. `[A&P ENTITY]` - confirm exact legal entity name and form ("Ashton & Price LLP" per letter 10 §3) and principal address.
4. `[SIGNATORY]` - Chris Price's exact title for the signature block.
5. `[NAMED ADMINISTRATORS]` - the two portal administrators the firm names (letter 10 §7).
6. Invoicing standards (net 30, late interest, 60-day fee-change notice) are template boilerplate, not letter commitments; Captain ratifies or strikes.
7. Counsel review of Sections 10 through 13 (warranties, liability, indemnification, disputes) before signature.

---

# Operator Service Agreement

**This Operator Service Agreement (this "Agreement") is entered into as of [EFFECTIVE DATE] (the "Effective Date") by and between SMDurgan, LLC, an Arizona limited liability company doing business as SMD Services ("SMD"), and [A&P ENTITY], with its principal place of business at [A&P ADDRESS] ("Customer" or "the Firm"). SMD and Customer are each a "Party" and together the "Parties."**

## 1. Definitions

1.1 **"Operator"** means the configured, per-Customer instance of the SMD platform provisioned for the Firm: the Machine, the operational memory, the configured persona, the enabled skills and routines, and the bound connectors, as configured in Exhibit A and the Portal Configuration Record.

1.2 **"Customer Data"** means all information submitted to, generated within, or processed by the Operator on the Firm's behalf, including matter content read through the Firm's connected systems, the Operator's operational memory, drafts, and the audit record.

1.3 **"Machine"** means the dedicated compute instance and encrypted storage volume provisioned for the Firm's exclusive use, as described in Section 4.

1.4 **"Entitlement Configuration"** means the per-action-class authorization the Firm authors for the Operator, recorded in Exhibit A and maintained in the Portal Configuration Record. For each class of action, the Firm authors how far the Operator may go on its own (autonomous, draft for review by a named person, or refused) and what the Operator may reach (recipients, folders, connectors). An action class for which the Firm has authored nothing is refused by default. The Operator enforces the Entitlement Configuration in code and cannot raise its own ceiling.

1.5 **"Portal Configuration Record"** means the configuration of record for the Firm's Operator as displayed in the client portal, including the routine settings, entitlement settings, connector grants, and audit record.

1.6 **"Named Administrators"** means the individuals the Firm designates in Exhibit A as authorized to operate the pause control and change entitlement settings.

1.7 **"Implementation Testing"** means the joint testing period described in Exhibit A during which the Operator's configured routines are validated against live Firm matters before billing begins.

## 2. Scope of Service

2.1 **The Service.** SMD will provision, configure, operate, monitor, and maintain a dedicated Operator for the Firm that runs the litigation-lifecycle routines configured in Exhibit A, and is available beyond those routines: Firm personnel may assign it tasks and ask it questions in the ordinary course of work. The Service is fully managed: SMD provides the infrastructure, the AI usage, ongoing configuration, monitoring, support, and the partnership obligations in Section 2.6.

2.2 **The Operator acts only within the Entitlement Configuration.** The Operator takes an action only where the Firm has authored an entitlement for that action class, and only up to the authored ceiling. Unauthored action classes are refused by default. Every action is recorded in the audit record described in Section 5.4.

2.3 **Permanent caps.** Independent of any setting the Firm authors, the following caps from the agreed routine grid apply for the life of the engagement:

(a) Any communication to opposing counsel or to a court is prepared by the Operator for a person at the Firm to review and send; the Operator does not send to those recipients under any configuration.

(b) Nothing touching deadlines or the movement of money is handled autonomously. The Operator reads computed court-rules dates from the Firm's systems and routes them for attorney confirmation; it does not compute or commit deadlines. It never moves funds or posts to trust ledgers.

(c) The medical chronology is an internal record only; the Operator records what is in the file and does not characterize it.

2.4 **Graduation.** Where the routine grid in Exhibit A records a higher ceiling than the starting setting, the Firm may graduate that routine at its discretion: a Named Administrator may make the change directly in the portal's entitlement settings, or request it of SMD in writing. Graduation is never automatic and never initiated by SMD or by the Operator, and no setting may be raised above the ceiling the grid records.

2.5 **Configuration changes.** Entitlement settings are changeable by two paths: Named Administrators change them directly in the portal, and SMD changes them only at the request of a Named Administrator. Every change, by either path, is recorded in the audit record with who made it and when. Other configuration changes (new or adjusted skills, connector grants, routine adjustments beyond the entitlement dials) are requested through a Named Administrator and implemented by SMD.

2.6 **Managed-service partnership.** As part of the Service, SMD follows the evolving technology landscape on the Firm's behalf, evaluates what is useful for the Firm's practice, and brings the Firm guidance, ideas, and ways to put the Operator to work. SMD keeps the Operator on the best suited frontier AI models as they release.

2.7 **Re-scope.** All AI usage required to run the configured Service is included in the Fee; nothing is metered and there are no per-task charges. SMD monitors usage, and if the work grows well beyond what the Parties have configured together, the Parties will re-scope the engagement together by mutual written agreement. No fee change takes effect except under Section 3.5 or such a mutual agreement.

## 3. Fees and Payment

3.1 **Monthly fee.** The fee for the Service is $5,000 per month (the "Fee"), fully managed, covering the items in Section 2 and Exhibit A.

3.2 **Stand-up fee waived.** The one-time stand-up fee of $4,000 is waived for the Firm.

3.3 **Billing start.** No charge accrues before Implementation Testing is complete. Billing begins on the date the Parties confirm in writing that Implementation Testing has wrapped (the "Billing Start Date"). From the Billing Start Date, SMD invoices monthly in advance; each invoice is due within thirty (30) days of the invoice date. Payment method is as stated in Exhibit A.

3.4 **Late payment.** Undisputed amounts more than thirty (30) days past due accrue interest at the lesser of 1.5% per month or the maximum rate permitted by law.

3.5 **Fee changes.** SMD may change the Fee only on at least sixty (60) days' written notice. The Firm's termination right under Section 9.1 is unaffected.

3.6 **No pass-through costs.** The Firm's own vendor relationships (practice management, filing, records retrieval, and similar) remain the Firm's; SMD passes through no third-party costs under this Agreement unless the Parties agree otherwise in writing.

## 4. Per-Customer Infrastructure and Security

4.1 **Dedicated Machine.** SMD operates a dedicated compute instance with its own encrypted storage volume for the Firm's exclusive use. No other SMD customer shares the Firm's Machine or storage. This isolation is enforced by deployment architecture, not by policy.

4.2 **No copy of the Firm's matter files.** The Firm's business systems remain the systems of record. The Operator reads matter content through authorized API connections, performs the task, and writes results back into the Firm's systems. SMD does not warehouse copies of the data held in those systems. Two artifacts containing matter references live on the Firm's dedicated Machine: the audit record and the Operator's operational memory; both are governed by this Agreement, the DPA (Exhibit B), and the Confidentiality Addendum (Exhibit C).

4.3 **Credentials.** Connection credentials for the Firm's systems live only on the Firm's Machine at restricted permissions and are never written to logs. The most sensitive credentials are held behind a broker process the agent cannot read.

4.4 **Fail-closed permissions and inbound fencing.** The Operator cannot take a consequential action it was not explicitly authorized to take. Sending under a Firm principal's identity is banned in code. Inbound email is structurally fenced so that instructions hidden in it cannot drive autonomous actions. An output gate screens client-facing output for fabricated or unsupported content before any send.

4.5 **Audit record.** Every Operator action lands in a hash-chained, append-only audit log the agent cannot rewrite, kept for the life of the engagement, viewable by the Firm in the portal at any time, and delivered in full on termination per Section 9.3.

4.6 **Mail channel.** The Operator's mailbox is provisioned inside the Firm's Microsoft 365 tenant, under the Firm's retention and controls, visible to the Firm like any staff mailbox. Access is scoped at the tenant level so the Operator can reach only its own mailbox. AgentMail is not used in this engagement and is not a sub-processor for the Firm.

4.7 **Security program.** SMD maintains the security measures described in the DPA (Exhibit B), including automated dependency scanning that fails the build on high or critical findings, full-history secret detection, static analysis on every change and daily, a maintained threat model with regular review, and periodic adversarial audits with remediation tracked to closure. SMD does not hold SOC 2 or ISO 27001 certification and says so plainly; sub-processor attestations are listed in the DPA.

## 5. Customer Data

5.1 **Ownership.** As between the Parties, the Firm owns Customer Data, including the Operator's operational memory and the audit record. SMD processes Customer Data only to provide the Service, under the DPA (Exhibit B).

5.2 **No training.** Customer Data is never used to train, fine-tune, or otherwise modify any machine-learning model, and never benefits any other SMD customer. What the Operator learns about the Firm's matters, processes, and people stays the Firm's.

5.3 **Protected information.** The Firm is a law firm; the handling of privileged communications, attorney work product, and client confidences is governed by the Confidentiality Addendum (Exhibit C), which controls over this Agreement as to that subject matter.

## 6. Service Levels and Support

6.1 **Monitoring.** SMD monitors the Operator continuously through automated systems, including machine heartbeats, connector-health checks, and error tracking. Business hours for human response are Monday through Friday, Arizona time.

6.2 **Severity ladder.** SMD responds to incidents on the following ladder:

| Severity | Definition                                                                  | Response                                      | Communication to the Firm                                       |
| -------- | --------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| SEV1     | Operator down, or the Operator acted outside its authorized entitlements    | Work begins immediately on detection, any day | Notified within 24 hours; updates at least daily until resolved |
| SEV2     | Degraded service: a connector broken, a routine failing, drafts not flowing | Acknowledged and worked the same business day | Notified where Firm-visible; updates as material facts change   |
| SEV3     | Questions, cosmetic issues, configuration requests                          | Next business day                             | Response in the same thread                                     |

6.3 **Failure posture.** If a connected system or the mail channel is unreachable, the Operator stops rather than acting on stale or partial data. Scheduled routines read outstanding work from the Firm's systems on every run, so on reconnection the next run picks up exactly the work still pending; an outage delays work and does not lose it. Every deadline the Operator flags is written into the Firm's practice-management system, which remains the Firm's calendar of record. Connection and process failures alert SMD; system and technical monitoring is SMD's to own.

6.4 **Security incidents.** SMD notifies the Firm without undue delay, and in any case within twenty-four (24) hours, of a confirmed security incident affecting Customer Data, per the DPA.

6.5 **Remedies.** SMD's commitment is detection, honest communication, and fast remediation on the ladder above. This Agreement does not carry uptime-percentage guarantees or service credits.

## 7. The Firm's Controls

7.1 **Pause control.** The portal provides a pause control that immediately stops all Operator activity and keeps it stopped until reenabled. Named Administrators can operate it without SMD's involvement. Every pause and resume is logged.

7.2 **Emergency disconnection.** The Firm may additionally revoke the Operator's access to its systems at any time through the Firm's own administrative controls (for example, its practice-management system owner or M365 tenant administrator).

7.3 **Alert routing.** Case-level alerts (verification stalls, deadline flags, drafts awaiting review) route per matter to the responsible attorney or assisting staff as assigned in the Firm's practice-management system, and tracked items land in the matter as assigned tasks. Nothing case-level funnels to a single inbox.

## 8. Confidentiality

8.1 Each Party will protect the other's non-public information with no less than reasonable care, use it only to perform under this Agreement, and disclose it only as this Agreement permits or the law compels (with prompt notice where lawful). Customer Data is the Firm's confidential information. The Confidentiality Addendum (Exhibit C) governs privileged and professionally protected material.

## 9. Term and Termination

9.1 **Term.** This Agreement runs month to month from the Effective Date. Either Party may terminate for convenience on at least thirty (30) days' written notice.

9.2 **Termination for cause.** Either Party may terminate if the other materially breaches this Agreement and does not cure within thirty (30) days of written notice.

9.3 **Offboarding.** On termination for any reason:

(a) Matter data and drafts are already in the Firm's systems; there is nothing to return or delete from SMD for those.

(b) Within fourteen (14) days of the effective termination date, SMD delivers the audit record and the Operator's operational memory in exportable form.

(c) SMD revokes all access grants and connection credentials, destroys the Firm's dedicated Machine and volume, and deletes residual Customer Data from its control plane, excepting records SMD must retain for legal, tax, or accounting purposes. Return and destruction complete within thirty (30) days of termination, with written destruction attestation on request.

(d) The Operator's mailbox lives in the Firm's M365 tenant and remains under the Firm's control; its disposition is the Firm's.

(e) The Firm pays Fees accrued through the effective termination date.

9.4 **Survival.** Sections 5, 8, 9.3, 10, 11, 12, and 13 survive termination.

## 10. Warranties; Insurance

10.1 **Mutual.** Each Party warrants it has authority to enter this Agreement and will comply with law applicable to its performance.

10.2 **SMD.** SMD warrants the Service will be performed in a professional and workmanlike manner consistent with industry standards.

10.3 **The Firm.** The Firm warrants it has the right to provide Customer Data to SMD for the purposes of this Agreement, including any required consents.

10.4 **Disclaimer.** EXCEPT AS EXPRESSLY STATED IN THIS SECTION 10, THE SERVICE IS PROVIDED "AS IS" AND SMD DISCLAIMS ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

10.5 **Insurance.** During the term, SMD maintains cyber liability and errors & omissions coverage that includes AI-services coverage, plus privacy and regulatory coverage for personal and medical data, with limits no less than those stated in Exhibit A. A certificate of insurance naming [A&P ENTITY] will be provided, and updated certificates on written request.

## 11. Limitation of Liability

11.1 EXCEPT FOR THE EXCLUSIONS IN SECTION 11.3, EACH PARTY'S AGGREGATE LIABILITY UNDER THIS AGREEMENT WILL NOT EXCEED [LIABILITY CAP].

11.2 EXCEPT FOR THE EXCLUSIONS IN SECTION 11.3, NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR LOSS OF PROFITS, REVENUE, DATA, OR BUSINESS OPPORTUNITY.

11.3 The limits in this Section 11 do not apply to (a) indemnification obligations under Section 12, (b) breach of Section 8 or Exhibit C, (c) a Party's gross negligence or willful misconduct, or (d) the Firm's payment obligations.

## 12. Indemnification

12.1 **By SMD.** SMD will defend and indemnify the Firm against third-party claims that the Service as provided by SMD infringes a U.S. patent, copyright, or trademark, conditioned on prompt notice, SMD's control of the defense, and reasonable cooperation.

12.2 **By the Firm.** The Firm will defend and indemnify SMD against third-party claims arising out of (a) Customer Data, (b) the Firm's use of the Service in violation of this Agreement or law, or (c) an action taken by the Operator within a ceiling the Firm authored in the Entitlement Configuration. Clause (c) does not extend to actions outside the authored configuration, to SMD's failure to enforce the configuration as specified, or to SMD's gross negligence or willful misconduct.

## 13. Disputes; Governing Law

13.1 The Parties first attempt informal resolution between authorized representatives, then mediation before a mutually agreed mediator (fees shared equally). If mediation fails within sixty (60) days, either Party may file in the state or federal courts of Arizona, to whose exclusive jurisdiction the Parties consent. This Agreement is governed by the laws of the State of Arizona, without regard to conflicts rules. Either Party may seek equitable relief in any court of competent jurisdiction for breaches of confidentiality.

## 14. General

Entire agreement (with Exhibits; body controls over Exhibits unless an Exhibit says otherwise); amendment only in signed writing; no assignment without consent except to a merger/acquisition successor; notices in writing to the signature-block addresses; force majeure (excluding payment); independent contractors; severability; no implied waiver; counterparts and electronic signature.

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

**Service.** The Litigation Lifecycle Operator per the proposal of 2026-06-26 and the routine-settings grid agreed in the correspondence of 2026-07-09 (Scott to Christa) and accepted 2026-07-23 (Christa to Scott), both incorporated by reference. The Portal Configuration Record is the configuration of record; where this Exhibit and the portal differ, the portal governs for settings the Firm controls.

**Routines and starting settings.** The nineteen routines of the agreed grid, at the agreed starting tiers, with the graduation ceilings the grid records. Confirmed settings: client verification escalates to a person after three (3) unanswered attempts; the treatment-gap flag is forty-five (45) days, adjustable to thirty (30) at the Firm's request.

**Permanent caps** (restating Section 2.3): opposing counsel and court communications always take a person's send; nothing touching deadlines or money auto-handles; the medical chronology is an internal record only.

**Connectors at go-live.** The Firm's practice-management system (Smokeball, the system of record); the Operator's mailbox in the Firm's Microsoft 365 tenant; the Claude-application connector providing direct Operator access for Firm-chosen users, riding the Firm's own Claude Enterprise account (SMD sets up and maintains this access; the Claude seats are the Firm's). Additional connectors are granted by the Firm per Section 2.5.

**Named Administrators.** [NAMED ADMINISTRATOR 1], [NAMED ADMINISTRATOR 2]. (The two individuals the Firm names for portal administration: pause control and entitlement settings.)

**Alert routing.** Per matter, via the responsible-attorney and assisting-staff roles in the Firm's practice-management system, per Section 7.3.

**Implementation Testing.** The joint validation of configured routines against live Firm matters per the implementation plan. Implementation Testing is complete when the Parties confirm in writing; that date is the Billing Start Date (Section 3.3).

**Payment method.** [PAYMENT METHOD].

**Insurance limits.** Technology errors & omissions and cyber liability: $1,000,000 policy aggregate. Commercial general liability: $1,000,000 each occurrence, $2,000,000 general aggregate.

**Pass-through cost categories.** None.

---

## Exhibit B: Data Processing Addendum

Attached as a separate document: [`data-processing-addendum.md`](./data-processing-addendum.md).

## Exhibit C: Confidentiality Addendum (Law Firm)

Attached as a separate document: [`confidentiality-addendum.md`](./confidentiality-addendum.md).
