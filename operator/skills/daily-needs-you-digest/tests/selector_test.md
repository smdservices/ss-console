# Selector Test — daily-needs-you-digest

Blind cross-skill selector simulation: does Hermes pick this skill for a "what needs me
across everything" batched-surface task, and NOT for its near-neighbors?

## Synthetic query

> "Give me the one summary of what actually needs me today across all my open matters."

## Expected selection

`daily-needs-you-digest` — the query asks for a single batched surface of the few items
that genuinely need a person now (due soon, unsigned, deadline near, stalled) across the
whole book, which is this skill's sole job. It reads and points; it takes no action.

## Boundary (should NOT select this skill)

- "Give me the state of the practice this week — every matter by stage, upcoming dates,
  quiet matters, low trust." → `matter-status-digest` (the full state-of-the-practice
  view, not the narrow "what needs a person now" action cut).
- "What's the status of the Reyes matter?" → `matter-status-responder` (one matter's
  status, not a firm-wide needs-a-person roll-up).
- "Chase the client verification on Reyes until it's signed." →
  `client-verification-tracker` (it **acts** — chases and tracks; the digest only lists
  the unsigned item and points here).
- "Escalate the missed response deadline on Okafor." → `deadline-miss-escalator` (it
  escalates one crossed deadline; the digest batches everything into one quiet summary
  and escalates nothing).
- "Chase the outstanding medical records on Nguyen." → `medical-records-chaser` (it acts
  on the item; the digest only surfaces that it is stalled and points here).

## The distinguisher

Two axes separate this skill from its neighbors:

- **Batched surface vs. full state.** `matter-status-digest` reports the whole state of
  every matter; `daily-needs-you-digest` reports only the few items that need a person
  now, in one quiet batch, and stays silent on everything on-track.
- **Surface vs. act.** The chase/track/escalate skills (`client-verification-tracker`,
  `discovery-response-tracker`, `deadline-miss-escalator`, `medical-records-chaser`)
  **do** the thing. This skill never acts; every line points to whichever of those owns
  the next action.

## Result

Pending — to be verified via a blind cross-skill selector simulation at the pack's
selector-cert pass. The "one batched summary of what needs a person, takes no action"
framing is the intended distinguisher from the full-state digest and from the owning
chase skills; no misroute is expected on the boundary queries above.
