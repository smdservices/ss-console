# Data Processing Addendum - Ashton & Price LLP (DRAFT, Exhibit B)

> **Status: DRAFT for Captain review. Not sent. Not signed.** Instantiated from
> `docs/legal/operator-dpa-template.md` (v0.1, #1680) for the Ashton & Price engagement.
> Counsel review required before signature; the CCPA service-provider clause (§6) is new
> substantive clause language beyond the template and needs specific counsel attention.
> This internal header block is stripped from the client-facing final form.

## Term provenance (doctrine Law 5)

| Term                                                           | Source                                                                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 30-day advance notice of sub-processor changes                 | Template §4.1; ADR 0065                                                                                                                      |
| 24-hour security-incident notification                         | Template §6; ADR 0064; matches the standing Smokeball commitment                                                                             |
| 14-day export of audit record + operational memory             | Template §7; ADR 0065; letter 10 §5                                                                                                          |
| 30-day return-and-destruction; written attestation on request  | Template §7; ADR 0065; letter 10 §5                                                                                                          |
| AgentMail struck from sub-processors; M365 tenant-mailbox note | Letter 10 §8; ADR 0078                                                                                                                       |
| No training on Client Data                                     | Template §5; letter 10 §2                                                                                                                    |
| CCPA service-provider terms                                    | Engagement research record (dossier, 2026-07: DPA with CCPA terms is the vehicle; no BAA as business associate); **counsel review required** |
| Annual controls walkthrough; no SOC 2/ISO claims               | Template §8.2; letter 10 §4                                                                                                                  |
| Governing law inherited from the Agreement (Arizona)           | Captain decision 2026-07-27                                                                                                                  |

## Open items before this leaves the building

1. Counsel review, with specific attention to §6 (CCPA service-provider terms) as new clause language.
2. Confirm the Clerk / Stripe / SignWell / Resend rows against what the A&P engagement will actually use at signing (billing and signature tooling in particular).

---

# Data Processing Addendum

This Data Processing Addendum ("DPA") forms part of the Operator Service Agreement (the "Agreement") between **SMDurgan, LLC d/b/a SMD Services** ("SMD") and **[A&P ENTITY]** ("Client"), is incorporated into the Agreement as Exhibit B, and governs SMD's processing of Client Data in connection with the Operator service.

## 1. Roles and scope

1.1. Client is the controller of Client Data. SMD acts as processor, processing Client Data only to provide the Operator service and only on Client's documented instructions, which consist of the Agreement, the authored Operator configuration, and instructions given through the client portal or the Operator's authorized channels.

1.2. Client's business systems (practice management, email, calendars, documents) remain the systems of record. SMD does not warehouse copies of the data held in those systems; the Operator accesses them transiently through Client-authorized connections to perform requested work.

1.3. Client Data includes, in the ordinary course of Client's plaintiff-side personal-injury practice, medical records and other health information of Client's clients, obtained under those individuals' authorizations. Such information is processed only under this DPA and the Confidentiality Addendum (Exhibit C to the Agreement). SMD is not a business associate of Client under HIPAA; Client is a law firm, not a covered entity, and the parties' obligations for this information are the contractual terms of this DPA and Exhibit C.

## 2. Data processed

| Category                 | Examples                                                                             | Where it lives                                          |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Employee identity data   | Names, work email addresses, roles of Client staff granted Operator or portal access | SMD control plane (identity provider and access grants) |
| Configuration data       | Authored routines, entitlement settings, rosters                                     | Client's dedicated machine and SMD control plane        |
| Operational memory       | Working memory the Operator builds performing Client's work                          | Client's dedicated machine                              |
| Governance records       | Append-only audit log of Operator actions; access-grant audit                        | Client's dedicated machine and SMD control plane        |
| Transient task content   | Business data read through Client's systems while performing a task                  | In memory during the task; not retained by SMD          |
| Operator email           | Mail sent and received through the Operator's mailbox                                | Client's own Microsoft 365 tenant, under Client's terms |
| Account and billing data | Contacts, invoices, subscription records                                             | SMD control plane and billing sub-processor             |

Data subjects are Client's personnel and the individuals whose information appears in Client's business records in the ordinary course of Client's work.

## 3. Security measures

SMD implements the measures described in its Security Overview (available in long form on request), including: a dedicated, isolated compute instance and encrypted volume per client; connection credentials stored only on Client's machine with process-level custody separation; a fail-closed authority model in which unconfigured action classes are refused; structural isolation of untrusted inbound content; an append-only audit log the agent cannot modify; access grants evaluated live per request with immediate revocation effect; and a controlled software delivery pipeline with automated security gates.

## 4. Sub-processors

4.1. Client authorizes the sub-processors listed in Exhibit B-1. SMD will notify Client at least **30** days before adding or replacing a sub-processor that will process Client Data, and Client may object on reasonable grounds relating to data protection.

4.2. SMD remains responsible for its sub-processors' performance of this DPA's obligations.

## 5. Confidentiality; no training

SMD limits access to Client Data to personnel and processes that need it to deliver the service, binds personnel to confidentiality obligations, and does not sell Client Data or use it for any purpose other than providing the service. Client Data is never used to train, fine-tune, or otherwise modify any machine-learning model: content processed through the language model provider is not used to train models per that provider's commercial terms, and SMD makes the same commitment for itself. Client Data never benefits any other SMD customer.

## 6. CCPA service-provider terms

To the extent Client Data includes personal information of California residents subject to the California Consumer Privacy Act as amended ("CCPA"), SMD acts as Client's "service provider." SMD will not: sell or share the personal information; retain, use, or disclose it for any purpose other than performing the services under the Agreement or as permitted by the CCPA; retain, use, or disclose it outside the direct business relationship with Client; or combine it with personal information received from other sources except as permitted by the CCPA. SMD certifies that it understands these restrictions and will comply with them, will notify Client if it determines it can no longer meet its CCPA obligations, and grants Client the right, upon reasonable notice, to take reasonable steps to stop and remediate unauthorized use of personal information.

## 7. Incident notification

SMD will notify Client without undue delay, and in any case within **24** hours, after becoming aware of a security incident affecting Client Data, will provide information reasonably required for Client's own notification obligations as it becomes available, and will cooperate in the investigation and remediation.

## 8. Return and deletion

8.1. During the term, Client may export its governance records from the client portal and may request an evidence packet at any time.

8.2. On termination of the Agreement, SMD will: (a) deliver Client's audit record and the Operator's operational memory in exportable form, within **14** days of the termination effective date; (b) revoke all access grants and connection credentials; (c) destroy Client's dedicated machine and volume; and (d) delete residual Client Data from the control plane, excepting records SMD must retain for legal, tax, or accounting purposes. Return and destruction are completed within **30** days of termination, and SMD will confirm destruction in writing on request.

## 9. Assistance and audits

9.1. SMD will reasonably assist Client with data subject requests and regulatory inquiries that concern the Operator's processing.

9.2. Once per year, or following a security incident affecting Client Data, Client may request a review of SMD's controls in the form of a documented walkthrough with SMD's security contact, together with supporting evidence. SMD does not hold its own SOC 2 or ISO 27001 certification and says so plainly; sub-processor attestations are listed in Exhibit B-1.

## 10. Term and precedence

This DPA applies for as long as SMD processes Client Data and survives termination until return and deletion complete. If this DPA conflicts with the Agreement, this DPA controls with respect to data protection.

---

## Exhibit B-1 - Sub-processors

| Sub-processor | Role                                                  | Client Data touched                                                                                         | Attestation                             |
| ------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Fly.io        | Hosts Client's dedicated machine and encrypted volume | Transient task content in memory; credentials, configuration, memory, and audit records at rest (encrypted) | SOC 2 Type II (trust.fly.io)            |
| Anthropic     | Language model inference                              | Task content, transiently; not used for model training per commercial terms                                 | SOC 2 Type II (trust.anthropic.com)     |
| Cloudflare    | Control plane, client portal, governance record store | Employee identity data, configuration projections, governance summaries                                     | SOC 2 / ISO 27001                       |
| Clerk         | Portal and access sign-in                             | Employee identity data                                                                                      | SOC 2 Type II                           |
| Stripe        | Billing                                               | Billing contact and payment records                                                                         | PCI DSS Level 1, SOC 2                  |
| SignWell      | Agreement signing                                     | Signatory names and executed documents                                                                      | SOC 2                                   |
| Resend        | Transactional email                                   | Recipient names and addresses                                                                               | SOC 2 Type II                           |
| Infisical     | SMD-side secrets management                           | No Client Data                                                                                              | Encrypted store, named-principal access |

The Operator's mailbox is provisioned inside Client's own Microsoft 365 tenant; that mail processing occurs within Client's tenancy under Client's own Microsoft terms, and Microsoft is accordingly not an SMD sub-processor. Client's own business systems (Smokeball, InfoTrack, and similar) are Client's vendor relationships, not SMD sub-processors. AgentMail is not used in this engagement and is not a sub-processor for Client.

---

**Completion at signing:** the standard terms above (30 days §4.1, 24 hours §7, 14/30 days §8.2) are the ADR 0064/0065 defaults, matching the commitments in the correspondence of 2026-07-27. Governing law is inherited from the Agreement (Arizona).
