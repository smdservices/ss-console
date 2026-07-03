# Selector Test - discovery-response-staging

Blind cross-skill selector simulation: does Hermes pick this skill for a staging /
routing task, and NOT for its near-neighbors?

## Synthetic query

> "Put the served RFP set and our prior verified responses into the matter folder so BriefPoint can draft the response, and route the draft to the attorney when it comes back."

## Expected selection

`discovery-response-staging` - the query is about **staging the drafting engine's
inputs into the matter folder and routing its output back to the attorney**, which is
this skill's sole job. It never drafts the response itself.

## Boundary (should NOT select this skill)

- "Start the client verification for the Reyes interrogatory responses and chase it
  until it's signed." → `client-verification-tracker` (the party's verification
  signature chase, not staging the drafting inputs).
- "What's the deadline to respond to the RFPs served on Reyes?" →
  `discovery-response-tracker` (the response deadline itself, not staging).
- "Assemble the separate statement for the motion to compel." →
  `separate-statement-assembler` (collates request/response/grounds into the CRC 3.1345
  table; a different mechanical artifact, not folder staging).
- "Draft the meet-and-confer letter on the opposing side's thin responses." →
  `meet-and-confer-drafter` (drafts a connective letter; this skill drafts nothing).
- "A served RFP set just landed in the matter - classify it and read the service
  date." → `discovery-served-watch` (spot-and-classify the served doc, not staging
  drafting inputs).

The near-neighbor risk is `separate-statement-assembler` (both move discovery
request/response documents) and `discovery-served-watch` (both touch a served request
in the matter). The distinguisher: this skill **stages the drafting engine's inputs
into the folder it draws from and routes the returned draft**; it authors no artifact
and computes no deadline. The assembler builds the CRC 3.1345 table; the watch skill
classifies the incoming served doc.

## Result

Pass - verified 2026-07-01 via a blind cross-skill selector simulation. The
stage-inputs-and-route-output framing distinguishes it from the assembler (which
collates a table) and the served-watch (which classifies an incoming doc); no misroute
observed on the boundary queries.
