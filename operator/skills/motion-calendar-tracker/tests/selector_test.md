# Selector Test - motion-calendar-tracker

Blind cross-skill selector simulation: does Hermes pick this skill for a
motion-calendar tracking task, and NOT for its near-neighbors?

## Synthetic query

> "Show me where the motions stand on Reyes - what's filed, what's due, and the hearing dates."

## Expected selection

`motion-calendar-tracker` - the query asks for the **organized, current picture** of
a matter's motions (filed / due / hearings) read from the record, which is this
skill's sole job. It surfaces; it does not compute a deadline, draft, or decide.

## Boundary (should NOT select this skill)

- "What's the deadline to oppose the motion to compel, and calendar it." →
  the deadline lane (`deadline-and-sol-tracker`) - computing and calendaring a filing
  deadline is a legal determination this skill hands off, never makes.
- "Draft the opposition to the motion to compel." → the motions drafting/assembly
  skill (e.g. `separate-statement-assembler` for the MTC separate statement) - this
  skill never drafts or files.
- "What's the overall status of the Reyes matter?" → `matter-status-responder` /
  `matter-status-digest` (whole-matter status, not the motion calendar specifically).
- "Chase the client's verification on the RFP responses." →
  `client-verification-tracker` (a signature chase, not a motion calendar).
- "Did the judge grant the motion to compel?" → not this skill's call - it surfaces
  "hearing was set for <date>; no minute order or disposition in the record - confirm
  whether held/continued/vacated" and hands the outcome question to a human; it never
  asserts the ruling or that the hearing was held.

## Near-neighbor risk

The sharp neighbor is the **deadline lane**: both touch motion dates. The
distinguisher is direction of authority - the deadline lane **computes and calendars**
a filing deadline (a legal determination); this skill only **reads and organizes**
what is already in the record and **surfaces the anchor + gap** for un-calendared
windows, never the computed date. The second neighbor is the **motions drafter**: it
produces the filing; this skill never drafts or files, it only tracks.

## Result

Pass - verified 2026-07-01 via a blind cross-skill selector simulation. The
surface-only, read-and-organize framing distinguishes it from the deadline lane (which
computes/calendars) and the motions drafter (which produces the filing); no misroute
observed on the boundary queries. The outcome-question boundary ("did it get granted")
correctly routes away, since this skill never asserts a hearing outcome.
