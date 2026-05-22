# Fabrication Policy (Platform Invariant #8)

This skill is a load-bearing test case for the fabrication discipline that platform PRD §7.5 invariant #8 makes architectural. Settlement-value analysis is named on the §5 third-rail map; this skill operationalizes the prep work that sits at the seam without crossing into the value-bearing core. The runtime's fabrication filter (`docs/specs/ai-employee/fabrication-filter.md`, issue #798) enforces the policy on every memo emit.

## The four tag values

Per `docs/specs/ai-employee/fabrication-filter.md`:

| Tag                | Meaning                                                                                                                        | Render rule                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matter_attribute` | Sourced from a field on the `Matter` returned by `PracticeManagement.get_matter`                                               | Render the value verbatim. If null/missing, render the TBD marker.                                                                                  |
| `system_of_record` | Sourced from an adapter-returned record other than Matter (e.g., `StoredDocument`)                                             | Render the value verbatim. Runtime records the source `<resource>.id`. If unresolved, render TBD.                                                   |
| `memory_rule`      | Sourced from a `memory_rules` D1 row                                                                                           | Render the value verbatim. Runtime records the rule_id and row_id. If the rule is missing or no row matches, render documented corpus-absent prose. |
| `none`             | The field is NOT sourced from any system. Render as a TBD marker. Rendering plausible content is a `block`-severity violation. | Render the TBD marker. Runtime's fabrication filter blocks any non-empty value with this tag.                                                       |

## The skill's per-field sourcing contract

The skill's `SKILL.md` frontmatter declares 27 client-facing fields. The per-field contract:

### Fields tagged `matter_attribute`

The runtime resolves these from `PracticeManagement.get_matter(matter_id)`. If null/missing, the field renders as `[TBD: <field-specific hint>]`.

| Field name                   | Matter attribute path                             | TBD marker on absence                                                          |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `client_name`                | `matter.client_name`                              | (refuse - client_name is required)                                             |
| `claim_number`               | `matter.custom_fields.claim_number`               | `[TBD: claim number - partner supplies]`                                       |
| `case_caption`               | `matter.custom_fields.case_caption`               | `[TBD: case caption - partner supplies]`                                       |
| `case_number`                | `matter.custom_fields.case_number`                | `[TBD: case number - partner supplies]`                                        |
| `date_of_incident`           | `matter.custom_fields.date_of_incident`           | `[TBD: date of incident - partner supplies]`                                   |
| `incident_location`          | `matter.custom_fields.incident_location`          | `[TBD: incident location - partner supplies]`                                  |
| `opposing_counsel_name`      | `matter.custom_fields.opposing_counsel_name`      | `[TBD: opposing counsel name - partner supplies]`                              |
| `opposing_counsel_firm`      | `matter.custom_fields.opposing_counsel_firm`      | `[TBD: opposing counsel firm - partner supplies]`                              |
| `opposing_carrier_name`      | `matter.custom_fields.opposing_carrier_name`      | `[TBD: carrier name - partner supplies]`                                       |
| `settlement_conference_date` | `matter.custom_fields.settlement_conference_date` | (refuse with `conference_date_missing` unless `--conference-date` is supplied) |

### Fields tagged `system_of_record`

The runtime resolves these from adapter calls on documents in the matter folder. Each rendered value records the `StoredDocument.id` that populated it.

| Field name                               | Source                                                                            | TBD on absence                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `medical_provider_list`                  | Documents classified `medical_record`                                             | Per-row: omit. Section-level: `[TBD: no medical records in matter file]`                     |
| `medical_specials_total`                 | Sum across billing-statement docs when every row sources                          | `[TBD: partial-source totals - partner confirms after billing exhibits are complete]`        |
| `billing_document_index`                 | Documents classified `billing_statement`                                          | Per-row: omit                                                                                |
| `lost_wages_total`                       | Sum across lost-wages docs when every row sources                                 | `[TBD: lost wages partial-source - partner confirms]`                                        |
| `employment_verification_document_index` | Documents classified `employment_verification`                                    | Per-row: omit                                                                                |
| `incident_evidence_document_index`       | Documents classified `incident_photo`, `incident_report`, or `police_report`      | Per-row: omit                                                                                |
| `chronology_event_list`                  | Composed from sourced documents and custom_fields                                 | Per-event: omit; the chronology contains only sourced events                                 |
| `strengths_fact_list`                    | Heuristic match against the matter file (sourced facts only, no characterization) | Per-fact: omit; the section emits only sourced facts                                         |
| `weaknesses_fact_list`                   | Heuristic match against the matter file (sourced facts only)                      | Per-fact: omit. If no weaknesses sourced: section emits the "no documented weaknesses" prose |

### Fields tagged `memory_rule`

| Field name                             | Memory rule key                                   | TBD/corpus-absent on absence                                                                                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comparable_verdict_table`             | `customer.memory_rules.comparable_verdicts`       | Refuse with `comparable_verdict_corpus_missing` unless `--no-comparable-verdicts`. When invoked with the flag, table renders the corpus-absent prose. When the rule is present but no rows match, table renders the corpus-absent prose with a more specific message. |
| `opposing_counsel_prior_pattern_table` | `customer.memory_rules.opposing_counsel_patterns` | Renders the corpus-absent prose ("no prior-pattern data on <opposing_counsel_name> in firm memory") when no row matches the named opposing counsel.                                                                                                                   |
| `carrier_prior_pattern_table`          | `customer.memory_rules.carrier_patterns`          | Renders the corpus-absent prose when no row matches the named carrier.                                                                                                                                                                                                |
| `partner_signoff`                      | `customer.signature_block`                        | (refuse - signature block must be configured for the memo to ship)                                                                                                                                                                                                    |

### Fields tagged `none` (the load-bearing five)

These are the legal-judgment sections the skill MUST NOT author. The runtime's fabrication filter blocks any rendered value; the only allowed render is the TBD marker.

| Field name                          | TBD marker                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settlement_bracket_recommendation` | `[TBD: settlement bracket recommendation - partner authors. The comparable-verdict table above and the damages tabulation are provided as input. The skill produces no bracket because settlement-value analysis is third-rail per law-firm PRD §5; the partner authors the bracket from the cited corpus and the matter facts.]` |
| `recommended_posture`               | `[TBD: recommended posture (open low / open high / anchor / walk-away) - partner authors. The opposing-counsel and carrier prior-pattern tables are provided as input.]`                                                                                                                                                          |
| `strengths_legal_argument_prose`    | `[TBD: legal-argument framing of strengths - partner authors. The strengths fact list above is provided as input.]`                                                                                                                                                                                                               |
| `weaknesses_legal_argument_prose`   | `[TBD: legal-argument framing of weaknesses - partner authors. The weaknesses fact list above is provided as input.]`                                                                                                                                                                                                             |
| `case_strategy_language`            | `[TBD: closing recommendation - partner authors. The skill emits no language about negotiation posture, settlement authority, walk-away triggers, or any forward-looking case-strategy framing.]`                                                                                                                                 |

These five are the architectural backstop against the failure mode the law-firm PRD §5 third-rail map exists to prevent: settlement-value fabrication, anchoring effects from agent-generated brackets, agent-authored posture recommendations that pull the partner toward a number the partner would not have chosen, and case-strategy commitments that constrain the partner's negotiation latitude.

The `settlement_bracket_recommendation` field is the highest-risk render in the law-firm vertical at v1. A render that contained a plausible number would create exactly the anchoring effect the §5 third-rail map names; the architectural enforcement is that the field is `none`-tagged and the fabrication filter blocks any non-empty content.

## High-risk markers

Beyond the per-field tagging, the fabrication-filter spec defines pattern-based high-risk markers. Markers relevant to this skill:

- `specific_dollar_amount` (`\$\d[\d,]{3,}`). Dollar amounts appear legitimately only in the damages tabulation (sourced from billing statements) and in the comparable-verdict table (verbatim from memory-rule rows). Any dollar amount in skill-authored prose outside those sections is a `flag` that escalates to `block` if the surrounding context is the bracket-recommendation, posture, or case-strategy TBD section.
- `dollar_range` (a dollar-amount string of the form `\$\d[\d,]{3,}` followed by a range connector (the word `to`, the ASCII hyphen, an en-dash codepoint, an em-dash codepoint, or the word `through`) followed by another dollar-amount string of the same shape). The skill MUST NOT render a dollar range anywhere in skill-authored prose. The bracket-recommendation section is TBD; the comparable-verdict table contains individual verdict amounts but no derived range. A range in skill-authored prose is `block` regardless of section.
- `verdict_average` or `verdict_median` keyword patterns. The skill MUST NOT compute or render an average, median, or mean of comparable-verdict amounts. The verdict rows surface individually; the partner authors any aggregation in the TBD bracket section. The filter flags any prose that introduces aggregated figures around the table.
- `future_date` (`\b\d{4}-\d{2}-\d{2}\b`). Dates render in `YYYY-MM-DD` format in tables and `Month D, YYYY` in prose. Dates are tagged `matter_attribute` or `system_of_record`; the filter flags rather than blocks.
- `commitment_phrase` (`\b(we'll|we will|I'll|I will)\s+(reach out|schedule|begin|deliver|complete|finish|ship|open|close|recommend|settle|accept|reject)\b`). The skill MUST NOT generate commitment phrases. The five `none`-tagged sections contain the only legitimate commitment language. A commitment phrase in any skill-authored section is `flag` on first occurrence and `block` on second occurrence in the same memo.
- `guarantee_phrase` (`\b(guarantee|guaranteed|promise|ensure|warrant)\b`). The skill MUST NOT use guarantee phrases. A guarantee phrase is `block` regardless of tag.
- `legal_conclusion_phrase` (`\b(plainly|clearly|obviously|undisputedly|self-evidently)\s+(meritless|inadequate|settled|undisputable|negligent|liable)\b`). The skill MUST NOT use legal-conclusion adverbs in fact lists or sourcing prose.
- `posture_recommendation_keyword` (`\b(open low|open high|anchor at|walk away at|floor|ceiling)\b`). The skill MUST NOT use posture-recommendation keywords outside the TBD recommended-posture section. Any hit is `block`.

## What the filter does on violation

Per `docs/specs/ai-employee/fabrication-filter.md`:

- `clean`: memo proceeds to `Email.create_draft`.
- `flag`: memo proceeds with a "verify source" banner in the dashboard.
- `block`: memo rejected. Skill re-runs with stricter prompt. If second run also blocks, escalate to Captain. No memo ships.

For this skill, expected outcomes:

- A matter with the comparable-verdict corpus populated, matter file complete, and the bracket and posture sections rendering as TBD markers: `clean`.
- A matter with the comparable-verdict corpus thin (no rows match) but the partner invoked with `--no-comparable-verdicts`: `clean`; the table renders the corpus-absent prose; the bracket TBD section notes the absence of a quantitative anchor.
- A skill bug that renders a `none`-tagged field non-empty: `block`. Bug fixed; skill re-deployed.
- A skill bug that renders a dollar range outside the verbatim comparable-verdict rows: `block` on the `dollar_range` marker.
- A skill bug that introduces "average verdict" or "median verdict" prose around the comparable-verdict table: `block` on the `verdict_average` marker.
- A skill bug that renders a posture-recommendation keyword outside the TBD section: `block` on the `posture_recommendation_keyword` marker.

## The fabrication-filter-trigger event

Every fabrication-filter outcome other than `clean` emits a `FABRICATION_FILTER_TRIGGERED` audit event. The event records: skill name, severity, field, marker (if pattern-based), memo hash. The Captain's weekly query reports flag/block rate per skill. A block rate above 5% on this skill triggers a skill review.

## Why this skill is load-bearing

Settlement-prep memos are the highest valuation-anchoring-risk surface in the law-firm vertical. The five `none`-tagged sections are the specific places where prior consumer-facing AI tools have made the disqualifying errors: generating a bracket recommendation that anchored the partner below the matter's actual value, recommending a posture that boxed the partner into a position they would not have chosen, characterizing a strength as a "clear case" that the partner had to back away from at the conference, or characterizing a weakness as "fatal" that the partner had already discounted.

The fabrication filter's `block` outcome on a `none`-tagged field with non-empty content is the architectural defense; this skill's `none` tagging on those five sections is the test of that defense. If the filter cannot block a fabricated bracket recommendation on this skill, the platform's fabrication discipline is not load-bearing on its highest-risk surface.

The comparable-verdict table is the architecturally interesting case: the rows are real (they come from a partner-authored memory rule), but the derivation of a range from those rows is partner work. The filter respects this split: rows surface verbatim from the corpus; any aggregation prose around the table is `block`; the bracket-recommendation section is `none`-tagged and the partner authors the derivation.
