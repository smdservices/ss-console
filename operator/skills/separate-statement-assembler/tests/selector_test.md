# Selector Test — separate-statement-assembler

Blind cross-skill selector simulation: does Hermes pick this skill for a
separate-statement assembly task, and NOT for its near-neighbors?

## Synthetic query

> "Assemble the separate statement for the motion to compel further responses on the Vega RFP set — pair each demand with its response, ready for the attorney."

## Expected selection

`separate-statement-assembler` — the query asks to **collate each discovery request
next to its response into the CRC 3.1345 item-by-item statement**, staged for the
attorney. That mechanical assembly is this skill's sole job.

## Boundary (should NOT select this skill)

- "Review the opposing side's responses and tell me which ones are deficient." →
  `opposing-response-deficiency-review` (surfaces possible gaps as a legal-judgment
  assist; this assembler quotes and collates, it never judges deficiency).
- "Draft the meet-and-confer letter on their thin responses." →
  `meet-and-confer-drafter` (drafts the connective letter; not the separate-statement
  table).
- "Assemble and stage the whole motion-to-compel package to the department's format." →
  `motion-package-assembler` (packages the motion, notice, points-and-authorities,
  exhibits; the separate statement is one component this skill produces).
- "What's the deadline to move to compel on the Vega responses?" →
  `discovery-response-tracker` (the deadline/clock, not the statement).
- "Start the client verification on the Vega responses." →
  `client-verification-tracker` (a verification-signature chase, not an assembly).

## The distinguisher

The near-neighbor risk is `opposing-response-deficiency-review` (both touch
requests-and-responses in a compel context) and `motion-package-assembler` (both are
assemblers in the motions lane). The line: this skill produces the **CRC 3.1345
separate statement specifically** — a mechanical request-next-to-response table with
the reasons-to-compel cell left blank for the attorney. It authors **no** legal
judgment (that is the deficiency-review assist) and it is **not** the full motion
package (that is the motion-package-assembler). If a query asks for the _reasons_ a
further response should be compelled, that is argument this skill never writes.

## Result

Pass — verified 2026-07-01 via a blind cross-skill selector simulation. The
"separate statement / CRC 3.1345 / pair each request with its response" framing
distinguishes it from the deficiency-review assist (which judges) and the
motion-package assembler (which packages the whole motion); no misroute observed on
the boundary queries.
