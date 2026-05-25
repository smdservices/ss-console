# Triage note — intake_synthetic_015

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: motor-vehicle-accident (out-of-state incident; California jurisdiction)
- `sol_window_risk`: medium (incident May 17, 2026; California two-year SOL runs to May 17, 2028; partner should confirm California-specific accrual + any local notice rules)
- `severity_tier`: serious (ER visit, cervical herniated disc, ortho follow-up)
- `missing_critical_fields`: none

## Clio adjacency

- No matter found for opposing party Marcus Webber
- No prior contact on file for Patrick Lindholm

## Attorney summary

Patrick Lindholm, an Arizona resident, was rear-ended in San Diego, California on May 17, 2026 at approximately 6 PM by Marcus Webber. UCSD Health diagnosed cervical herniated disc; Phoenix Spine and Joint follow-up next week. San Diego PD report 26-SD-19842. Opposing carrier Pacific Coast Insurance. The incident is in California; the firm's bar admission is Arizona. Partner should evaluate co-counsel referral to a San Diego firm or evaluate whether the case warrants a California pro hac vice posture.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["patrick.lindholm@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Car accident in San Diego while on vacation — am Arizona resident`
- `thread_id`: `msg_synthetic_intake_015`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Patrick,

Thank you for the details about the May 17 incident in San Diego.

The case has a wrinkle: the incident is in California, so it would go through California courts and under California law. Our firm is licensed in Arizona. We can still help, but the structure typically involves either working with a San Diego firm as local counsel or our seeking permission to practice in California for the specific case.

We would like to schedule a call to walk through both options and decide which makes more sense for your situation. Our response window is two business days from initial outreach.

In the meantime, please continue with your Phoenix Spine and Joint follow-up next week and follow UCSD's instructions on the neck brace. Do not speak with Pacific Coast Insurance until we have talked. Save the police report and all medical paperwork.

Sarah

## Recommended next action

`HOLD_FOR_PARTNER_REVIEW`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present
- `out_of_state_jurisdiction`: present — California venue; partner decides co-counsel referral vs. pro hac vice

## Recommended action I did not take

None at this trust ceiling. The next action requires partner sign-off on the call schedule + the jurisdictional posture decision.
