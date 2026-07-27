# Confidentiality Addendum (Law Firm) - Ashton & Price LLP (DRAFT, Exhibit C)

> **Status: DRAFT for Captain review. Not sent. Not signed.** Instantiated from
> `docs/templates/operator/baa-equivalent-confidentiality.md` (#827) and reconciled to the
> engagement's actual architecture and commitments. This is the document that answers the
> firm's "BAA" diligence ask (letter 09 item 1 / letter 10 item 1): it performs the
> equivalent function for privileged and client-confidential material that a BAA performs
> for PHI, without SMD signing as a HIPAA business associate (no BAA is legally required;
> plaintiff-side, patient-authorization chain; research record 2026-07). If the firm sends
> a preferred form (letter 10 offered), that form becomes the base instead.
> This internal header block is stripped from the client-facing final form.

## Reconciliation notes (vs the #827 template)

- Send-posture clause rewritten: the template pinned draft-for-review as a law-firm floor
  (pre-ADR 0073); this instantiation states the agreed grid caps instead.
- "Memory Artifact" / structural-diff / Platform-PRD closed-loop claims replaced with the
  letter 10 §4 architecture: systems of record stay the firm's; the dedicated machine holds
  the audit record and operational memory.
- Template §7.3 warranted the audit log "does not contain the substantive text of privileged
  communications"; not warranted here. The audit record is treated as Protected Information
  instead, which protects the firm without asserting a content property we have not proven.
- Template §5 (vendor-hostile-content connector flags) and §9.2 (per-jurisdiction clause
  libraries) promised platform features that are not part of this engagement; replaced with
  the engagement-true commitment (§5) and dropped (§9.2) respectively.
- DPA cross-references renumbered to the Exhibit B DPA in this directory.

## Term provenance (doctrine Law 5)

| Term                                                       | Source                                                |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| Grid caps (opposing counsel / court / deadlines / money)   | Letter 07 grid; letters 09-10; Agreement §2.3         |
| No send under a firm principal's identity                  | Letter 10 §4                                          |
| Audit record + operational memory on the dedicated machine | Letter 10 §4                                          |
| Export / destruction windows                               | Letter 10 §5; DPA §8; ADR 0065                        |
| Incident notification base                                 | DPA §7; ADR 0064                                      |
| Governing law: Arizona                                     | Captain decision 2026-07-27                           |
| `[CONFLICT NOTIFICATION DAYS]`                             | **TBD: Captain** (template field; no recorded source) |
| `[SUBPOENA NOTIFICATION HOURS]`                            | **TBD: Captain** (template field; no recorded source) |

## Open items before this leaves the building

1. `[CONFLICT NOTIFICATION DAYS]` and `[SUBPOENA NOTIFICATION HOURS]` - Captain sets both (no letter or ADR names a number).
2. Counsel review alongside the Agreement and DPA.

---

# Confidentiality Addendum (Law Firm)

**This Confidentiality Addendum (this "Addendum") is entered into as of [EFFECTIVE DATE] between SMDurgan, LLC (d/b/a SMD Services) ("SMD") and [A&P ENTITY] ("the Firm"). This Addendum forms part of and is incorporated as Exhibit C into the Operator Service Agreement between the Parties (the "Agreement") and is executed concurrently with the Data Processing Addendum (Exhibit B, the "DPA"). Capitalized terms not defined here have the meanings given in the Agreement and the DPA.**

## 1. Purpose

1.1 The Firm is a law firm that handles information subject to professional confidentiality obligations, including attorney-client privileged communications, attorney work product, and client confidences, and, in the ordinary course of its plaintiff-side personal-injury practice, medical records and other health information of its clients.

1.2 The Parties acknowledge that the Operator, in the ordinary course of performing the configured routines, will read content that includes or relates to Protected Information.

1.3 This Addendum performs the function for the Firm's privileged and client-confidential material that a business associate agreement performs for protected health information: it documents the confidentiality regime, permitted uses, compelled-disclosure handling, and end-of-engagement lifecycle for the protected categories. It supplements and does not limit the Agreement and the DPA; to the extent of conflict concerning Protected Information, this Addendum controls.

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

3.3 SMD will not aggregate, analyze, or otherwise use Protected Information to develop insights about the Firm's clients, matters, or adversaries.

## 4. Architecture Commitments for Protected Information

4.1 The Firm's systems remain the systems of record. The Operator reads Matter content through authorized connections to perform a task and writes results back into the Firm's systems; SMD does not warehouse copies of the Firm's matter files (Agreement §4.2). The two artifacts on the Firm's dedicated machine that contain Matter references, the audit record and the Operator's operational memory, are Protected Information under this Addendum and are governed by the export and destruction terms of the DPA.

4.2 The Firm's machine is exclusive to the Firm (Agreement §4.1). No other SMD customer's systems have any path to read, learn from, or benefit from the Firm's Protected Information.

4.3 The agreed permanent caps apply to Protected Information as to all Operator work (Agreement §2.3): any communication to opposing counsel or a court is prepared for a person at the Firm to review and send; nothing touching deadlines or the movement of money is handled autonomously; the medical chronology is an internal record that does not characterize. The Operator never sends under a firm principal's identity; that is banned in code.

4.4 The Parties' shared understanding is that these commitments are intended to support, not weaken, the Firm's privilege and work-product positions. Whether privilege is preserved in any specific situation is a determination for the Firm's licensed counsel and the relevant tribunal, and is not warranted by SMD.

## 5. Content Sources with AI-Ingestion Restrictions

Where a third-party content source the Firm uses prohibits providing its content to third-party AI systems, that source is not connected to the Operator. Connector grants are authored per source (Agreement §2.5), so no source is connected without the Firm's authorization.

## 6. Conflicts of Interest

6.1 SMD is a service vendor and does not owe the Firm's clients duties of loyalty, confidentiality, or care in its own right. SMD will take these operational steps:

(a) **Cross-customer prohibition.** SMD's architecture prevents one customer's data from informing another customer's service (Section 4.2; DPA §5).

(b) **Operational conflict notification.** If SMD becomes aware that it provides services to multiple firms with adverse interests in a known Matter, SMD will notify the Firm within [CONFLICT NOTIFICATION DAYS] days of becoming aware, to the extent notice does not itself breach another customer's confidentiality. The notice identifies the existence of the potential adversity only, never another customer's matters, clients, or content.

(c) **No conflict warranty.** SMD does not represent that its customer base is conflict-free with respect to any Matter. The Firm remains solely responsible for its own conflict checks.

## 7. Compelled Disclosure

7.1 If SMD receives a subpoena, court order, warrant, civil investigative demand, or other compulsory process seeking Protected Information, SMD will, except to the extent prohibited by law: (a) notify the Firm in writing within [SUBPOENA NOTIFICATION HOURS] hours of receipt; (b) provide a copy of the process and the issuing authority's identity; (c) not produce Protected Information until the Firm has had a reasonable opportunity to object, move to quash, or seek a protective order; and (d) reasonably cooperate, at the Firm's expense, with the Firm's efforts to challenge or limit the process.

7.2 If production is ultimately required, SMD produces only the minimum legally required and requests confidential treatment, including filing under seal where applicable.

7.3 SMD will not voluntarily disclose Protected Information to any third party, including law enforcement, absent compulsory process, the Firm's prior written consent, or express legal requirement.

## 8. Retention and End of Engagement

8.1 Substantive Matter content lives in the Firm's systems and has no SMD-side retention period; it is read transiently to perform tasks (DPA §1.2). The audit record and operational memory on the Firm's dedicated machine are retained for the life of the engagement.

8.2 On termination, the DPA's offboarding terms govern: export of the audit record and operational memory within 14 days, destruction of the machine and volume with return-and-destruction complete within 30 days, and written destruction attestation on request (DPA §8.2). If the Firm's professional rules require return rather than destruction, the export satisfies the return obligation for the portion of Protected Information SMD held.

## 9. Disclosure Posture

The Operator's role in the Firm's practice is an internal operational matter. Whether and how the Firm discloses the Operator's involvement to clients, courts, or regulators is governed by the professional rules applicable to the Firm, and is the Firm's decision.

## 10. Personnel and Access

10.1 SMD personnel with access to the Firm's machine or operational infrastructure are bound by confidentiality obligations no less protective than this Addendum.

10.2 SMD's operational access to the Firm's machine is logged. The Firm may request a summary of access events affecting it for any twelve-month period.

## 11. Breach Notification

In addition to the DPA's incident-notification obligations (DPA §7), for a security incident affecting Protected Information SMD will expressly identify the categories of Protected Information affected and reasonably cooperate with any notification obligations the Firm owes its clients, the bar, or regulators.

## 12. Remedies

12.1 The Firm's remedies for breach of this Addendum are cumulative with those under the Agreement and DPA. Monetary damages may not be an adequate remedy for breaches affecting Protected Information; the Firm may seek injunctive or other equitable relief.

12.2 Consistent with Agreement §11.3, the liability cap does not apply to breaches of this Addendum constituting gross negligence or willful misconduct.

## 13. Governing Law and Survival

13.1 This Addendum is governed by the laws of the State of Arizona, consistent with Agreement §13.

13.2 Sections 3, 7, 8.2, 11, and 12 survive termination as required by their nature, applicable law, and the professional rules applicable to the Firm.

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
