# Fabrication Policy (Platform Invariant #8)

This skill is a load-bearing test case for the fabrication discipline that platform PRD §7.5 invariant #8 makes architectural. The runtime's fabrication filter (`docs/specs/operator/fabrication-filter.md`, issue #798) enforces the policy on every draft emit. This document is the skill's per-section sourcing contract — the mapping the runtime reads from the skill's `client_facing_fields` frontmatter, with the rendering rules for each tag.

## The four tag values

Per `docs/specs/operator/fabrication-filter.md`:

| Tag                | Meaning                                                                                                                        | Render rule                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `matter_attribute` | Sourced from a field on the `Matter` returned by `PracticeManagement.get_matter`                                               | Render the value verbatim. If the attribute is null/missing, render the TBD marker.                                      |
| `system_of_record` | Sourced from an adapter-returned record other than Matter (e.g., `StoredDocument`, `EmailThread`)                              | Render the value verbatim. The runtime records the source `<resource>.id`. If the source cannot be resolved, render TBD. |
| `memory_rule`      | Sourced from a `memory_rules` D1 row                                                                                           | Render the value verbatim. The runtime records the rule_id.                                                              |
| `none`             | The field is NOT sourced from any system. Render as a TBD marker. Rendering plausible content is a `block`-severity violation. | Render the TBD marker. The runtime's fabrication filter blocks any non-empty value with this tag.                        |

## The skill's per-field sourcing contract

The skill's `SKILL.md` frontmatter declares 19 client-facing fields. The per-field contract:

### Fields tagged `matter_attribute`

The runtime resolves these from `PracticeManagement.get_matter(matter_id)`. If null/missing, the field renders as `[TBD: <field-specific hint>]`.

| Field name          | Matter attribute path                         | TBD marker on absence                                     |
| ------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `recipient_name`    | `matter.custom_fields.opposing_adjuster_name` | `[TBD: opposing adjuster name — partner supplies]`        |
| `recipient_carrier` | `matter.custom_fields.opposing_carrier`       | `[TBD: opposing carrier — partner supplies]`              |
| `claim_number`      | `matter.custom_fields.claim_number`           | `[TBD: claim number — partner supplies]`                  |
| `client_name`       | `matter.client_name`                          | (refuse — client_name is required for matter to be valid) |
| `date_of_incident`  | `matter.custom_fields.date_of_incident`       | `[TBD: date of loss — partner supplies]`                  |
| `incident_location` | `matter.custom_fields.incident_location`      | `[TBD: incident location — partner supplies]`             |
| `employer_name`     | `matter.custom_fields.employer_name`          | `[TBD: employer — partner supplies]`                      |

### Fields tagged `system_of_record`

The runtime resolves these from adapter calls on documents in the matter folder. Each rendered value records the `StoredDocument.id` that populated it.

| Field name               | Source                                                                | TBD on absence                                                                                            |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `medical_provider_list`  | Distinct providers across medical `StoredDocument` files              | Row dropped from chronology if no sourced provider                                                        |
| `medical_specials_total` | Sum of per-provider billing rows                                      | `[TBD: medical specials total — partner verifies after sourcing missing billing statements]`              |
| `per_provider_billing`   | Each billing-statement `StoredDocument` parsed for billed total       | Per-provider line: `[TBD: source billing statement at <path>]`                                            |
| `lost_wages_total`       | Sum of employment-verification rows (W-2, pay stubs, employer letter) | `[TBD: lost wages — partner supplies after employer verification received]`                               |
| `treatment_chronology`   | Date and provider extracted from each medical `StoredDocument`        | Row dropped from chronology if no sourced date or provider; recorded in "could not source" appendix       |
| `exhibit_index`          | Every `StoredDocument` referenced in the draft                        | (no TBD case — if no documents are sourced, the readiness rubric refuses with `insufficient_source_data`) |

### Fields tagged `memory_rule`

| Field name        | Memory rule key            | TBD on absence                                                                               |
| ----------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| `partner_signoff` | `customer.signature_block` | (refuse — signature block must be configured in customer.yaml for an external draft to ship) |

### Fields tagged `none` (the load-bearing four)

These are the legal-judgment sections the skill MUST NOT author. The runtime's fabrication filter blocks any rendered value; the only allowed render is the TBD marker.

| Field name                   | TBD marker                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `liability_characterization` | `[TBD: liability characterization — partner authors. The factual chronology above is provided as input. The skill emits no characterization of fault, negligence, foreseeability, or causation.]` |
| `settlement_bracket_prose`   | `[TBD: settlement bracket and supporting framing — partner authors]`                                                                                                                              |
| `demand_amount`              | `[TBD: demand amount — partner authors]`                                                                                                                                                          |
| `case_strategy_language`     | `[TBD: closing paragraph — partner authors per firm template. The skill emits no language about filing suit, response deadlines, litigation posture, or settlement posture.]`                     |

These four are the architectural backstop against the failure mode the law-firm PRD §6.2 deferral exists to prevent: factual demand-letter prose carrying implicit legal-judgment characterization. By tagging them `none` in the frontmatter, the runtime makes it impossible for the skill to render them with plausible content. If a future skill author adds a prompt that produces a non-empty `liability_characterization`, the fabrication filter blocks the emit and the runtime escalates to Captain. The discipline is architectural, not aspirational.

## High-risk markers

Beyond the per-field tagging, the fabrication-filter spec defines pattern-based high-risk markers. Markers relevant to this skill:

- `specific_dollar_amount` (`\$\d[\d,]{3,}`). The skill renders dollar amounts in the medical-specials and lost-wages sections. These are tagged `system_of_record`; the filter flags rather than blocks (the reviewer verifies the upstream source on review).
- `future_date` (`\b\d{4}-\d{2}-\d{2}\b`). The skill renders dates in `YYYY-MM-DD` format in tables and `Month D, YYYY` in prose. Dates are tagged `matter_attribute` or `system_of_record`; the filter flags rather than blocks.
- `commitment_phrase` (`\b(we'll|we will|I'll|I will)\s+(reach out|schedule|begin|deliver|complete|finish|ship)\b`). The skill MUST NOT generate any commitment phrases. The four `none`-tagged sections contain the only legitimate commitment language; those sections are the partner's authoring. A commitment phrase in any skill-authored section is a `flag`-severity hit that escalates to `block` on second occurrence in the same draft.
- `guarantee_phrase` (`\b(guarantee|guaranteed|promise|ensure|warrant)\b`). The skill MUST NOT use guarantee phrases anywhere. Demand letters do not guarantee outcomes; they state facts and reserve negotiation. A guarantee phrase is a `block` regardless of tag.

## What the filter does on violation

Per `docs/specs/operator/fabrication-filter.md`:

- `clean`: draft proceeds to `Email.create_draft`.
- `flag`: draft proceeds with a "verify source" banner in the dashboard.
- `block`: draft rejected. Skill re-runs with stricter prompt. If second run also blocks, escalate to Captain. No draft ships.

For this skill, expected outcomes:

- A well-sourced matter with no missing fields: `clean`.
- A matter with missing employment verification (lost wages TBD): `clean` (the TBD render is the correct outcome).
- A matter with citations in source data: refused by the readiness rubric before reaching the filter.
- A skill bug that renders a `none`-tagged field non-empty: `block`. Bug fixed; skill re-deployed; PR-author and Captain notified.

## The fabrication-filter-trigger event

Every fabrication-filter outcome other than `clean` emits a `FABRICATION_FILTER_TRIGGERED` audit event. The event records: skill name, severity, field, marker (if pattern-based), draft hash. The Captain's weekly query against `audit_log` reports flag/block rate per skill. A block rate above 5% on this skill triggers a skill review.

## Why this skill is load-bearing

Demand letters are the highest legal-sensitivity draft surface the law-firm vertical ships. The four `none`-tagged sections (liability, settlement bracket, demand amount, case strategy) are the specific places where prior consumer-facing AI tools have made the disqualifying errors: fabricating a settlement amount, characterizing fault, or stating a legal conclusion the firm did not endorse. The fabrication filter's `block` outcome on a `none`-tagged field with non-empty content is the architectural defense; this skill's `none` tagging on those four sections is the test of that defense. If the filter cannot block a fabricated demand amount on this skill, the platform's fabrication discipline is not load-bearing.
