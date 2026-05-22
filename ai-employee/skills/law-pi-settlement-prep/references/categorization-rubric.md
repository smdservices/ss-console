# Matter Readiness Rubric

Before assembling a settlement-prep memo, the skill classifies the matter and the surrounding memory-rule corpus along seven readiness axes. The classifications drive: which sections render fully, which render as corpus-absent prose, which render as TBD, and whether the skill proceeds at all.

The rubric is decision-bearing: every axis has a value, AMBIGUOUS and UNKNOWN are valid values when the matter does not support a confident call. Guessing is not.

## Axis 1: Matter scope

Is this matter in scope for the skill?

| Value          | Criterion                                                                                  | Action                                                          |
| -------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| IN_SCOPE       | `matter.matter_type` is one of: `auto-accident`, `premises`, `product-liability`, `medmal` | Proceed.                                                        |
| OUT_OF_SCOPE   | `matter.matter_type` is any other value                                                    | Refuse with `matter_wrong_type`. Write no memo.                 |
| AMBIGUOUS_TYPE | `matter.matter_type` is null, empty, or contains a value not in the PI registry            | Refuse with `matter_wrong_type`. Surface to partner for triage. |

## Axis 2: Matter status

Is this matter active and at the right stage?

| Value      | Criterion                                                                                       | Action                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ACTIVE     | `matter.status == "open"` and a settlement-conference date is present                           | Proceed.                                                                                                                       |
| PRE_DEMAND | `matter.status == "open"` and the demand letter has not been served (`demand_served_date` null) | Refuse with `matter_pre_demand`. Settlement prep precedes a conference; without a served demand the conference rarely happens. |
| INTAKE     | `matter.status == "intake"`                                                                     | Refuse with `matter_intake_only`. Prep memos do not issue from intake-status matters.                                          |
| CLOSED     | `matter.status == "closed"`                                                                     | Refuse with `matter_closed`. Write no memo.                                                                                    |

## Axis 3: Conference date readiness

Is a settlement-conference date present?

| Value     | Criterion                                                                                       | Action                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SCHEDULED | `matter.custom_fields.settlement_conference_date` is present and in the future                  | Proceed.                                                                                                                                    |
| PAST      | `matter.custom_fields.settlement_conference_date` is present and in the past                    | Proceed; sourcing note flags retrospective assembly. The partner may be preparing a post-conference debrief or reconstructing for an audit. |
| OVERRIDE  | `matter.custom_fields.settlement_conference_date` is absent but `--conference-date` is supplied | Proceed with the override; sourcing note records the override.                                                                              |
| MISSING   | Neither the matter custom_field nor the CLI override is present                                 | Refuse with `conference_date_missing`. The skill never invents a conference date.                                                           |

## Axis 4: Document corpus readiness

Does the matter folder contain enough sourced documents to assemble a meaningful chronology and damages tabulation?

| Value   | Criterion                                                                                          | Action                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| READY   | Matter folder contains at least one document in each of: medical, billing, incident_report classes | Proceed with full memo.                                                                                                                                             |
| LIGHT   | Matter folder contains at least medical records but no billing or no incident report               | Proceed; the corresponding sub-table or chronology row renders as TBD; sourcing note records the gap.                                                               |
| MISSING | Matter folder contains no medical records                                                          | Refuse with `matter_documents_missing`. A prep memo without medical records cannot support a damages table or strengths-and-weaknesses list. Partner triages first. |

## Axis 5: Comparable-verdict corpus readiness

Does the firm's memory-rule corpus contain rows that match the matter's profile?

| Value          | Criterion                                                                                                                                                 | Action                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| READY          | `customer.yaml.memory_rules.comparable_verdicts` is present and at least one row matches all the match-criterion fields the partner authored on each row. | Proceed with full table.                                                                                                                                                                                                     |
| THIN           | Memory rule is present but no rows match the matter's profile.                                                                                            | Proceed with the table rendering the corpus-absent prose; sourcing note records the absence. Skill marks the bracket-recommendation section TBD with the additional context that no quantitative anchor is available.        |
| CORPUS_MISSING | `customer.yaml.memory_rules.comparable_verdicts` is null, empty, or undefined.                                                                            | Refuse with `comparable_verdict_corpus_missing` UNLESS the partner has supplied `--no-comparable-verdicts` (logged). With the flag, proceed with table rendering the corpus-absent prose; the bracket TBD notes the absence. |

The comparable-verdict corpus is the load-bearing memory rule for this skill. The skill never invents a verdict; the corpus is the partner's authored source of truth.

## Axis 6: Voice envelope readiness

Does the customer have enough Layer 2 voice samples to support an internal-memo draft?

| Value         | Criterion                                                                                          | Action                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| READY         | `customer.yaml.voice.layer2_samples.count >= 30` AND at least 5 samples tagged internal-memo class | Proceed.                                                                                                    |
| THIN_REGISTER | `count >= 30` but fewer than 5 samples tagged internal-memo class                                  | Proceed; warn in sourcing note. Internal-memo audience is the partner; lower-risk than external recipients. |
| BELOW_GATE    | `count < 30`                                                                                       | Refuse with `voice_samples_missing`. The skill refuses rather than ship against an uncalibrated envelope.   |

## Axis 7: Citation-propagation risk

Does the matter file contain citations the skill would otherwise carry through into its own factual prose?

| Value            | Criterion                                                                                                                                                                                                                                       | Action                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLEAN            | No citation-shaped strings in any matter custom_field the skill would read into its own prose (matter-facts summary, chronology, strengths lead-in, weaknesses lead-in). Comparable-verdict rows are exempt under the verbatim-quote carve-out. | Proceed.                                                                                                                                                                                       |
| PROPAGATION_RISK | A citation-shaped string appears in a matter custom_field (e.g., `case_summary`, `liability_narrative`) the skill would otherwise carry through.                                                                                                | Refuse with `citation_in_source`. The partner edits the custom_field to quote-isolate the citation or remove it, then re-invokes. The substrate-level filter is the architectural enforcement. |

## Refusal precedence

When multiple refusal criteria fire, the precedence is:

1. `out_of_scope` (customer practice-area mismatch)
2. `matter_not_found` / `matter_wrong_type` / `matter_closed` / `matter_intake_only` / `matter_pre_demand`
3. `conference_date_missing`
4. `matter_documents_missing`
5. `comparable_verdict_corpus_missing` (unless `--no-comparable-verdicts` is supplied)
6. `voice_samples_missing`
7. `citation_in_source`

The earliest-firing criterion wins. The structured error includes the criterion code and the surfacing path the partner uses to remediate.

## What the sourcing note records

For every axis, the sourcing note records the classified value. The Captain's weekly query against the sourcing-note corpus reports refusal-criterion frequency by skill; persistent `voice_samples_missing` or `comparable_verdict_corpus_missing` refusals indicate the customer's memory-rule onboarding is incomplete.
