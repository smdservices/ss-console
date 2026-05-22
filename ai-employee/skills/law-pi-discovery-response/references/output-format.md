# Draft Output Format

Two outputs per skill invocation:

1. **The draft itself** - created via `Email.create_draft` into the supervising partner's drafts folder. Per ADR 0005 this is the only external surface. The partner reviews, fills in TBDs, edits, and clicks send from their own mail client.
2. **The matter-internal sourcing note** - written at `~/.hermes/customer_notes/{customer_slug}/pi-discovery-response-YYYY-MM-DD-<matter-id>.md`. Records what populated each section. Read by the dashboard's "what Marcus used to write this" sourcing block. Never sent.

Section order is fixed. The partner scans the draft top-to-bottom; section order is the scan order.

## Draft section order

```
1. Header block (firm letterhead, case caption, response-due-date)
2. Subject line ("Responses to <request kind> for <case caption>, <case number>")
3. Recitation lead-in (one paragraph identifying the request, served date, and the response posture)
4. Per-request response table (one row per numbered request; the table shape varies by request kind)
5. Responsive-document list (per-request, for RFPs only; embedded inside the table for RFP filings, omitted for other kinds)
6. Privilege log skeleton (one row per withheld document; privilege-claim type as TBD)
7. Closing case-strategy paragraph (TBD marker, partner authors)
8. Partner sign-off block (from customer.yaml)
9. Exhibit list (enumerated, every responsive document; omitted for RFA filings that produce no exhibits)
```

## Section templates

### 1. Header block

```
<Firm letterhead from customer.yaml>

<Today's date in "Month D, YYYY" format>

<Opposing counsel name from matter.custom_fields.opposing_counsel_name, or TBD>
<Opposing counsel firm from matter.custom_fields.opposing_counsel_firm, or TBD>
<Opposing counsel mailing address from matter.custom_fields, or TBD>

Re: <Case caption from matter.custom_fields.case_caption>
Case Number: <Case number from matter.custom_fields.case_number, or TBD>
Our Client: <Client name from matter.client_name>
Responses Due: <Response due date in "Month D, YYYY" format, or TBD>
```

Every angle-bracketed value renders from a sourced field or as a TBD marker. The skill does not author addresses, names, or case numbers it cannot source.

### 2. Subject line

For `Email.create_draft`, `DraftInput.subject` is:

```
Responses to <request kind> for <case caption>, <case number>
```

Where `<request kind>` is one of "Interrogatories", "Requests for Production", or "Requests for Admission". Where any component is absent, that component renders as `TBD`; the partner edits the subject line on review.

### 3. Recitation lead-in

One paragraph, two to four sentences. Sourced from matter attributes and the parsed request structure.

```
<Plaintiff or Defendant designation> <client name>, by and through undersigned counsel, responds to <Plaintiff or Defendant designation> <opposing party name>'s <request kind ordinal, e.g., "First Set of Interrogatories"> served on <served date in "Month D, YYYY"> as follows. The numbered responses below correspond to the numbered <interrogatories | requests | matters for admission> in the served document.
```

If the served date cannot be sourced, the date clause renders as `[TBD: served date - partner confirms]`. The skill does not invent a date.

### 4. Per-request response table

Table shape varies by request kind. Each kind has a fixed column structure.

#### 4a. Interrogatories

```
| No. | Interrogatory text (verbatim from served document)                                  | Objection categories (memory-rule sourced)                              | Substantive answer                                           |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | State the full name and address of each person likely to have discoverable information. | (no categories matched)                                                 | `[TBD: answer Interrogatory No. 1 - partner authors]`        |
| 2   | Identify every healthcare provider who has treated the plaintiff in the past ten years. | `overbroad`, `not proportional to the needs of the case`                | `[TBD: answer Interrogatory No. 2 - partner authors]`        |
| 3   | Describe in detail every prior personal-injury claim filed by the plaintiff.            | `vague and ambiguous`, `not proportional to the needs of the case`      | `[TBD: answer Interrogatory No. 3 - partner authors]`        |
```

The interrogatory text column is the verbatim text from the served filing. The objection-categories column is a comma-separated list of labels from the memory-rule vocabulary, or `(no categories matched)` when no category applied. The substantive-answer column is always a TBD marker.

#### 4b. Requests for production

```
| No. | Request text (verbatim from served document)                                                | Objection categories (memory-rule sourced)                              | Responsive documents (sourced from DocumentStorage)            | Production posture                                  |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| 1   | All medical records concerning the plaintiff's treatment for injuries from the subject incident. | (no categories matched)                                                 | doc_01, doc_03, doc_04, doc_05 (5 documents; see Exhibits A-E) | `[TBD: production posture - partner authors]`       |
| 2   | All communications between the plaintiff and any prior counsel concerning this matter.           | `seeks information protected by attorney-client privilege`              | (no responsive non-privileged documents in matter file)        | `[TBD: production posture - partner authors]`       |
| 3   | All medical records concerning the plaintiff for the ten years prior to the subject incident.    | `overbroad`, `not proportional to the needs of the case`                | `[TBD: responsive documents - partner confirms scope]`         | `[TBD: production posture - partner authors]`       |
```

The responsive-documents column lists `StoredDocument.id` values comma-separated, with a parenthetical count and exhibit-range reference. When the document-storage scan returned no responsive documents and at least one objection category matched, the cell reads `(no responsive non-privileged documents in matter file)`. When no objections matched but no documents were found, the cell reads a TBD marker rather than silently asserting absence; the partner confirms scope.

The production-posture column is always a TBD marker. The substantive language about whether documents will be produced subject to objections, withheld under privilege, or produced in full is partner authoring.

#### 4c. Requests for admission

```
| No. | Matter for admission (verbatim from served document)                                | Objection categories (memory-rule sourced)                              | Admit or deny                                                |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Admit that the plaintiff was operating a 2021 Toyota Camry on April 28, 2026.       | (no categories matched)                                                 | `[TBD: admit or deny RFA No. 1 - partner authors]`           |
| 2   | Admit that the plaintiff's medical specials exceed $25,000.                         | `premature`, `seeks expert opinion`                                     | `[TBD: admit or deny RFA No. 2 - partner authors]`           |
| 3   | Admit that the defendant's vehicle did not cause the plaintiff's lumbar disc herniation. | `seeks expert opinion`, `not proportional to the needs of the case`     | `[TBD: admit or deny RFA No. 3 - partner authors]`           |
```

The admit-or-deny column is always a TBD marker. The substantive language is partner authoring.

### 5. Responsive-document list (for RFPs only)

The responsive-document list is embedded inside the RFP response table (column 4). For RFPs that produced more than four responsive documents per request, the column reads the count and exhibit range, and the full per-document detail moves to a per-request appendix below the table. The appendix shape:

```
### Responsive documents for Request for Production No. 1

| Doc ID  | Filename                                  | Date       | Classification                | Exhibit |
| ------- | ----------------------------------------- | ---------- | ----------------------------- | ------- |
| doc_01  | 2026-04-28_mercy_general_ed.pdf           | 2026-04-28 | medical_record                | A       |
| doc_03  | 2026-05-18_phoenix_ortho_initial.pdf      | 2026-05-18 | medical_record                | C       |
| doc_04  | 2026-06-04_phoenix_ortho_followup.pdf     | 2026-06-04 | medical_record                | D       |
| doc_05  | 2026-06-12_valley_pt_summary.pdf          | 2026-06-12 | medical_record                | E       |
```

Every row is sourced from a `StoredDocument` in the matter folder. The skill never invents documents.

### 6. Privilege log skeleton

One row per document the responsive-document scan flagged as potentially privileged (classification matched `attorney_work_product`, `client_communication`, `expert_communication`, or `internal_memo`). The privilege-claim type column is always a TBD marker.

```
## Privilege log

The following documents from the matter file fall within the responsive set but are withheld. The partner authors the privilege-claim characterization for each row.

| Doc ID  | Filename                                  | Date       | Author          | Recipient      | Privilege claim                                                 |
| ------- | ----------------------------------------- | ---------- | --------------- | -------------- | --------------------------------------------------------------- |
| doc_42  | 2026-05-22_client_intake_notes.pdf        | 2026-05-22 | Sarah Holcomb   | Janet Holloway | `[TBD: privilege claim - partner authors]`                      |
| doc_47  | 2026-05-30_internal_strategy_memo.pdf     | 2026-05-30 | Sarah Holcomb   | (internal)     | `[TBD: privilege claim - partner authors]`                      |
| doc_51  | 2026-06-04_expert_comm_dr_voss.pdf        | 2026-06-04 | Sarah Holcomb   | Dr. Mira Voss  | `[TBD: privilege claim - partner authors]`                      |
```

If no documents in the matter file match the privilege heuristics, the section reads:

```
## Privilege log

No documents in the responsive set were flagged as potentially privileged by the skill's classification heuristic. The partner confirms after review whether additional privilege claims apply.
```

The skill does not assert privilege; the skill flags documents the partner needs to consider for privilege.

### 7. Closing case-strategy paragraph

Always a TBD marker. The skill never authors this section.

```
[TBD: closing paragraph - partner authors per firm template. The skill emits no language about discovery posture, motion-to-compel risk, meet-and-confer obligations, sanctions exposure, or any forward-looking case-strategy language.]
```

### 8. Partner sign-off block

Pulled verbatim from `customer.yaml`:

```
<Partner first name and last name>
<Partner title (e.g., "Managing Partner")>
<Firm name>
<Firm address>
<Firm phone>
<Partner direct email>
```

The skill never authors a sign-off line, a "Sincerely," "Respectfully," or any closing salutation. The partner's signature block is what their voice samples capture, and that block is what the skill renders.

### 9. Exhibit list (RFP filings only; omitted for interrogatories and RFAs)

Enumerated. Every responsive document referenced in the per-request table. Captions in partner voice (see `voice.md` for the caption style). The exhibit list is identical in shape to the demand-letter skill's exhibit list; for RFA filings (which produce no exhibits) and interrogatories (which produce no exhibits absent a stipulation), the section is omitted.

```
Exhibit A: Mercy General Hospital, emergency-department record, April 28, 2026.
Exhibit B: Mercy General Hospital, itemized billing statement, May 6, 2026.
Exhibit C: Phoenix Orthopedics (Dr. Chen), initial consultation note, May 18, 2026.
Exhibit D: Phoenix Orthopedics (Dr. Chen), follow-up note, June 4, 2026.
Exhibit E: Valley Physical Therapy, treatment summary, May 22 through June 12, 2026.
```

## Matter-internal sourcing note format

Output path: `~/.hermes/customer_notes/{customer_slug}/pi-discovery-response-YYYY-MM-DD-<matter-id>.md`.

Structure:

```markdown
# PI Discovery Response Sourcing Note - <matter-id>

**Matter:** <matter ID and client name>
**Request kind:** <interrogatories | requests_for_production | requests_for_admission>
**Numbered-request count:** <count>
**Drafted:** <ISO-8601 timestamp>
**Draft reference:** <DraftRef.id from Email.create_draft, or "dry-run" if --dry-run>
**Voice-gate score:** <score and pass/fail>
**Fabrication-filter result:** <clean | flag | block, plus any violations>

## Readiness classification

| Axis                         | Value    | Evidence                                                |
| ---------------------------- | -------- | ------------------------------------------------------- |
| Matter scope                 | IN_SCOPE | matter_type=auto-accident, in PI registry               |
| Matter status                | ACTIVE   | matter.status=open                                      |
| Request parseability         | PARSED   | 25 numbered items extracted                             |
| Objection vocabulary         | READY    | customer.yaml.memory_rules.objection_categories present |
| Voice envelope readiness     | READY    | 35 Layer 2 samples (above the 30 threshold)             |
| Citation risk in source data | CLEAN    | No citation-shaped strings in skill-read custom_fields  |

## Sourcing index

| Section           | Field                       | Sourced from                                               | TBD? |
| ----------------- | --------------------------- | ---------------------------------------------------------- | ---- |
| Header            | opposing_counsel_name       | matter.custom_fields.opposing_counsel_name                 | no   |
| Header            | opposing_counsel_firm       | matter.custom_fields.opposing_counsel_firm                 | no   |
| Header            | case_caption                | matter.custom_fields.case_caption                          | no   |
| Header            | case_number                 | matter.custom_fields.case_number                           | no   |
| Header            | response_due_date           | computed from served_at + jurisdiction-rule                | no   |
| Recitation        | client_name                 | matter.client_name                                         | no   |
| Recitation        | served_date                 | StoredDocument doc_99 (cover-letter date)                  | no   |
| Per-request table | row[1].request_text         | StoredDocument doc_99 (parsed item 1)                      | no   |
| Per-request table | row[1].objection_categories | memory_rule "objection_categories" (matched: overbroad)    | no   |
| Per-request table | row[1].substantive_answer   | client_facing_fields.substantive_answer_per_request=none   | TBD  |
| Privilege log     | row[0].doc_id               | StoredDocument doc_42                                      | no   |
| Privilege log     | row[0].privilege_claim      | client_facing_fields.privilege_claim_characterization=none | TBD  |
| Closing           | (none)                      | client_facing_fields.case_strategy_language=none           | TBD  |

## Could not source

- Interrogatory No. 14: no responsive documents found in matter folder; partner confirms whether matter file contains responsive material.
- Response due date: no served_at metadata on doc_99; cover-letter date parsed as fallback.

## Refusal events

- (none)

## Citation refusal events

- (none)

## Voice-gate detail

- Sentence-length p50: 17 words. p95: 28 words. (Within envelope.)
- Banned-pattern hits: 0.
- Layer 2 similarity: 0.74 (threshold 0.65). Pass.

## Adapter calls made

- PracticeManagement.get_matter("matter_42") - 1 call
- DocumentStorage.list_folder({folder_path: "/matters/matter_42", recursive: true}) - 1 call
- DocumentStorage.download_document("doc_99") (the served request) - 1 call
- DocumentStorage.download_document("doc_01") through DocumentStorage.download_document("doc_47") - 47 calls
- Email.create_draft(...) - 1 call
```

Every adapter call is recorded. The dashboard's "what Marcus used to write this" sourcing block reads the sourcing index. Compliance evidence packets export the sourcing note alongside the draft.

## Format rules summary

1. **No prose outside the named sections.** The agent does not write paragraphs of analysis or self-justification. The note is scannable.
2. **Every section header appears even when its content is empty.** Empty sections read "Empty." or "(none)" rather than being omitted.
3. **Tables use the standard markdown pipe-and-hyphen syntax.** The hyphens are ASCII hyphens, not em dashes or en dashes.
4. **No em dashes anywhere.** Use commas and periods. The hyphen character is fine in compound words.
5. **TBD markers are bracketed and one-line.** `[TBD: <section> - partner authors]`. The partner scans for `[TBD:` to find their authoring queue.
6. **Verbatim incoming-request text is preserved exactly.** The recital column in the per-request table contains the request text from the source filing without reformatting, rewording, or paraphrase. Length differences across requests are not normalized.
