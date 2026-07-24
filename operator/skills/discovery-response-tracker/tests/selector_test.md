# Selector Test - discovery-response-tracker

Blind cross-skill selector simulation: does Hermes pick this skill for a discovery
**response-deadline** task (either direction), and NOT for its near-neighbors?

## Synthetic queries

> (inbound) "Interrogatories were just served on the Reyes matter - what's our response
> deadline and get it confirmed for the calendar."

> (outbound) "Track the response deadline on the discovery we served in Ruiz, and tell me
> when they're late so we can meet and confer."

## Expected selection

`discovery-response-tracker` - both queries are about a **discovery response deadline**:
inbound (the deadline to respond to what was served on us, presented for attorney confirm)
and outbound (the opposing side's deadline on discovery we propounded, watched to flag the
meet-and-confer / compel point). The `direction` param selects the mode; both are this
skill.

## Boundary (should NOT select this skill)

- "A served-discovery document just came in - what type is it and read the proof of
  service." → `discovery-served-watch` (spot + classify the served doc and read the
  service date/method; it hands the capture to this skill, which presents the deadline).
- "Start the client verification for the Reyes interrogatory responses and stay on the
  client until it's signed." → `client-verification-tracker` (the client's verification
  **signature** on our responses, not the response **deadline**).
- "Draft the meet-and-confer letter on the opposing side's thin responses." →
  `meet-and-confer-drafter` (writes the letter and owns the compel-window citation; this
  skill only flags the decision point and hands off).
- "Assemble the separate statement for the motion to compel." →
  `separate-statement-assembler`.
- "Stage the served requests into the matter folder for BriefPoint to draft from." →
  `discovery-response-staging`.

## Near-neighbor risk and the distinguisher

The two nearest neighbors are `discovery-served-watch` (both touch a served doc and the
proof of service) and `meet-and-confer-drafter` (both touch the late/thin-response point).
The distinguisher: `discovery-served-watch` **captures and classifies** the served doc and
hands off; this skill turns that capture into a **response deadline presented for confirm**
and watches the mirror deadline outbound. `meet-and-confer-drafter` **writes the letter**;
this skill **flags the decision** and never drafts or sends it.

This skill also absorbs two former identities that both route here via `direction`: the
inbound response-deadline clock (formerly `discovery-response-clock`) and the outbound
propounded-discovery tracker (formerly `propounded-discovery-tracker`). A query for either
should land on `discovery-response-tracker`.

## Result

Pass - verified 2026-07-01 via a blind cross-skill selector simulation. The
response-deadline framing (both directions) distinguishes it from the served-doc capture
skill and the meet-and-confer drafter; the `direction` param resolves inbound vs. outbound
without a misroute on the boundary queries.
