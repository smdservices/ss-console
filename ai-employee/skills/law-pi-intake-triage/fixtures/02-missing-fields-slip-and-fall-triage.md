# Triage note — intake_synthetic_002

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: slip-and-fall
- `sol_window_risk`: UNKNOWN (date of incident not supplied)
- `severity_tier`: AMBIGUOUS (hip pain reported; medical treatment status unclear)
- `missing_critical_fields`: date_of_incident, incident_location, opposing_party_name, treatment_status, current_pain_level

## Clio adjacency

- Cannot run conflict check without opposing party name or location
- No prior contact on file for Janet Tomlinson

## Attorney summary

Janet Tomlinson reports a fall at an unspecified store and hip pain. She has not yet seen a doctor. Date of incident, location, opposing party, and treatment history are all absent. No information to assess statute-of-limitations risk or severity.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["janet.tomlinson@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Need help with a fall`
- `thread_id`: `msg_synthetic_intake_002`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Janet,

Thank you for reaching out about your fall. To look into whether we can help, we need a few specifics.

Please reply with the date your fall happened, the name and address of the store, and what you have done so far for the hip pain. If you have seen a doctor or been to urgent care, please share where and when. If you have any photos of the location or any incident report the store gave you, please attach those too.

Our response window is two business days from when we have the basic facts. We will be in touch once we have a clearer picture.

Sarah

## Recommended next action

`REQUEST_MISSING_INFO`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: present — case_type is confident but every other axis is unresolved without missing fields

## Recommended action I did not take

None at this trust ceiling. The next action requires attorney sign-off on the missing-info request before the draft ships.
