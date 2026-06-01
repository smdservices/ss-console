# Fabrication Policy (Platform Invariant #8)

This skill is a load-bearing test case for the fabrication discipline that platform PRD §7.5 invariant #8 makes architectural. The runtime's fabrication filter (`docs/specs/operator/fabrication-filter.md`, issue #798) enforces the policy on every draft emit. This document is the skill's per-section sourcing contract - the mapping the runtime reads from the skill's `client_facing_fields` frontmatter, with the rendering rules for each tag.

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

| Field name               | Matter attribute path                         | TBD marker on absence                                     |
| ------------------------ | --------------------------------------------- | --------------------------------------------------------- |
| `opposing_counsel_name`  | `matter.custom_fields.opposing_counsel_name`  | `[TBD: opposing counsel name - partner supplies]`         |
| `opposing_counsel_firm`  | `matter.custom_fields.opposing_counsel_firm`  | `[TBD: opposing counsel firm - partner supplies]`         |
| `opposing_counsel_email` | `matter.custom_fields.opposing_counsel_email` | (renders as `to: []` on the draft; partner fills in)      |
| `client_name`            | `matter.client_name`                          | (refuse - client_name is required for matter to be valid) |
| `claim_number`           | `matter.custom_fields.claim_number`           | `[TBD: claim number - partner supplies]`                  |
| `case_caption`           | `matter.custom_fields.case_caption`           | `[TBD: case caption - partner supplies]`                  |
| `case_number`            | `matter.custom_fields.case_number`            | `[TBD: case number - partner supplies]`                   |

### Fields tagged `system_of_record`

The runtime resolves these from adapter calls on documents in the matter folder, including the served discovery-request document itself. Each rendered value records the `StoredDocument.id` that populated it.

| Field name                              | Source                                                                                         | TBD on absence                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `discovery_request_kind`                | Parsed from served request document body                                                       | (refuse - kind must resolve to interrogatories / RFPs / RFAs)                                                                                |
| `discovery_request_number_list`         | Parsed from served request document body                                                       | (refuse - if no numbered items, `request_unparseable`)                                                                                       |
| `discovery_request_text_per_number`     | Parsed from served request document body, verbatim                                             | Per-item: `[TBD: request text item N - partial parse, partner confirms]`                                                                     |
| `response_due_date`                     | Computed from `served_at` metadata + jurisdiction rule from customer.yaml                      | `[TBD: response due date - partner confirms]`                                                                                                |
| `responsive_document_index_per_request` | Per-request keyword scan of matter folder against `StoredDocument` filename and classification | Per-row: `[TBD: responsive documents - partner confirms scope]`                                                                              |
| `privilege_log_document_index`          | Filter of responsive-document set by classification (work_product, client_communication, etc.) | If empty: section reads "No documents in the responsive set were flagged as potentially privileged by the skill's classification heuristic." |

### Fields tagged `memory_rule`

| Field name                       | Memory rule key                              | TBD on absence                                                                                                            |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `objection_category_per_request` | `customer.memory_rules.objection_categories` | (refuse with `objection_vocabulary_missing` if the rule is null or empty; otherwise cell reads `(no categories matched)`) |
| `partner_signoff`                | `customer.signature_block`                   | (refuse - signature block must be configured in customer.yaml for an external draft to ship)                              |

### Fields tagged `none` (the load-bearing four)

These are the legal-judgment sections the skill MUST NOT author. The runtime's fabrication filter blocks any rendered value; the only allowed render is the TBD marker.

| Field name                         | TBD marker                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `substantive_answer_per_request`   | `[TBD: substantive answer to Interrogatory No. <N> - partner authors. The objection-category mapping and the matter custom_fields are provided as input.]`                                                                                  |
| `privilege_claim_characterization` | `[TBD: privilege claim - partner authors]` (one per privilege-log row)                                                                                                                                                                      |
| `admission_or_denial_per_request`  | `[TBD: admit or deny RFA No. <N> - partner authors. The matter custom_fields are provided as input.]`                                                                                                                                       |
| `case_strategy_language`           | `[TBD: closing paragraph - partner authors per firm template. The skill emits no language about discovery posture, motion-to-compel risk, meet-and-confer obligations, sanctions exposure, or any forward-looking case-strategy language.]` |

These four are the architectural backstop against the failure mode the law-firm PRD §5 third-rail map exists to prevent: discovery-response prose carrying privilege-waiver risk, substantive-answer fabrication, or sanctions exposure from a misstated admission. By tagging them `none` in the frontmatter, the runtime makes it impossible for the skill to render them with plausible content. If a future skill author adds a prompt that produces a non-empty `substantive_answer_per_request`, the fabrication filter blocks the emit and the runtime escalates to Captain. The discipline is architectural, not aspirational.

## High-risk markers

Beyond the per-field tagging, the fabrication-filter spec defines pattern-based high-risk markers. Markers relevant to this skill:

- `specific_dollar_amount` (`\$\d[\d,]{3,}`). The skill does not render dollar amounts; if one appears in skill-authored prose, the filter flags. (Dollar amounts inside the verbatim-quoted incoming request are exempt under the same verbatim-quote carve-out that governs citations.)
- `future_date` (`\b\d{4}-\d{2}-\d{2}\b`). The skill renders dates in `YYYY-MM-DD` format in tables and `Month D, YYYY` in prose. Dates are tagged `matter_attribute` or `system_of_record`; the filter flags rather than blocks. The response-due-date field is the highest-risk date; the skill computes it from sourced inputs only.
- `commitment_phrase` (`\b(we'll|we will|I'll|I will)\s+(reach out|schedule|begin|deliver|complete|finish|ship|produce|withhold|object)\b`). The skill MUST NOT generate any commitment phrases. The four `none`-tagged sections contain the only legitimate commitment language; those sections are the partner's authoring. A commitment phrase in any skill-authored section is a `flag`-severity hit that escalates to `block` on second occurrence in the same draft.
- `guarantee_phrase` (`\b(guarantee|guaranteed|promise|ensure|warrant)\b`). The skill MUST NOT use guarantee phrases anywhere. Discovery responses do not guarantee outcomes; they state facts about responsive material and reserve substantive responses for the partner. A guarantee phrase is a `block` regardless of tag.
- `legal_conclusion_phrase` (`\b(plainly|clearly|obviously|undisputedly|self-evidently)\s+(privileged|irrelevant|improper|burdensome|overbroad|inadmissible)\b`). The skill MUST NOT use legal-conclusion adverbs in category labels or sourcing prose. The category labels themselves are mechanical pointers to a memory-rule vocabulary; a label that reads `plainly overbroad` is a `block`-severity violation. The unadorned label `overbroad` is the only allowed render.

## What the filter does on violation

Per `docs/specs/operator/fabrication-filter.md`:

- `clean`: draft proceeds to `Email.create_draft`.
- `flag`: draft proceeds with a "verify source" banner in the dashboard.
- `block`: draft rejected. Skill re-runs with stricter prompt. If second run also blocks, escalate to Captain. No draft ships.

For this skill, expected outcomes:

- A well-parsed request with the objection vocabulary configured and the matter folder populated: `clean`.
- A partial-parse request with some items rendering as TBD in the request-text column: `clean` (the TBD render is the correct outcome for unparseable rows).
- A request with citations only inside the verbatim-quoted incoming-request column: `clean` (verbatim-quote exempt).
- A matter with citations in the `case_summary` custom_field: refused by the readiness rubric before reaching the filter.
- A skill bug that renders a `none`-tagged field non-empty: `block`. Bug fixed; skill re-deployed; PR-author and Captain notified.
- A skill bug that renders a category label with a legal-conclusion adverb (e.g., `plainly overbroad`): `block` on the legal_conclusion_phrase marker.

## The fabrication-filter-trigger event

Every fabrication-filter outcome other than `clean` emits a `FABRICATION_FILTER_TRIGGERED` audit event. The event records: skill name, severity, field, marker (if pattern-based), draft hash. The Captain's weekly query against `audit_log` reports flag/block rate per skill. A block rate above 5% on this skill triggers a skill review.

## Why this skill is load-bearing

Discovery responses are the highest privilege-waiver-risk draft surface the law-firm vertical ships. The four `none`-tagged sections (substantive answer, privilege-claim characterization, admit-or-deny, case strategy) are the specific places where prior consumer-facing AI tools have made the disqualifying errors: fabricating a substantive answer that contradicts the client's testimony, characterizing a privilege claim incorrectly and waiving it, admitting a fact the client would have denied, or stating a discovery-posture commitment that boxes the partner into a position.

The fabrication filter's `block` outcome on a `none`-tagged field with non-empty content is the architectural defense; this skill's `none` tagging on those four sections is the test of that defense. If the filter cannot block a fabricated privilege-claim characterization on this skill, the platform's fabrication discipline is not load-bearing.

The objection-category column is the architecturally interesting middle case: the labels are real (they map to a memory rule the partner authors), but the formal objection sentence that cites a court rule and frames the legal basis is partner work. The filter respects this split: a cell with a label from the memory rule is `clean`; a cell with a label not in the memory rule is a `block` (the skill cannot invent a category); a cell with a label decorated with a legal-conclusion adverb is a `block` regardless of source. The split mirrors the load-bearing pattern: factual mapping is the skill; legal-judgment authoring is the partner.
