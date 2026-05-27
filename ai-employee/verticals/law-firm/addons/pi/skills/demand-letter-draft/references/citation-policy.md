# Citation Policy (Law-Firm Vertical, Platform Invariant #6)

The skill must never produce, repeat, reformulate, or augment any legal citation. This is the law-firm vertical's instance of platform invariant #6 (citation-refusal). The architectural enforcement lives in the citation-refusal substrate at `ai-employee/safety-substrate/citation_filter.py`; the skill's prompt-level discipline below is defense in depth.

## What counts as a citation

The skill treats the following as citations subject to the refusal rule:

- **Case-name citations.** Strings of the shape `<Plaintiff> v. <Defendant>` followed by a reporter cite (`123 F.3d 456`), a court designation (`(3d Cir. 2010)`, `(E.D. Pa. 2022)`), and/or a pinpoint (`at 462`). Examples the skill refuses to author or restate: `Smith v. Jones, 123 F.3d 456 (3d Cir. 2010)`, `Brown v. Bd. of Educ., 347 U.S. 483 (1954)`, `Daubert v. Merrell Dow Pharms., 509 U.S. 579 (1993)`.
- **Statute references.** Federal: `<title> U.S.C. § <section>`, `<title> USC <section>`. State: `<state>-<title>-<section>`, `<state> Rev. Stat. § <section>`, and the major state-specific patterns (Arizona Revised Statutes, Pennsylvania Consolidated Statutes, etc.). Examples: `42 U.S.C. § 1983`, `Ariz. Rev. Stat. § 12-542`, `12 Pa. C.S. § 5524`.
- **Court rule references.** Federal: `Fed. R. Civ. P. <rule>`, `Fed. R. Evid. <rule>`, `Fed. R. App. P. <rule>`. State-court rule patterns. Examples: `Fed. R. Civ. P. 26(b)(1)`, `Ariz. R. Civ. P. 16`.
- **Treatise and restatement pinpoints.** `Restatement (Second) of Torts § <section>`, `Wright & Miller, Federal Practice and Procedure § <section>`, `Prosser & Keeton on Torts § <section>`.
- **Administrative regulations.** `<title> C.F.R. § <section>` and state regulatory equivalents.

The detection is pattern-based; false positives (the substrate flags a string that looks citation-shaped but is not) are escalated to the partner rather than silently dropped.

## What the skill does on detection

The skill never authors a citation. Detection paths:

1. **Skill-emit-time detection.** The skill's draft assembly never includes a citation. If the assembled draft would otherwise contain one (e.g., the skill's prompt would draw on training data containing case names), the skill replaces the would-be string with `[CITATION REMOVED — partner inserts after review]` and logs a `citation_refusal_event`.
2. **Substrate-pre-emit detection.** Before the draft reaches the `draft_queue` or `Email.create_draft`, the citation-refusal substrate at `ai-employee/safety-substrate/citation_filter.py` scans the draft body for citation-shaped strings. Any hit causes the substrate to block the emit; the skill re-runs with stricter prompting; if the second run also fails, the runtime emits a `block`-severity event and escalates to Captain. This is the architectural enforcement; the skill's discipline is defense in depth.

## What about citations in source data

The matter may contain citations the partner authored in narrative notes (e.g., `matter.custom_fields.case_summary` may reference a controlling precedent the partner wants the demand to acknowledge). The skill handles these as follows:

- **Citations the skill would carry through verbatim, inside a partner-authored TBD section.** The skill does not author the TBD sections (liability characterization, settlement bracket, closing). If the partner fills in a TBD section after the draft lands and includes a citation, that is the partner's authoring, not the skill's. The substrate-pre-emit filter still scans, but the partner's edits are an out-of-band addition, not part of the skill's output.
- **Citations in source data the skill would read into its own factual prose.** Refuse. Specifically: if a `case_summary` or `liability_narrative` custom_field that the skill reads contains a citation, the skill triggers the readiness rubric's `PROPAGATION_RISK` value (see `categorization-rubric.md` axis 5) and refuses with `citation_in_source`. The partner edits the custom_field (removes the citation or quote-isolates it in a way the skill is configured to skip) and re-invokes.
- **Citations the skill might quote indirectly.** The skill does not paraphrase, restate, or summarize citations. "The Pennsylvania statute of limitations for personal injury is two years" is not a citation per se but is on the line; the skill does not author such statements. Statute-of-limitations content is partner-authored in the TBD closing section.

## What about the demand-letter content type

Demand letters can be authored to acknowledge controlling case law without quoting it ("the firm's position on liability rests on well-settled Pennsylvania precedent"). The skill does not author such statements. They are partner-authored in the TBD liability-characterization section.

## Standard refusal language

When the skill must refuse, it returns a structured error rather than writing a draft. The error's user-facing message:

> The skill cannot draft this demand because the matter record contains a legal citation in a field the skill reads as factual source data. Citation authoring and validation is human legal-research work the skill does not perform. To proceed: edit the matter's narrative fields to remove or quote-isolate the citation, then re-invoke. If you want the citation referenced in the draft's liability-characterization section, author that section yourself after the draft lands; the skill leaves that section as a TBD marker for exactly this reason.

The technical error code is `citation_in_source`. The matter-internal sourcing note records the offending field name and the matched pattern.

## Relationship to the citation-refusal substrate

The substrate (`ai-employee/safety-substrate/citation_filter.py`) is the load-bearing enforcement. This document is the skill's prompt-level discipline, which exists for two reasons:

1. **Defense in depth.** A skill that prompts itself to draft case citations and then relies on the substrate to strip them is wasteful and produces a worse user experience than a skill that refuses to draft them in the first place.
2. **Voice-gate signal.** Citation-shaped strings in skill output cause voice-gate score reductions and may trigger fabrication-filter flags. The skill's prompt-level discipline keeps the score clean.

The substrate and the skill discipline together implement invariant #6. Either failing on its own is a single-layer failure; both failing is the venture-killer the substrate exists to prevent.
