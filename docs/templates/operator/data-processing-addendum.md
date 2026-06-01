# Data Processing Addendum (Template)

> Article-28-shaped Data Processing Addendum to the AI Employee Service Agreement. Internal drafting template; not a final form.

---

## Bracketed field reference

| Field                               | Meaning                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `[CUSTOMER LEGAL NAME]`             | The customer's full legal entity name.                                                                 |
| `[CUSTOMER STATE OF INCORPORATION]` | The state under whose laws the customer is organized.                                                  |
| `[CUSTOMER ADDRESS]`                | The customer's principal place of business.                                                            |
| `[EFFECTIVE DATE]`                  | The date this DPA becomes effective (ISO 8601: YYYY-MM-DD).                                            |
| `[FLY REGION]`                      | The Fly.io region where Customer's Machine is provisioned (for example, `us-west-2 (lax)`).            |
| `[RETENTION WINDOW DAYS]`           | The default post-termination retention window for archived encrypted namespaces, in days.              |
| `[RESTORATION WINDOW DAYS]`         | The post-termination window during which restoration to live state is available, in days.              |
| `[OFFBOARDING WINDOW DAYS]`         | The number of days SMD has to deliver the memory export on offboarding.                                |
| `[INCIDENT NOTIFICATION HOURS]`     | The maximum hours within which SMD will notify Customer of a confirmed Security Incident.              |
| `[DATA SUBJECT RESPONSE DAYS]`      | The number of business days SMD has to support Customer's response to a verified data subject request. |
| `[CUSTOMER SIGNATORY NAME]`         | The name of the individual signing for the customer.                                                   |
| `[CUSTOMER SIGNATORY TITLE]`        | The title of the individual signing for the customer.                                                  |
| `[ADDITIONAL TERMS]`                | Any negotiated additions specific to this engagement.                                                  |

---

# Data Processing Addendum

**This Data Processing Addendum (this "DPA") is entered into as of [EFFECTIVE DATE] (the "Effective Date") between SMDurgan, LLC (d/b/a SMD Services) ("SMD," "Processor") and [CUSTOMER LEGAL NAME] ("Customer," "Controller"). This DPA forms part of and is incorporated by reference into the AI Employee Service Agreement between the Parties dated [EFFECTIVE DATE] (the "Service Agreement"). Capitalized terms not defined in this DPA have the meanings given in the Service Agreement.**

## 1. Roles

1.1 Customer is the Controller of the Personal Data processed by SMD under the Service Agreement. SMD is the Processor.

1.2 SMD processes Personal Data only on documented instructions from Customer. The Service Agreement, this DPA, the Documentation, and Customer's configuration choices (recorded in Customer's `customer.yaml` configuration file maintained by SMD on Customer's behalf per Platform PRD §13.6 and [ADR 0012](../../adr/0012-customer-yaml-storage.md)) constitute Customer's documented instructions.

## 2. Categories of Personal Data and Data Subjects

2.1 **Categories of Personal Data.** Personal Data processed under this DPA may include:

(a) **Internal Customer team data**: names, business email addresses, business phone numbers, role designations, and authentication identifiers for Reviewers and other authorized users of the AI Employee.

(b) **Counterparty and third-party contact data**: names, email addresses, and other identifiers of clients, opposing counsel, court personnel, and other third parties with whom Customer's team communicates and whose data is therefore observed by the AI Employee in the course of drafting work product.

(c) **Substantive communication content**: the bodies of email, chat, and document content read by the AI Employee at active draft time to produce a draft, including any Personal Data contained in such content.

(d) **Audit metadata**: timestamps, actor identifiers, action types, content digests (cryptographic hashes), and structured-diff summaries of draft activity.

(e) **Voice samples and memory artifacts**: Customer-curated voice samples (real sent communications selected by Customer), structured-diff records of draft-vs-sent edits, and memory rules authored by Customer or learned from Customer edits.

2.2 **Special categories.** Personal Data may include attorney work product, health information, financial account information, or other categories subject to specific legal protection, depending on Customer's vertical. The BAA-Equivalent Confidentiality Addendum (Exhibit C to the Service Agreement) applies where such categories are present.

2.3 **Categories of Data Subjects.** Data Subjects include Customer's personnel, Customer's clients and counterparties, and any other natural person whose Personal Data is contained in Customer-connected systems the AI Employee is authorized to access.

## 3. Purposes of Processing

SMD processes Personal Data solely for the following purposes:

(a) operating the AI Employee Service per the Service Agreement;

(b) producing drafts and surfacing them to Reviewers for review and sending;

(c) maintaining the Memory Artifact (rules, person mappings, voice samples, audit log) per Customer's configured retention and scope;

(d) generating compliance evidence packets on Customer request per Platform PRD §13.6;

(e) responding to Customer support requests and operational incidents;

(f) fulfilling SMD's legal and audit obligations; and

(g) producing the portable export and decommissioning Customer's substrate on offboarding.

SMD will not process Personal Data for any other purpose, including SMD's own product development or marketing, except as expressly authorized by Customer in writing.

## 4. Closed-Loop Architecture Commitments

This Section 4 documents the architectural commitments that distinguish SMD's processing posture. Each commitment is enforced architecturally, not merely by policy.

4.1 **No training on Customer Data.** SMD does not use Customer Data to train, fine-tune, or otherwise modify the weights of any machine-learning model, whether operated by SMD or by a Sub-processor. "Training" means modifying model weights.

4.2 **Bounded indexing within Customer's namespaces.** SMD indexes specific categories of Customer Data for retrieval within Customer's own Machine and namespaces. Indexing is distinct from training and is bounded to:

(a) Customer-curated content (voice samples, memory rules, declared process knowledge);

(b) structural-diff data per Platform PRD §10.4 (formatting patterns from draft-vs-sent comparisons, not substantive content); and

(c) Customer's curated narrative knowledge per Platform PRD §10.1.

Substantive communication content (matter records, client emails, documents) is not indexed.

4.3 **Session-bounded substantive reads.** Substantive Customer content (matter records, client emails, documents) is read by the AI Employee at active draft time only. Substantive reads are not persisted into the Memory Artifact or any Sub-processor's storage; they exist only within the active draft session.

4.4 **Reviewer-as-sender.** No outbound customer-bound message is sent under the AI Employee's identity. Every outbound message is drafted into a Reviewer's drafts folder for the Reviewer to review, edit, and send under the Reviewer's own identity. This commitment is architectural and is documented in [ADR 0005](../../adr/0005-reviewer-as-sender.md).

4.5 **Per-Customer Machine isolation.** Customer's runtime, storage namespaces, and credentials are exclusive to Customer's Machine. No cross-Machine query path exists. The boot-time invariant check refuses to start Customer's Machine if its storage bindings include namespaces outside Customer's slug. This is enforced architecturally per [ADR 0007](../../adr/0007-per-customer-machine-isolation.md) and [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md), with the runtime check recorded as Safety Substrate invariant #7 per Platform PRD §7.5.

4.6 **No cross-customer learning.** Customer Data does not flow to any other SMD customer's Machine, to SMD's shared skill catalog, or to any SMD process that aggregates content across customers. Platform-level improvements are authored by SMD from human-readable insights, never inferred from Customer runtime data.

## 5. Sub-processors

5.1 **Authorized Sub-processors at the Effective Date.** Customer authorizes the following Sub-processors:

| Sub-processor  | Role                                                                                                                             | Data categories processed                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Anthropic**  | Large language model inference for draft generation. Operates on a per-draft request basis; no retention of Customer content.    | Substantive content provided at draft time, request metadata.                                                                                    |
| **Composio**   | Connector platform brokering OAuth and API calls to Customer-authorized third-party systems (email, calendar, document, e-sign). | Connector credentials (OAuth tokens stored in SMD's vault and used through Composio brokered calls); content read or written through connectors. |
| **Fly.io**     | Hosting platform for Customer's dedicated Machine. Provides compute and storage isolation per Machine.                           | Compute environment; in-memory state of active sessions.                                                                                         |
| **Cloudflare** | Storage platform for Customer's dedicated D1 (structured rows), R2 (object storage), and Vectorize (vector index) namespaces.    | Memory Artifact contents, audit log rows, voice samples, vault objects, embeddings.                                                              |

5.2 **Sub-processor terms.** SMD has entered into written agreements with each Sub-processor that impose data protection obligations no less protective than those in this DPA, and that prohibit Sub-processors from using Customer Data for any purpose other than providing the contracted services. Sub-processors are prohibited from training models on Customer Data.

5.3 **New Sub-processors.** SMD may engage additional Sub-processors with at least thirty (30) days' written notice to Customer. Customer may object to a new Sub-processor on reasonable data protection grounds within fifteen (15) days of notice. If the Parties cannot resolve Customer's objection in good faith, Customer may terminate the Service Agreement without penalty effective on the proposed Sub-processor onboarding date.

5.4 **Sub-processor liability.** SMD remains liable to Customer for the acts and omissions of its Sub-processors with respect to Personal Data to the same extent SMD would be liable if performing the services directly.

5.5 **Vendor-hostile-content rules.** Some third-party content vendors prohibit ingestion of their content into third-party AI. The platform enforces this at the connector layer per Platform PRD §13.4. Where Customer connects such a source, content from that source is read by Customer's human users only and is not ingested into the AI Employee's context, drafting, or Memory Artifact.

## 6. Data Residency

6.1 Customer's Machine is provisioned in the Fly.io region [FLY REGION]. Customer's D1, R2, and Vectorize namespaces are bound to that Machine and operate within Cloudflare's distributed edge.

6.2 SMD's control plane (the operational layer that provisions and monitors Machines) operates from Cloudflare's distributed edge and supporting U.S. infrastructure.

6.3 Customer may request a different Machine region. SMD will accommodate reasonable requests subject to Sub-processor availability in the requested region.

## 7. Security Measures

7.1 SMD maintains the following security measures:

(a) **Per-Customer credential isolation**: Customer's connector credentials (OAuth tokens, API keys for systems Customer has authorized) are stored at per-Customer paths in SMD's managed secrets vault. No literal secret value is permitted in `customer.yaml` per the secret-detector enforcement described in Platform PRD §13.6.

(b) **Encryption in transit**: TLS for all network communication between Sub-processor endpoints, the Machine, and Customer-connected systems.

(c) **Encryption at rest**: storage-backend-level encryption at the D1, R2, and Vectorize layer per Sub-processor defaults.

(d) **Access controls**: SMD operational access to Customer's Machine and namespaces is limited to Captain and explicitly authorized SMD operators. Access events are logged in the SMD operational audit trail.

(e) **Audit logging**: an append-only audit log per Customer Machine recording every agent action, every draft produced, every Reviewer edit, every connector call, and every Machine boot-check result. The audit log is part of the Memory Artifact and is exportable per Section 11.

(f) **Boot-time invariant checks**: the eight safety invariants per Platform PRD §7.5 are verified at every Machine boot. Failure of any invariant causes the Machine to refuse to start and alerts the control plane.

(g) **Skill-catalog merge gate**: platform-level skill catalog merges are gated by a human review check that prohibits customer-specific content from entering the shared catalog, enforcing the cross-customer prohibition at the source-control layer.

7.2 SMD reviews and updates its security measures regularly. SMD may modify its security measures from time to time, provided the modifications do not materially reduce the protection of Customer Data.

## 8. Security Incidents

8.1 **Definition.** A "Security Incident" is a confirmed breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorized disclosure of, or access to Customer Data processed by SMD or any Sub-processor.

8.2 **Notification.** SMD will notify Customer without undue delay (and in any case within [INCIDENT NOTIFICATION HOURS] hours) of a confirmed Security Incident affecting Customer Data. The notification will include the information then known to SMD, including:

(a) the nature of the Security Incident, including the categories and approximate volume of Personal Data and Data Subjects affected;

(b) the likely consequences of the Security Incident;

(c) the measures SMD has taken or proposes to take to address the Security Incident and mitigate its possible adverse effects; and

(d) the name and contact details of SMD's response coordinator.

8.3 **Investigation.** SMD will promptly investigate the Security Incident and provide Customer with regular status updates until the Security Incident is resolved.

8.4 **Cooperation.** SMD will provide Customer with reasonable cooperation and information to enable Customer to fulfill its own notification obligations to data protection authorities, Data Subjects, or other affected parties.

8.5 **No admission of fault.** SMD's notification of a Security Incident is not an admission of fault or liability.

## 9. Data Subject Rights

9.1 Customer is responsible for responding to Data Subject requests (access, rectification, erasure, restriction, portability, objection). SMD does not have direct relationships with Data Subjects.

9.2 SMD will assist Customer in responding to verified Data Subject requests by:

(a) producing structured exports of Personal Data within Customer's Memory Artifact relating to an identified Data Subject within [DATA SUBJECT RESPONSE DAYS] business days of Customer's request, to the extent that the data is locatable in the Memory Artifact;

(b) processing Customer-instructed deletions of Personal Data within the Memory Artifact within [DATA SUBJECT RESPONSE DAYS] business days, subject to retention requirements that apply to the audit log per Section 10.4; and

(c) implementing Customer-instructed restrictions on processing for identified Data Subjects.

9.3 SMD does not respond to Data Subject requests directly. If SMD receives a request directly from a Data Subject relating to Customer's processing, SMD will forward the request to Customer without undue delay and will not respond to the Data Subject other than to acknowledge receipt and direct the Data Subject to Customer.

## 10. Retention

10.1 **In-engagement retention.** During the Term of the Service Agreement, SMD retains Customer Data in the Memory Artifact per Customer's configuration. Default retention for substantive draft history is bounded per Platform PRD §10.4; the audit log is append-only and retained for the full Term.

10.2 **Configurable per engagement.** Retention windows for substantive content categories are configurable per engagement in the `customer.yaml` per Platform PRD §13.3. Customer may adjust retention by submitting a written reconfiguration request to SMD.

10.3 **Post-termination retention.** Following termination of the Service Agreement:

(a) The portable export per Section 11 is produced and delivered to Customer within [OFFBOARDING WINDOW DAYS] days.

(b) Customer's namespaces are archived in an encrypted state for [RETENTION WINDOW DAYS] days, during which time the first [RESTORATION WINDOW DAYS] days permit Customer to request restoration to a live state for a Captain-quoted reactivation fee. The default windows are stated as bracketed values above; Customer may select shorter windows including immediate deletion at termination.

(c) After [RETENTION WINDOW DAYS] days, SMD performs verifiable hard deletion of the archived namespaces per the procedure documented in the [decommission spec](../../specs/ai-employee/decommission-customer.md) and provides Customer with written confirmation.

10.4 **Audit log retention exception.** SMD retains the audit log for the period Customer paid for, per Platform PRD §13.6. Customer-instructed deletions affecting Personal Data within the substantive content layer do not delete the audit log entries that record the existence of the affected action; the audit log retains the action metadata (timestamps, actor, action type, content digests) but the substantive content is removed.

## 11. Memory Portability

11.1 On Customer's written request at any time during the Term, or automatically upon termination, SMD produces a portable export of Customer's Memory Artifact in the form documented in [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md) and the operational memory export specification.

11.2 The export package includes:

(a) memory rules as structured JSON;

(b) person mappings as structured JSON;

(c) the R2 vault contents (process knowledge, structural-diff records, voice samples) as a tarball preserving original markdown and sanitized voice-sample form;

(d) the audit log as append-only JSONL covering the full retention period; and

(e) a manifest with cryptographic hashes for integrity verification.

11.3 The export is delivered to Customer within [OFFBOARDING WINDOW DAYS] days of the request (or, on termination, of the Effective Termination Date). On-request exports during the Term are subject to a reasonable Captain-quoted fee for engineering time if requested more frequently than once per quarter.

## 12. Audit Rights

12.1 **Documentation.** On Customer's written request, SMD will make available to Customer the information necessary to demonstrate compliance with this DPA, including:

(a) summary descriptions of SMD's security measures;

(b) the most recent compliance evidence packet generated for Customer per Platform PRD §13.6; and

(c) Sub-processor information sufficient to allow Customer to evaluate the data protection posture of each Sub-processor.

12.2 **Audit.** Customer may, no more than once per twelve-month period and at Customer's own cost, audit SMD's compliance with this DPA. Audits are conducted on at least thirty (30) days' advance written notice, during SMD's regular business hours, and in a manner that does not unreasonably interfere with SMD's operations. Customer's auditors must be subject to a written confidentiality obligation no less protective than Section 7 of the Service Agreement.

12.3 **Audit-by-evidence-packet alternative.** SMD's compliance evidence packet (per Platform PRD §13.6) is designed to satisfy Customer's audit requirements without a site visit. Customer may rely on the evidence packet as the primary audit artifact; an on-site audit is reserved for circumstances where the evidence packet does not address Customer's specific question.

## 13. Cross-Border Data Transfers

13.1 SMD's processing infrastructure is described in Section 6. Customer authorizes the transfers contemplated by Section 6 as necessary to perform the Service.

13.2 If applicable law requires standard contractual clauses or other data-transfer mechanisms for transfers covered by this DPA, the Parties will execute the required instruments. Until such instruments are executed, SMD will process Personal Data using the safeguards described in this DPA and in the Service Agreement.

## 14. Term and Survival

14.1 This DPA is effective for the Term of the Service Agreement and will terminate with the Service Agreement.

14.2 Sections 8 (with respect to Security Incidents discovered or notified during the Term), 10.3, 10.4, 11, and 13 survive termination of this DPA for the periods stated in those Sections or as required by applicable law.

## 15. Additional Terms

[ADDITIONAL TERMS]

---

**IN WITNESS WHEREOF, the Parties have executed this DPA as of the Effective Date.**

**SMDurgan, LLC (d/b/a SMD Services)**

By: `______________________________`
Name: Scott Durgan
Title: Principal
Date: `______________________________`

**[CUSTOMER LEGAL NAME]**

By: `______________________________`
Name: [CUSTOMER SIGNATORY NAME]
Title: [CUSTOMER SIGNATORY TITLE]
Date: `______________________________`

---

> This is a TEMPLATE. Before customer countersignature, this document must be (1) reviewed by Captain and (2) reviewed by external counsel licensed in the customer's jurisdiction.
