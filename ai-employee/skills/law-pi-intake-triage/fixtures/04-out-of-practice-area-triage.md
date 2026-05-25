# Triage note — intake_synthetic_004

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: family-law (out of practice area)
- `sol_window_risk`: not applicable (no PI claim at issue)
- `severity_tier`: not applicable (family law, no injury claim)
- `missing_critical_fields`: none for triage purposes; further information not needed because the matter is outside our practice

## Clio adjacency

- Conflict check skipped; matter is outside practice area filter (personal-injury) per customer.yaml

## Attorney summary

Derek Aldridge is requesting representation in a contested divorce and child custody matter. The firm's practice area filter from customer.yaml is personal-injury only. The matter is outside our scope.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["derek.aldridge@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Divorce and custody — looking for help`
- `thread_id`: `msg_synthetic_intake_004`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Derek,

Thank you for reaching out. Our firm focuses on personal injury matters and we do not handle divorce or family law work. We would not be the right fit for your situation.

For a referral, the Maricopa County Bar Association maintains a Lawyer Referral Service that can connect you with a family-law attorney in Phoenix. Their contact information is on the MCBA website.

We wish you the best with your matter.

Sarah

## Recommended next action

`DECLINE_OUTSIDE_PRACTICE`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present — the case type is unambiguously outside practice area

## Recommended action I did not take

None at this trust ceiling. The next action is shipping the polite refer-out reply, which requires attorney sign-off.
