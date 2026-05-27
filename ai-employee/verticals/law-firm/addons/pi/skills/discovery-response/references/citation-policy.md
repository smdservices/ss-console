# Citation Policy (Law-Firm Vertical, Platform Invariant #6)

The skill must never produce, repeat, reformulate, or augment any legal citation in any section it authors. This is the law-firm vertical's instance of platform invariant #6 (citation-refusal). The architectural enforcement lives in the citation-refusal substrate at `ai-employee/safety-substrate/citation_filter.py`; the skill's prompt-level discipline below is defense in depth.

This skill has a narrow carve-out: the verbatim incoming-request body is quoted unchanged in the per-request response table's request-text column. Citation strings that appear in the verbatim quote are not authored by the skill and are exempt from the authoring prohibition. Citation strings inside partner-authored TBD sections (substantive answer, privilege-claim characterization, admit-or-deny, closing case-strategy) are similarly exempt because they are not the skill's authoring.

## What counts as a citation

The skill treats the following as citations subject to the authoring prohibition:

- **Case-name citations.** Strings of the shape `<Plaintiff> v. <Defendant>` followed by a reporter cite (`123 F.3d 456`), a court designation (`(3d Cir. 2010)`, `(E.D. Pa. 2022)`), and/or a pinpoint (`at 462`). Examples the skill refuses to author or restate: `Smith v. Jones, 123 F.3d 456 (3d Cir. 2010)`, `Brown v. Bd. of Educ., 347 U.S. 483 (1954)`, `Daubert v. Merrell Dow Pharms., 509 U.S. 579 (1993)`.
- **Statute references.** Federal: `<title> U.S.C. § <section>`, `<title> USC <section>`. State: `<state>-<title>-<section>`, `<state> Rev. Stat. § <section>`, and the major state-specific patterns (Arizona Revised Statutes, Pennsylvania Consolidated Statutes, etc.). Examples: `42 U.S.C. § 1983`, `Ariz. Rev. Stat. § 12-542`, `12 Pa. C.S. § 5524`.
- **Court rule references.** Federal: `Fed. R. Civ. P. <rule>`, `Fed. R. Evid. <rule>`, `Fed. R. App. P. <rule>`. State-court rule patterns. Examples: `Fed. R. Civ. P. 26(b)(1)`, `Fed. R. Civ. P. 33`, `Fed. R. Civ. P. 34`, `Fed. R. Civ. P. 36`, `Ariz. R. Civ. P. 26`.
- **Treatise and restatement pinpoints.** `Restatement (Second) of Torts § <section>`, `Wright & Miller, Federal Practice and Procedure § <section>`, `Prosser & Keeton on Torts § <section>`.
- **Administrative regulations.** `<title> C.F.R. § <section>` and state regulatory equivalents.

The detection is pattern-based; false positives (the substrate flags a string that looks citation-shaped but is not) are escalated to the partner rather than silently dropped.

## The verbatim-quote carve-out

The skill's per-request response table includes a column that quotes the verbatim text of each numbered request from the incoming filing. Opposing counsel routinely embeds court-rule citations in interrogatories and requests for production. For example, a request may read: "Pursuant to Fed. R. Civ. P. 34, plaintiff is requested to produce all documents...". The skill's behavior on such text:

1. **The verbatim quote carries through unchanged.** The skill does not rewrite, paraphrase, or summarize the request. The recital column contains the text as served.
2. **The citation in the quote is not the skill's authoring.** It is the opposing party's authoring, served on the firm. The skill's reproduction is a quote, not a citation produced by the skill.
3. **The substrate's filter respects the carve-out.** The filter's `verbatim_quote_exempt` configuration flag (set at skill load time per `customer.yaml.skill_config.law-pi-discovery-response.verbatim_quote_exempt: true`) instructs the filter to ignore citation-shaped strings inside the verbatim-quote markdown blocks. The carve-out is narrow: only the per-request table's request-text column, only the recital lead-in's verbatim-quote sub-clauses (e.g., a partner-supplied service-date quote). Every other section is fully subject to the prohibition.
4. **The skill's own prose around the quote is fully subject to the prohibition.** A category-label cell that reads `Fed. R. Civ. P. 26(b)(1) (proportionality)` is a violation; the cell must read `not proportional to the needs of the case` (the firm's memory-rule label, citation-free).

## What the skill does on detection in its own authoring

The skill never authors a citation. Detection paths:

1. **Skill-emit-time detection.** The skill's draft assembly never includes a citation in skill-authored sections (category-label cells, sourcing-note prose, recitation lead-in prose, responsive-document captions, privilege-log column captions). If the assembled draft would otherwise contain one (e.g., the skill's prompt would draw on training data containing court-rule references), the skill replaces the would-be string with `[CITATION REMOVED - partner inserts after review]` and logs a `citation_refusal_event`.
2. **Substrate-pre-emit detection.** Before the draft reaches the `draft_queue` or `Email.create_draft`, the citation-refusal substrate scans the draft body for citation-shaped strings outside the verbatim-quote-exempt regions. Any hit causes the substrate to block the emit; the skill re-runs with stricter prompting; if the second run also fails, the runtime emits a `block`-severity event and escalates to Captain. This is the architectural enforcement; the skill's discipline is defense in depth.

## What about citations in source data

The matter may contain citations the partner authored in narrative notes (e.g., `matter.custom_fields.case_summary` may reference a controlling precedent the partner wants the response to acknowledge). The skill handles these as follows:

- **Citations the skill would carry through verbatim, inside a partner-authored TBD section.** The skill does not author the TBD sections (substantive answer, privilege-claim characterization, admit-or-deny, closing case-strategy). If the partner fills in a TBD section after the draft lands and includes a citation, that is the partner's authoring, not the skill's. The substrate-pre-emit filter still scans, but the partner's edits are an out-of-band addition, not part of the skill's output.
- **Citations in source data the skill would read into its own factual prose.** Refuse. Specifically: if a `case_summary` or `liability_narrative` custom_field that the skill reads for recitation lead-in or sourcing-note prose contains a citation, the skill triggers the readiness rubric's `PROPAGATION_RISK` value (see `categorization-rubric.md` axis 6) and refuses with `citation_in_source`. The partner edits the custom_field (removes the citation or quote-isolates it in a way the skill is configured to skip) and re-invokes.
- **Citations in the incoming request body.** Exempt under the verbatim-quote carve-out. The skill quotes the request unchanged; the citation appears inside the verbatim-quoted recital column; the substrate-level filter respects the exemption.
- **Citations the skill might quote indirectly.** The skill does not paraphrase, restate, or summarize citations even from the incoming request. "The plaintiff objects under Fed. R. Civ. P. 26(b)(1)" is a citation the skill must not author; the formal objection sentence is partner work and renders as a TBD marker.

## What about the discovery-response content type

Discovery responses are content where citing court rules is the norm in formal practice. The substantive objection sentence and the formal admit-or-deny boilerplate routinely cite Fed. R. Civ. P. 26, Fed. R. Civ. P. 33, Fed. R. Civ. P. 34, Fed. R. Civ. P. 36, and state-court analogues. The skill does not author these sentences. They are partner-authored in the TBD substantive-answer / admit-or-deny / production-posture columns.

The skill's table structure surfaces the category labels (citation-free) and the responsive-document mapping (citation-free) and leaves the citation-bearing prose as the partner's authoring queue. The partner reviews the table, sees which categories the skill mapped, and authors the formal objection sentences that cite the appropriate rule. This is the load-bearing pattern: the skill does the time-consuming factual mapping; the partner does the legal-judgment authoring that includes the citations.

## Standard refusal language

When the skill must refuse, it returns a structured error rather than writing a draft. The error's user-facing message:

> The skill cannot draft this discovery response because the matter record contains a legal citation in a field the skill reads as factual source data for its own authoring. Citation authoring and validation is human legal-research work the skill does not perform. To proceed: edit the matter's narrative fields to remove or quote-isolate the citation, then re-invoke. If you want the citation referenced in the formal objection sentences or the substantive-answer sections, author those sections yourself after the draft lands; the skill leaves those sections as TBD markers for exactly this reason. Citations inside the verbatim incoming-request quote are exempt and do not trigger this refusal.

The technical error code is `citation_in_source`. The matter-internal sourcing note records the offending field name and the matched pattern.

## Relationship to the citation-refusal substrate

The substrate (`ai-employee/safety-substrate/citation_filter.py`) is the load-bearing enforcement. This document is the skill's prompt-level discipline, which exists for two reasons:

1. **Defense in depth.** A skill that prompts itself to draft citation-bearing objection sentences and then relies on the substrate to strip them is wasteful and produces a worse user experience than a skill that refuses to draft them in the first place. Discovery-response objection sentences are the most-likely citation surface in the law-firm vertical because the formal objection sentence pattern is ingrained in litigator training; the skill must actively avoid it.
2. **Voice-gate signal.** Citation-shaped strings in skill-authored output cause voice-gate score reductions and may trigger fabrication-filter flags. The skill's prompt-level discipline keeps the score clean.

The substrate and the skill discipline together implement invariant #6, with the verbatim-quote carve-out as the narrow exception. Either failing on its own is a single-layer failure; both failing on a skill-authored section is the venture-killer the substrate exists to prevent.
