# Selector Test - matter-initiation-setup

Blind cross-skill selector simulation: does Hermes pick this skill for a new-matter
setup task, and NOT for its near-neighbors?

## Synthetic query

> "We just opened the Reyes auto case - set up the matter: create the standard folders and opening tasks, and get the statute of limitations and the service deadline for each defendant on the radar."

## Expected selection

`matter-initiation-setup` - the query is about **setting a newly opened matter up**:
building the firm's standard folder structure and opening tasks, and scaffolding the two
initiation deadlines (SOL + per-defendant service) as items to confirm. That whole
day-one setup is this skill's sole job. It computes no date and drafts no work product.

## Boundary (should NOT select this skill)

- "A served RFP set just landed in the Reyes matter - classify it and read the service
  date off the proof of service." → `discovery-served-watch` (spot-and-classify an
  incoming served discovery doc, not case initiation).
- "What's the deadline to respond to the interrogatories served on Reyes?" →
  `discovery-response-tracker` (a discovery response deadline, not the SOL / service-of-
  summons setup).
- "Track the authored deadlines and the SOL on the Reyes matter and chase them." →
  `deadline-and-sol-tracker` (tracks and chases dates a human already entered; this
  skill scaffolds the initiation items at opening and computes nothing).
- "Put the served RFP set and our prior responses into the drafting folder so BriefPoint
  can draft." → `discovery-response-staging` (stages drafting-engine inputs into a
  matter folder; a different write, not the initiation setup).
- "Confirm each defendant was served and the proof of service came back." →
  `service-confirmation-watcher` (watches for service to be completed and the POS to
  land; this skill only scaffolds the service item at opening).
- "Run intake on the new Reyes lead - dedupe the contact and check conflicts." →
  `new-matter-intake` (lead intake / conflict check, upstream of setup).

The near-neighbor risk is `deadline-and-sol-tracker` (both touch the SOL) and
`new-matter-intake` (both fire around a new matter). The distinguisher: this skill runs
**once at matter opening** to build the standard structure and scaffold the initiation
deadlines **to confirm**; the SOL tracker chases dates a human already set, and intake is
the upstream lead/conflict step before the matter exists.

## Result

Pass - verified 2026-07-01 via a blind cross-skill selector simulation. The
set-up-a-newly-opened-matter framing (standard folders + opening tasks + scaffold SOL and
per-defendant service to confirm) distinguishes it from the deadline tracker (which
chases already-set dates) and from intake (the upstream lead step); no misroute observed
on the boundary queries.
