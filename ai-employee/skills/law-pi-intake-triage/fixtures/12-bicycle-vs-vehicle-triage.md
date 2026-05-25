# Triage note — intake_synthetic_012

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: motor-vehicle-accident (bicyclist vs. car)
- `sol_window_risk`: low (incident May 20, 2026; AZ two-year SOL runs to May 20, 2028)
- `severity_tier`: moderate (ER visit by ambulance, fractured radius in cast, partial-work disruption)
- `missing_critical_fields`: none

## Clio adjacency

- No matter found for opposing party Erika Mason
- No matter found for opposing carrier Cascade Mutual
- No prior contact on file for Rachelle Dempsey

## Attorney summary

Rachelle Dempsey was struck by a car driven by Erika Mason on 7th Avenue near Indian School in Phoenix on May 20, 2026 at approximately 7:30 AM while commuting in the bike lane. The car pulled out of a parking-lot driveway without yielding. St. Joseph's diagnosed a fractured radius (right wrist; now in cast) and road rash. Phoenix police report PD-2026-05348. Opposing carrier is Cascade Mutual. Client is a software engineer at AcmePath; partial-work disruption.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["rachelle.dempsey@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Hit by a car while biking — need help`
- `thread_id`: `msg_synthetic_intake_012`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Rachelle,

Thank you for the details about the May 20 incident on 7th Avenue.

We would like to schedule a call to walk through the timeline and what to expect next. Our response window is two business days from initial outreach.

In the meantime, please continue with your orthopedics follow-up next week and follow St. Joseph's instructions on the cast and the road rash. Do not speak with Cascade Mutual. Save every appointment summary and every receipt. If you took any photographs of the scene, your bike, or your injuries, forward those through. Note any days you cannot work in full so we have a record of the lost-wage impact.

Sarah

## Recommended next action

`SCHEDULE_INTAKE_CALL`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present

## Recommended action I did not take

None at this trust ceiling. The next action requires partner sign-off on the call schedule.
