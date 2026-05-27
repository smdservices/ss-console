# law-pi-demand-letter-draft

Demand-letter draft assembler for personal-injury law firms. Reads an active PI matter and writes a factual draft into the supervising partner's drafts folder.

The skill writes only what the matter record and document store contain. The four legal-judgment sections (liability characterization, settlement bracket, demand amount, closing strategy language) render as TBD markers; the partner authors them after the draft lands. The skill never sends — per ADR 0005 the partner is the sender.

## Files

- `SKILL.md` — the skill contract (frontmatter + body)
- `references/voice.md` — partner-corpus voice rules (Layer 2 match)
- `references/output-format.md` — section order and templates for the draft and the matter-internal sourcing note
- `references/categorization-rubric.md` — matter-readiness axes; refusal criteria
- `references/citation-policy.md` — law-firm vertical invariant #6 (no citations, ever)
- `references/fabrication-policy.md` — platform invariant #8; per-section sourcing contract; the four `none`-tagged TBD sections
- `references/test-cases.md` — what the three fixtures exercise
- `fixtures/01-clean-matter.{yaml,md}` — full-information matter, complete draft
- `fixtures/02-missing-wages-matter.{yaml,md}` — missing employment verification, TBD pattern
- `fixtures/03-citation-in-source-{matter.yaml,refusal.md}` — citation in source, refusal pattern

## Scope alignment

The skill name `law-pi-demand-letter-draft` is shorthand for a factually-narrow demand-letter assembler. The law-firm PRD §6.2 defers the more general `pi-demand-letter-text-only` skill to Phase 3+ on legal-judgment-fingerprint grounds. This skill implements the safe subset: factual chronology, tabulation, exhibit assembly, and a sourced case-history paragraph. The legal-judgment sections are TBD by architecture.

See `SKILL.md` § "Scope alignment with law-firm-prd §6.2" for the full reconciliation. If Captain decides this scope creeps too close to the deferred skill, the fix is configuration: narrow the factual prose to bulleted assembly only, OR hold the skill for Phase 3.

## Trust ceiling

`draft_for_review`, locked. Per platform PRD §11.2 the ceiling is architecturally non-promotable for any skill touching settlement authority.

## Capability bindings

- `PracticeManagement` — read-only (`get_matter`)
- `DocumentStorage` — read-only (`list_folder`, `download_document`)
- `Email` — `create_draft` only (no send method exists per ADR 0005)
