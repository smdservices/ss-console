# Triage note — intake_synthetic_001

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: motor-vehicle-accident
- `sol_window_risk`: low (incident May 16, 2026; AZ two-year SOL runs to May 16, 2028)
- `severity_tier`: serious (ER visit, ambulance, MRI pending, lost wages, employed in physical role)
- `missing_critical_fields`: none

## Clio adjacency

- No matter found for opposing party David Kerr
- No active matter on file with Saguaro Mutual Insurance
- No prior contact on file for Martin Reyes

## Attorney summary

Martin Reyes was rear-ended by David Kerr at Camelback and 24th Street in Phoenix on May 16, 2026 at approximately 5:30 PM. Mercy General ED treated him for neck and lower back pain on the day of the incident. Phoenix Orthopedics is the follow-up provider with an MRI pending. He has not worked since the accident and is employed as a welder at ABC Manufacturing. The opposing carrier is Saguaro Mutual; police report is PD-2026-04982.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["martin.reyes@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Car accident on Camelback last Friday — need to discuss`
- `thread_id`: `msg_synthetic_intake_001`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Martin,

Thank you for the details. The information you sent gives us a clear picture of what happened on Friday.

A few next steps. We would like to schedule a short call to walk through the timeline, your treatment to date, and what to expect next. Our response window is two business days from your initial outreach, and we will be in touch to put a call on the calendar.

In the meantime, please continue to follow your providers' instructions. Do not talk to the other driver's insurance company. Save every appointment summary and every receipt. Forward us any communications you receive from Saguaro Mutual without responding to them.

We will be in touch shortly.

Sarah

## Recommended next action

`SCHEDULE_INTAKE_CALL`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present

## Recommended action I did not take

None at this trust ceiling. The next action requires attorney sign-off and a calendar tool the agent does not hold at draft_for_review.
