# DocuSign Signing Flow Runbook

> Operational runbook for converting the templates in this directory into countersigned customer documents via DocuSign. Per Platform PRD §20 (Phase 1 connectors: DocuSign).

---

## When this runbook applies

This runbook applies once Captain has scoped a beta-1 AI Employee engagement and is ready to send the customer the three contract documents for countersignature. The runbook covers:

1. Producing the customer-specific final form from each template.
2. Captain review.
3. External counsel review (required for customer-zero; required for any new substantive clause language introduced thereafter).
4. PDF export and DocuSign upload.
5. Countersignature, archive, and compliance evidence packet integration.

This runbook does not cover negotiation rounds with the customer's counsel. Negotiated changes return the document to the appropriate review step.

---

## Step 1: Captain selects the template set

Determine which templates apply to the engagement:

| Customer type                                        | Templates required                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Law firm                                             | Service Contract + DPA + BAA-Equivalent Confidentiality Addendum.                                                                |
| Other professional-services (accounting, healthcare) | Service Contract + DPA, plus the BAA-Equivalent (or a HIPAA BAA, as appropriate) on Captain's call in consultation with counsel. |
| Non-regulated business                               | Service Contract + DPA.                                                                                                          |

If the engagement requires a HIPAA Business Associate Agreement (Customer is a HIPAA-covered entity or business associate and the AI Employee will read protected health information), Captain must engage external counsel to produce or adapt a HIPAA-compliant BAA. The BAA-Equivalent template in this directory is not a substitute for a HIPAA BAA where one is legally required.

---

## Step 2: Captain produces the customer-specific draft

For each applicable template:

1. Copy the template file into a working directory outside this repository (Captain's secure local working area; do not commit customer-specific draft documents to this repository).
2. Fill every bracketed field. Cross-reference the field tables at the top of each template. The standard bracketed fields are:
   - `[CUSTOMER LEGAL NAME]`, `[CUSTOMER STATE OF INCORPORATION]`, `[CUSTOMER ADDRESS]`
   - `[EFFECTIVE DATE]`
   - `[MONTHLY FEE]`, `[INITIAL TERM MONTHS]`, `[TERMINATION NOTICE DAYS]`
   - `[GOVERNING LAW STATE]`, `[LIABILITY CAP AMOUNT]`
   - `[OFFBOARDING WINDOW DAYS]`, plus DPA-specific retention and incident-response fields
   - `[UPTIME PERCENTAGE]`, `[SEVERITY 1 RESPONSE HOURS]`, `[SEVERITY 2 RESPONSE HOURS]`
   - `[CUSTOMER SIGNATORY NAME]`, `[CUSTOMER SIGNATORY TITLE]`
   - `[ADDITIONAL TERMS]` (use to record negotiated additions; if none, write "None.")
3. Populate Exhibit A in the Service Contract with the actual Statement of Work for this engagement (configured persona, enabled skills, bound connectors, authorized Reviewers, pass-through cost categories).
4. Remove every "This is a TEMPLATE" footer block from the working drafts before export. The footer is for internal templates only; customer-facing final forms do not carry it. (The footer's removal is itself a checklist item below.)

The bracketed-field checklist must be 100% complete before the document leaves Step 2. A draft with any unreplaced `[FIELD NAME]` is not eligible for review.

---

## Step 3: Captain review

Captain reviews each draft end-to-end for:

- Every bracketed field replaced.
- No "This is a TEMPLATE" footer remaining.
- Exhibit A reflects the actual engagement scope.
- All cross-references between the Service Contract, DPA, and BAA-Equivalent are internally consistent (effective dates match, terminology matches, retention windows match).
- Tone is plainspoken consistent with the SMD voice standard. No em dashes in any text Captain has authored or modified.
- Architecture references still reflect current ADRs. If a referenced ADR has changed since the template was last revised, the affected clause must be updated and the change flagged for counsel review in Step 4.

Captain initials a Captain review checklist (kept in Captain's secure working area) noting the review date and the file hashes of each reviewed draft.

---

## Step 4: External counsel review

Required for customer-zero. Required for any subsequent engagement where Captain has materially modified substantive clause language not previously reviewed by counsel. Not required (at Captain's discretion) for subsequent engagements that use the previously counsel-reviewed clause language with only bracketed-field substitutions.

Counsel reviews for:

- Conformance to applicable law in `[GOVERNING LAW STATE]` and (for the DPA) any applicable privacy law in the customer's jurisdiction.
- Enforceability of the dispute resolution and liability provisions.
- For the BAA-Equivalent: conformance to the professional and ethical rules applicable to Customer's profession in Customer's jurisdiction.
- For law-firm customers operating in jurisdictions with formal AI-use guidance (for example, Pennsylvania Bar Association Formal Opinion 2024-200 or Utah's standing order on generative AI per Platform PRD §13.6), counsel confirms the BAA-Equivalent and the associated engagement-letter clause library are consistent with that guidance.

Counsel returns the draft with redlines. Captain incorporates counsel's redlines and either re-circulates to counsel (if material changes were made) or proceeds to Step 5.

---

## Step 5: Export to PDF

For each reviewed document:

1. Convert the final markdown working draft to PDF using Captain's standard markdown-to-PDF toolchain. The PDF must:
   - Preserve all section numbering and cross-references.
   - Include the signature blocks on a single signing page where reasonably possible.
   - Be paginated, with page numbers in the footer.
   - Embed all fonts.
2. File-name the PDF using the convention: `{customer-slug}-{document-type}-{effective-date}.pdf`. Examples:
   - `acme-law-service-contract-2026-06-01.pdf`
   - `acme-law-dpa-2026-06-01.pdf`
   - `acme-law-baa-equivalent-2026-06-01.pdf`

---

## Step 6: DocuSign upload

1. Log into DocuSign as the SMD principal signer account.
2. Create a new envelope.
3. Upload the PDFs in the order: Service Contract, DPA, BAA-Equivalent (if applicable).
4. Add recipients:
   - SMD signatory (Captain) as Signer 1.
   - Customer signatory as Signer 2, addressed to `[CUSTOMER SIGNATORY NAME]` at the email address Customer designated.
5. Place signature, date, and printed-name fields on the signature blocks of each document.
6. Set the envelope's expiration to a reasonable default (typically 30 days).
7. Configure email subject and message in plain professional language naming Customer and SMD and identifying the documents enclosed. Do not include unreplaced bracketed fields in the email subject or body.
8. Send to SMD signer first; Captain signs and the envelope routes to Customer signer for countersignature.

DocuSign's audit trail (envelope ID, signing certificate, timestamps, signer IP addresses) is preserved automatically by DocuSign and serves as the chain-of-custody record for the executed agreement.

---

## Step 7: Countersignature and archive

Once Customer countersigns:

1. DocuSign delivers the fully-executed PDFs to both Parties by email.
2. Download the executed PDFs and the DocuSign Certificate of Completion.
3. Archive in Captain's secure document storage under `customers/{customer-slug}/contracts/{effective-date}/`:
   - `service-contract.executed.pdf`
   - `dpa.executed.pdf`
   - `baa-equivalent.executed.pdf` (if applicable)
   - `certificate-of-completion.pdf`
4. Record the engagement in the SMD customer registry with the effective date, term, fee, and DocuSign envelope ID.

---

## Step 8: Compliance evidence packet integration

The executed DPA and BAA (where applicable) become inputs to Customer's compliance evidence packet per Platform PRD §13.6:

- `10-dpa.pdf` in the packet is the executed DPA PDF.
- `11-baa.pdf` in the packet is the executed BAA-Equivalent (or HIPAA BAA) PDF, where applicable.

Captain ensures these PDFs are available to the `compliance-audit-export` skill at the customer-archive path the skill expects, per the [compliance evidence packet spec](../../specs/ai-employee/compliance-evidence-packet.md).

---

## Renewals

After the Initial Term, the Service Agreement auto-renews monthly per Service Contract Section 9.1. No new signing event is required at renewal.

If the Parties agree to extend with modified terms (new monthly fee, new Initial Term, new SLA), Captain produces an amendment using a separate amendment template (filed as a follow-on task once the first beta-1 renewal is in scope) and the amendment goes through the same Steps 3 through 7.

---

## Termination

When Customer or SMD terminates per Service Contract Section 9, no signing event is required. The termination is effected by written notice as described in the Service Contract. The decommissioning procedure documented in the [decommission spec](../../specs/ai-employee/decommission-customer.md) executes in parallel with the offboarding obligations in Service Contract Section 9.4 and DPA Section 10.

---

## Pre-flight checklist

Before any envelope leaves DocuSign for Customer, Captain confirms:

- [ ] Every bracketed field in every document is replaced with a customer-specific value.
- [ ] The "This is a TEMPLATE" footer is removed from every PDF.
- [ ] Captain review is complete (Step 3).
- [ ] External counsel review is complete where required (Step 4).
- [ ] Effective dates match across all documents in the envelope.
- [ ] Bracketed retention, response, and offboarding windows are consistent across the Service Contract and DPA.
- [ ] Exhibit A (Statement of Work) reflects the actual engagement scope.
- [ ] PDF file naming follows the `{customer-slug}-{document-type}-{effective-date}.pdf` convention.
- [ ] The DocuSign envelope subject and message contain no unreplaced bracketed fields.
- [ ] The customer registry record is ready to update on countersignature.

---

> This is a TEMPLATE runbook. The signing flow may be refined as Captain operates it for the first several customers. Update this runbook whenever the operational reality diverges from the documented procedure.
