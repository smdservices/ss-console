# Selector Test — client-verification-tracker

Blind cross-skill selector simulation: does Hermes pick this skill for a
verification task, and NOT for its near-neighbors?

## Synthetic query

> "Start the client verification for the Reyes interrogatory responses and stay on the client until it's signed."

## Expected selection

`client-verification-tracker` — the query is about preparing/tracking/chasing a
**client's discovery-response verification** signature, which is this skill's sole
job.

## Boundary (should NOT select this skill)

- "What's the status of the Reyes matter?" → `matter-status-responder` (status
  read, not a verification chase).
- "Chase the engagement letter signature on the new Ruiz matter." →
  `engagement-letter-chaser` (engagement/retainer signature, not a discovery
  verification).
- "What's the deadline to respond to the interrogatories served on Reyes?" →
  `discovery-response-tracker` (the response deadline itself, not the verification
  signature).
- "Draft the meet-and-confer on the opposing side's thin responses." →
  `meet-and-confer-drafter`.
- "Assemble the separate statement for the motion to compel." →
  `separate-statement-assembler`.

The near-neighbor risk is `engagement-letter-chaser` (both are signature chases) and
`discovery-response-tracker` (both touch discovery deadlines). The distinguisher: this
skill chases a **client's verification of discovery responses**, keyed to a
response-set; the engagement chaser is a retainer signature; the response-tracker is
the response deadline, not the signature.

## Result

Pass — verified 2026-07-01 via a blind cross-skill selector simulation. The
verification-signature framing distinguishes it from the engagement-signature chaser
and the response-deadline tracker; no misroute observed on the boundary queries.
