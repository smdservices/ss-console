# Matter Readiness Rubric

Before assembling a demand-letter draft, the skill classifies the matter along five readiness axes. The classifications drive: which sections render as prose, which render as TBD, and whether the skill proceeds at all.

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

| Value   | Criterion                    | Action                                                                                                           |
| ------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| ACTIVE  | `matter.status == "open"`    | Proceed.                                                                                                         |
| PENDING | `matter.status == "pending"` | Proceed but flag in sourcing note.                                                                               |
| INTAKE  | `matter.status == "intake"`  | Refuse with `matter_intake_only`. Demand letters do not issue from intake-status matters; matter must be opened. |
| CLOSED  | `matter.status == "closed"`  | Refuse with `matter_closed`. Write no draft.                                                                     |

## Axis 3: Source-data density

Does the matter have enough sourced rows to support a draft?

The skill counts sourced rows across three categories:

- **Medical** — `StoredDocument` files matching medical-record naming heuristics (the adapter's filename classifier OR a partner-authored `document.classification` field on the matter).
- **Billing** — `StoredDocument` files matching billing-statement naming heuristics.
- **Employment** — `StoredDocument` files matching W-2, pay-stub, or employer-letter heuristics.

| Value        | Criterion                                                              | Action                                                                                                        |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| READY        | ≥3 medical AND ≥2 billing AND ≥1 employment OR partner-flagged "ready" | Proceed with full draft. All tabulations populated; case-history paragraph attempted.                         |
| PARTIAL      | ≥3 medical AND ≥2 billing AND 0 employment                             | Proceed with draft; lost-wages section renders as TBD; sourcing note records employment-verification missing. |
| INSUFFICIENT | <3 medical OR <2 billing                                               | Refuse with `insufficient_source_data`. Surface to partner: matter needs more sourced documents.              |

The threshold (≥3 medical, ≥2 billing) is conservative on purpose. A draft built on one medical record and one billing statement is closer to fabrication than to assembly.

## Axis 4: Voice envelope readiness

Does the customer have enough Layer 2 voice samples to support an externally-bound draft?

| Value   | Criterion                                            | Action                                                                                                         |
| ------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| READY   | `customer.yaml.voice.layer2_samples.count >= 30`     | Proceed.                                                                                                       |
| LIGHT   | `customer.yaml.voice.layer2_samples.count` in 15..29 | Refuse with `voice_samples_below_threshold`. Per PRD §9.6 Gate 1, externally-bound drafts require ≥30 samples. |
| MISSING | `customer.yaml.voice.layer2_samples.count < 15`      | Refuse with `voice_samples_missing`.                                                                           |

The skill does not lower the threshold for opposing-carrier drafts on the theory that the carrier is not the customer's client. Voice match still matters; opposing carriers compare correspondence to prior firm correspondence and a voice mismatch is a tell.

## Axis 5: Citation risk in source data

Does the matter custom_fields or partner narrative notes contain citation-shaped strings the skill might inadvertently propagate?

| Value            | Criterion                                                                                                                                | Action                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CLEAN            | No citation-shaped strings in any custom_field the skill reads                                                                           | Proceed.                                                                                                                              |
| QUOTED_OK        | Citation-shaped strings present but only inside partner-narrative custom_fields the skill carries through verbatim                       | Proceed. The substrate-level citation filter blocks any post-emit citation; the skill's own discipline does not need to reproduce it. |
| PROPAGATION_RISK | Citation-shaped strings appear in custom_fields the skill would otherwise read into its own factual prose (e.g., a `case_summary` field) | Refuse with `citation_in_source`. The partner edits the custom_field to remove or quote-isolate the citation, then re-invokes.        |

Citation patterns the skill detects:

- Case names: `<Name> v. <Name>` followed by a reporter cite (e.g., `123 F.3d 456 (3d Cir. 2010)`).
- Statute references: `<title> U.S.C. § <section>`, `<title>-<section>` (some state codes), `42 USC 1983`.
- Court rule references: `Fed. R. Civ. P. <rule>`, `Fed. R. Evid. <rule>`, state-court rule patterns.
- Treatise pinpoints: `Restatement (Second) of <Topic> § <section>`, `Wright & Miller § <section>`.

Detection is conservative; false positives are flagged for partner review rather than silently dropped.

## Tie-breakers

When two axes disagree about whether to proceed:

- **Source-data density wins over voice envelope readiness.** A matter with ample source data but a thin voice envelope refuses; the firm calibrates voice samples and re-invokes.
- **Citation risk wins over everything.** Any `PROPAGATION_RISK` value refuses regardless of other axes.
- **Matter status wins over source-data density.** A closed matter with ample data still refuses.

## What the sourcing note records

The matter-internal sourcing note (see `output-format.md`) records the value of every axis under a `## Readiness classification` section, with the per-axis evidence (counts, sample counts, citation hits) the rubric used. This is the audit trail; the partner can see exactly why the skill chose to render full prose vs. structured-only vs. refuse.
