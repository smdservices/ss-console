# Memo Output Format

Two outputs per skill invocation:

1. **The memo itself** - created via `Email.create_draft` into the supervising partner's drafts folder. The memo is internal; the partner is both the reviewer and the recipient. Per ADR 0005 `Email.create_draft` remains the only outbound surface even for internal addressees.
2. **The matter-internal sourcing note** - written at `~/.hermes/customer_notes/{customer_slug}/pi-settlement-prep-YYYY-MM-DD-<matter-id>.md`. Records what populated each section. Read by the dashboard's "what Marcus used to write this" sourcing block. Never sent.

Section order is fixed. The partner scans the memo top-to-bottom in the fifteen minutes before walking into the conference; section order is the scan order.

## Memo section order

```
1. Header block (matter-facts summary in one paragraph)
2. Conference logistics (date, location, mediator if known, attendees if known)
3. Chronology of treatment and matter milestones
4. Damages tabulation (medical specials table + lost wages table)
5. Strengths fact list (sourced facts, no characterization)
6. Weaknesses fact list (sourced facts, no characterization)
7. Comparable-verdict table (memory-rule sourced, verbatim rows or corpus-absent prose)
8. Opposing-counsel prior-pattern table (memory-rule sourced or corpus-absent prose)
9. Carrier prior-pattern table (memory-rule sourced or corpus-absent prose)
10. Strengths legal-argument prose (TBD marker)
11. Weaknesses legal-argument prose (TBD marker)
12. Settlement bracket recommendation (TBD marker)
13. Recommended posture (TBD marker)
14. Closing case-strategy language (TBD marker)
15. Exhibit list (every sourced document, numbered)
16. Partner signoff (from customer.yaml)
```

## Section templates

### 1. Header block

```
[SYNTHETIC FIXTURE WATERMARK if applicable]

To: <Partner first name and signature block from customer.yaml>
From: <Partner first name> (drafted by Marcus, the Operator, on <today's date>)
Re: Settlement Conference Prep - <case caption>, <case number>
Matter: <matter id>

<Matter-facts summary paragraph: case caption, matter type, opened date, client name, client role, opposing party name, opposing counsel name and firm, carrier name. Every field renders from a sourced custom_field or as a TBD marker. Dense, partner-to-self prose. Three to six short sentences.>
```

Every angle-bracketed value renders from a sourced field or as a TBD marker. The skill does not author client names, opposing counsel names, or carrier names it cannot source.

### 2. Conference logistics

```
## Conference Logistics

- Date: <settlement_conference_date from matter.custom_fields, formatted as Month D, YYYY>
- Location: <conference_location from matter.custom_fields, or TBD>
- Mediator: <mediator_name from matter.custom_fields, or "[TBD: mediator not recorded in matter file]">
- Attendees recorded: <attendees_recorded from matter.custom_fields, or "[TBD: attendee list not recorded]">
```

The conference date is the load-bearing field; the skill refuses if it is not present (`conference_date_missing`).

### 3. Chronology of treatment and matter milestones

A linear table. Each row sources to a `StoredDocument.id` or a `matter.custom_fields.<field>` reference.

```
## Chronology

| Date       | Event                                                        | Source                                   |
| ---------- | ------------------------------------------------------------ | ---------------------------------------- |
| 2026-04-28 | Incident at Camelback and 24th, Phoenix                      | custom_field: date_of_incident           |
| 2026-05-03 | First medical contact, Mercy General ED                      | doc_01                                   |
| 2026-05-12 | MRI at Phoenix Imaging, L4-L5 disc herniation documented     | doc_02                                   |
| 2026-05-18 | Initial orthopedic consult, Phoenix Orthopedics              | doc_03                                   |
| 2026-06-04 | Orthopedic followup, Phoenix Orthopedics                     | doc_04                                   |
| 2026-06-12 | Physical therapy summary, Valley PT                          | doc_05                                   |
| 2026-06-15 | Demand letter served on opposing counsel                     | custom_field: demand_served_date         |
| 2026-08-01 | Settlement conference scheduled                              | custom_field: settlement_conference_date |
```

Events that cannot be sourced do not appear. The chronology is anchored in document IDs and matter custom_fields; the skill does not narrate events between sourced rows.

### 4. Damages tabulation

Two sub-tables.

#### 4a. Medical specials

```
## Damages: Medical Specials

| Provider             | Date range            | Billed   | Adjusted | Source |
| -------------------- | --------------------- | -------- | -------- | ------ |
| Mercy General        | 2026-05-03            | $4,800   | $3,200   | doc_06 |
| Phoenix Imaging      | 2026-05-12            | $2,200   | $1,800   | doc_06 |
| Phoenix Orthopedics  | 2026-05-18 to 2026-06-04 | $5,400 | $4,100   | doc_07 |
| Valley PT            | 2026-05-25 to 2026-06-30 | $6,200 | $5,400   | doc_07 |

Medical specials total (billed): $18,600
Medical specials total (adjusted): $14,500
```

Totals compute only when every row sources. A partial-source table renders the totals as `[TBD: partial-source totals - partner confirms after billing exhibits are complete]`.

#### 4b. Lost wages

```
## Damages: Lost Wages

| Pay period          | Days lost | Verified amount | Source |
| ------------------- | --------- | --------------- | ------ |
| 2026-04-28 to 2026-05-15 | 14    | $1,820          | doc_08 |
| 2026-05-16 to 2026-05-31 | 4     | $520            | doc_08 |

Lost wages total: $2,340
```

### 5. Strengths fact list

Bullet list. Each bullet states a sourced fact and lists the source. No characterizations.

```
## Strengths (sourced facts)

- May 12, 2026 MRI at Phoenix Imaging documents L4-L5 disc herniation. Source: doc_02.
- First medical contact within five days of incident, at Mercy General ED. Sources: custom_field date_of_incident, doc_01.
- Police report attributes fault to opposing party operator. Source: doc_09 (Phoenix PD incident report dated 2026-04-28).
- Documented employment continuity at ABC Manufacturing for the eighteen months preceding the incident. Source: doc_08.

Legal-argument framing of these facts: see TBD section below.
```

### 6. Weaknesses fact list

Bullet list. Each bullet states a sourced fact and lists the source. No characterizations.

```
## Weaknesses (sourced facts)

- Five-day gap between incident (2026-04-28) and first medical contact (2026-05-03). Sources: custom_field date_of_incident, doc_01.
- Matter custom_field prior_back_injury_history records a 2021 lumbar strain at the same level (L4-L5). Source: matter custom_field prior_back_injury_history.

Legal-argument framing of these facts: see TBD section below.
```

When the matter file contains no documented weakness, the section reads:

```
## Weaknesses (sourced facts)

The matter file contains no documented weaknesses against the strengths fact list above. The partner may identify additional considerations in the TBD section below; the skill emits no inferred weaknesses.
```

### 7. Comparable-verdict table

Memory-rule sourced. Rows surface verbatim from the firm's `customer.yaml.memory_rules.comparable_verdicts` corpus where the matter's profile matches the row's criterion fields.

```
## Comparable Verdicts (firm memory-rule sourced)

Match criteria: matter_type=auto-accident, injury=disc_herniation, jurisdiction=Maricopa County, liability=clear.

| Case name            | Year | Jurisdiction         | Verdict    | Key matched facts                                    | Source (partner-authored)              |
| -------------------- | ---- | -------------------- | ---------- | ---------------------------------------------------- | -------------------------------------- |
| Reyes v. Mid-City    | 2024 | Maricopa Superior    | $185,000   | rear-end, L4-L5 herniation, clear liability          | Maricopa Jury Verdict Reporter 2024-118|
| Patel v. Sunrise     | 2023 | Maricopa Superior    | $142,000   | rear-end, L5-S1 herniation, clear liability          | partner matter file 2023-441           |
| Aguilar v. Reliant   | 2023 | Maricopa Superior    | $97,000    | rear-end, lumbar strain plus disc bulge, clear liability | partner matter file 2023-322       |

Rows are verbatim from the firm's corpus. The skill produces no derived range, no average, no median, and no recommended bracket. The partner authors the bracket recommendation in the TBD section below.
```

When no rows match, the table renders as:

```
## Comparable Verdicts (firm memory-rule sourced)

No comparable verdicts in the firm's memory rule match this matter's profile (auto-accident, disc herniation, Maricopa County, clear liability). The partner authors the bracket recommendation from external research, or the firm extends the corpus before the conference.
```

### 8. Opposing-counsel prior-pattern table

```
## Opposing Counsel Prior-Pattern (firm memory-rule sourced)

Opposing counsel: <opposing_counsel_name from matter custom_fields>, <opposing_counsel_firm>.

| Metric                                       | Value (partner-authored)                |
| -------------------------------------------- | --------------------------------------- |
| Median days from demand to first offer       | 42                                      |
| Median days from first offer to settlement   | 71                                      |
| Conference behavior pattern                  | Mid-conference settlement (recorded across four prior matters) |
| Partner qualitative note                     | Whitfield rarely opens at meaningful numbers, but moves quickly once anchored above policy midpoint |

Rows are verbatim from the firm's prior-pattern memory rule. The skill does not interpolate.
```

When the opposing counsel is not in the corpus, the section reads:

```
## Opposing Counsel Prior-Pattern (firm memory-rule sourced)

No prior-pattern data on <opposing_counsel_name> in firm memory. The partner authors the posture section without an opposing-counsel anchor, or the firm records a prior-pattern row from a prior matter before the conference.
```

### 9. Carrier prior-pattern table

Same shape as section 8, keyed on `opposing_carrier_name` instead of opposing counsel.

### 10. Strengths legal-argument prose

```
## Strengths: Legal-Argument Framing

`[TBD: legal-argument framing of strengths - partner authors. The strengths fact list above is provided as input.]`
```

### 11. Weaknesses legal-argument prose

```
## Weaknesses: Legal-Argument Framing

`[TBD: legal-argument framing of weaknesses - partner authors. The weaknesses fact list above is provided as input.]`
```

### 12. Settlement bracket recommendation

```
## Settlement Bracket Recommendation

`[TBD: settlement bracket recommendation - partner authors. The comparable-verdict table above and the damages tabulation are provided as input. The skill produces no bracket because settlement-value analysis is third-rail per law-firm PRD §5; the partner authors the bracket from the cited corpus and the matter facts.]`
```

### 13. Recommended posture

```
## Recommended Posture

`[TBD: recommended posture (open low / open high / anchor / walk-away) - partner authors. The opposing-counsel and carrier prior-pattern tables are provided as input.]`
```

### 14. Closing case-strategy language

```
## Closing

`[TBD: closing recommendation - partner authors. The skill emits no language about negotiation posture, settlement authority, walk-away triggers, or any forward-looking case-strategy framing.]`
```

### 15. Exhibit list

```
## Exhibits

| Exhibit | Document                                       | Source ID |
| ------- | ---------------------------------------------- | --------- |
| A       | Mercy General ED record, 2026-05-03            | doc_01    |
| B       | Phoenix Imaging MRI report, 2026-05-12         | doc_02    |
| C       | Phoenix Orthopedics initial consult, 2026-05-18 | doc_03   |
| D       | Phoenix Orthopedics followup, 2026-06-04       | doc_04    |
| E       | Valley PT summary, 2026-06-12                  | doc_05    |
| F       | Mercy General billing statement                | doc_06    |
| G       | Phoenix Orthopedics billing statement          | doc_07    |
| H       | ABC Manufacturing employment verification      | doc_08    |
| I       | Phoenix PD incident report, 2026-04-28         | doc_09    |
```

Every exhibit references a sourced `StoredDocument.id`. No invented exhibits.

### 16. Partner signoff

The partner's signature block from `customer.yaml.signature_block`. Internal memos may use a shorter block than external correspondence; the Layer 2 corpus decides.

## Sourcing note

Section-by-section sourcing index. Written to `~/.hermes/customer_notes/{customer_slug}/pi-settlement-prep-YYYY-MM-DD-<matter-id>.md`.

```
# Sourcing Note - Settlement Prep Memo

Matter: <matter-id>
Conference date: <date>
Generated: <timestamp>
Skill: settlement-prep@<version>

## Matter-facts summary

- case_caption: matter.custom_fields.case_caption
- case_number: matter.custom_fields.case_number
- client_name: matter.client_name
- opposing_counsel_name: matter.custom_fields.opposing_counsel_name
- opposing_carrier_name: matter.custom_fields.opposing_carrier_name

## Chronology

- 2026-04-28 (incident): matter.custom_fields.date_of_incident
- 2026-05-03 (first medical): doc_01 (Mercy General ED record)
- ...

## Damages

- doc_06 row Mercy General: billed=$4,800, adjusted=$3,200
- doc_06 row Phoenix Imaging: billed=$2,200, adjusted=$1,800
- ...

## Strengths

- fact 1: source doc_02
- fact 2: sources custom_field date_of_incident + doc_01
- ...

## Weaknesses

- fact 1: sources custom_field date_of_incident + doc_01
- fact 2: source custom_field prior_back_injury_history

## Comparable verdicts

- row 1 (Reyes v. Mid-City): memory_rule comparable_verdicts row_id rv_2024_118
- row 2 (Patel v. Sunrise): memory_rule comparable_verdicts row_id pv_2023_441
- ...

## Opposing-counsel prior-pattern

- opposing_counsel row: memory_rule opposing_counsel_patterns row_id oc_whitfield

## Carrier prior-pattern

- carrier row: memory_rule carrier_patterns row_id cp_statewide_mutual

## TBD fields and reason

- settlement_bracket_recommendation: tagged `none`, fabrication filter blocks any non-empty render
- recommended_posture: tagged `none`, fabrication filter blocks
- strengths_legal_argument_prose: tagged `none`, partner authors
- weaknesses_legal_argument_prose: tagged `none`, partner authors
- case_strategy_language: tagged `none`, partner authors

## Voice gate score

- overall: 0.86 (above threshold 0.75)
- internal_memo_register_subscore: 0.81

## Adapter calls

- practice_management.get_matter: 1
- document_storage.list_folder: 1
- document_storage.download_document: 9
- email.create_draft: 1
```
