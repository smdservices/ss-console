# Triage note — intake_synthetic_008

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: motor-vehicle-accident (motorcycle)
- `sol_window_risk`: low (incident May 21, 2026; AZ two-year SOL runs to May 21, 2028)
- `severity_tier`: serious (ambulance, broken collarbone, concussion, ongoing symptoms, work-impacting cognitive effects)
- `missing_critical_fields`: opposing_party_full_name, opposing_carrier, police_report_number

## Clio adjacency

- Conflict check skipped at intake; will run after opposing party name is confirmed
- No prior contact on file for Eddie Watanabe

## Attorney summary

Eddie Watanabe was struck on his motorcycle by a left-turning car on Tatum Boulevard north of Cactus Road in Phoenix on May 21, 2026 at approximately 4 PM. Banner Thunderbird ED diagnosed broken collarbone and concussion. Ongoing headache and sleep disruption; neurology follow-up planned this week. Client is a remote-work graphic designer with screen-focus impairment. Opposing party name partially captured from the call (possibly Maxwell); police report and insurance carrier pending.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["call-followup-eddie-watanabe-602-555-0712@holcomb-reyes.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Following up on your call about the May 21 motorcycle accident`
- `thread_id`: null
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Eddie,

Thank you for calling our intake line and sharing what happened on May 21. We have the basics from your call.

When you have the police report, please send it through. We also need the full name of the other driver and the name of their insurance carrier. Once we have those, we will run a quick conflict check and schedule a call to walk through next steps.

In the meantime, please follow neurology's instructions, rest as much as you need, and keep notes about any symptoms day to day. Save every appointment receipt and discharge summary. Do not speak to the other driver's insurance carrier.

Sarah

## Recommended next action

`REQUEST_MISSING_INFO`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present
- `transcript_unclear_speech`: present at [00:50] (opposing party name partially captured); flagged for follow-up

## Recommended action I did not take

None at this trust ceiling. The next action requires partner review of the partial opposing-party-name capture before the follow-up request ships.
