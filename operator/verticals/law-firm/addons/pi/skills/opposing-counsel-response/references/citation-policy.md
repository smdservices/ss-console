# Citation Policy (Law-Firm Vertical, Platform Invariant #6)

The skill must never produce, repeat, reformulate, or augment any legal citation in any section it authors. This is the law-firm vertical's instance of platform invariant #6 (citation-refusal). The architectural enforcement lives in the citation-refusal substrate at `operator/safety-substrate/citation_filter.py`; the skill's prompt-level discipline below is defense in depth.

This skill has a narrow carve-out: the verbatim inbound message body is quoted unchanged in the inbound-claim recital section. Citation strings that appear in the verbatim quote are not authored by the skill and are exempt from the authoring prohibition. Citation strings inside partner-authored TBD sections (substantive settlement response, motion response, scheduling response, closing case-strategy) are similarly exempt because they are not the skill's authoring. Citation strings inside the verbatim-quoted prior-correspondence table are similarly exempt.

## What counts as a citation

The skill treats the following as citations subject to the authoring prohibition:

- **Case-name citations.** Strings of the shape `<Plaintiff> v. <Defendant>` followed by a reporter cite (`123 F.3d 456`), a court designation (`(3d Cir. 2010)`, `(E.D. Pa. 2022)`), and/or a pinpoint (`at 462`). Examples the skill refuses to author or restate: `Smith v. Jones, 123 F.3d 456 (3d Cir. 2010)`, `Brown v. Bd. of Educ., 347 U.S. 483 (1954)`, `Daubert v. Merrell Dow Pharms., 509 U.S. 579 (1993)`.
- **Statute references.** Federal: `<title> U.S.C. § <section>`, `<title> USC <section>`. State: `<state>-<title>-<section>`, `<state> Rev. Stat. § <section>`, and the major state-specific patterns. Examples: `42 U.S.C. § 1983`, `Ariz. Rev. Stat. § 12-542`, `12 Pa. C.S. § 5524`.
- **Court rule references.** Federal: `Fed. R. Civ. P. <rule>`, `Fed. R. Evid. <rule>`, `Fed. R. App. P. <rule>`. State-court rule patterns. Examples: `Fed. R. Civ. P. 56`, `Fed. R. Civ. P. 16`, `Fed. R. Civ. P. 26(c)`, `Ariz. R. Civ. P. 16`.
- **Treatise and restatement pinpoints.** `Restatement (Second) of Torts § <section>`, `Wright & Miller, Federal Practice and Procedure § <section>`, `Prosser & Keeton on Torts § <section>`.
- **Administrative regulations.** `<title> C.F.R. § <section>` and state regulatory equivalents.

The detection is pattern-based; false positives (the substrate flags a string that looks citation-shaped but is not) are escalated to the partner rather than silently dropped.

## The verbatim-quote carve-out

The skill's inbound-claim recital quotes the verbatim text of the inbound message. Motion-related correspondence routinely embeds court-rule citations and case-name citations. For example, a motion-related letter may read: "Defendant intends to file a motion for summary judgment under Fed. R. Civ. P. 56 in light of the holding in Anderson v. Liberty Lobby, Inc., 477 U.S. 242 (1986)." The skill's behavior on such text:

1. **The verbatim quote carries through unchanged.** The skill does not rewrite, paraphrase, or summarize the inbound. The recital contains the text as received.
2. **The citation in the quote is not the skill's authoring.** It is the opposing party's authoring, served on the firm. The skill's reproduction is a quote, not a citation produced by the skill.
3. **The substrate's filter respects the carve-out.** The filter's `verbatim_quote_exempt` configuration flag (set at skill load time per `customer.yaml.skill_config.opposing-counsel-response.verbatim_quote_exempt: true`) instructs the filter to ignore citation-shaped strings inside the verbatim-quote markdown blocks. The carve-out is narrow: only the inbound-claim recital section, only the prior-correspondence-table synopsis column when the synopsis was authored by the partner (sourced from EmailThread). Every other section is fully subject to the prohibition.
4. **The skill's own prose around the quote is fully subject to the prohibition.** A tone-classification label that reads `Fed. R. Civ. P. 56 procedural` is a violation; the label must read `procedural` (the firm's memory-rule label, citation-free).

## What the skill does on detection in its own authoring

The skill never authors a citation. Detection paths:

1. **Skill-emit-time detection.** The skill's draft assembly never includes a citation in skill-authored sections (tone-classification labels, sourcing-note prose, recitation lead-in prose, prior-correspondence captions, inbound-claim quote captions). If the assembled draft would otherwise contain one, the skill replaces the would-be string with `[CITATION REMOVED - partner inserts after review]` and logs a `citation_refusal_event`.
2. **Substrate-pre-emit detection.** Before the draft reaches the `draft_queue` or `Email.create_draft`, the citation-refusal substrate scans the draft body for citation-shaped strings outside the verbatim-quote-exempt regions. Any hit causes the substrate to block the emit; the skill re-runs with stricter prompting; if the second run also fails, the runtime emits a `block`-severity event and escalates to Captain. This is the architectural enforcement; the skill's discipline is defense in depth.

## What about citations in source data

The matter may contain citations the partner authored in narrative notes (e.g., `matter.custom_fields.case_summary` may reference a controlling precedent the partner wants the response to acknowledge). The skill handles these as follows:

- **Citations the skill would carry through verbatim, inside a partner-authored TBD section.** The skill does not author the TBD sections. If the partner fills in a TBD section after the draft lands and includes a citation, that is the partner's authoring, not the skill's. The substrate-pre-emit filter still scans, but the partner's edits are an out-of-band addition.
- **Citations in source data the skill would read into its own factual prose.** Refuse. Specifically: if a `case_summary` or `motion_strategy_narrative` custom_field that the skill reads for recitation lead-in or sourcing-note prose contains a citation, the skill triggers the readiness rubric's `PROPAGATION_RISK` value (see `categorization-rubric.md` axis 6) and refuses with `citation_in_source`. The partner edits the custom_field and re-invokes.
- **Citations in the inbound message body.** Exempt under the verbatim-quote carve-out. The skill quotes the inbound unchanged; the citation appears inside the verbatim-quoted recital; the substrate-level filter respects the exemption.
- **Citations in the prior-correspondence table.** Exempt under the verbatim-quote carve-out when the synopsis field is sourced verbatim from EmailThread. The skill never paraphrases the synopsis.
- **Citations the skill might quote indirectly.** The skill does not paraphrase, restate, or summarize citations even from the inbound. "Opposing counsel cited Fed. R. Civ. P. 56" is a citation the skill must not author; the formal legal-argument framing is partner work and renders as a TBD marker.

## What about the opposing-counsel-correspondence content type

Opposing-counsel correspondence on PI matters is content where citing court rules is the norm in formal practice, particularly for motion-related correspondence. Substantive motion responses cite Fed. R. Civ. P. 56 (summary judgment), Fed. R. Civ. P. 12 (motions to dismiss), Fed. R. Civ. P. 26 (discovery), Fed. R. Civ. P. 16 (scheduling), and state-court analogues. The skill does not author these citation-bearing sentences. They are partner-authored in the TBD motion-substantive-response section.

The skill's structural shape surfaces the inbound's factual claims (verbatim, citation-free for skill-authored captions) and the prior-correspondence chronology (citation-free in skill-authored captions; verbatim synopses sourced from EmailThread are exempt) and leaves the citation-bearing prose as the partner's authoring queue. The partner reviews the recital, reviews the prior-correspondence record, sees which tone label the skill mapped, and authors the legal-argument framing that includes the citations. This is the load-bearing pattern: the skill does the time-consuming factual recitation and chronological assembly; the partner does the legal-judgment authoring that includes the citations.

## Standard refusal language

When the skill must refuse, it returns a structured error rather than writing a draft. The error's user-facing message:

> The skill cannot draft this opposing-counsel response because the matter record contains a legal citation in a field the skill reads as factual source data for its own authoring. Citation authoring and validation is human legal-research work the skill does not perform. To proceed: edit the matter's narrative fields to remove or quote-isolate the citation, then re-invoke. If you want the citation referenced in the substantive-response sections, author those sections yourself after the draft lands; the skill leaves those sections as TBD markers for exactly this reason. Citations inside the verbatim inbound-message quote and inside the verbatim prior-correspondence-table synopses are exempt and do not trigger this refusal.

The technical error code is `citation_in_source`. The matter-internal sourcing note records the offending field name and the matched pattern.

## Relationship to the citation-refusal substrate

The substrate (`operator/safety-substrate/citation_filter.py`) is the load-bearing enforcement. This document is the skill's prompt-level discipline, which exists for two reasons:

1. **Defense in depth.** A skill that prompts itself to draft citation-bearing motion-response framing and then relies on the substrate to strip them is wasteful and produces a worse user experience than a skill that refuses to draft them in the first place. Motion-correspondence response framing is one of the most-likely citation surfaces in the law-firm vertical because formal motion-response patterns are ingrained in litigator training; the skill must actively avoid it.
2. **Voice-gate signal.** Citation-shaped strings in skill-authored output cause voice-gate score reductions and may trigger fabrication-filter flags. The skill's prompt-level discipline keeps the score clean.

The substrate and the skill discipline together implement invariant #6, with the verbatim-quote carve-out as the narrow exception. Either failing on its own is a single-layer failure; both failing on a skill-authored section is the venture-killer the substrate exists to prevent.
