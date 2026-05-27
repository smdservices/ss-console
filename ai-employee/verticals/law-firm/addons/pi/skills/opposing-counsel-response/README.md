# law-pi-opposing-counsel-response

Opposing-counsel-correspondence response-draft assembler for personal-injury law firms. Reads one inbound piece of opposing-counsel correspondence (a settlement counter-offer, a motion-related letter or proposed order, or a scheduling-related letter or proposed stipulation) and writes a factual response draft into the supervising partner's drafts folder.

The skill produces three artifacts inside one draft: an inbound-claim recital (every factual claim from the inbound message quoted verbatim with sentence-level pointers back to the source), a prior-correspondence record (a chronological table of every prior message on the relevant thread sourced from EmailThread message IDs), and a tone-classification label (a single label from the firm's memory-rule vocabulary). The substantive response to the inbound offer, motion, or scheduling proposal, any legal-argument framing, and any case-strategy language render as TBD markers for the partner to author. The skill never sends, per ADR 0005 the partner is the sender. The skill never authors a settlement number, a counter-counter, an acceptance, or a rejection, per the law-firm-prd §5 third-rail map.

## Files

- `SKILL.md` the skill contract (frontmatter + body)
- `references/voice.md` partner-corpus voice rules (Layer 2 match)
- `references/output-format.md` section order and templates for the draft and the matter-internal sourcing note
- `references/categorization-rubric.md` matter-readiness axes; refusal criteria; tone-classification memory-rule contract; correspondence-kind detection rubric
- `references/correspondence-kind-detection.md` heuristics for classifying the inbound as settlement counter-offer, motion correspondence, or scheduling correspondence
- `references/citation-policy.md` law-firm vertical invariant #6 (no citations in skill-authored prose); verbatim-quote carve-out for inbound correspondence
- `references/fabrication-policy.md` platform invariant #8; per-section sourcing contract; the four `none`-tagged TBD sections; the dollar-amount and commitment-phrase markers
- `references/test-cases.md` what the three fixtures exercise
- `fixtures/01-settlement-counter-offer-matter.{yaml,md}` inbound settlement counter-offer, complete draft with verbatim recital and prior settlement-history table
- `fixtures/02-motion-correspondence-matter.{yaml,md}` inbound motion-related letter with proposed order, draft with verbatim recital and prior motion-correspondence table
- `fixtures/03-scheduling-negotiation-matter.{yaml,md}` inbound scheduling proposal with proposed stipulation, draft with verbatim recital and prior scheduling-history table

## Scope alignment

The law-firm PRD §6.2 spans opposing-counsel correspondence across Pillar 5 (Discovery + investigation), Pillar 6 (Motion practice + court filings), and Pillar 7 (Settlement + resolution). This skill implements the factually-narrow subset: identifying the inbound's correspondence kind, reciting the inbound's verbatim factual claims, assembling the prior-correspondence record from the EmailThread system of record, and tagging the inbound's tone classification from a memory-rule vocabulary. The legal-judgment sections (substantive response to offer/motion/scheduling proposal, legal-argument framing, case-strategy language) are TBD by architecture.

See `SKILL.md` § "Scope alignment with law-firm-prd §6.2 and §5" for the full reconciliation. If Captain decides this scope creeps too close to settlement-authority authoring, motion-argument authoring, or scheduling-commitment authoring, the fix is configuration: narrow the inbound-claim recital to a flat-quote block (no skill-authored framing prose), narrow the prior-correspondence record to a chronological index with no captioning, or hold the skill for Phase 3.

## Trust ceiling

`draft_for_review`, locked. Per platform PRD §11.2 the ceiling is architecturally non-promotable for any skill touching settlement authority, court filings, or the evidentiary record. Opposing-counsel correspondence on a PI matter routinely touches all three. Promotion to `autonomous` is blocked.

## Capability bindings

- `PracticeManagement` read-only (`get_matter`)
- `EmailThread` read-only (`list_messages_for_matter`, `get_message`)
- `Email` `create_draft` only (no send method exists per ADR 0005)
