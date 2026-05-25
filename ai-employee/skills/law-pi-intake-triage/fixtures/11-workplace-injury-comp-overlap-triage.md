# Triage note — intake_synthetic_011

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: motor-vehicle-accident (third-party tortfeasor; workers-comp parallel claim ongoing)
- `sol_window_risk`: low (incident May 19, 2026; AZ two-year SOL runs to May 19, 2028)
- `severity_tier`: serious (urgent care, ortho referral, diagnosed L5 herniation, lost wages)
- `missing_critical_fields`: police_report_number, opposing_driver_name, opposing_carrier

## Clio adjacency

- No matter found for opposing party Mountain Wholesale
- No matter found for FastBox Logistics
- No prior contact on file for Tomas Lozano

## Attorney summary

Tomas Lozano was rear-ended at a loading dock at 4445 South 32nd Street in Phoenix on May 19, 2026 at approximately 10 AM. He was on the job for his employer FastBox Logistics; the other vehicle is owned by Mountain Wholesale. Diagnosed L5 herniation; ortho referred. Workers-comp claim on the FastBox side is active for medical bills and lost wages. Third-party PI claim against Mountain Wholesale is independent of the workers-comp claim per his comp rep's note.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["tomas.lozano@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Hurt at work but the other driver was not from my company`
- `thread_id`: `msg_synthetic_intake_011`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Tomas,

Thank you for the details about the May 19 incident.

Cases like this one (workers comp on one side, a third-party motor-vehicle claim on the other) come up regularly and we handle them. We would like to schedule a call to walk through the timeline, the medical picture, and how a third-party case typically interacts with the comp claim. Our response window is two business days from initial outreach.

In the meantime, please send through the name of the other driver, the police report number, and the name of Mountain Wholesale's insurance carrier when you have them. Continue with your ortho referral and follow your providers' instructions. Forward us anything Mountain Wholesale or their carrier sends you without responding.

Sarah

## Recommended next action

`SCHEDULE_INTAKE_CALL`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present — case is clearly third-party PI alongside an existing workers-comp claim

## Recommended action I did not take

None at this trust ceiling. The next action requires partner sign-off on the call schedule.
