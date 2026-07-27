# Confidentiality Addendum (Law Firm) - Ashton & Price LLP (DRAFT, Exhibit C)

> **Status: DRAFT for Captain review. Not sent. Not signed.** Instantiated from
> `docs/templates/operator/baa-equivalent-confidentiality.md` (#827), reconciled to the
> engagement's actual architecture, and revised 2026-07-27 per the four-reviewer counsel
> panel (§3.3 insights covenant fixed so performing the Service is not a breach; §3.4 CMIA
> no-further-disclosure covenant added; §5 restated as firm-identifies-sources; §7 contempt
> escape added; §12 conformed to the Agreement's §11.3 carve-out structure; §13.2 survival
> repaired). This answers the firm's "BAA" diligence ask (letters 09/10 item 1) without SMD
> signing as a HIPAA business associate (no BAA legally required; plaintiff-side,
> patient-authorization chain; research record 2026-07). If the firm sends a preferred form
> (letter 10 offered), that form becomes the base instead. External licensed-counsel review
> waived by Captain 2026-07-27. Deliver client-facing as "Confidentiality Addendum" only;
> never label it "BAA" anywhere the firm can see.
> This internal header block is stripped from the client-facing final form.

## Term provenance (doctrine Law 5)

| Term                                                       | Source                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| Grid caps (opposing counsel / court / deadlines / money)   | Letter 07 grid; letters 09-10; Agreement §2.3                              |
| No send under a firm principal's identity                  | Letter 10 §4                                                               |
| Audit record + operational memory on the dedicated machine | Letter 10 §4                                                               |
| Export / destruction windows                               | Letter 10 §5; DPA §8; ADR 0065                                             |
| Incident notification base                                 | DPA §7; ADR 0064                                                           |
| Governing law: Arizona                                     | Captain decision 2026-07-27                                                |
| Conflict notification: 5 business days                     | Captain decision 2026-07-27                                                |
| Subpoena notification: 24 hours                            | Captain decision 2026-07-27 (matches the DPA §7 incident clock)            |
| CMIA §56.13 no-further-disclosure covenant (§3.4)          | Counsel panel 2026-07-27                                                   |
| §12 conformed to Agreement §11.3 super-cap structure       | Counsel panel 2026-07-27; **Captain ratification pending** (with §11.3(b)) |

## Open items before this leaves the building

1. Captain ratification of the Agreement §11.3(b) super-cap structure, which §12.2 now mirrors.

---

# Confidentiality Addendum (Law Firm)

**This Confidentiality Addendum (this "Addendum") is entered into as of [EFFECTIVE DATE] between SMDurgan, LLC (d/b/a SMD Services) ("SMD") and [A&P ENTITY] ("the Firm"). This Addendum forms part of and is incorporated as Exhibit C into the Operator Service Agreement between the Parties (the "Agreement") and is executed concurrently with it, together with the Data Processing Addendum (Exhibit B, the "DPA"). Capitalized terms not defined in this Addendum have the meanings given in the Agreement and the DPA.**

## 1. Purpose

1.1 The Firm is a law firm that handles information subject to professional confidentiality obligations, including attorney-client privileged communications, attorney work product, and client confidences, and, in the ordinary course of its plaintiff-side personal-injury practice, medical records and other health information of its clients.

1.2 The Parties acknowledge that the Operator, in the ordinary course of performing the configured routines, will read content that includes or relates to Protected Information.

1.3 This Addendum performs the function for the Firm's privileged and client-confidential material that a business associate agreement performs for protected health information: it documents the confidentiality regime, permitted uses, compelled-disclosure handling, and end-of-engagement lifecycle for the protected categories. It supplements and does not limit the Agreement and the DPA; conflicts are resolved per the order of precedence in Agreement §14.2, under which this Addendum controls as to the treatment of Protected Information.

1.4 Nothing in this Addendum creates a fiduciary, attorney-client, or other professional relationship between SMD and any third party, including the Firm's clients. SMD is a vendor providing services to the Firm.

## 2. Definitions

2.1 **"Protected Information"** means information accessed, observed, processed, or generated by the Operator in providing the Service that falls within any of these categories:

(a) **Privileged communications**: communications subject to the attorney-client privilege or an analogous evidentiary privilege.

(b) **Work product**: materials prepared by or for the Firm in anticipation of litigation or for trial, including mental impressions, conclusions, opinions, legal theories, and litigation strategy.

(c) **Client confidences**: information of the Firm's clients held by the Firm in a professional capacity, including information protected by the professional conduct rules applicable to the Firm's practice and including medical records and other health information of the Firm's clients.

(d) The Operator's **audit record and operational memory**, to the extent they reference any of the above.

2.2 **"Matter"** means any client engagement, file, or case in the Firm's practice for which the Operator accesses or produces Protected Information.

## 3. Permitted Uses

3.1 SMD accesses and processes Protected Information solely to provide the Service under the Agreement and the DPA. SMD will not use Protected Information for any other purpose, including product development, marketing, training of any machine-learning model (DPA §5), or the benefit of any other SMD customer.

3.2 SMD will not disclose Protected Information to any third party except as necessary to provide the Service through the sub-processors authorized in the DPA, each bound by written terms no less protective than this Addendum, or as Section 7 (compelled disclosure) provides.

3.3 Other than as necessary to perform the Service for the Firm's own benefit (for example, maintaining the medical chronology, tracking verification status, and building the Operator's operational memory of the Firm's matters and processes), SMD will not aggregate, analyze, or otherwise use Protected Information to develop insights about the Firm's clients, matters, or adversaries, and will never do so for its own benefit or the benefit of any other customer.

3.4 SMD acknowledges that medical information within Protected Information may have been obtained by the Firm under patient authorizations governed by California Civil Code §56.11. SMD will not further disclose such medical information except (a) to the sub-processors authorized in the DPA, each bound by written terms no less protective than this Addendum, solely to perform the Service; (b) back to the Firm or into the Firm's own systems; or (c) as Section 7 (compelled disclosure) provides. SMD will not disclose such medical information for marketing, product development, or any purpose other than performing the Service, and will not sell it.

## 4. Architecture Commitments for Protected Information

4.1 The Firm's systems remain the systems of record. The Operator reads Matter content through authorized connections to perform a task and writes results back into the Firm's systems; SMD does not warehouse copies of the Firm's matter files (Agreement §4.2). The two artifacts on the Firm's dedicated Machine that contain Matter references, the audit record and the Operator's operational memory, are Protected Information under this Addendum and are governed by the export and destruction terms of the DPA.

4.2 The Firm's Machine is exclusive to the Firm (Agreement §4.1). No other SMD customer's systems have any path to read, learn from, or benefit from the Firm's Protected Information.

4.3 The agreed permanent caps apply to Protected Information as to all Operator work (Agreement §2.3): any communication to opposing counsel or a court is prepared for a person at the Firm to review and send; nothing touching deadlines or the movement of money is handled autonomously; the medical chronology is an internal record maintained as Section 2.3(c) of the Agreement provides. The Operator never sends under a firm principal's identity; that is banned in code.

4.4 The Parties' shared understanding is that these commitments are intended to support, not weaken, the Firm's privilege and work-product positions. Whether privilege is preserved in any specific situation is a determination for the Firm's licensed counsel and the relevant tribunal, and is not warranted by SMD.

## 5. Content Sources with AI-Ingestion Restrictions

The Firm will identify to SMD any content source whose terms prohibit providing its content to third-party AI systems, and SMD will not connect any source the Firm has so identified. Connector grants are authored per source (Agreement §2.5), so no source is connected without the Firm's authorization. SMD does not independently review the terms of the Firm's third-party content sources.

## 6. Conflicts of Interest

6.1 SMD is a service vendor and does not owe the Firm's clients duties of loyalty, confidentiality, or care in its own right. SMD will take these operational steps:

(a) **Cross-customer prohibition.** SMD's architecture prevents one customer's data from informing another customer's service (Section 4.2; DPA §5).

(b) **Operational conflict notification.** If SMD becomes aware that it provides services to multiple firms with adverse interests in a known Matter, SMD will notify the Firm within five (5) business days of becoming aware, to the extent notice does not itself breach another customer's confidentiality. The notice identifies the existence of the potential adversity only, never another customer's matters, clients, or content.

(c) **No conflict warranty.** SMD does not represent that its customer base is conflict-free with respect to any Matter. The Firm remains solely responsible for its own conflict checks.

## 7. Compelled Disclosure

7.1 If SMD receives a subpoena, court order, warrant, civil investigative demand, or other compulsory process seeking Protected Information, SMD will, except to the extent prohibited by law: (a) notify the Firm in writing within twenty-four (24) hours of receipt; (b) provide a copy of the process and the issuing authority's identity; (c) not produce Protected Information until the Firm has had a reasonable opportunity to object, move to quash, or seek a protective order; and (d) reasonably cooperate, at the Firm's expense, with the Firm's efforts to challenge or limit the process. Notwithstanding clause (c), SMD may comply with compulsory process to the extent and at the time necessary to avoid contempt, sanction, or other penalty, after giving the Firm as much advance notice as the circumstances permit.

7.2 If production is ultimately required, SMD produces only the minimum legally required and requests confidential treatment, including filing under seal where applicable.

7.3 SMD will not voluntarily disclose Protected Information to any third party, including law enforcement, absent compulsory process, the Firm's prior written consent, or express legal requirement.

## 8. Retention and End of Engagement

8.1 Substantive Matter content lives in the Firm's systems and has no SMD-side retention period; it is read transiently to perform tasks (DPA §1.2). The audit record and operational memory on the Firm's dedicated Machine are retained for the life of the engagement.

8.2 On termination, the DPA's offboarding terms govern: export of the audit record and operational memory within 14 days, destruction of the Machine and volume with return-and-destruction complete within 30 days, written destruction attestation on request, and suspension of destruction under any litigation hold the Firm notices (DPA §8). If the Firm's professional rules require return rather than destruction, the export satisfies the return obligation for the portion of Protected Information SMD held.

## 9. Disclosure Posture

The Operator's role in the Firm's practice is an internal operational matter. Whether and how the Firm discloses the Operator's involvement to clients, courts, or regulators is governed by the professional rules applicable to the Firm, and is the Firm's decision.

## 10. Personnel and Access

10.1 SMD personnel with access to the Firm's Machine or operational infrastructure are bound by confidentiality obligations no less protective than this Addendum.

10.2 SMD's operational access to the Firm's Machine is logged. The Firm may request a summary of access events affecting it on the cadence of DPA §9.2.

## 11. Breach Notification

In addition to the DPA's incident-notification obligations (DPA §7), for a security incident affecting Protected Information SMD will expressly identify the categories of Protected Information affected and reasonably cooperate with any notification obligations the Firm owes its clients, the bar, or regulators.

## 12. Remedies

12.1 The Firm's remedies for breach of this Addendum are cumulative with those under the Agreement and DPA, except where the Agreement expressly provides that a remedy is sole and exclusive. Monetary damages may not be an adequate remedy for a breach affecting Protected Information, and either Party may seek injunctive or other equitable relief per Agreement §13.2.

12.2 Liability for breaches of this Addendum is governed by Agreement §11.3(b): breaches constituting gross negligence or willful misconduct are uncapped; all other breaches are subject to the enhanced cap stated there.

## 13. Governing Law and Survival

13.1 This Addendum is governed by the laws of the State of Arizona, consistent with Agreement §13.

13.2 Sections 2, 3, 7, 8.2, 10.1, 11, and 12, and any other provision that by its nature should survive, survive termination and continue for so long as SMD retains any Protected Information and, as to the confidentiality obligations in Section 3, thereafter.

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
