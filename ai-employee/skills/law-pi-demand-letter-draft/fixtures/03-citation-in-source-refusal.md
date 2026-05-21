---

`[SYNTHETIC FIXTURE — NOT A REAL MATTER]`

---

This file is the reference output for fixture 03. The skill detects a citation-shaped string in `matter.custom_fields.case_summary` and refuses with `citation_in_source`. The output is the matter-internal sourcing note recording the refusal. NO draft is created; `Email.create_draft` is NOT called.

The runtime's error returned to the caller:

```
SkillRefusalError {
  skill: "law-pi-demand-letter-draft",
  code: "citation_in_source",
  matter_ref: "matter_synthetic_03",
  user_facing_message: "The skill cannot draft this demand because the matter record contains a legal citation in a field the skill reads as factual source data. Citation authoring and validation is human legal-research work the skill does not perform. To proceed: edit the matter's narrative fields to remove or quote-isolate the citation, then re-invoke. If you want the citation referenced in the draft's liability-characterization section, author that section yourself after the draft lands; the skill leaves that section as a TBD marker for exactly this reason.",
}
```

The matter-internal sourcing note written at `~/.hermes/customer_notes/holcomb-reyes/pi-demand-draft-<date>-matter_synthetic_03.md`:

---

# PI Demand Draft Sourcing Note — matter_synthetic_03

**Matter:** matter_synthetic_03 (Daria Polanco)
**Drafted:** `<ISO-8601 timestamp of run>`
**Draft reference:** (none — skill refused before draft creation)
**Voice-gate score:** (not exercised)
**Fabrication-filter result:** (not exercised — refusal upstream of filter)

## Readiness classification

| Axis                         | Value            | Evidence                                                                |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------- |
| Matter scope                 | IN_SCOPE         | matter_type=auto-accident, in PI registry                               |
| Matter status                | ACTIVE           | matter.status=open                                                      |
| Source-data density          | READY            | 4 medical, 3 billing, 2 employment, 3 photo                             |
| Voice envelope readiness     | READY            | 38 Layer 2 samples (above the 30 threshold)                             |
| Citation risk in source data | PROPAGATION_RISK | case_name_citation pattern matched in matter.custom_fields.case_summary |

## Refusal events

- **Code:** citation_in_source
- **Offending field:** matter.custom_fields.case_summary
- **Matched pattern:** case_name_citation
- **Matched substring:** "Wexford v. Mendoza Holdings, 214 Ariz. 487 (Ariz. Ct. App. 2018)"
- **Action:** skill refused. No draft created. No Email.create_draft call. Sourcing note written.

## Partner-facing remediation

The matter's `case_summary` custom_field contains a legal citation the skill cannot propagate into factual prose. To proceed with a draft, do one of:

1. **Remove the citation from the field.** Edit `matter.custom_fields.case_summary` to remove the citation and any direct restatement of the legal rule. The skill will then read the field as factual source data.
2. **Author the citation into the liability characterization yourself.** Leave the field as-is or remove it. After the draft lands (re-invoke the skill after the field is cleaned), fill in the liability-characterization TBD section with whatever case law you want the demand to acknowledge. The skill leaves that section as a TBD marker for exactly this reason.
3. **Quote-isolate the citation.** Wrap the citation in a sentinel the skill is configured to skip (the runtime's configuration for this customer specifies which sentinel). The skill will pass the field through verbatim into a partner-authored section only and will not read it as factual source data.

## Adapter calls made

- PracticeManagement.get_matter("matter_synthetic_03") — 1 call
- (No DocumentStorage calls; the refusal triggered before document inspection began.)
- (No Email.create_draft call.)

## Audit events emitted

- `SKILL_REFUSED` — skill=law-pi-demand-letter-draft, code=citation_in_source, matter_ref=matter_synthetic_03
- `CITATION_REFUSAL_TRIGGERED` — substrate=skill-level (readiness-rubric axis 5)

---

## Why this refusal exists

The citation-refusal substrate (`ai-employee/safety-substrate/citation_filter.py`) blocks any draft body containing a citation-shaped string. The skill's readiness rubric is the upstream check that prevents the skill from attempting a draft that the substrate would block. Refusing at the rubric layer is cheaper, surfaces a clearer error to the partner, and avoids a `block`-severity audit event when the same outcome can be a `SKILL_REFUSED` event.

Per the law-firm PRD §9 and the substrate's citation policy (`references/citation-policy.md`), the skill never produces, repeats, reformulates, or validates legal citations. Citations in partner-authored TBD sections after the draft lands are the partner's authoring and are not the skill's concern.
