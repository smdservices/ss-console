# Calibration packet 2026-05-19 (Phase C skills 1-3)

**Plan ref:** `~/.claude/plans/melodic-orbiting-barto.md` Phase C, Session 1 Step 7.
**Purpose:** evidence base for Captain's async rubric-boundary review before Session 2.
**Skills covered:** intake-triage, law-conflict-check, law-client-status-update.
**Not yet covered:** law-attorney-inbox-triage, law-signing-page-chase, law-time-entry-reconciliation, law-client-document-collection, law-red-flag-watching (Session 2 authoring; will produce calibration packet 2 after that authoring).

## How to read this packet

Each section walks through 5 simulated outputs of one skill against 5 fixtures. The outputs are simulated, not real. The skills have not been deployed to Hermes yet (Plan Step 4 hermes-demo-law provisioning is the gate). The simulations apply the SKILL.md anatomy (description, behavior spec, voice rules, output-format spec, categorization rubric, citation policy) deterministically to fixture content.

Each sample includes:

- Input description (1 line; fixture content not quoted to avoid moving adversarial payloads into this file)
- Simulated skill output (full, in the exact shape the skill's output-format.md specifies)
- Rubric checks against `ai-employee/grading/rubric.md`
- Proposed grade (autonomous / autonomous-with-flag / draft_for_review / draft_for_review_with_revisions / partner-review-required / fails, exact options depend on skill type)
- Boundary annotation (1-2 sentences naming what places this output on the borderline)

Then each section closes with:

- Proposed rubric boundary (3-5 paragraphs anchored to the 5 samples, naming where the boundary should sit and why)
- Open questions for Captain (rubric ambiguities the samples surfaced)

## What Captain decides from this packet

Three things:

1. **Where the boundary sits per skill.** For each of the three skills, is the proposed rubric boundary in the right place? Adjust inline in `ai-employee/grading/rubric.md` or send back with specific revisions.
2. **How the open questions resolve.** Each section closes with the rubric ambiguities the samples surfaced. Decide each one. The decisions calibrate Session 2's authoring of skills 4-8.
3. **Whether to proceed.** Once boundaries and open questions are settled, signal "rubric adjusted, proceed" via any channel and Session 2 starts.

## Sections

- [intake-triage](calibration-packets/2026-05-19/intake-triage.md), 425 lines
- [law-conflict-check](calibration-packets/2026-05-19/law-conflict-check.md), 356 lines
- [law-client-status-update](calibration-packets/2026-05-19/law-client-status-update.md), 425 lines

Total: 1,206 lines across 15 sample outputs (5 per skill × 3 skills).

## Skills not yet calibrated (Session 2 deliverables)

Five remaining law-vertical skills will be authored in Session 2 and a second calibration packet will follow. Captain's rubric-boundary decisions on this packet propagate to those five.

## Methodology notes

- The simulations honor each skill's authored trust ceiling. `intake-triage` and `law-client-status-update` are `draft_for_review`; `law-conflict-check` is `autonomous` (read-only). Proposed grades reflect those ceilings.
- The simulations honor the citation-refusal substrate (invariant #6) by NOT including any case names, statute references, or court rule references in any sample output. Where a fixture asks for citations, the simulated output shows the standard refusal language.
- Adversarial fixture content (injection payloads, hostile language verbatim) is referenced by fixture ID only, never quoted into this packet. The simulated outputs DEMONSTRATE the correct refusal/flagging behavior; the adversarial payloads themselves stay in the fixture files.
- The `[SYNTHETIC FIXTURE - NOT A REAL MATTER]` watermark appears on every simulated output that references fixture content, matching the fixtures' own watermarking pattern.
