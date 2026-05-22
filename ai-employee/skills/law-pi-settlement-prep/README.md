# law-pi-settlement-prep

Settlement-conference partner-prep memo assembler for personal-injury law firms. Reads an active PI matter at the pre-settlement-conference stage and writes a factual internal prep memo into the supervising partner's drafts folder.

The memo is INTERNAL. The recipient is the partner's own mailbox, not opposing counsel, not the mediator, not the client. The skill assembles the matter-facts summary, chronology, damages tabulation, strengths fact list, weaknesses fact list, comparable-verdict table (sourced from the firm's memory-rule corpus), and opposing-counsel and carrier prior-pattern tables. The skill never authors the settlement bracket recommendation, the recommended posture, or the legal-argument framing of strengths and weaknesses; those sections render as TBD markers for the partner to author. Per ADR 0005 the partner is the sender (and here also the recipient). The skill never sends.

## Files

- `SKILL.md` - the skill contract (frontmatter + body)
- `references/voice.md` - partner internal-memo voice rules (Layer 2 match against the internal-prep-memo and case-strategy-memo register)
- `references/output-format.md` - section order and templates for the memo and the matter-internal sourcing note
- `references/categorization-rubric.md` - matter-readiness axes; refusal criteria; comparable-verdict corpus readiness gate; conference-date gate
- `references/citation-policy.md` - law-firm vertical invariant #6 (no citations in skill-authored prose); verbatim-quote carve-out for comparable-verdict rows
- `references/fabrication-policy.md` - platform invariant #8; per-section sourcing contract; the five `none`-tagged TBD sections (bracket, posture, strengths-prose, weaknesses-prose, closing strategy)
- `references/test-cases.md` - what the two fixtures exercise
- `fixtures/01-soft-tissue-clear-liability-matter.{yaml,md}` - low-severity soft-tissue matter with clear liability and conference scheduled
- `fixtures/02-disc-herniation-contested-liability-matter.{yaml,md}` - higher-severity fracture-and-disc matter with contested liability and conference scheduled

## Scope alignment

The law-firm PRD §5 third-rail map names "settlement-value analysis" as work the agent must never do. The PRD §6.2 places settlement and resolution work in Pillar 7. This skill operationalizes the pre-conference assembly that sits at the seam of the pillar without crossing into the judgment-bearing core: the skill produces the assembled facts and the partner's own comparable-verdict corpus; the partner produces the bracket, the posture, and the legal-argument framing.

See `SKILL.md` § "Scope alignment with law-firm-prd §5 and §6.2" for the full reconciliation. If Captain decides the bracket-recommendation TBD section creates room for valuation drift, the fix is configuration: strip the section from the template so the partner authors that thinking in a separate document.

## Trust ceiling

`draft_for_review`, locked. Per platform PRD §11.2 the ceiling is architecturally non-promotable for any skill that informs settlement-authority decisions. Promotion to `autonomous` is blocked.

## Capability bindings

- `PracticeManagement` - read-only (`get_matter`)
- `DocumentStorage` - read-only (`list_folder`, `download_document`)
- `Email` - `create_draft` only (no send method exists per ADR 0005); the memo is internal so the partner is the recipient, but `Email.create_draft` remains the only outbound surface

## Voice envelope

The internal-memo voice envelope differs from the external-correspondence envelope used by sibling skills (`law-pi-demand-letter-draft`, `law-pi-discovery-response`). Internal memos are dense, plain, partner-to-self prose. The Layer 2 anchor corpus for this skill should include the partner's prior internal prep memos and case-strategy memoranda; external-correspondence samples are weaker anchors for this register. The skill emits a warning rather than refusing when fewer than five Layer 2 samples are tagged `internal_prep_memo` or `case_strategy_memo`, because the internal-memo register is lower-risk than external correspondence (the audience is the partner).
