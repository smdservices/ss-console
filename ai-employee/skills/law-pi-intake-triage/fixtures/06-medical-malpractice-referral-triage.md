# Triage note — intake_synthetic_006

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: medical-malpractice
- `sol_window_risk`: medium (incident March 4, 2026; AZ med-mal SOL has tighter rules than general PI; partner should confirm exact deadline)
- `severity_tier`: serious (multiple ED visits, sepsis-related complications, second-surgeon corroboration)
- `missing_critical_fields`: none for referral purposes

## Clio adjacency

- No matter found for opposing party Dr. Andrew Chen
- No matter found for Banner Desert Medical Center
- No prior contact on file for Priya Balasubramanian

## Attorney summary

Priya Balasubramanian reports a surgical error during gallbladder surgery on March 4, 2026 at Banner Desert Medical Center, with subsequent corroboration from a Mayo surgeon. Medical-malpractice is a sub-specialty distinct from the firm's general PI practice; most PI firms refer these out unless they have a dedicated med-mal team.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["priya.balasubramanian@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Surgical error claim`
- `thread_id`: `msg_synthetic_intake_006`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Priya,

Thank you for sending the details about your surgery and what has happened since.

Medical malpractice is a specialty area. While we focus on personal injury, surgical-error claims involve expert affidavit requirements and SOL rules that benefit from a firm that handles these full time. We would not be the right fit.

For a referral, the Maricopa County Bar Association maintains a Lawyer Referral Service that can connect you with a medical-malpractice attorney in Phoenix. We would also be willing to suggest specific firms if you would like; please reply if that would be helpful.

We wish you the best with your case.

Sarah

## Recommended next action

`REFER_OUT`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present

## Recommended action I did not take

None at this trust ceiling. The next action requires partner sign-off on the refer-out reply, particularly the offer to suggest specific firms.
