# discovery-response

Discovery-response draft assembler for personal-injury law firms. Reads an inbound discovery request from opposing counsel (interrogatories, requests for production, or requests for admission) and writes a factual response draft into the supervising partner's drafts folder.

The skill produces three artifacts inside one draft: an objections list (categorical labels mapped from a memory-rule vocabulary, citation-free), a responsive-document list (every entry sourced to a specific `StoredDocument.id`), and a privilege log skeleton (per-document metadata, privilege-claim type as TBD). The substantive answer to each interrogatory, the privilege-claim characterization, the admit-or-deny language for each request for admission, and any case-strategy framing render as TBD markers for the partner to author. The skill never sends - per ADR 0005 the partner is the sender.

## Files

- `SKILL.md` - the skill contract (frontmatter + body)
- `references/voice.md` - partner-corpus voice rules (Layer 2 match)
- `references/output-format.md` - section order and templates for the draft and the matter-internal sourcing note
- `references/categorization-rubric.md` - matter-readiness axes; refusal criteria; objection-vocabulary memory-rule contract
- `references/citation-policy.md` - law-firm vertical invariant #6 (no citations in skill-authored prose, ever); verbatim-quote carve-out for the incoming request
- `references/fabrication-policy.md` - platform invariant #8; per-section sourcing contract; the four `none`-tagged TBD sections
- `references/test-cases.md` - what the three fixtures exercise
- `fixtures/01-interrogatories-matter.{yaml,md}` - standard interrogatories filing, complete draft
- `fixtures/02-requests-for-production-matter.{yaml,md}` - RFPs filing with responsive-document mapping and privilege log skeleton
- `fixtures/03-requests-for-admission-matter.{yaml,md}` - RFAs filing with per-request admit-or-deny TBD markers

## Scope alignment

The law-firm PRD §6.2 places discovery work in Pillar 5 (Discovery + investigation) with medium third-rail risk. This skill implements the factually-narrow subset: parsing the incoming request, mapping each numbered item to a categorical objection from a memory-rule vocabulary, listing responsive documents from the matter folder, and building the privilege-log skeleton. The legal-judgment sections (substantive answer, privilege-claim characterization, admit-or-deny, case-strategy) are TBD by architecture.

See `SKILL.md` § "Scope alignment with law-firm-prd §6.2 and §5" for the full reconciliation. If Captain decides this scope creeps too close to substantive-answer authoring, the fix is configuration: narrow the objection list to a pure category-label table (no draft objection sentence), narrow the responsive-document mapping to a flat index, or hold the skill for Phase 3.

## Trust ceiling

`draft_for_review`, locked. Per platform PRD §11.2 the ceiling is architecturally non-promotable for any skill touching court filings, privilege claims, or the evidentiary record. Once served on opposing counsel, a discovery response is part of the case record; promotion to `autonomous` is blocked.

## Capability bindings

- `PracticeManagement` - read-only (`get_matter`)
- `DocumentStorage` - read-only (`list_folder`, `download_document`); optional `upload_document` only on the explicit `--stage-request` path
- `Email` - `create_draft` only (no send method exists per ADR 0005)
