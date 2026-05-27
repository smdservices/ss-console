# Matter Readiness Rubric

Before assembling a discovery-response draft, the skill classifies the matter and the incoming request along six readiness axes. The classifications drive: which sections render as prose vs. table, which render as TBD, and whether the skill proceeds at all.

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

| Value   | Criterion                    | Action                                                                                         |
| ------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| ACTIVE  | `matter.status == "open"`    | Proceed.                                                                                       |
| PENDING | `matter.status == "pending"` | Proceed but flag in sourcing note.                                                             |
| INTAKE  | `matter.status == "intake"`  | Refuse with `matter_intake_only`. Discovery responses do not issue from intake-status matters. |
| CLOSED  | `matter.status == "closed"`  | Refuse with `matter_closed`. Write no draft.                                                   |

## Axis 3: Request parseability

Can the incoming discovery request be parsed into discrete numbered items?

| Value         | Criterion                                                                              | Action                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PARSED        | The request body decomposes cleanly into a numbered list (extraction success >= 95%)   | Proceed with full draft.                                                                                                |
| PARTIAL_PARSE | Extraction success in 70-94%. Some items extracted; some ambiguous boundaries flagged. | Proceed with draft. Items with ambiguous boundaries render as TBD in the request-text column; sourcing note enumerates. |
| UNPARSEABLE   | Extraction success below 70%, or the document is image-only with degraded OCR.         | Refuse with `request_unparseable`. The partner surfaces a clean copy or re-OCRs the source.                             |

The parseability check is conservative on purpose. A draft built on misnumbered or merged requests is worse than no draft.

## Axis 4: Objection vocabulary readiness

Is the firm's objection-category vocabulary configured?

| Value   | Criterion                                                                                                                                                                                                                                                               | Action                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| READY   | `customer.yaml.memory_rules.objection_categories` is present and contains at least the platform-standard categories (overbroad, unduly burdensome, vague and ambiguous, proportionality, attorney-client privilege, work-product doctrine, possession-custody-control). | Proceed.                                                                                                                                           |
| LIGHT   | `customer.yaml.memory_rules.objection_categories` is present but missing one or more of the platform-standard categories.                                                                                                                                               | Proceed with draft; render the table with the available categories; sourcing note records the gap. The partner extends the vocabulary out of band. |
| MISSING | `customer.yaml.memory_rules.objection_categories` is null, empty, or undefined.                                                                                                                                                                                         | Refuse with `objection_vocabulary_missing`. The firm authors the vocabulary; the skill refuses rather than ship a draft with no category labels.   |

The objection-category vocabulary is a memory rule the partner authors during onboarding. The skill does not invent categories.

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
| CLEAN            | No citation-shaped strings in any custom_field the skill reads (excluding `discovery_request_body`, which is a verbatim source the skill quotes rather than authors).                                | Proceed.                                                                                                                                |
| QUOTED_OK        | Citation-shaped strings present in the incoming request body OR in partner-narrative custom_fields the skill carries through verbatim only.                                                          | Proceed. The substrate-level citation filter blocks any post-emit citation in skill-authored prose; quoted-source citations are exempt. |
| PROPAGATION_RISK | Citation-shaped strings appear in custom_fields the skill would otherwise read into its own factual prose (e.g., a `case_summary` field), or in matter notes the skill reads for recitation lead-in. | Refuse with `citation_in_source`. The partner edits the custom_field to remove or quote-isolate the citation, then re-invokes.          |

Citation patterns the skill detects (identical to the demand-letter skill's detection, for consistency):

- Case names: `<Name> v. <Name>` followed by a reporter cite (e.g., `123 F.3d 456 (3d Cir. 2010)`).
- Statute references: `<title> U.S.C. § <section>`, `<title>-<section>` (some state codes), `42 USC 1983`.
- Court rule references: `Fed. R. Civ. P. <rule>`, `Fed. R. Evid. <rule>`, state-court rule patterns.
- Treatise pinpoints: `Restatement (Second) of <Topic> § <section>`, `Wright & Miller § <section>`.

Detection is conservative; false positives are flagged for partner review rather than silently dropped.

The verbatim incoming-request body is exempt from the propagation-risk check: the skill quotes the request unchanged, and any citation in the request itself appears only inside the verbatim-quoted recital column of the response table. The substrate-level filter respects the quoted-source exemption per `references/citation-policy.md`.

## Tie-breakers

When two axes disagree about whether to proceed:

- **Request parseability wins over voice envelope readiness.** A matter with a clean voice envelope but an unparseable request refuses; the partner cleans the source.
- **Objection vocabulary missing wins over everything except matter scope.** A matter ready in every other axis but missing the vocabulary refuses; the firm authors the vocabulary during onboarding.
- **Citation risk wins over everything.** Any `PROPAGATION_RISK` value refuses regardless of other axes.
- **Matter status wins over request parseability.** A closed matter with a parseable request still refuses.

## The objection-category memory-rule contract

The skill reads `customer.yaml.memory_rules.objection_categories`, which is structured as:

```yaml
memory_rules:
  objection_categories:
    rule_id: 'obj_categories_v1'
    rule_version: '2026-05-15'
    categories:
      - label: 'overbroad'
        keywords: ['every', 'all', 'any and all', 'each and every']
        applies_to: ['interrogatories', 'requests_for_production', 'requests_for_admission']
      - label: 'unduly burdensome'
        keywords: ['ten years', 'all employees', 'all communications', 'all documents']
        applies_to: ['requests_for_production']
      - label: 'vague and ambiguous'
        keywords: ['detailed', 'each', 'identify all']
        applies_to: ['interrogatories', 'requests_for_admission']
      - label: 'not proportional to the needs of the case'
        keywords: ['ten years', 'prior employment', 'unrelated incidents']
        applies_to: ['interrogatories', 'requests_for_production', 'requests_for_admission']
      - label: 'seeks information protected by attorney-client privilege'
        keywords: ['counsel', 'attorney', 'legal advice', 'representation']
        applies_to: ['interrogatories', 'requests_for_production', 'requests_for_admission']
      - label: 'seeks information protected by the work-product doctrine'
        keywords: ['mental impressions', 'litigation strategy', 'expert preparation']
        applies_to: ['requests_for_production']
      - label: 'seeks information not in the responding party's possession, custody, or control'
        keywords: ['third party', 'opposing party', 'other counsel']
        applies_to: ['interrogatories', 'requests_for_production']
      - label: 'premature'
        keywords: ['expert', 'opinion', 'damages', 'valuation']
        applies_to: ['interrogatories', 'requests_for_admission']
      - label: 'seeks expert opinion'
        keywords: ['expert', 'opinion', 'causation', 'prognosis']
        applies_to: ['interrogatories', 'requests_for_admission']
```

The skill scans each numbered request's verbatim text for keyword matches and emits the matched category labels comma-separated in the table cell. The skill does NOT author the formal objection sentence (which typically cites Fed. R. Civ. P. 26(b)(1) or its state-court analogue); that's partner work and renders as a TBD marker in the production-posture or substantive-answer column.

The keywords are partner-authored. The skill is a category mapper, not a legal classifier. If the partner's memory rule labels a category `unduly burdensome` and the keyword is `ten years`, the skill emits the label when the request text contains "ten years," and nothing more. The matching is mechanical.

## What the sourcing note records

The matter-internal sourcing note (see `output-format.md`) records the value of every axis under a `## Readiness classification` section, with the per-axis evidence (parseability score, sample counts, citation hits, vocabulary completeness) the rubric used. This is the audit trail; the partner can see exactly why the skill chose to proceed, render partial-parse TBDs, or refuse.
