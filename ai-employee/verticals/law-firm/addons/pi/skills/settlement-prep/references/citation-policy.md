# Citation Policy (Law-Firm Vertical, Platform Invariant #6)

The skill must never produce, repeat, reformulate, or augment any legal citation in any section it authors. This is the law-firm vertical's instance of platform invariant #6 (citation-refusal). The architectural enforcement lives in the citation-refusal substrate at `ai-employee/safety-substrate/citation_filter.py`; the skill's prompt-level discipline below is defense in depth.

This skill has a narrow carve-out: the rows of the comparable-verdict table surface verbatim from the firm's `customer.yaml.memory_rules.comparable_verdicts` corpus, which the partner authored. The citation strings in the `source` column of each surfaced row are partner authoring under the verbatim-quote carve-out. The skill does not validate, augment, or extend those citations.

## What counts as a citation

The skill treats the following as citations subject to the authoring prohibition:

- **Case-name citations.** Strings of the shape `<Plaintiff> v. <Defendant>` followed by a reporter cite (`123 F.3d 456`), a court designation (`(3d Cir. 2010)`, `(D. Ariz. 2022)`), and/or a pinpoint (`at 462`). Examples the skill refuses to author or restate: `Smith v. Jones, 123 F.3d 456 (3d Cir. 2010)`, `Brown v. Bd. of Educ., 347 U.S. 483 (1954)`.
- **Statute references.** Federal: `<title> U.S.C. § <section>`, `<title> USC <section>`. State: `<state>-<title>-<section>`, `<state> Rev. Stat. § <section>`, and the major state-specific patterns.
- **Court rule references.** Federal: `Fed. R. Civ. P. <rule>`, `Fed. R. Evid. <rule>`. State-court rule patterns.
- **Treatise and restatement pinpoints.** `Restatement (Second) of Torts § <section>`, `Wright & Miller, Federal Practice and Procedure § <section>`.
- **Administrative regulations.** `<title> C.F.R. § <section>` and state regulatory equivalents.
- **Jury-verdict reporter cites in the SOURCE column of comparable-verdict rows.** These ARE citations, but they are exempt under the verbatim-quote carve-out because the row is verbatim from the partner-authored memory rule.

The detection is pattern-based; false positives are escalated to the partner rather than silently dropped.

## The verbatim-quote carve-out

The comparable-verdict table is the only section of this skill's output where citation-shaped strings legitimately appear. Each row of the table is a verbatim render of a memory-rule row the partner authored. The row's `source` column commonly contains:

- A jury-verdict reporter cite (e.g., `Maricopa Jury Verdict Reporter 2024-118`).
- A published-opinion cite (e.g., `Smith v. Mid-City Cab, 245 Ariz. 312 (2024)`).
- A partner-internal reference (e.g., `partner matter file 2023-441`).
- A treatise or settlement-reporter pinpoint.

The skill's behavior on such rows:

1. **The verbatim row carries through unchanged.** The skill does not rewrite, paraphrase, or summarize the row. The source column contains exactly what the partner authored in the memory rule.
2. **The citation in the row is not the skill's authoring.** It is the partner's authoring in the memory-rule corpus. The skill's reproduction is a quote, not a citation produced by the skill.
3. **The substrate's filter respects the carve-out.** The filter's `verbatim_quote_exempt` configuration flag (set at skill load time per `customer.yaml.skill_config.law-pi-settlement-prep.verbatim_quote_exempt_sections: [comparable_verdicts]`) instructs the filter to ignore citation-shaped strings inside the comparable-verdict table region. The carve-out is narrow: only the comparable-verdict table's source column and the case-name column. Every other section is fully subject to the prohibition.
4. **The skill's own prose around the table is fully subject to the prohibition.** The table caption, the matched-criteria description, and any lead-in or follow-on prose must contain no citation-shaped strings.

## What the skill does on detection in its own authoring

The skill never authors a citation. Detection paths:

1. **Skill-emit-time detection.** The skill's memo assembly never includes a citation in skill-authored sections (matter-facts summary, chronology, damages tables, strengths lead-in, weaknesses lead-in, prior-pattern table prose, exhibit list). If the assembled memo would otherwise contain one, the skill replaces the would-be string with `[CITATION REMOVED - partner inserts after review]` and logs a `citation_refusal_event`.
2. **Substrate-pre-emit detection.** Before the memo reaches `Email.create_draft`, the citation-refusal substrate scans the body for citation-shaped strings outside the verbatim-quote-exempt regions. Any hit causes the substrate to block the emit; the skill re-runs with stricter prompting; if the second run also fails, the runtime emits a `block`-severity event and escalates to Captain.

## What about citations in matter source data

The matter may contain citations the partner authored in narrative notes. The skill handles these as follows:

- **Citations in the comparable-verdict memory-rule rows.** Exempt under the verbatim-quote carve-out. Surface verbatim. The skill does not paraphrase, augment, or extend.
- **Citations the skill would carry through into its own prose** (e.g., a `case_summary` custom_field that the skill reads for the matter-facts summary lead-in). Refuse. Specifically: if a custom_field the skill reads contains a citation, the skill triggers the readiness rubric's `PROPAGATION_RISK` value (categorization-rubric.md axis 7) and refuses with `citation_in_source`. The partner edits the custom_field and re-invokes.
- **Citations the partner authors into the TBD bracket or posture sections after the memo lands.** Out of band; the partner's edits are not the skill's authoring. The substrate-pre-emit filter still runs on the assembled memo before emit, but the partner's later edits do not re-trigger the skill.

## Standard refusal language

When the skill must refuse, it returns a structured error rather than writing a memo. The error's user-facing message:

> The skill cannot draft this settlement-prep memo because the matter record contains a legal citation in a field the skill reads as factual source data for its own authoring. Citation authoring and validation is human legal-research work the skill does not perform. To proceed: edit the matter's narrative fields to remove or quote-isolate the citation, then re-invoke. The comparable-verdict table sources verbatim from the firm's memory rule and is the only section where citations legitimately appear; that section is exempt under the verbatim-quote carve-out.

The technical error code is `citation_in_source`. The matter-internal sourcing note records the offending field name and the matched pattern.

## Why the carve-out is narrow

The comparable-verdict corpus is the only place where the firm has committed (by authoring the corpus) that citations are partner-validated and ready for inclusion. Everywhere else in the matter file, citations may be partial, in-progress, or in narrative drafts the partner has not validated for external use. The skill cannot distinguish a validated citation from a draft citation; the safe rule is to refuse propagation everywhere except the explicitly partner-validated memory-rule corpus.

The skill's behavior is the partner's hedge: validated citations live in the memory rule, where the skill can carry them through; everywhere else, the partner authors the citation directly in the TBD sections.
