---

`[SYNTHETIC FIXTURE - NOT A REAL MATTER]`

---

This file is the reference output memo for fixture 02. A correctly-implemented runtime replaying the skill against `02-disc-herniation-contested-liability-matter.yaml` produces this memo body (modulo the date in the header block, which renders as the date of the test run).

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["sarah.holcomb@holcomb-reyes.invalid"]` (internal memo)
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Settlement Conference Prep: Chen v. Acosta, CV2026-004128, August 19, 2026`
- `thread_id`: `null`
- `matter_ref`: `matter_synthetic_prep_02`
- `drafted_by_skill`: `law-pi-settlement-prep`

The memo body (everything below the next horizontal rule):

---

To: Sarah Holcomb, Managing Partner, Holcomb & Reyes, LLP
From: Sarah Holcomb (drafted by Marcus, the AI Employee, on `<today's date>`)
Re: Settlement Conference Prep, Chen v. Acosta, CV2026-004128
Matter: matter_synthetic_prep_02

Chen v. Acosta. Auto-accident matter, opened March 12, 2026. Client: Marcus Chen, operator of 2019 Honda Civic making a protected left turn at 7th Street and McDowell Road. Opposing party: Linda Acosta. Opposing counsel: Roland Bishop, Bishop & Vargas, P.A. Carrier: Northland Indemnity. Settlement conference scheduled August 19, 2026. Liability is contested per the police report; the report records both operators' statements without attribution of fault.

## Conference Logistics

- Date: August 19, 2026
- Location: Bishop & Vargas, P.A., 3940 E Camelback Road, Suite 200, Phoenix AZ 85018
- Mediator: James Tovar, JAMS Phoenix
- Attendees recorded: `[TBD: attendee list not recorded]`

## Chronology

| Date       | Event                                                    | Source                                   |
| ---------- | -------------------------------------------------------- | ---------------------------------------- |
| 2026-03-08 | Incident at 7th Street and McDowell Road, Phoenix        | custom_field: date_of_incident           |
| 2026-03-08 | Phoenix PD on scene, incident report filed               | doc_12                                   |
| 2026-03-12 | First medical contact, Mercy General ED                  | doc_01                                   |
| 2026-03-25 | MRI at Phoenix Imaging, L4-L5 disc herniation documented | doc_02                                   |
| 2026-04-02 | Phoenix Orthopedics initial consult                      | doc_03                                   |
| 2026-04-20 | Phoenix Orthopedics first followup                       | doc_04                                   |
| 2026-05-22 | Phoenix Orthopedics second followup                      | doc_05                                   |
| 2026-06-15 | Valley PT summary, eleven-week course concludes          | doc_06                                   |
| 2026-06-25 | Compass Software employment verification received        | doc_10                                   |
| 2026-06-30 | Demand letter served on opposing counsel                 | custom_field: demand_served_date, doc_16 |
| 2026-08-19 | Settlement conference scheduled                          | custom_field: settlement_conference_date |

## Damages: Medical Specials

| Provider            | Date range               | Billed  | Source |
| ------------------- | ------------------------ | ------- | ------ |
| Mercy General ED    | 2026-03-12               | $5,400  | doc_07 |
| Phoenix Imaging     | 2026-03-25               | $3,200  | doc_08 |
| Phoenix Orthopedics | 2026-04-02 to 2026-05-22 | $14,800 | doc_09 |
| Valley PT           | 2026-04-15 to 2026-06-15 | $9,400  | doc_09 |

Medical specials total (billed): $32,800.

## Damages: Lost Wages

| Pay period               | Days lost | Verified amount | Source |
| ------------------------ | --------- | --------------- | ------ |
| 2026-03-08 to 2026-04-15 | 21        | $4,200          | doc_11 |
| 2026-04-16 to 2026-05-15 | 6         | $1,260          | doc_11 |

Lost wages total: $5,460.

## Strengths (sourced facts)

- March 25, 2026 MRI at Phoenix Imaging documents L4-L5 disc herniation. Source: doc_02.
- First medical contact within four days of incident, at Mercy General ED. Sources: custom_field date_of_incident (2026-03-08), doc_01 (Mercy General ED record dated 2026-03-12).
- Eleven-week documented treatment course across orthopedic consult and PT, with billing statements that match the dates. Sources: doc_03, doc_04, doc_05, doc_06, doc_09.
- Employer-verified employment continuity at Compass Software documented for the preceding twenty-six months. Sources: doc_10, doc_11.

Legal-argument framing of these facts: see TBD section below.

## Weaknesses (sourced facts)

- Police report records both operators' statements without attribution of fault. The contested-liability profile shifts comparative-fault risk onto the firm. Source: doc_12 (Phoenix PD incident report dated 2026-03-08).
- Matter custom_field prior_back_injury_history records a 2021 lumbar strain at the same L4-L5 level, documented in pre-incident PCP records. Source: matter custom_field prior_back_injury_history.

Legal-argument framing of these facts: see TBD section below.

## Comparable Verdicts (firm memory-rule sourced)

Match criteria: matter_type=auto-accident, injury=disc_herniation_no_surgery, jurisdiction=Maricopa County, liability=contested.

| Case name                      | Year | Jurisdiction      | Verdict  | Key matched facts                                                                                                               | Source (partner-authored)               |
| ------------------------------ | ---- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Kowalski v. Sunrise Trucking   | 2024 | Maricopa Superior | $148,000 | left-turn intersection with disputed right-of-way, L4-L5 herniation no surgery, comparative-fault verdict reduced from $185,000 | Maricopa Jury Verdict Reporter 2024-602 |
| Delgado v. Cactus Construction | 2023 | Maricopa Superior | $112,000 | intersection collision, L5-S1 herniation no surgery, prior back-injury history disclosed at trial                               | partner matter file 2023-517            |

Rows are verbatim from the firm's corpus. The skill produces no derived range, no average, no median, and no recommended bracket. The partner authors the bracket recommendation in the TBD section below.

## Opposing Counsel Prior-Pattern (firm memory-rule sourced)

Opposing counsel: Roland Bishop, Bishop & Vargas, P.A.

| Metric                                     | Value (partner-authored)                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Median days from demand to first offer     | 28                                                                                                                                                                 |
| Median days from first offer to settlement | 96                                                                                                                                                                 |
| Conference behavior pattern                | Trial-eve settlement (recorded across three prior matters). Bishop holds positions at mediation and moves in the two weeks before trial.                           |
| Partner qualitative note                   | Bishop is comfortable in front of a jury and will not anchor at mediation unless the carrier instructs. Expect a low first offer; expect movement closer to trial. |

Rows are verbatim from the firm's prior-pattern memory rule. The skill does not interpolate.

## Carrier Prior-Pattern (firm memory-rule sourced)

No prior-pattern data on Northland Indemnity in firm memory. The partner authors the posture section without a carrier anchor, or the firm records a prior-pattern row from a prior matter before the conference.

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

| Exhibit | Document                                        | Source ID |
| ------- | ----------------------------------------------- | --------- |
| A       | Mercy General ED record, 2026-03-12             | doc_01    |
| B       | Phoenix Imaging MRI report, 2026-03-25          | doc_02    |
| C       | Phoenix Orthopedics initial consult, 2026-04-02 | doc_03    |
| D       | Phoenix Orthopedics followup, 2026-04-20        | doc_04    |
| E       | Phoenix Orthopedics second followup, 2026-05-22 | doc_05    |
| F       | Valley PT summary, 2026-06-15                   | doc_06    |
| G       | Mercy General billing statement                 | doc_07    |
| H       | Phoenix Imaging billing statement               | doc_08    |
| I       | Phoenix Orthopedics and PT billing statement    | doc_09    |
| J       | Compass Software employment verification        | doc_10    |
| K       | Compass Software lost wages statement           | doc_11    |
| L       | Phoenix PD incident report, 2026-03-08          | doc_12    |
| M       | Scene photo 01, 2026-03-08                      | doc_13    |
| N       | Scene photo 02, 2026-03-08                      | doc_14    |
| O       | Scene photo 03, 2026-03-08                      | doc_15    |

---

Sarah Holcomb
Managing Partner
Holcomb & Reyes, LLP
1810 N Central Avenue, Suite 800
Phoenix, AZ 85004
(602) 555-0142
sarah.holcomb@holcomb-reyes.invalid
