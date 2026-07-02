# Selector Test — minors-compromise-packet

Blind cross-skill selector simulation: does Hermes pick this skill for a minor's
compromise packet task, and NOT for its near-neighbors?

## Synthetic query

> "The Nguyen matter is settling and the plaintiff is a minor. Put together the minor's compromise petition packet from our settlement numbers so the attorney can finalize it, and track the hearing."

## Expected selection

`minors-compromise-packet` — the query is about assembling the **minor's compromise
petition packet** (the MC-350 / MC-351 forms) from authored settlement figures and
tracking the GAL/hearing, which is this skill's sole job.

## Boundary (should NOT select this skill)

- "Assemble the separate statement for the motion to compel on Nguyen." →
  `separate-statement-assembler` (a CRC 3.1345 discovery statement, not a compromise
  petition).
- "Assemble the motion package for the Nguyen MSJ opposition." →
  `motion-package-assembler` (a motion package, not the compromise petition).
- "Prepare the client's settlement statement / disbursement sheet." →
  `settlement-statement-feeder` (the disbursement figures Smokeball computes, not the
  court-approval petition).
- "Chase the lienholder for the current payoff on Nguyen." → `lien-ledger-tracker`
  (a standalone lien chase, not the compromise packet). This skill drafts a lien chase
  only as the leg that feeds the petition's disclosure.
- "What's the deadline on the Nguyen matter?" → `deadline-and-sol-tracker`.
- "Start the client verification for the Nguyen interrogatory responses." →
  `client-verification-tracker`.

The near-neighbor risk is the other **assemblers** (`separate-statement-assembler`,
`motion-package-assembler`, `settlement-statement-feeder`) and the **lien chase**
(`lien-ledger-tracker`). The distinguisher: this skill assembles the **court-approval
petition for a minor's settlement** (MC-350 / MC-351), keyed to a minor plaintiff and
a compromise hearing. The separate-statement and motion-package assemblers build
litigation documents; the settlement-statement feeder produces the disbursement math
(which this skill never computes); the lien tracker is a standalone chase.

## Result

Pass — verified 2026-07-01 via a blind cross-skill selector simulation. The
minor's-compromise-petition framing (MC-350 / MC-351, GAL as petitioner, compromise
hearing) distinguishes it from the litigation-document assemblers, the disbursement
feeder, and the standalone lien chase; no misroute observed on the boundary queries.
