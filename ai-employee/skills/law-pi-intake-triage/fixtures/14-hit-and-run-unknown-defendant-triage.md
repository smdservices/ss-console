# Triage note — intake_synthetic_014

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: motor-vehicle-accident (hit-and-run; uninsured-motorist claim path)
- `sol_window_risk`: low (incident May 16, 2026; AZ two-year SOL runs to May 16, 2028)
- `severity_tier`: moderate (ED visit next day, whiplash diagnosis, 6 weeks of PT ordered)
- `missing_critical_fields`: photographs, dashcam_footage

## Clio adjacency

- Opposing party UNKNOWN (hit-and-run); no adjacency check possible against opposing party
- Client carrier Liberty Mutual has no active adversary matter on file
- No prior contact on file for Denise Araujo

## Attorney summary

Denise Araujo was rear-ended at Bell Road and 35th Avenue in Phoenix on May 16, 2026 at approximately 11 PM in a hit-and-run. The other driver fled; no plate or vehicle description captured. Phoenix police report PD-2026-04863. Banner Boswell diagnosed whiplash; six weeks of PT ordered. Client has uninsured-motorist coverage through Liberty Mutual; the adjuster has reached out but client has not responded yet.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["denise.araujo@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Hit and run on Bell — they left the scene`
- `thread_id`: `msg_synthetic_intake_014`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Denise,

Thank you for the details about the May 16 incident.

Hit-and-run cases with an unidentified other driver have a different shape than typical motor-vehicle cases because the recovery path runs through your own uninsured-motorist coverage rather than the other driver's carrier. We handle these and would like to schedule a call to walk through how that works. Our response window is two business days from initial outreach.

In the meantime, please continue with the PT order and follow Banner's instructions. Do not speak with the Liberty Mutual adjuster, including the one who has already reached out, until we have talked. Forward us any communications they send. If you have a dashcam or any photographs of the damage to your car, send those through.

Sarah

## Recommended next action

`SCHEDULE_INTAKE_CALL`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present
- `unknown_opposing_party`: present — adjacency check has nothing to compare against; matter shape is uninsured-motorist not third-party-tort

## Recommended action I did not take

None at this trust ceiling. The next action requires partner sign-off on the call schedule.
