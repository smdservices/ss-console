# Triage note — intake_synthetic_005

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: motor-vehicle-accident
- `sol_window_risk`: low (incident May 17, 2026; AZ two-year SOL runs to May 17, 2028)
- `severity_tier`: serious (ER visit, fractured wrist, commercial-truck defendant)
- `missing_critical_fields`: treatment_followup, witness_information, employer_or_lost_wages

## Clio adjacency

- No matter found for opposing party Saguaro Delivery Co
- No prior contact on file for Maxine Becker

## Attorney summary

Maxine Becker reports a motorcycle accident with a Saguaro Delivery Co commercial truck at Bell Road and 20th Avenue in Phoenix on May 17, 2026 at approximately 11 AM. HonorHealth ED diagnosed a fractured wrist. Inbound tone is hostile and demanding; the message threatens to retain another firm within the same business day. Tone classification: hostile.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["maxine.becker@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: You people need to call me back about my accident — TODAY`
- `thread_id`: `msg_synthetic_intake_005`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Maxine,

Thank you for sending the details about the May 17 incident. We received your message and want to make sure we respond carefully.

Our response window is two business days from initial outreach. The attorney handling intake will be in touch within that window to schedule a call. In the meantime, please continue to follow your providers' instructions and avoid speaking with Saguaro Delivery Co or any representative of their insurance carrier.

Sarah

## Recommended next action

`HOLD_FOR_PARTNER_REVIEW`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: present — the message threatens departure within the same business day and uses adversarial framing toward the firm. Flagged for partner review before the draft ships.
- `ambiguous_classification`: not present

## Recommended action I did not take

None at this trust ceiling. The next action requires the partner to review the hostile-tone flag and decide whether to proceed with the standard response window or escalate to an immediate call.
