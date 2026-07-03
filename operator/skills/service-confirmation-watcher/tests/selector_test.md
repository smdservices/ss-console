# Selector Test — service-confirmation-watcher

Blind cross-skill selector simulation: does Hermes pick this skill when a service
confirmation comes back and the responsive-pleading clock should start, and NOT for its
near-neighbors?

## Synthetic query

> "The proof of service came back on the Reyes matter — did the defendant get served, and start the response clock."

## Expected selection

`service-confirmation-watcher` — the query is about a **service confirmation** (proof of
service of summons) landing on a matter and starting the **responsive-pleading clock**:
capture the served date off the confirmation and surface the responsive-pleading
deadline for confirm. That detection-and-capture step is this skill's sole job.

## Boundary (should NOT select this skill)

- "A set of interrogatories was just served on Reyes — classify it and capture the
  service date." → `discovery-served-watch` (a **discovery** document served on the
  firm's client, captured for the discovery-response clock; this skill is the **summons
  / complaint** service confirmation that starts the **defendant's responsive-pleading**
  clock).
- "What's the deadline to respond to the interrogatories served on Reyes, and chase the
  late responses?" → `discovery-response-tracker` (the discovery response deadline, not
  the responsive-pleading clock).
- "Set up the new Reyes matter — open it, add the parties, and stage the intake." →
  `matter-initiation-setup` (the sibling case-initiation skill that stands the matter
  up; this skill fires later, when the service confirmation returns).
- "Start the client verification for the Reyes interrogatory responses." →
  `client-verification-tracker` (a verification-signature chase).
- "Log who changed the Reyes matter." → `matter-memo-on-update`.

The near-neighbor risk is `discovery-served-watch` (both read a proof of service and
capture a served date, both fail-closed, both surface a deadline input for confirm). The
distinguisher: `discovery-served-watch` fires on a **discovery** document served on the
firm's client and feeds the **discovery-response** clock; this skill fires on the
**summons / complaint** service confirmation (synced in from InfoTrack) and feeds the
**defendant's responsive-pleading** clock, keyed per defendant. Different document,
different clock, different party. The other neighbor is `matter-initiation-setup` (same
case-initiation phase): it opens the matter; this skill acts on the confirmation that
comes back after service.

## Result

Pending first blind cross-skill selector simulation on the assembled pack. The
summons-service-confirmation + responsive-pleading-clock framing is what distinguishes it
from the discovery-served capture and the matter-setup skill; the boundary queries above
route to their owners with no observed misroute in authoring review. Re-run and record
the verified date when the pack's selector suite is executed.
