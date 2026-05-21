# Draft Output Format

Two outputs per skill invocation:

1. **The draft itself** — created via `Email.create_draft` into the supervising partner's drafts folder. Per ADR 0005 this is the only external surface. The partner reviews, fills in TBDs, edits, and clicks send from their own mail client.
2. **The matter-internal sourcing note** — written at `~/.hermes/customer_notes/{customer_slug}/pi-demand-draft-YYYY-MM-DD-<matter-id>.md`. Records what populated each section. Read by the dashboard's "what Marcus used to write this" sourcing block. Never sent.

Section order is fixed. The partner scans the draft top-to-bottom; section order is the scan order.

## Draft section order

```
1. Header block (firm letterhead, date, recipient)
2. Subject line ("Demand for <client>, claim <number>, date of loss <date>")
3. Opening recital ("This firm represents <client> for injuries sustained on <date>.")
4. Factual case-history paragraph (sourced, partner voice; OR omitted if voice gate fails)
5. Medical treatment chronology (table)
6. Medical specials tabulation (table, per-provider)
7. Lost-wages tabulation (table OR TBD marker)
8. Liability characterization (TBD marker, partner authors)
9. Settlement bracket and demand amount (TBD marker, partner authors)
10. Closing case-strategy paragraph (TBD marker, partner authors)
11. Exhibit list (enumerated, every sourced document)
12. Partner sign-off block (from customer.yaml)
```

## Section templates

### 1. Header block

```
<Firm letterhead from customer.yaml>

<Today's date in "Month D, YYYY" format>

<Adjuster name from matter.custom_fields.opposing_adjuster_name, or TBD>
<Carrier name from matter.custom_fields.opposing_carrier, or TBD>
<Adjuster mailing address from matter.custom_fields, or TBD>

Re: Demand for <client name>
Claim Number: <claim number from matter, or TBD>
Date of Loss: <date in "Month D, YYYY" format, or TBD>
Insured: <matter.custom_fields.opposing_insured_name, or TBD>
Our Client: <client name>
```

Every angle-bracketed value renders from a sourced field or as a TBD marker. The skill does not author addresses, names, or claim numbers it cannot source.

### 2. Subject line

For `Email.create_draft`, `DraftInput.subject` is:

```
Demand for <client name>, claim <claim number>, date of loss <Month D, YYYY>
```

Where any component is absent, that component renders as `TBD`; the partner edits the subject line on review.

### 3. Opening recital

Two sentences max. Sourced from matter attributes.

```
This firm represents <client name> for injuries sustained on <date of incident> at <incident location>. Our client's medical specials to date total $<specials total>; lost wages to date total $<lost wages total or TBD>.
```

If either total cannot be sourced, that clause renders as a TBD marker rather than dropping out of the sentence.

### 4. Factual case-history paragraph

Three to five sentences. Sourced. Partner voice (Layer 2 match). See `voice.md` for the rules.

OR: omitted entirely if the voice gate fails. When omitted, the draft jumps from the opening recital to the chronology table; the partner authors the case-history paragraph after the chronology.

The skill writes the case-history paragraph or it does not. It never writes a half-paragraph.

### 5. Medical treatment chronology

Markdown table. Every row sourced.

```
| Date       | Provider                | Treatment                                | Exhibit |
| ---------- | ----------------------- | ---------------------------------------- | ------- |
| 2026-04-28 | Mercy General Hospital  | ED admission, cervical and lumbar pain   | A       |
| 2026-05-12 | Phoenix Imaging         | MRI lumbar, L4-L5 disc herniation        | C       |
| 2026-05-18 | Dr. Chen / Phoenix Ortho | Initial consultation, treatment plan    | D       |
| 2026-06-04 | Dr. Chen / Phoenix Ortho | Follow-up, prescribed PT 3x weekly       | E       |
```

Rows without a sourced date OR a sourced provider are NOT included. Such gaps are recorded in the matter-internal sourcing note under "could not source" so the partner can fill them in after the draft lands.

### 6. Medical specials tabulation

Markdown table. Totals at the bottom. Every line sourced from a billing-statement document or rendered as TBD.

```
| Provider                | Billed Charges | Exhibit |
| ----------------------- | -------------- | ------- |
| Mercy General Hospital  | $14,237.18     | B       |
| Phoenix Imaging         | $1,842.00      | C       |
| Phoenix Orthopedics     | $6,418.24      | F       |
| Valley Physical Therapy | $2,340.00      | G       |
| **Total**               | **$24,837.42** |         |
```

If a provider's billing statement is missing or unparseable, that row renders:

```
| <Provider name>         | [TBD: source billing statement] | <Exhibit, if doc present>  |
```

And the Total line then renders:

```
| **Total**               | [TBD: specials total — partner verifies after sourcing missing billing statements] |   |
```

### 7. Lost-wages tabulation

Markdown table. Sourced from W-2, pay stubs, employer letter.

```
| Period                  | Lost Wages     | Source / Exhibit |
| ----------------------- | -------------- | ---------------- |
| 2026-04-28 to 2026-05-12 | $4,200.00     | Employer letter, Exhibit H |
| 2026-05-13 to 2026-06-15 | $3,800.00     | Pay stub gap, Exhibit I    |
| **Total**               | **$8,000.00** |                  |
```

If employer verification is absent:

```
[TBD: lost wages — partner supplies after employer verification received]
```

The skill never imputes lost wages from the client's stated occupation, hourly rate, or treating physician's work-restriction note unless the matter custom_fields contain a partner-authored note explicitly authorizing the imputation.

### 8. Liability characterization

Always a TBD marker. The skill never authors this section. The marker:

```
[TBD: liability characterization — partner authors. The factual chronology above is provided as input. The skill emits no characterization of fault, negligence, foreseeability, or causation.]
```

### 9. Settlement bracket and demand amount

Always TBD markers. Two markers, paired:

```
[TBD: settlement bracket and supporting framing — partner authors]

[TBD: demand amount — partner authors]
```

The skill never writes a number into either marker. Per PRD §11.2 and law-firm-prd §6.2, demand-amount and settlement-bracket authoring is judgment-bearing work the agent cannot do.

### 10. Closing case-strategy paragraph

Always a TBD marker.

```
[TBD: closing paragraph — partner authors per firm template. The skill emits no language about filing suit, response deadlines, litigation posture, or settlement posture.]
```

### 11. Exhibit list

Enumerated. Every sourced document. Captions in partner voice (see `voice.md` for the caption style).

```
Exhibit A: Mercy General Hospital, emergency-department record, April 28, 2026.
Exhibit B: Mercy General Hospital, itemized billing statement, May 6, 2026.
Exhibit C: Phoenix Imaging, MRI report and films, May 12, 2026.
Exhibit D: Phoenix Orthopedics (Dr. Chen), initial consultation note, May 18, 2026.
Exhibit E: Phoenix Orthopedics (Dr. Chen), follow-up note, June 4, 2026.
Exhibit F: Phoenix Orthopedics, itemized billing statement, June 5, 2026.
Exhibit G: Valley Physical Therapy, treatment notes and itemized billing, May 22 through June 12, 2026.
Exhibit H: Employer letter, ABC Manufacturing, dated June 1, 2026.
Exhibit I: Pay stubs, ABC Manufacturing, pay periods ending April 27 through June 15, 2026.
```

Photo exhibits are listed with filename and modified date. Scene-diagram or third-party-document exhibits are listed with provider and date.

### 12. Partner sign-off block

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

## Matter-internal sourcing note format

Output path: `~/.hermes/customer_notes/{customer_slug}/pi-demand-draft-YYYY-MM-DD-<matter-id>.md`.

Structure:

```markdown
# PI Demand Draft Sourcing Note — <matter-id>

**Matter:** <matter ID and client name>
**Drafted:** <ISO-8601 timestamp>
**Draft reference:** <DraftRef.id from Email.create_draft, or "dry-run" if --dry-run>
**Voice-gate score:** <score and pass/fail>
**Fabrication-filter result:** <clean | flag | block, plus any violations>

## Sourcing index

| Section                    | Field                  | Sourced from                                         | TBD? |
| -------------------------- | ---------------------- | ---------------------------------------------------- | ---- |
| Header                     | recipient_name         | matter.custom_fields.opposing_adjuster_name          | no   |
| Header                     | recipient_carrier      | matter.custom_fields.opposing_carrier                | no   |
| Header                     | claim_number           | matter.custom_fields.claim_number                    | no   |
| Header                     | date_of_loss           | matter.custom_fields.date_of_incident                | no   |
| Opening                    | client_name            | matter.client_name                                   | no   |
| Opening                    | medical_specials_total | sum of StoredDocument billing rows (5 docs)          | no   |
| Opening                    | lost_wages_total       | (none — employer verification not in storage)        | TBD  |
| Chronology                 | row[0]                 | StoredDocument id "doc_42"                           | no   |
| ... (continued)            | ...                    | ...                                                  | ...  |
| Liability characterization | (none)                 | client_facing_fields.liability_characterization=none | TBD  |
| Demand amount              | (none)                 | client_facing_fields.demand_amount=none              | TBD  |
| Settlement bracket prose   | (none)                 | client_facing_fields.settlement_bracket_prose=none   | TBD  |
| Closing                    | (none)                 | client_facing_fields.case_strategy_language=none     | TBD  |

## Could not source

- Lost wages: no employer-letter document found in matter folder. Partner supplies.
- Pre-incident wage history: no pay-stub-history document found. Not required for the v1 draft; partner can fill in if they want a comparative wage figure.

## Refusal events

- (none)

## Citation refusal events

- (none)

## Voice-gate detail

- Sentence-length p50: 17 words. p95: 28 words. (Within envelope.)
- Banned-pattern hits: 0.
- Layer 2 similarity: 0.78 (threshold 0.65). Pass.

## Adapter calls made

- PracticeManagement.get_matter("matter_42") — 1 call
- DocumentStorage.list_folder({folder_path: "/matters/matter_42", recursive: true}) — 1 call
- DocumentStorage.download_document("doc_42") through DocumentStorage.download_document("doc_51") — 10 calls
- Email.create_draft(...) — 1 call
```

Every adapter call is recorded. The dashboard's "what Marcus used to write this" sourcing block reads the sourcing index. Compliance evidence packets export the sourcing note alongside the draft.
