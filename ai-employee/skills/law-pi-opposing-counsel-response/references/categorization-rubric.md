# Matter Readiness Rubric

Before assembling an opposing-counsel response draft, the skill classifies the matter and the inbound correspondence along seven readiness axes. The classifications drive: which sections render as prose vs. table, which render as TBD, and whether the skill proceeds at all.

The rubric is decision-bearing: every axis has a value, AMBIGUOUS and UNKNOWN are valid values when the matter does not support a confident call. Guessing is not.

## Axis 1: Matter scope

Is this matter in scope for the skill?

| Value          | Criterion                                                                                  | Action                                                          |
| -------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| IN_SCOPE       | `matter.matter_type` is one of: `auto-accident`, `premises`, `product-liability`, `medmal` | Proceed.                                                        |
| OUT_OF_SCOPE   | `matter.matter_type` is any other value (workers' comp, family, estate, employment, etc.)  | Refuse with `matter_wrong_type`. Write no draft.                |
| AMBIGUOUS_TYPE | `matter.matter_type` is null, empty, or contains a value not in the PI registry            | Refuse with `matter_wrong_type`. Surface to partner for triage. |

The skill never proceeds on a matter outside the PI vertical, even if the partner manually invokes it. The partner can re-tag the matter and re-invoke; the skill does not re-classify autonomously.

## Axis 2: Matter status

Is this matter active?

| Value   | Criterion                    | Action                                                                                                |
| ------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| ACTIVE  | `matter.status == "open"`    | Proceed.                                                                                              |
| PENDING | `matter.status == "pending"` | Proceed but flag in sourcing note.                                                                    |
| INTAKE  | `matter.status == "intake"`  | Refuse with `matter_intake_only`. Opposing-counsel responses do not issue from intake-status matters. |
| CLOSED  | `matter.status == "closed"`  | Refuse with `matter_closed`. Write no draft.                                                          |

## Axis 3: Inbound correspondence kind resolvability

Can the inbound message be classified into one of the supported correspondence kinds with confidence above the threshold?

| Value        | Criterion                                                                                                                                   | Action                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| RESOLVED     | The correspondence-kind detection rubric (see `correspondence-kind-detection.md`) returns a single kind with confidence >= 0.80             | Proceed with the resolved kind.                                                                         |
| MIXED        | The detection rubric returns two or more kinds with confidence >= 0.50 each (e.g., a single inbound that proposes both a date and an offer) | Proceed with a consolidated draft that contains separate sections per kind.                             |
| UNRESOLVABLE | The detection rubric returns no kind above 0.50 confidence, or returns conflicting signals without a dominant kind                          | Refuse with `kind_unresolvable`. The partner triages the inbound and re-invokes with explicit `--kind`. |

The detection rubric is conservative on purpose. An incorrectly classified inbound produces a draft with the wrong substantive-response TBD marker, the wrong prior-correspondence-thread query, and the wrong response posture; that draft is worse than no draft.

## Axis 4: Tone vocabulary readiness

Is the firm's correspondence-tone classification vocabulary configured?

| Value   | Criterion                                                                                                                                                                        | Action                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| READY   | `customer.yaml.memory_rules.correspondence_tone_categories` is present and contains at least the platform-standard categories (routine, contested, hostile, procedural, urgent). | Proceed.                                                                                                                                           |
| LIGHT   | `customer.yaml.memory_rules.correspondence_tone_categories` is present but missing one or more of the platform-standard categories.                                              | Proceed with draft; render the label with the available categories; sourcing note records the gap. The partner extends the vocabulary out of band. |
| MISSING | `customer.yaml.memory_rules.correspondence_tone_categories` is null, empty, or undefined.                                                                                        | Refuse with `tone_vocabulary_missing`. The firm authors the vocabulary; the skill refuses rather than ship a draft with no tone classification.    |

The tone-classification vocabulary is a memory rule the partner authors during onboarding. The skill does not invent categories.

## Axis 5: Voice envelope readiness

Does the customer have enough Layer 2 voice samples to support an externally-bound draft?

| Value   | Criterion                                            | Action                                                                                                           |
| ------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| READY   | `customer.yaml.voice.layer2_samples.count >= 30`     | Proceed.                                                                                                         |
| LIGHT   | `customer.yaml.voice.layer2_samples.count` in 15..29 | Refuse with `voice_samples_below_threshold`. Per PRD §9.6 Gate 1, externally-bound drafts require >= 30 samples. |
| MISSING | `customer.yaml.voice.layer2_samples.count < 15`      | Refuse with `voice_samples_missing`.                                                                             |

The skill does not lower the threshold for opposing-counsel drafts on the theory that the recipient is opposing counsel rather than the customer's client. Voice match still matters; opposing counsel compares correspondence to prior firm correspondence and a voice mismatch is a tell.

## Axis 6: Citation risk in source data

Does the matter custom_fields or partner narrative notes contain citation-shaped strings the skill might inadvertently propagate?

| Value            | Criterion                                                                                                                                                                                            | Action                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| CLEAN            | No citation-shaped strings in any custom_field the skill reads (excluding `inbound_message_body`, which is a verbatim source the skill quotes rather than authors).                                  | Proceed.                                                                                                                                |
| QUOTED_OK        | Citation-shaped strings present in the inbound message body OR in partner-narrative custom_fields the skill carries through verbatim only.                                                           | Proceed. The substrate-level citation filter blocks any post-emit citation in skill-authored prose; quoted-source citations are exempt. |
| PROPAGATION_RISK | Citation-shaped strings appear in custom_fields the skill would otherwise read into its own factual prose (e.g., a `case_summary` field), or in matter notes the skill reads for recitation lead-in. | Refuse with `citation_in_source`. The partner edits the custom_field to remove or quote-isolate the citation, then re-invokes.          |

Citation patterns the skill detects:

- Case names: `<Name> v. <Name>` followed by a reporter cite (e.g., `123 F.3d 456 (3d Cir. 2010)`).
- Statute references: `<title> U.S.C. § <section>`, `<title>-<section>` (some state codes), `42 USC 1983`.
- Court rule references: `Fed. R. Civ. P. <rule>`, `Fed. R. Evid. <rule>`, state-court rule patterns.
- Treatise pinpoints: `Restatement (Second) of <Topic> § <section>`, `Wright & Miller § <section>`.

Detection is conservative; false positives are flagged for partner review rather than silently dropped.

The verbatim inbound-message body is exempt from the propagation-risk check: the skill quotes the inbound unchanged, and any citation in the inbound itself appears only inside the verbatim-quoted recital section. The substrate-level filter respects the quoted-source exemption per `references/citation-policy.md`.

## Axis 7: Dollar-amount risk in source data

Does the matter custom_fields contain dollar-amount strings the skill might inadvertently propagate into skill-authored prose?

| Value            | Criterion                                                                                                                                             | Action                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| CLEAN            | No dollar-amount strings in any custom_field the skill reads (excluding the inbound message body and the verbatim-quoted prior-correspondence table). | Proceed.                                                                                                                                      |
| QUOTED_OK        | Dollar-amount strings present only inside the inbound message body or inside prior-correspondence message bodies the skill quotes verbatim.           | Proceed. The substrate-level fabrication filter blocks any post-emit dollar amount in skill-authored prose; quoted-source amounts are exempt. |
| PROPAGATION_RISK | Dollar-amount strings appear in custom_fields the skill would otherwise read into its own factual prose (e.g., a `valuation` field).                  | Refuse with `dollar_amount_in_source`. The partner edits the custom_field to remove or quote-isolate the amount, then re-invokes.             |

Dollar-amount patterns the skill detects: `\$\d[\d,]{3,}` (matching $1,000 and above; smaller amounts are too noisy to gate on).

This axis is unique to the opposing-counsel-response skill among PI skills because settlement-counter correspondence is the highest-risk surface for inadvertent dollar-amount propagation. The skill's structural commitment is no dollar amounts outside the verbatim-quote envelope, and this readiness axis enforces it before draft assembly begins.

## Tie-breakers

When two axes disagree about whether to proceed:

- **Inbound kind resolvability wins over voice envelope readiness.** A matter with a clean voice envelope but an unresolvable inbound refuses; the partner triages the inbound.
- **Tone vocabulary missing wins over everything except matter scope.** A matter ready in every other axis but missing the vocabulary refuses; the firm authors the vocabulary during onboarding.
- **Citation risk wins over everything.** Any `PROPAGATION_RISK` value on axis 6 refuses regardless of other axes.
- **Dollar-amount risk wins over everything except matter scope and matter status.** Any `PROPAGATION_RISK` value on axis 7 refuses; this is the load-bearing axis for settlement-counter responses.
- **Matter status wins over inbound kind resolvability.** A closed matter with a resolvable inbound still refuses.

## The tone-classification memory-rule contract

The skill reads `customer.yaml.memory_rules.correspondence_tone_categories`, which is structured as:

```yaml
memory_rules:
  correspondence_tone_categories:
    rule_id: 'tone_categories_v1'
    rule_version: '2026-05-15'
    categories:
      - label: 'routine'
        keywords: ['confirming', 'as discussed', 'enclosed', 'pursuant to', 'in accordance with']
        applies_to:
          ['settlement_counter_offer', 'motion_correspondence', 'scheduling_correspondence']
      - label: 'contested'
        keywords: ['disagree', 'object', 'reject', 'inadequate', 'unsatisfactory', 'unacceptable']
        applies_to:
          ['settlement_counter_offer', 'motion_correspondence', 'scheduling_correspondence']
      - label: 'hostile'
        keywords:
          ['frivolous', 'sanctions', 'bad faith', 'unreasonable', 'will not tolerate', 'meritless']
        applies_to:
          ['settlement_counter_offer', 'motion_correspondence', 'scheduling_correspondence']
      - label: 'procedural'
        keywords: ['continuance', 'extension', 'meet and confer', 'stipulation', 'protective order']
        applies_to: ['motion_correspondence', 'scheduling_correspondence']
      - label: 'urgent'
        keywords:
          ['immediately', 'no later than', 'time-sensitive', 'deadline', 'before close of business']
        applies_to:
          ['settlement_counter_offer', 'motion_correspondence', 'scheduling_correspondence']
```

The skill scans the inbound message body for keyword matches and emits the highest-priority matched category as a single label in the draft header. Priority order is `hostile > contested > urgent > procedural > routine`; when multiple categories match, the highest-priority match wins. The skill does NOT emit multiple labels and does NOT compose new labels.

The keywords are partner-authored. The skill is a tone-classification mapper, not a sentiment analyzer. If the partner's memory rule labels a category `hostile` and the keyword is `frivolous`, the skill emits the label when the inbound text contains "frivolous," and nothing more. The matching is mechanical.

## What the sourcing note records

The matter-internal sourcing note (see `output-format.md`) records the value of every axis under a `## Readiness classification` section, with the per-axis evidence (parseability score, sample counts, citation hits, dollar-amount hits, vocabulary completeness) the rubric used. This is the audit trail; the partner can see exactly why the skill chose to proceed, render partial-parse TBDs, or refuse.
