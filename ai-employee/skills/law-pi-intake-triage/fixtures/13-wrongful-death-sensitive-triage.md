# Triage note — intake_synthetic_013

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: wrongful-death (motor-vehicle, commercial-trucking)
- `sol_window_risk`: low (death May 8, 2026; AZ two-year SOL for wrongful death runs to May 8, 2028; partner should confirm specific accrual date)
- `severity_tier`: catastrophic (death; surviving spouse and two minor children; ongoing police investigation; commercial-trucking defendant)
- `missing_critical_fields`: none for triage purposes

## Clio adjacency

- No matter found for opposing party Sun State Hauling
- No matter found for opposing driver Carl Hopkins individually
- No prior contact on file for Samuel Iwata or Mary Iwata

## Attorney summary

Samuel Iwata's wife Mary Iwata died on May 8, 2026 from injuries sustained in a May 6 collision on the 101 freeway near Northern Avenue in Phoenix. She was rear-ended by a Sun State Hauling semi truck driven by Carl Hopkins. She was transported to Banner Estrella, where she died two days later from internal injuries. Police investigation ongoing; report PD-2026-04921. Opposing carrier Continental Mutual. Surviving family: spouse and two minor children (12 and 9). Client has death certificate, hospital records, and initial police report.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["samuel.iwata@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: My wife was killed in a car accident — looking for representation`
- `thread_id`: `msg_synthetic_intake_013`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Samuel,

We received your message and are very sorry for the loss of your wife.

We would like to schedule a call. Wrongful-death cases involving commercial-trucking defendants follow a different procedural path than ordinary motor-vehicle cases, and we want to walk through what that looks like so you understand what to expect. Our response window is two business days from initial outreach.

In the meantime, please continue to keep everything you have organized: the death certificate, the hospital records, the initial police report, and any communications you receive. Do not speak to Sun State Hauling or to Continental Mutual. Forward us anything they send.

If there is any way the firm can be useful before the call, please let us know.

Sarah

## Recommended next action

`HOLD_FOR_PARTNER_REVIEW`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present
- `wrongful_death_sensitivity`: present — case_type warrants partner attention before any client-facing communication ships

## Recommended action I did not take

None at this trust ceiling. The next action requires the partner to personally review the draft client reply before it ships, given the sensitivity of the case.
