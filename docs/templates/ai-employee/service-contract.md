# AI Employee Service Contract (Template)

> Master agreement for the AI Employee service. Internal drafting template; not a final form.

---

## Bracketed field reference

Replace every bracketed value before exporting to PDF for DocuSign. Fields are validated by the signing-flow checklist in [`signing-flow.md`](./signing-flow.md).

| Field                               | Meaning                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `[CUSTOMER LEGAL NAME]`             | The customer's full legal entity name.                                  |
| `[CUSTOMER STATE OF INCORPORATION]` | The state under whose laws the customer is organized.                   |
| `[CUSTOMER ADDRESS]`                | The customer's principal place of business.                             |
| `[EFFECTIVE DATE]`                  | The date the contract becomes effective (ISO 8601: YYYY-MM-DD).         |
| `[MONTHLY FEE]`                     | The monthly recurring fee in U.S. dollars.                              |
| `[INITIAL TERM MONTHS]`             | The initial term length in months.                                      |
| `[TERMINATION NOTICE DAYS]`         | The advance notice period either party must provide to terminate.       |
| `[GOVERNING LAW STATE]`             | The U.S. state whose law governs this agreement.                        |
| `[LIABILITY CAP AMOUNT]`            | The aggregate liability cap, typically expressed as a multiple of fees. |
| `[OFFBOARDING WINDOW DAYS]`         | The number of days SMD has to deliver the memory export on offboarding. |
| `[UPTIME PERCENTAGE]`               | The monthly Machine uptime SLA percentage.                              |
| `[SEVERITY 1 RESPONSE HOURS]`       | The response time commitment for severity 1 incidents, in hours.        |
| `[SEVERITY 2 RESPONSE HOURS]`       | The response time commitment for severity 2 incidents, in hours.        |
| `[CUSTOMER SIGNATORY NAME]`         | The name of the individual signing for the customer.                    |
| `[CUSTOMER SIGNATORY TITLE]`        | The title of the individual signing for the customer.                   |
| `[ADDITIONAL TERMS]`                | Any negotiated additions specific to this engagement.                   |

---

# AI Employee Service Agreement

**This AI Employee Service Agreement (this "Agreement") is entered into as of [EFFECTIVE DATE] (the "Effective Date") by and between SMDurgan, LLC, an Arizona limited liability company doing business as SMD Services ("SMD"), and [CUSTOMER LEGAL NAME], a [CUSTOMER STATE OF INCORPORATION] entity with its principal place of business at [CUSTOMER ADDRESS] ("Customer"). SMD and Customer are each a "Party" and collectively the "Parties."**

## 1. Definitions

1.1 **"AI Employee"** means the configured per-Customer instance of the SMD platform that drafts and surfaces work product for review by Customer's authorized reviewers, comprising the Machine, the Memory Artifact, the configured persona, the enabled skills, and the bound connectors, as those terms are used in the Documentation.

1.2 **"Customer Data"** means all information submitted to, generated within, or processed by the AI Employee on Customer's behalf, including memory rules, voice samples, person mappings, drafts, audit logs, and any substantive content read at draft time from Customer's connected systems.

1.3 **"Documentation"** means the AI Employee platform documentation maintained by SMD, including the Platform PRD, the architecture decision records (ADRs) referenced in this Agreement, and the operational runbooks.

1.4 **"Machine"** means the dedicated Fly.io Machine provisioned for Customer's exclusive use, as further described in Section 4.

1.5 **"Memory Artifact"** means the per-Customer collection of structured rules, voice samples, person mappings, process knowledge, and audit logs stored in Customer-specific D1, R2, and Vectorize namespaces, as described in the DPA.

1.6 **"Reviewer"** means a Customer-designated individual authorized to review, edit, and send drafts produced by the AI Employee.

1.7 **"Service"** means the AI Employee software-as-a-service offering provided by SMD under this Agreement, including provisioning, hosting, monitoring, maintenance, support, and offboarding.

## 2. Scope of Service

2.1 **What the Service does.** SMD will provision a per-Customer AI Employee instance configured to Customer's specifications. The AI Employee drafts work product (including but not limited to email replies, intake summaries, calendar entries, and document drafts) and surfaces those drafts to Reviewers for review. Specific skills enabled at the Effective Date are listed in the Statement of Work attached as Exhibit A.

2.2 **What the Service does not do.** The AI Employee does not send any customer-bound external message under its own identity. Every outbound message produced by the AI Employee is drafted into a Reviewer's drafts folder for the Reviewer to review, edit, and send under the Reviewer's own identity. This commitment is architectural and is documented in [ADR 0005](../../adr/0005-reviewer-as-sender.md).

2.3 **No autonomous external action.** The AI Employee does not execute transactions, file documents with courts or regulators, or send communications to third parties without a named human Reviewer pressing send. Trust ceilings governing this behavior are documented in the Platform PRD §11.

2.4 **Configuration changes.** Customer may request reconfiguration (new skills enabled, persona adjustments, scope changes) at any time during the Term. SMD will implement reasonable configuration changes within the operational budget defined in Exhibit A. Changes outside that budget may require a written change order.

## 3. Fees and Payment

3.1 **Monthly fee.** Customer will pay SMD a monthly fee of [MONTHLY FEE] in U.S. dollars (the "Fee") for the Service. The Fee covers the per-Customer Machine, storage, configured skills, ongoing memory curation, and the operational budget defined in Exhibit A.

3.2 **Invoicing and payment.** SMD will invoice Customer monthly in advance. Each invoice is due within thirty (30) days of the invoice date. Payment is by ACH or another method mutually agreed in Exhibit A.

3.3 **Late payment.** Undisputed amounts not paid within thirty (30) days of the invoice date accrue interest at the lesser of one and one-half percent (1.5%) per month or the maximum rate permitted by applicable law.

3.4 **Pass-through costs.** Third-party vendor costs incurred specifically on Customer's behalf (for example, court-records fees, e-signature transaction fees, or per-document data-extraction fees from optional add-on services) are passed through at cost and itemized on the monthly invoice. The Fee does not include such pass-through costs unless expressly stated in Exhibit A.

3.5 **Fee changes.** SMD will not change the Fee during the Initial Term. After the Initial Term, SMD may change the Fee with at least sixty (60) days' written notice; Customer may terminate this Agreement without penalty effective on the proposed change date by providing written notice within thirty (30) days of SMD's change notice.

## 4. Per-Customer Infrastructure

4.1 **Dedicated Machine.** SMD will provision and operate a dedicated Fly.io Machine named `hermes-{customer-slug}` for Customer's exclusive use. The Machine is the runtime environment for Customer's AI Employee. No other SMD customer shares this Machine.

4.2 **Dedicated storage namespaces.** SMD will provision and operate dedicated D1, R2, and Vectorize namespaces bound to Customer's Machine. No other SMD customer has access to these namespaces. The cross-Machine query prohibition is enforced at boot per the safety substrate invariants described in the Platform PRD §7.5 and [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md).

4.3 **Per-Customer credentials.** SMD will store Customer's connector credentials (OAuth tokens, API keys for systems Customer has authorized the AI Employee to access) at per-Customer paths in SMD's secrets vault. No other SMD customer has access to Customer's credentials. The credential storage and revocation lifecycle is documented in the Documentation.

4.4 **Architectural isolation.** Per-Customer infrastructure isolation is an architectural commitment, not a policy. The isolation is enforced by deployment topology per [ADR 0007](../../adr/0007-per-customer-machine-isolation.md), not by runtime tenant scoping.

## 5. Customer Data and Memory Ownership

5.1 **Customer ownership.** Customer owns the Memory Artifact, including all memory rules, voice samples, person mappings, drafts, and audit logs produced for Customer. This ownership is contractual and operational. SMD is the data processor; Customer is the data controller. The detailed terms of the data processing relationship are set forth in the Data Processing Addendum attached as Exhibit B (the "DPA").

5.2 **Memory portability.** On Customer's written request at any time, SMD will produce a portable export of Customer's Memory Artifact as described in [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md). On termination, the export is produced within [OFFBOARDING WINDOW DAYS] days at no additional charge.

5.3 **No training on Customer Data.** SMD will not use Customer Data to train, fine-tune, or otherwise modify the weights of any machine-learning model. The distinction between training (prohibited) and bounded indexing (permitted, for retrieval within Customer's own Machine) is set forth in the DPA.

5.4 **No cross-customer learning.** Customer Data does not flow to any other SMD customer's Machine or to SMD's shared skill catalog. This is enforced architecturally per [ADR 0009](../../adr/0009-cross-machine-query-prohibition.md).

## 6. Service Levels

6.1 **Uptime commitment.** SMD will use commercially reasonable efforts to maintain at least [UPTIME PERCENTAGE]% monthly availability of Customer's Machine, measured as the percentage of minutes in the calendar month during which Customer's Machine is responsive to the SMD control-plane health probe. Scheduled maintenance windows, force majeure events, and third-party vendor outages beyond SMD's reasonable control are excluded from the calculation.

6.2 **Incident response.**

| Severity   | Definition                                                                                   | SMD response                                           |
| ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Severity 1 | Machine is fully unavailable, or a safety invariant has failed and the Machine has halted.   | Acknowledged within [SEVERITY 1 RESPONSE HOURS] hours. |
| Severity 2 | Material feature degradation; a specific skill is unavailable or producing incorrect output. | Acknowledged within [SEVERITY 2 RESPONSE HOURS] hours. |
| Severity 3 | Cosmetic or low-impact issue.                                                                | Acknowledged within two (2) business days.             |

Acknowledgement means SMD has confirmed receipt and begun triage. Acknowledgement is not resolution. SMD will provide regular status updates until the incident is resolved.

6.3 **Service credits.** If monthly uptime falls below [UPTIME PERCENTAGE]% for any calendar month, Customer may request a service credit equal to ten percent (10%) of that month's Fee for each full percentage point of shortfall, capped at fifty percent (50%) of the month's Fee. Service credits are Customer's sole and exclusive remedy for SLA failures and must be requested in writing within thirty (30) days of the affected month.

6.4 **Maintenance.** SMD may perform scheduled maintenance with at least forty-eight (48) hours' advance notice when reasonably practicable. Emergency maintenance to address safety or security issues may be performed without advance notice; SMD will provide notice as soon as reasonably practicable.

## 7. Confidentiality

7.1 **Definition.** "Confidential Information" means any non-public information disclosed by one Party to the other, whether orally, in writing, or by inspection of tangible objects, that is identified as confidential or that a reasonable person would understand to be confidential under the circumstances. Customer Data is Customer's Confidential Information.

7.2 **Obligations.** Each Party will protect the other Party's Confidential Information using the same degree of care it uses to protect its own confidential information, but in no event less than a reasonable degree of care. Neither Party will use the other Party's Confidential Information except as necessary to perform under this Agreement or disclose it to any third party except as expressly permitted by this Agreement.

7.3 **Exclusions.** Confidential Information does not include information that (a) is or becomes publicly known through no fault of the receiving Party, (b) was rightfully in the receiving Party's possession before disclosure, (c) is independently developed by the receiving Party without reference to the disclosing Party's Confidential Information, or (d) is rightfully obtained from a third party without restriction on disclosure.

7.4 **Compelled disclosure.** If a Party is compelled by law to disclose Confidential Information, it will provide the disclosing Party with prompt written notice (unless prohibited by law) and reasonable cooperation in seeking a protective order.

7.5 **Industry-specific confidentiality.** If Customer is a law firm or other professional-services firm subject to industry-specific confidentiality obligations (attorney-client privilege, work product, or equivalents), the BAA-Equivalent Confidentiality Addendum attached as Exhibit C governs those obligations.

## 8. Security

8.1 **Security program.** SMD will maintain a written information security program that includes administrative, technical, and physical safeguards appropriate to the nature of the Service and the sensitivity of Customer Data. The program addresses access controls, encryption in transit, encryption at rest at the storage-backend layer (D1, R2), credential storage in a managed secrets vault, audit logging of administrative actions, and incident response.

8.2 **Security incidents.** SMD will notify Customer without undue delay (and in any case within seventy-two (72) hours) of any confirmed Security Incident affecting Customer Data, as that term is defined in the DPA. The DPA governs the substantive incident-response obligations.

## 9. Term and Termination

9.1 **Term.** This Agreement begins on the Effective Date and continues for an initial term of [INITIAL TERM MONTHS] months (the "Initial Term"). After the Initial Term, this Agreement automatically renews for successive one-month periods (each a "Renewal Term," and together with the Initial Term, the "Term") unless either Party gives written notice of non-renewal in accordance with Section 9.2.

9.2 **Termination for convenience.** After the Initial Term, either Party may terminate this Agreement for convenience by giving the other Party at least [TERMINATION NOTICE DAYS] days' written notice.

9.3 **Termination for cause.** Either Party may terminate this Agreement for cause if the other Party materially breaches this Agreement and fails to cure the breach within thirty (30) days after receiving written notice of the breach.

9.4 **Effect of termination; offboarding.** On termination for any reason:

(a) SMD will continue operating Customer's Machine through the Effective Termination Date.

(b) Within [OFFBOARDING WINDOW DAYS] days following the Effective Termination Date, SMD will produce and deliver to Customer a portable export of Customer's Memory Artifact in the form described in the DPA and [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md).

(c) SMD will decommission Customer's Machine, namespaces, and credentials per the procedure documented in the [decommission spec](../../specs/ai-employee/decommission-customer.md). SMD will provide written confirmation of decommissioning to Customer.

(d) Customer remains obligated to pay all Fees accrued through the Effective Termination Date.

9.5 **Persona identity on offboarding.** The persona name selected by Customer may be retained by Customer. The agent's email identity (provided by SMD's identity infrastructure), avatar assets, and any platform-provided artifacts are SMD property and are decommissioned with the Machine. This boundary is documented in [ADR 0008](../../adr/0008-customer-owned-memory-artifact.md).

9.6 **Survival.** Sections 5 (to the extent of post-termination obligations), 7, 10, 11, 12, 13, and any other provision that by its nature should survive, will survive termination of this Agreement.

## 10. Representations and Warranties

10.1 **Mutual.** Each Party represents and warrants that (a) it has the full corporate authority to enter into and perform this Agreement, (b) execution and performance does not violate any other agreement to which it is a party, and (c) it will comply with all laws applicable to its performance under this Agreement.

10.2 **SMD warranties.** SMD warrants that (a) the Service will be performed in a professional and workmanlike manner consistent with industry standards, (b) the Service will conform in all material respects to the Documentation, and (c) SMD will not knowingly introduce malicious code into the Service.

10.3 **Customer warranties.** Customer represents and warrants that (a) Customer has the legal right to provide all Customer Data to SMD for the purposes contemplated by this Agreement, including any consents required from data subjects, (b) Customer Data does not infringe the intellectual property rights of any third party, and (c) Customer will not use the Service for any unlawful purpose.

10.4 **Disclaimer.** EXCEPT AS EXPRESSLY SET FORTH IN THIS SECTION 10, THE SERVICE IS PROVIDED "AS IS" AND SMD DISCLAIMS ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

## 11. Limitation of Liability

11.1 **Liability cap.** EXCEPT FOR THE EXCLUSIONS SET FORTH IN SECTION 11.3, EACH PARTY'S AGGREGATE LIABILITY UNDER OR IN CONNECTION WITH THIS AGREEMENT, WHETHER IN CONTRACT, TORT, OR OTHERWISE, WILL NOT EXCEED [LIABILITY CAP AMOUNT].

11.2 **Consequential damages waiver.** EXCEPT FOR THE EXCLUSIONS SET FORTH IN SECTION 11.3, NEITHER PARTY WILL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, OR BUSINESS OPPORTUNITY, ARISING OUT OF OR RELATING TO THIS AGREEMENT.

11.3 **Exclusions.** The limitations in Sections 11.1 and 11.2 do not apply to (a) a Party's indemnification obligations under Section 12, (b) breach of confidentiality obligations under Section 7 or Exhibit C, (c) a Party's gross negligence or willful misconduct, or (d) Customer's payment obligations under Section 3.

## 12. Indemnification

12.1 **SMD indemnification.** SMD will defend, indemnify, and hold harmless Customer from and against any third-party claim alleging that the Service, as provided by SMD and used in accordance with this Agreement, infringes any U.S. patent, copyright, or trademark of a third party. SMD's obligations under this Section 12.1 are conditioned on Customer (a) promptly notifying SMD of the claim, (b) giving SMD sole control of the defense and settlement, and (c) providing reasonable cooperation.

12.2 **Customer indemnification.** Customer will defend, indemnify, and hold harmless SMD from and against any third-party claim arising out of (a) Customer Data, (b) Customer's use of the Service in violation of this Agreement or applicable law, or (c) any communication, transaction, or action taken by a Reviewer using the Service.

12.3 **Sole remedy.** This Section 12 states each Party's sole and exclusive remedy and the other Party's sole and exclusive liability for third-party claims of the types described.

## 13. Dispute Resolution

13.1 **Informal resolution.** The Parties will attempt in good faith to resolve any dispute arising out of or relating to this Agreement through informal negotiations between authorized representatives of each Party.

13.2 **Mediation.** If informal negotiations do not resolve the dispute within thirty (30) days, the Parties will submit the dispute to mediation administered by a mutually agreed mediator. The Parties will share the mediator's fees equally.

13.3 **Litigation.** If mediation does not resolve the dispute within sixty (60) days of the request for mediation, either Party may file suit in the state or federal courts located in [GOVERNING LAW STATE], and each Party irrevocably consents to the exclusive jurisdiction of such courts.

13.4 **Governing law.** This Agreement is governed by and construed in accordance with the laws of the State of [GOVERNING LAW STATE], without giving effect to its conflict-of-laws principles.

13.5 **Equitable relief.** Notwithstanding the foregoing, either Party may seek injunctive or other equitable relief in any court of competent jurisdiction to prevent or restrain a breach of confidentiality or intellectual property obligations.

## 14. General Provisions

14.1 **Entire agreement.** This Agreement, together with all Exhibits attached, constitutes the entire agreement between the Parties with respect to the subject matter and supersedes all prior or contemporaneous agreements, communications, and understandings, written or oral.

14.2 **Order of precedence.** In the event of any conflict between the body of this Agreement and any Exhibit, the body of this Agreement controls unless the Exhibit expressly states that its terms supersede.

14.3 **Amendment.** This Agreement may be amended only by a written instrument signed by both Parties.

14.4 **Assignment.** Neither Party may assign this Agreement without the other Party's prior written consent, except that either Party may assign this Agreement without consent to a successor in connection with a merger, acquisition, or sale of substantially all of its assets. Any attempted assignment in violation of this Section is void.

14.5 **Notices.** All notices under this Agreement must be in writing and delivered to the addresses set forth in the signature blocks below (or to such other address as a Party may designate by written notice). Notice is deemed given on the date of receipt.

14.6 **Force majeure.** Neither Party is liable for any failure or delay in performance (other than payment obligations) to the extent caused by circumstances beyond its reasonable control, including acts of God, war, terrorism, civil unrest, government action, internet or utility outages, or pandemic.

14.7 **Independent contractors.** The Parties are independent contractors. Nothing in this Agreement creates a partnership, joint venture, agency, or employment relationship.

14.8 **Severability.** If any provision of this Agreement is held to be unenforceable, the remaining provisions remain in full force and effect, and the unenforceable provision will be reformed to the minimum extent necessary to make it enforceable while preserving the Parties' intent.

14.9 **Waiver.** No waiver of any provision of this Agreement is effective unless in writing and signed by the waiving Party. A waiver in one instance is not a waiver in any other instance.

14.10 **Counterparts; electronic signature.** This Agreement may be executed in counterparts, including by electronic signature, each of which is deemed an original and all of which together constitute the same instrument.

## 15. Additional Terms

[ADDITIONAL TERMS]

---

**IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.**

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

## Exhibit A: Statement of Work

This Exhibit A describes the Service as configured for Customer at the Effective Date.

**Persona configuration.** [Configured persona name, signature, avatar reference, tone descriptors.]

**Skills enabled at Effective Date.** [List of enabled skills with their trust ceilings.]

**Connectors bound at Effective Date.** [List of connectors with the systems they integrate.]

**Reviewers authorized at Effective Date.** [List of Reviewer names and email addresses.]

**Operational budget.** SMD's operational budget for ongoing maintenance, configuration changes, and Customer support is up to two (2) hours per week, consistent with Platform PRD §20 Phase 1 ops budget. Hours beyond this budget may require a written change order.

**Pass-through cost categories.** [List of third-party services whose costs are passed through, if any.]

---

## Exhibit B: Data Processing Addendum

The Data Processing Addendum is attached as a separate document. See [`data-processing-addendum.md`](./data-processing-addendum.md).

---

## Exhibit C: BAA-Equivalent Confidentiality Addendum (if applicable)

If Customer is a law firm or other professional-services firm subject to industry-specific confidentiality obligations, the BAA-Equivalent Confidentiality Addendum is attached as a separate document. See [`baa-equivalent-confidentiality.md`](./baa-equivalent-confidentiality.md).

---

> This is a TEMPLATE. Before customer countersignature, this document must be (1) reviewed by Captain and (2) reviewed by external counsel licensed in the customer's jurisdiction.
