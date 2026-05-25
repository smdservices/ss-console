# Triage note — intake_synthetic_010

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: premises-liability (slip-and-fall, commercial defendant)
- `sol_window_risk`: low (incident May 19, 2026; AZ two-year SOL runs to May 19, 2028)
- `severity_tier`: serious (ER visit, lumbar strain, possible disc involvement, MRI scheduled, lost wages in a physical-trade occupation)
- `missing_critical_fields`: store_incident_report_copy, witnesses, photographs_provided

## Clio adjacency

- No matter found for opposing party Sunshine Market
- No prior contact on file for Wei Zhang

## Attorney summary

Wei Zhang slipped on a wet floor at the Sunshine Market on Bell Road and 7th Street in Phoenix on May 19, 2026 at approximately 7 PM. Client reports a recently-mopped floor with no warning signage visible. Assistant manager Tony Reeve filled out an incident report; client requested a copy and has not received it. Banner University Phoenix ED diagnosed lumbar strain with possible disc involvement; MRI Friday. Client cannot work as a hairdresser at Atelier Phoenix until cleared. Client has photographs and a receipt confirming presence on the premises.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["wei.zhang@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Slip and fall at a Sunshine Market — back injury`
- `thread_id`: `msg_synthetic_intake_010`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Wei,

Thank you for the details about the May 19 incident at Sunshine Market.

We would like to schedule a call to discuss next steps. Our response window is two business days from initial outreach. In the meantime, please send us the photographs you took at the scene and the receipt from that morning. Also, please write down anything you remember about whether anyone else was nearby when it happened, including the assistant manager you spoke with.

Please follow your MRI orders this Friday and continue to follow Banner's instructions. Do not speak to anyone from Sunshine Market or their insurance carrier about the incident. If Sunshine Market or their insurer contacts you, take down their name and the date and forward it to us.

Sarah

## Recommended next action

`SCHEDULE_INTAKE_CALL`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present

## Recommended action I did not take

None at this trust ceiling. The next action requires the partner to schedule the call and to follow up with Sunshine Market on the incident-report copy.
