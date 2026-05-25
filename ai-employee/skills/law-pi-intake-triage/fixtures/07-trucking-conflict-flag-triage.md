# Triage note — intake_synthetic_007

`<today's date in "Month D, YYYY" format>`

## Classification

- `case_type`: motor-vehicle-accident (commercial trucking)
- `sol_window_risk`: low (incident May 18, 2026; AZ two-year SOL runs to May 18, 2028)
- `severity_tier`: serious (ER visit, concussion, neurology follow-up pending, lost wages, commercial-truck defendant)
- `missing_critical_fields`: none

## Clio adjacency

- ADJACENCY HIT: opposing party Phoenix Logistics appears on existing open matter 2025-PI-0312 (Estate of Helena Frazier v. Phoenix Logistics — wrongful death), opened August 15, 2025
- No matter found for opposing driver John Whitfield individually
- No prior contact on file for Jorge Salazar

## Attorney summary

Jorge Salazar was hit by a Phoenix Logistics delivery truck on I-10 westbound near 51st Avenue exit on May 18, 2026. St. Joseph's diagnosed concussion and sprained shoulder; neurology follow-up pending. Police report PD-2026-05213. Opposing carrier Mountain West Mutual. Adjacency check surfaced the firm already represents a wrongful-death plaintiff against Phoenix Logistics on matter 2025-PI-0312. Partner conflict check required before any further intake action.

## Draft client reply

The `Email.create_draft` envelope:

- `reviewer_account_id`: `sarah.holcomb@holcomb-reyes.invalid`
- `to`: `["jorge.salazar@example.invalid"]`
- `cc`: `[]`
- `bcc`: `[]`
- `subject`: `Re: Truck accident on I-10 on Monday`
- `thread_id`: `msg_synthetic_intake_007`
- `matter_ref`: null
- `drafted_by_skill`: `law-pi-intake-triage`

The draft body (everything below the next horizontal rule):

---

Hello Jorge,

Thank you for the details about the May 18 accident. We received your message and are reviewing it.

Before we can talk further, we need to run a standard conflict check given the parties involved. We will be in touch within two business days with the result. In the meantime, please continue to follow your providers' instructions, do not speak with Phoenix Logistics or Mountain West Mutual, and keep every appointment record and receipt.

Sarah

## Recommended next action

`RUN_CONFLICT_CHECK`

## Edge case flags

- `prompt_injection`: not detected
- `citation_request`: not detected
- `hostile_tone`: not detected
- `ambiguous_classification`: not present

## Recommended action I did not take

None at this trust ceiling. The next action is the conflict-check run, which is a separate tool invocation the partner authorizes after reviewing this adjacency flag.
