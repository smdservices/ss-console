# Fabrication Policy (Platform Invariant #8)

This skill is a load-bearing test case for the fabrication discipline that platform PRD §7.5 invariant #8 makes architectural, with particular emphasis on the dollar-amount and commitment-phrase markers. The runtime's fabrication filter (`docs/specs/ai-employee/fabrication-filter.md`, issue #798) enforces the policy on every draft emit. This document is the skill's per-section sourcing contract: the mapping the runtime reads from the skill's `client_facing_fields` frontmatter, with the rendering rules for each tag.

## The four tag values

Per `docs/specs/ai-employee/fabrication-filter.md`:

| Tag                | Meaning                                                                                                                         | Render rule                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `matter_attribute` | Sourced from a field on the `Matter` returned by `PracticeManagement.get_matter`                                                | Render the value verbatim. If the attribute is null/missing, render the TBD marker.                                      |
| `system_of_record` | Sourced from an adapter-returned record other than Matter (e.g., `EmailThread.message`, `EmailThread.list_messages_for_matter`) | Render the value verbatim. The runtime records the source `<resource>.id`. If the source cannot be resolved, render TBD. |
| `memory_rule`      | Sourced from a `memory_rules` D1 row                                                                                            | Render the value verbatim. The runtime records the rule_id.                                                              |
| `none`             | The field is NOT sourced from any system. Render as a TBD marker. Rendering plausible content is a `block`-severity violation.  | Render the TBD marker. The runtime's fabrication filter blocks any non-empty value with this tag.                        |

## The skill's per-field sourcing contract

The skill's `SKILL.md` frontmatter declares 21 client-facing fields. The per-field contract:

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

The runtime resolves these from EmailThread adapter calls. Each rendered value records the EmailThread message ID that populated it.

| Field name                       | Source                                                                                           | TBD on absence                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `correspondence_kind`            | Detected from inbound message body, subject, and metadata per `correspondence-kind-detection.md` | (refuse with `kind_unresolvable` if confidence below threshold)                        |
| `inbound_message_date`           | EmailThread message metadata (`message.received_at` or `message.sent_at`)                        | `[TBD: inbound received date - partner confirms]`                                      |
| `inbound_message_verbatim_quote` | EmailThread message body, quoted verbatim                                                        | (refuse - inbound body is required to draft response)                                  |
| `inbound_factual_claim_index`    | Parsed from inbound message body (sentence-level extraction of factual claims)                   | Per-claim: `[TBD: factual claim N - partial parse, partner confirms]`                  |
| `settlement_history_log`         | `EmailThread.list_messages_for_matter` filtered to settlement thread                             | If empty: "The matter file contains no prior settlement correspondence as of <today>." |
| `motion_correspondence_log`      | `EmailThread.list_messages_for_matter` filtered to motion-correspondence thread                  | If empty: "The matter file contains no prior motion correspondence as of <today>."     |
| `scheduling_log`                 | `EmailThread.list_messages_for_matter` filtered to scheduling thread                             | If empty: "The matter file contains no prior scheduling correspondence as of <today>." |
| `response_due_date`              | Computed from inbound metadata + firm rule from customer.yaml                                    | `[TBD: response due date - partner confirms]`                                          |

### Fields tagged `memory_rule`

| Field name                           | Memory rule key                                        | TBD on absence                                                                                                                |
| ------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `correspondence_tone_classification` | `customer.memory_rules.correspondence_tone_categories` | (refuse with `tone_vocabulary_missing` if the rule is null or empty; otherwise label reads `routine` as the fallback default) |
| `partner_signoff`                    | `customer.signature_block`                             | (refuse - signature block must be configured in customer.yaml for an external draft to ship)                                  |

### Fields tagged `none` (the load-bearing four)

These are the legal-judgment sections the skill MUST NOT author. The runtime's fabrication filter blocks any rendered value; the only allowed render is the TBD marker.

| Field name                                | TBD marker                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settlement_counter_substantive_response` | `[TBD: substantive settlement-counter response - partner authors. The skill emits no number, no acceptance, no rejection, no counter-counter, and no negotiation framing. Settlement authority is partner work per the firm's authority matrix.]` |
| `motion_substantive_response`             | `[TBD: substantive motion response - partner authors. The skill emits no concession, no opposition framing, no procedural posture, and no characterization of the motion's merits. Legal-argument authoring is partner work.]`                    |
| `scheduling_substantive_response`         | `[TBD: substantive scheduling response - partner authors. The skill emits no agreement, no refusal, no alternative date, and no conditional acceptance. Scheduling commitments are partner work per the firm's calendar-authority matrix.]`       |
| `case_strategy_language`                  | `[TBD: closing paragraph - partner authors per firm template. The skill emits no language about settlement posture, motion-to-compel risk, sanctions exposure, meet-and-confer obligations, or any forward-looking case-strategy language.]`      |

These four are the architectural backstop against the failure modes the law-firm PRD §5 third-rail map exists to prevent: settlement-authority fabrication (the agent proposes a counter-offer number), motion-argument fabrication (the agent commits to a procedural posture), scheduling-commitment fabrication (the agent agrees to a date the partner has not approved), or case-strategy fabrication (the agent characterizes the firm's posture in a way the partner has not adopted).

By tagging them `none` in the frontmatter, the runtime makes it impossible for the skill to render them with plausible content. If a future skill author adds a prompt that produces a non-empty `settlement_counter_substantive_response`, the fabrication filter blocks the emit and the runtime escalates to Captain. The discipline is architectural, not aspirational.

## High-risk markers

Beyond the per-field tagging, the fabrication-filter spec defines pattern-based high-risk markers. Markers relevant to this skill:

- `specific_dollar_amount` (`\$\d[\d,]{3,}`). This is the LOAD-BEARING marker for this skill. The skill renders dollar amounts ONLY inside the verbatim-quoted inbound recital and inside the verbatim-quoted prior-correspondence table (the synopsis column when the synopsis includes a dollar amount sourced verbatim from EmailThread). Any dollar amount in any other section is a `block`-severity violation. Settlement-counter responses are the highest-risk surface for inadvertent dollar-amount propagation; the skill's structural commitment is no dollar amounts outside the quote envelope, and the filter enforces.
- `future_date` (`\b\d{4}-\d{2}-\d{2}\b`). The skill renders dates in `YYYY-MM-DD` format in tables and `Month D, YYYY` in prose. Dates are tagged `matter_attribute` or `system_of_record`; the filter flags rather than blocks. The response-due-date field is the highest-risk date; the skill computes it from sourced inputs only.
- `commitment_phrase` (`\b(we'll|we will|I'll|I will)\s+(reach out|schedule|begin|deliver|complete|finish|ship|produce|counter|accept|reject|agree|oppose|stipulate)\b`). The skill MUST NOT generate any commitment phrases. The four `none`-tagged sections contain the only legitimate commitment language; those sections are the partner's authoring. A commitment phrase in any skill-authored section is a `flag`-severity hit that escalates to `block` on second occurrence in the same draft. This skill extends the platform-default commitment-phrase pattern to include the negotiation-and-scheduling verbs (`counter`, `accept`, `reject`, `agree`, `oppose`, `stipulate`) because those verbs are the load-bearing failure modes for opposing-counsel correspondence.
- `guarantee_phrase` (`\b(guarantee|guaranteed|promise|ensure|warrant)\b`). The skill MUST NOT use guarantee phrases anywhere. Opposing-counsel responses do not guarantee outcomes; they recite facts and reserve substantive responses for the partner. A guarantee phrase is a `block` regardless of tag.
- `legal_conclusion_phrase` (`\b(plainly|clearly|obviously|undisputedly|self-evidently)\s+(inadequate|unreasonable|frivolous|meritless|improper|unsupported|insufficient)\b`). The skill MUST NOT use legal-conclusion adverbs in tone-classification labels or sourcing prose. The label itself is a mechanical pointer to a memory-rule vocabulary; a label that reads `plainly contested` is a `block`-severity violation. The unadorned label `contested` is the only allowed render.
- `negotiation_anchor` (custom marker for this skill: any phrase combining a relative-quantity word and a settlement-context word, e.g., `(?i)(higher|lower|inadequate|insufficient|unrealistic|reasonable|fair)\s+(offer|settlement|number|amount|valuation|figure)`). The skill MUST NOT use anchor phrases in any skill-authored section. The substantive-response framing is partner work.

## What the filter does on violation

Per `docs/specs/ai-employee/fabrication-filter.md`:

- `clean`: draft proceeds to `Email.create_draft`.
- `flag`: draft proceeds with a "verify source" banner in the dashboard.
- `block`: draft rejected. Skill re-runs with stricter prompt. If second run also blocks, escalate to Captain. No draft ships.

For this skill, expected outcomes:

- A well-detected inbound with the tone vocabulary configured and the prior-correspondence thread populated: `clean`.
- A mixed-kind inbound that resolves to two correspondence kinds: `clean` (the consolidated draft is the correct outcome).
- An inbound with citations only inside the verbatim-quoted inbound recital: `clean` (verbatim-quote exempt).
- A settlement-counter inbound where the inbound recital includes the offer dollar amount verbatim: `clean` (verbatim-quote exempt under specific_dollar_amount marker).
- A matter with citations in the `case_summary` custom_field: refused by the readiness rubric before reaching the filter.
- A matter with dollar amounts in the `valuation` custom_field: refused by the readiness rubric before reaching the filter.
- A skill bug that renders a `none`-tagged field non-empty (e.g., a counter-offer number in `settlement_counter_substantive_response`): `block`. Bug fixed; skill re-deployed; PR-author and Captain notified.
- A skill bug that renders a tone-classification label with a legal-conclusion adverb (e.g., `plainly contested`): `block` on the legal_conclusion_phrase marker.
- A skill bug that emits an alternative-date proposal in the scheduling-substantive-response section: `block` on the `none`-tag check and `block` on the commitment_phrase marker simultaneously.

## The fabrication-filter-trigger event

Every fabrication-filter outcome other than `clean` emits a `FABRICATION_FILTER_TRIGGERED` audit event. The event records: skill name, severity, field, marker (if pattern-based), draft hash. The Captain's weekly query against `audit_log` reports flag/block rate per skill. A block rate above 5% on this skill triggers a skill review.

## Why this skill is load-bearing

Opposing-counsel correspondence is the highest negotiation-authority-risk draft surface the law-firm vertical ships. The four `none`-tagged sections (settlement-counter response, motion response, scheduling response, case strategy) are the specific places where prior consumer-facing AI tools have made the disqualifying errors: proposing a counter-offer number that anchors the partner's negotiation, committing to a procedural posture in a motion response that the partner has not adopted, agreeing to a deposition date that conflicts with the partner's calendar, or characterizing the firm's posture in a way the partner would have framed differently.

The fabrication filter's `block` outcome on a `none`-tagged field with non-empty content is the architectural defense; this skill's `none` tagging on those four sections is the test of that defense. If the filter cannot block a fabricated settlement counter-offer number on this skill, the platform's settlement-authority discipline is not load-bearing.

The dollar-amount marker is the architecturally interesting case: dollar amounts are real and present in the source data (the inbound's offer amount, prior counter-offers in the EmailThread), but skill-authored prose must never contain a dollar amount. The filter respects this split: a dollar amount inside the verbatim-quoted inbound recital is `clean`; a dollar amount inside the verbatim-quoted prior-correspondence synopsis is `clean`; a dollar amount anywhere else in the draft is a `block`. The split mirrors the load-bearing pattern: factual recitation is the skill; substantive authoring (which includes any dollar-amount commitment) is the partner.
