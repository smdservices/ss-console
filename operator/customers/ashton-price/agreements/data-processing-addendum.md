# Data Processing Addendum - Ashton & Price LLP (DRAFT, Exhibit B)

> **Status: DRAFT for Captain review. Not sent. Not signed.** Instantiated from
> `docs/legal/operator-dpa-template.md` (v0.1, #1680); revised 2026-07-27 per the
> four-reviewer counsel panel (CCPA clause completed to the 11 CCR 7051(a) elements,
> CMIA no-further-disclosure and HIPAA-transition provisions added, data map corrected,
> sub-processor exhibit corrected, deletion/correction mechanics and litigation-hold
> suspension added). External licensed-counsel review waived by Captain 2026-07-27.
> This internal header block is stripped from the client-facing final form.

## Term provenance (doctrine Law 5)

| Term                                                            | Source                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| 30-day advance notice of sub-processor changes                  | Template §4.1; ADR 0065                                       |
| 24-hour security-incident notification (on awareness)           | Template; ADR 0064; matches the standing Smokeball commitment |
| 14-day export of audit record + operational memory              | Template; ADR 0065; letter 10 §5                              |
| 30-day return-and-destruction; written attestation on request   | Template; ADR 0065; letter 10 §5                              |
| AgentMail struck from sub-processors; M365 tenant-mailbox note  | Letter 10 §8; ADR 0078                                        |
| No training on Client Data                                      | Template §5; letter 10 §2                                     |
| CCPA service-provider terms (completed elements)                | Counsel panel 2026-07-27 (11 CCR 7051(a) checklist)           |
| CMIA §56.13 no-further-disclosure covenant (in Exhibit C §3.4)  | Counsel panel 2026-07-27                                      |
| HIPAA posture as Firm representation + BAA-transition re-opener | Counsel panel 2026-07-27; research record (dossier, 2026-07)  |
| 10-business-day deletion/correction assistance window           | Counsel panel 2026-07-27; **Captain ratification pending**    |
| Litigation-hold suspension of destruction                       | Counsel panel 2026-07-27                                      |
| US data residency                                               | Counsel panel 2026-07-27; Fly region sjc (customer.yaml)      |
| Annual controls walkthrough; no SOC 2/ISO claims                | Template §9.2; letter 10 §4                                   |
| Governing law inherited from the Agreement (Arizona)            | Captain decision 2026-07-27                                   |

## Open items before this leaves the building

1. Confirm the Clerk / Stripe / SignWell / Resend rows against what the A&P engagement will actually use at signing (billing and signature tooling in particular).
2. Verify Sentry data scrubbing is configured on the smd-operator project so the Exhibit B-1 row's "technical error data" description holds (open item also carried on the Agreement).
3. Captain ratification of the 10-business-day deletion/correction assistance window (§9.1).

---

# Data Processing Addendum

This Data Processing Addendum ("DPA") forms part of the Operator Service Agreement (the "Agreement") between **SMDurgan, LLC d/b/a SMD Services** ("SMD") and **[A&P ENTITY]** ("Client," the party defined as "Customer" or "the Firm" in the Agreement), is incorporated into the Agreement as Exhibit B, and governs SMD's processing of Client Data in connection with the Operator service. Capitalized terms not defined in this DPA have the meanings given in the Agreement; **"Client Data"** has the meaning given to "Customer Data" in the Agreement.

## 1. Roles and scope

1.1. Client is the controller (and, for personal information subject to the CCPA, the "business") with respect to Client Data. SMD acts as processor (and "service provider"), processing Client Data only to provide the Operator service and only on Client's documented instructions, which consist of the Agreement, the authored Operator configuration, and instructions given through the client portal or the Operator's authorized channels.

1.2. Client's business systems (practice management, email, calendars, documents) remain the systems of record. SMD does not warehouse copies of the data held in those systems; the Operator accesses them transiently through Client-authorized connections to perform requested work.

1.3. Client Data includes, in the ordinary course of Client's plaintiff-side personal-injury practice, medical records and other health information of Client's clients. Client represents that it is not a HIPAA covered entity, and is not acting as a business associate of any covered entity, with respect to the information it makes available to the Operator, and that such health information is held under valid authorizations from the individuals concerned (Agreement §10.3). On that basis, SMD is not a business associate of Client under HIPAA, and the Parties' obligations for this information are the contractual terms of this DPA and the Confidentiality Addendum (Exhibit C to the Agreement). If Client notifies SMD that this has ceased to be accurate, the Parties will negotiate and execute a business associate agreement before any protected health information subject to HIPAA is made available to the Operator; pending execution, this DPA and Exhibit C govern.

## 2. Data processed

| Category                 | Examples                                                                             | Where it lives                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee identity data   | Names, work email addresses, roles of Client staff granted Operator or portal access | SMD control plane (identity provider and access grants); configuration repository                                                                                                                                                                               |
| Configuration data       | Authored routines, entitlement settings, rosters                                     | Client's dedicated machine, SMD's configuration repository, and SMD control plane                                                                                                                                                                               |
| Operational memory       | Working memory the Operator builds performing Client's work                          | Client's dedicated machine                                                                                                                                                                                                                                      |
| Governance records       | Append-only audit log of Operator actions; access-grant audit                        | Full audit log: Client's dedicated machine. High-level governance summaries: SMD control plane                                                                                                                                                                  |
| Transient task content   | Business data read through Client's systems while performing a task                  | In memory during the task; not retained by SMD                                                                                                                                                                                                                  |
| Operator email           | Mail sent and received through the Operator's mailbox                                | Stored in Client's own Microsoft 365 tenant under Client's terms; message content the Operator reads is additionally processed on Client's dedicated machine and transmitted to the language model provider for inference, as with other transient task content |
| Account and billing data | Contacts, invoices, subscription records                                             | SMD control plane and billing sub-processor                                                                                                                                                                                                                     |

Data subjects are Client's personnel and the individuals whose information appears in Client's business records in the ordinary course of Client's work.

## 3. Security measures

SMD implements and maintains a security program designed to protect Client Data, currently including the following measures, which SMD may update from time to time provided the protection afforded is not materially diminished: a dedicated, isolated compute instance and encrypted volume per client, hosted in the United States; connection credentials stored only on Client's machine with process-level custody separation; a fail-closed authority model in which unconfigured action classes are refused; structural isolation of untrusted inbound content; an append-only audit log the agent cannot modify; access grants evaluated live per request with immediate revocation effect; and a controlled software delivery pipeline with automated security gates (dependency scanning failing the build on high or critical findings, full-history secret detection, and static analysis on every change and daily). SMD will not relocate Client's machine or volume outside the United States without Client's prior written consent. These measures satisfy, and are intended to satisfy, the reasonable-security requirement of California Civil Code §1798.81.5.

## 4. Sub-processors

4.1. Client authorizes the sub-processors listed in Exhibit B-1. SMD will notify Client at least **30** days before adding or replacing a sub-processor that will process Client Data (a change of language-model provider under Agreement §2.6 is such a change), and Client may object on reasonable grounds relating to data protection within the notice period. If Client objects, SMD will use commercially reasonable efforts to provide an alternative that avoids the objection; if it cannot on commercially reasonable terms, either Party may terminate the Agreement on thirty (30) days' written notice, which is Client's exclusive remedy for the objection.

4.2. SMD remains responsible for its sub-processors' performance of this DPA's obligations.

4.3. SMD maintains a written contract with each sub-processor that processes Client Data imposing obligations no less protective than this DPA, including the CCPA service-provider terms of Section 6 where applicable, and will provide evidence of such contracts on Client's reasonable request.

## 5. Confidentiality; no training

SMD limits access to Client Data to personnel and processes that need it to deliver the service, binds personnel to confidentiality obligations, and does not sell Client Data or use it for any purpose other than providing the service. Client Data is never used to train, fine-tune, or otherwise modify any machine-learning model: SMD makes that commitment for itself, contracts with its model providers on terms under which content submitted for inference is not used to train models, and will not route Client Data to a provider whose terms permit training on it. Client Data never benefits any other SMD customer.

## 6. CCPA service-provider terms

6.1. To the extent Client Data includes personal information of California residents subject to the California Consumer Privacy Act as amended ("CCPA"), Client discloses personal information to SMD only for, and SMD processes it only for, the following limited and specified business purposes: (a) reading matter records, correspondence, and calendar entries from Client's practice-management system, mailbox, and other connected systems to perform the routines configured in Exhibit A to the Agreement; (b) preparing drafts, internal summaries, and chronologies for review by Client's personnel; (c) writing task results back into Client's systems of record; (d) maintaining the Operator's operational memory and the append-only audit record; (e) provisioning, operating, monitoring, securing, and maintaining the Operator and the dedicated machine; and (f) providing support to Client's personnel. SMD will not process such personal information for any other business or commercial purpose.

6.2. SMD will not: sell or share the personal information; retain, use, or disclose it for any purpose other than the business purposes in Section 6.1 or as otherwise permitted of a service provider by the CCPA; retain, use, or disclose it outside the direct business relationship with Client; or combine it with personal information received from or on behalf of another person, or collected from SMD's own interaction with the consumer, except as the CCPA and its regulations permit a service provider to do.

6.3. SMD will comply with all obligations applicable to it under the CCPA and its implementing regulations, and will provide the same level of privacy protection to the personal information as the CCPA requires of Client. SMD certifies that it understands the restrictions of this Section 6 and will comply with them, and will notify Client if it determines it can no longer meet its obligations under the CCPA.

6.4. Client may (a) take reasonable and appropriate steps to help ensure that SMD uses the personal information in a manner consistent with Client's obligations under the CCPA, including through the review right in Section 9.2, and (b) upon notice, take reasonable and appropriate steps to stop and remediate any unauthorized use of the personal information.

6.5. Notwithstanding the governing-law provision of the Agreement, SMD will comply with California privacy and data-security law applicable to its processing of Client Data, including the CCPA and California Civil Code §1798.81.5. Nothing in this DPA or the Agreement waives or limits any right of a California consumer under the CCPA.

## 7. Incident notification

SMD will notify Client without undue delay, and in any case within **24** hours, after becoming aware of a security incident affecting Client Data, and will cooperate in the investigation and remediation. SMD's notice will include, to the extent known and as information becomes available, the categories of Client Data affected, the individuals or categories of individuals affected, the date or estimated date of the incident, a description of what occurred, and the remediation taken or planned, in the detail reasonably required for any notice Client must give under California Civil Code §1798.82. SMD will supplement its notice as information develops and will not delay initial notice to complete its investigation.

## 8. Return and deletion

8.1. During the term, Client may export its governance records from the client portal and may request an export of its governance records at any time.

8.2. On termination of the Agreement, SMD will: (a) deliver Client's audit record and the Operator's operational memory in exportable form, within **14** days of the termination effective date; (b) revoke all access grants and connection credentials; (c) destroy Client's dedicated machine and volume; and (d) delete residual Client Data from the control plane, excepting records SMD must retain for legal, tax, or accounting purposes, which remain subject to the Agreement's confidentiality terms and Exhibit C for as long as they are held. Return and destruction are completed within **30** days of termination, and SMD will confirm destruction in writing on request.

8.3. SMD will suspend destruction under Sections 8.2(c) and (d) for any Client Data identified in a written notice from Client stating that Client is subject to a litigation hold, regulatory inquiry, or professional-responsibility proceeding, and will preserve that data until Client releases the hold in writing.

## 9. Assistance and audits

9.1. SMD will assist Client with consumer requests and regulatory inquiries concerning the Operator's processing, including providing on request the information about SMD's processing reasonably necessary for Client to conduct and document any risk assessment or similar compliance documentation required of Client under California law. On Client's written direction that it has received a verifiable consumer request for deletion or correction, SMD will delete or correct the relevant personal information within the Operator's operational memory and SMD's control plane within ten (10) business days and confirm completion in writing. SMD's obligation does not extend to (a) information Client directs SMD to retain or that may be retained under a CCPA exemption, including for the exercise or defense of legal claims; (b) information within Client's own systems of record, which Client controls directly; or (c) the append-only audit record, whose integrity depends on its immutability and which is retained for the life of the engagement as a governance record and delivered to Client on termination. SMD will identify to Client any information it cannot delete and the basis for retention.

9.2. Once per year, or following a security incident affecting Client Data, Client may request a review of SMD's controls in the form of a documented walkthrough with SMD's security contact, together with supporting evidence. SMD does not hold its own SOC 2 or ISO 27001 certification and says so plainly; sub-processor attestations are listed in Exhibit B-1.

## 10. Term and precedence

This DPA applies for as long as SMD processes Client Data and survives termination until return and deletion complete (and, as to Section 8.3 holds, until released). If this DPA conflicts with the Agreement, this DPA controls with respect to data protection, subject to the order of precedence in Agreement §14.2.

---

## Exhibit B-1 - Sub-processors

| Sub-processor | Role                                                     | Client Data touched                                                                                                                                                                                                                                 | Attestation                             |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Fly.io        | Hosts Client's dedicated machine and encrypted volume    | Transient task content in memory; credentials, configuration, memory, and audit records at rest (encrypted)                                                                                                                                         | SOC 2 Type II (trust.fly.io)            |
| Anthropic     | Language model inference                                 | Task content, including matter content and medical information, processed for inference; retained by the provider only for the limited period its commercial terms provide for trust-and-safety purposes, and not used to train or fine-tune models | SOC 2 Type II (trust.anthropic.com)     |
| Cloudflare    | Control plane, client portal, governance record store    | Employee identity data, configuration projections, high-level governance summaries                                                                                                                                                                  | SOC 2 / ISO 27001                       |
| GitHub        | Configuration repository                                 | Authored configuration, including rosters naming Client personnel (work names, addresses, roles); no matter content                                                                                                                                 | SOC 2 (github.com/security)             |
| Sentry        | Error and performance monitoring of the Operator runtime | Technical error data (stack traces, error messages, runtime metadata)                                                                                                                                                                               | SOC 2 Type II                           |
| Clerk         | Portal and access sign-in                                | Employee identity data                                                                                                                                                                                                                              | SOC 2 Type II                           |
| Stripe        | Billing                                                  | Billing contact and payment records                                                                                                                                                                                                                 | PCI DSS Level 1, SOC 2                  |
| SignWell      | Agreement signing                                        | Signatory names and executed documents                                                                                                                                                                                                              | SOC 2                                   |
| Resend        | Transactional email from the portal and control plane    | Recipient names and addresses for portal notices; carries no Operator client-content or matter content                                                                                                                                              | SOC 2 Type II                           |
| Infisical     | SMD-side secrets management                              | No Client Data                                                                                                                                                                                                                                      | Encrypted store, named-principal access |

The Operator's mailbox is provisioned inside Client's own Microsoft 365 tenant; mail storage and tenancy processing occur within Client's tenancy under Client's own Microsoft terms, and Microsoft is accordingly not an SMD sub-processor (message content the Operator reads is processed per the Section 2 table). The Claude-application connector rides Client's own Claude Enterprise account on the same analysis: Client's vendor relationship, not an SMD sub-processor. Client's own business systems (Smokeball, InfoTrack, and similar) are Client's vendor relationships, not SMD sub-processors. AgentMail is not used in this engagement and is not a sub-processor for Client.

---

**Completion at signing:** the standard terms above (30 days §4.1, 24 hours §7, 14/30 days §8.2) are the ADR 0064/0065 defaults, matching the commitments in the correspondence of 2026-07-27. Governing law is inherited from the Agreement (Arizona), subject to Section 6.5.

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
