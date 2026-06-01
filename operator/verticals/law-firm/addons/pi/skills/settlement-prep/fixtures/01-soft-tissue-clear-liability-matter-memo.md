---

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

---

This file is the reference output memo for fixture 01. A correctly-implemented runtime replaying the skill against `01-soft-tissue-clear-liability-matter.yaml` produces this memo body (modulo the date in the header block, which renders as the date of the test run). The body is what `Email.create_draft` receives as `body_text` and is what the supervising partner sees in their drafts folder.

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["sarah.holcomb@holcomb-reyes.invalid"]` (internal memo; the partner is both reviewer and recipient)
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Settlement Conference Prep: Holloway v. Kerr, CV2026-006491, August 1, 2026`
- `thread_id`: `null`
- `matter_ref`: `matter_synthetic_prep_01`
- `drafted_by_skill`: `settlement-prep`

The memo body (everything below the next horizontal rule):

---

To: Sarah Holcomb, Managing Partner, Holcomb & Reyes, LLP
From: Sarah Holcomb (drafted by Marcus, the Operator, on `<today's date>`)
Re: Settlement Conference Prep, Holloway v. Kerr, CV2026-006491
Matter: matter_synthetic_prep_01

Holloway v. Kerr. Auto-accident matter, opened May 1, 2026. Client: Janet Holloway, operator of stopped 2021 Camry rear-ended at Camelback and 24th. Opposing party: David Kerr. Opposing counsel: Theodora Whitfield, Whitfield Reardon, PLLC. Carrier: Statewide Mutual. Settlement conference scheduled August 1, 2026 at Maricopa County Superior Court.

## Conference Logistics

- Date: August 1, 2026
- Location: Maricopa County Superior Court, Settlement Conference Room 4-A
- Mediator: Hon. Paul Mendoza (retired)
- Attendees recorded: Sarah Holcomb (firm), Theodora Whitfield (opposing counsel), Statewide Mutual claims rep TBD

## Chronology

| Date       | Event                                              | Source                                   |
| ---------- | -------------------------------------------------- | ---------------------------------------- |
| 2026-04-28 | Incident at Camelback and 24th, Phoenix            | custom_field: date_of_incident           |
| 2026-04-28 | Phoenix PD on scene, incident report filed         | doc_09                                   |
| 2026-05-03 | First medical contact, Mercy General ED            | doc_01                                   |
| 2026-05-10 | Phoenix Chiropractic initial consult               | doc_02                                   |
| 2026-06-04 | Phoenix Chiropractic followup                      | doc_03                                   |
| 2026-06-25 | Valley PT summary, treatment course concludes      | doc_04                                   |
| 2026-06-01 | ABC Manufacturing employment verification received | doc_07                                   |
| 2026-06-15 | Demand letter served on opposing counsel           | custom_field: demand_served_date, doc_12 |
| 2026-08-01 | Settlement conference scheduled                    | custom_field: settlement_conference_date |

## Damages: Medical Specials

| Provider             | Date range               | Billed | Source |
| -------------------- | ------------------------ | ------ | ------ |
| Mercy General ED     | 2026-05-03               | $4,800 | doc_05 |
| Phoenix Chiropractic | 2026-05-10 to 2026-06-04 | $8,400 | doc_06 |
| Valley PT            | 2026-05-25 to 2026-06-25 | $1,300 | doc_06 |

Medical specials total (billed): $14,500. Adjusted totals are not present in the billing statements for this matter; the partner confirms adjusted figures with the carriers if needed.

## Damages: Lost Wages

| Pay period               | Days lost | Verified amount | Source |
| ------------------------ | --------- | --------------- | ------ |
| 2026-04-28 to 2026-05-15 | 14        | $1,820          | doc_08 |
| 2026-05-16 to 2026-05-31 | 4         | $520            | doc_08 |

Lost wages total: $2,340.

## Strengths (sourced facts)

- Police report attributes fault to opposing party operator. Source: doc_09 (Phoenix PD incident report dated 2026-04-28).
- First medical contact within five days of incident, at Mercy General ED. Sources: custom_field date_of_incident (2026-04-28), doc_01 (Mercy General ED record dated 2026-05-03).
- Six-week documented treatment course at Phoenix Chiropractic and Valley PT, with billing statements that match the dates. Sources: doc_02, doc_03, doc_04, doc_06.
- Employer-verified lost wages with continuity at ABC Manufacturing documented for the eighteen months preceding the incident. Sources: doc_07, doc_08.

Legal-argument framing of these facts: see TBD section below.

## Weaknesses (sourced facts)

The matter file contains no documented weaknesses against the strengths fact list above. The partner may identify additional considerations in the TBD section below; the skill emits no inferred weaknesses.

## Comparable Verdicts (firm memory-rule sourced)

Match criteria: matter_type=auto-accident, injury=soft_tissue, jurisdiction=Maricopa County, liability=clear.

| Case name                    | Year | Jurisdiction      | Verdict | Key matched facts                                                                    | Source (partner-authored)               |
| ---------------------------- | ---- | ----------------- | ------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| Reyes v. Mid-City Cab        | 2024 | Maricopa Superior | $58,000 | rear-end at stoplight, cervical strain, six-week treatment course                    | Maricopa Jury Verdict Reporter 2024-118 |
| Patel v. Sunrise Transit     | 2023 | Maricopa Superior | $42,500 | rear-end at intersection, cervical and lumbar strain, eight-week chiropractic course | partner matter file 2023-441            |
| Aguilar v. Reliant Logistics | 2023 | Maricopa Superior | $67,000 | rear-end at stoplight, cervical strain with mild radiculopathy, ten-week treatment   | partner matter file 2023-322            |

Rows are verbatim from the firm's corpus. The skill produces no derived range, no average, no median, and no recommended bracket. The partner authors the bracket recommendation in the TBD section below.

## Opposing Counsel Prior-Pattern (firm memory-rule sourced)

Opposing counsel: Theodora Whitfield, Whitfield Reardon, PLLC.

| Metric                                     | Value (partner-authored)                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Median days from demand to first offer     | 42                                                                                                  |
| Median days from first offer to settlement | 71                                                                                                  |
| Conference behavior pattern                | Mid-conference settlement (recorded across four prior matters)                                      |
| Partner qualitative note                   | Whitfield rarely opens at meaningful numbers, but moves quickly once anchored above policy midpoint |

Rows are verbatim from the firm's prior-pattern memory rule. The skill does not interpolate.

## Carrier Prior-Pattern (firm memory-rule sourced)

Carrier: Statewide Mutual.

| Metric                                     | Value (partner-authored)                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Median days from demand to first offer     | 38                                                                                                                                              |
| Median days from first offer to settlement | 64                                                                                                                                              |
| Conference behavior pattern                | Settles at conference in roughly two-thirds of matters; trial-eve settlements in the remaining third                                            |
| Partner qualitative note                   | Statewide claims reps have authority up to policy limits and can move at conference; the limiting factor is usually the carrier-counsel handoff |

## Strengths: Legal-Argument Framing

`[TBD: legal-argument framing of strengths - partner authors. The strengths fact list above is provided as input.]`

## Weaknesses: Legal-Argument Framing

`[TBD: legal-argument framing of weaknesses - partner authors. The weaknesses fact list above is provided as input.]`

## Settlement Bracket Recommendation

`[TBD: settlement bracket recommendation - partner authors. The comparable-verdict table above and the damages tabulation are provided as input. The skill produces no bracket because settlement-value analysis is third-rail per law-firm PRD §5; the partner authors the bracket from the cited corpus and the matter facts.]`

## Recommended Posture

`[TBD: recommended posture (open low / open high / anchor / walk-away) - partner authors. The opposing-counsel and carrier prior-pattern tables are provided as input.]`

## Closing

`[TBD: closing recommendation - partner authors. The skill emits no language about negotiation posture, settlement authority, walk-away triggers, or any forward-looking case-strategy framing.]`

## Exhibits

| Exhibit | Document                                         | Source ID |
| ------- | ------------------------------------------------ | --------- |
| A       | Mercy General ED record, 2026-05-03              | doc_01    |
| B       | Phoenix Chiropractic initial consult, 2026-05-10 | doc_02    |
| C       | Phoenix Chiropractic followup, 2026-06-04        | doc_03    |
| D       | Valley PT summary, 2026-06-25                    | doc_04    |
| E       | Mercy General billing statement                  | doc_05    |
| F       | Phoenix Chiropractic billing statement           | doc_06    |
| G       | ABC Manufacturing employment verification        | doc_07    |
| H       | ABC Manufacturing lost wages statement           | doc_08    |
| I       | Phoenix PD incident report, 2026-04-28           | doc_09    |
| J       | Scene photo 01, 2026-04-28                       | doc_10    |
| K       | Scene photo 02, 2026-04-28                       | doc_11    |

---

Sarah Holcomb
Managing Partner
Holcomb & Reyes, LLP
1810 N Central Avenue, Suite 800
Phoenix, AZ 85004
(602) 555-0142
sarah.holcomb@holcomb-reyes.invalid
