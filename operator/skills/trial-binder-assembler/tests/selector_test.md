# Selector Test - trial-binder-assembler

Blind cross-skill selector simulation: does Hermes pick this skill for a
trial-binder assembly task, and NOT for its near-neighbors?

## Synthetic query

> "Reyes is set for trial next month - assemble the trial binder from our exhibit list, witness list, and deposition summaries, and track the pre-trial deadlines."

## Expected selection

`trial-binder-assembler` - the query asks to **collate the authored trial components
(exhibit list, witness list, deposition summaries) into an ordered binder index and
track the trial-prep deadlines**, staged for the attorney. That mechanical assembly
plus deadline capture is this skill's sole job.

## Boundary (should NOT select this skill)

- "Assemble the separate statement for the motion to compel further on the Reyes RFP
  set." → `separate-statement-assembler` (the CRC 3.1345 request-next-to-response
  table; a discovery-motion collation, not the trial binder).
- "Assemble and stage the motion-to-compel package to the department's format." →
  `motion-package-assembler` (packages a motion, notice, points-and-authorities,
  exhibits; not the trial binder).
- "Draft the trial brief / the motions in limine for Reyes." → not this skill and not
  any assembler - that is attorney work product; the assembler never authors it.
- "What's the discovery cutoff before the Reyes trial?" → `discovery-response-tracker`
  / the deadline lane (the deadline clock itself; this skill captures and surfaces
  trial-prep dates but does not own the authoritative computation).
- "Assemble the minor's compromise packet for the Reyes minor plaintiff." →
  `minors-compromise-packet` (the MC-350/MC-351 packet, a different assembly).

## The distinguisher

The near-neighbor risk is the other assemblers (`separate-statement-assembler`,
`motion-package-assembler`, `minors-compromise-packet`) - all collate authored
components into a required structure. The line: this skill produces the **trial binder
specifically** (exhibit list + witness list + deposition summaries + exhibits,
ordered, with the Bates/PDF step routed to the firm's PDF tool) and captures the
**trial-prep/pre-trial-filing deadlines**. It authors **no** substance: not the trial
brief, not a motion in limine, not a deposition summary, and it never decides which
exhibits or witnesses go in. If a query asks to write the brief or argue an exhibit,
that is work product this skill never produces. If a query asks for a Bates-stamped
merged PDF, that step is routed to the firm's PDF tool, not performed by the skill.

## Result

Pass - verified 2026-07-01 via a blind cross-skill selector simulation. The "trial
binder / exhibit + witness + deposition-summary collation / trial-prep deadlines"
framing distinguishes it from the discovery-motion assemblers and the minor's
compromise packet, and the no-authoring line keeps it clear of trial-brief drafting;
no misroute observed on the boundary queries.
