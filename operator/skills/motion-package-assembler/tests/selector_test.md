# Selector Test - motion-package-assembler

Blind cross-skill selector simulation: does Hermes pick this skill for a motion-package
assembly-and-staging task, and NOT for its near-neighbors?

## Synthetic query

> "The motion to compel further on Vega is drafted. Package it up in the department's filing order, put the hearing I reserved on the calendar, and remind me to check the tentative ruling before the hearing."

## Expected selection

`motion-package-assembler` - the query asks to **gather the already-drafted components
into the filing order, stage the reserved hearing, and set the tentative-ruling
reminder**, staged for the attorney. That assemble-format-stage-watch mechanic is this
skill's sole job.

## Boundary (should NOT select this skill)

- "Assemble the separate statement for the motion to compel." →
  `separate-statement-assembler` (produces the CRC 3.1345 request-next-to-response table,
  which is **one component** this package skill gathers; it does not build that table).
- "Draft the points and authorities for the motion." → a drafting tool, **not this skill**.
  This skill never drafts a motion component; a missing draft is a gap it surfaces.
- "Draft the meet-and-confer letter on their thin responses." →
  `meet-and-confer-drafter` (drafts the connective letter, not a motion package).
- "Review the opposing side's responses and tell me which are deficient." →
  `opposing-response-deficiency-review` (a legal-judgment assist; this skill packages, it
  never judges).
- "What's the deadline to file the moving papers before the hearing?" →
  `discovery-response-tracker` / the deadline lane (the filing clock under rule 3.1300, not
  the package; this skill records the hearing date, it does not compute the deadline).
- "Start the client verification on the Vega responses." →
  `client-verification-tracker` (a verification-signature chase, not an assembly).

## The distinguisher

The near-neighbor risk is `separate-statement-assembler` (both are assemblers in the
motions lane) and the drafting tool (both touch motion papers). The line: this skill
**packages the whole motion** - gathers the notice, points and authorities, declarations,
the separate statement, the proposed order, and the proof of service into the filing
order, stages the attorney-reserved hearing, and schedules the tentative-ruling check. It
**authors nothing** (drafting is the drafting tool's; the separate-statement table is the
sibling assembler's). If a query asks to **draft** a component, or to build the CRC 3.1345
**separate statement specifically**, that is not this skill.

## Result

Pass - verified 2026-07-01 via a blind cross-skill selector simulation. The
"package / filing order / stage the hearing / tentative-ruling reminder" framing
distinguishes it from the separate-statement assembler (which builds one component) and
the drafting tool (which authors the papers); no misroute observed on the boundary
queries.
