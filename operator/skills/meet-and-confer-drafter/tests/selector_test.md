# Selector Test — meet-and-confer-drafter

Blind cross-skill selector simulation: does Hermes pick this skill for a
meet-and-confer drafting task, and NOT for its near-neighbors?

## Synthetic query

> "The other side's interrogatory responses on Reyes are thin — draft the meet-and-confer letter and tell me the window to move to compel."

## Expected selection

`meet-and-confer-drafter` — the query asks to **draft the meet-and-confer letter**
about opposing responses and to **note the compel-further window**, which is this
skill's sole job. The letter is drafted for review and the go/no-go is put to the
attorney; nothing is sent.

## Boundary (should NOT select this skill)

- "Look at the opposing responses and tell me which ones are deficient." →
  `opposing-response-deficiency-review` (surfaces possible gaps for the attorney to
  weigh; this skill drafts from deficiencies the attorney has already flagged, it does
  not identify them).
- "Assemble the separate statement for the motion to compel." →
  `separate-statement-assembler` (the CRC 3.1345 item-by-item table for the motion,
  not the meet-and-confer letter).
- "What's the deadline to respond to the interrogatories served on us?" →
  `discovery-response-tracker` (the responding party's response deadline, not the
  compel-further window on the other side's responses).
- "Start the client verification for the Reyes responses and chase it until signed." →
  `client-verification-tracker` (the client's verification signature, not a
  meet-and-confer).
- "Track the deadlines on the discovery we served and chase late responses." →
  `discovery-response-tracker` (outbound direction: track/chase our propounded
  discovery; this skill is the drafting step once the attorney flags deficiencies).

The near-neighbor risk is `opposing-response-deficiency-review` (both touch opposing
responses) and `separate-statement-assembler` (both are compel-adjacent discovery
artifacts). The distinguisher: this skill **drafts the meet-and-confer letter** from
attorney-flagged deficiencies and **notes the compel window**; the deficiency-review
skill _identifies_ possible gaps (upstream), and the separate-statement assembler
builds the motion's _table_ (downstream). This skill neither identifies deficiencies
nor argues the motion.

## Result

Pass — verified 2026-07-01 via a blind cross-skill selector simulation. The
"draft the meet-and-confer letter + note the compel window" framing distinguishes it
from the upstream deficiency-review assist and the downstream separate-statement
assembler; no misroute observed on the boundary queries.
