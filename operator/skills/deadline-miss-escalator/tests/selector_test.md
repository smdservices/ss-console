# Selector test — deadline-miss-escalator

Asserts Hermes' skill selector picks `deadline-miss-escalator` for "a deadline is approaching / slipping — escalate it," not `deadline-and-sol-tracker` (the standing date mirror) or `stalled-matter-nudge` (inactivity).

## Synthetic query

> A filing deadline is coming up fast and nobody has acted on it — make sure it gets in front of the right person.

## Expected selection

`deadline-miss-escalator`

## Why the adjacency is clean

- **vs. `deadline-and-sol-tracker`:** the tracker is the _standing view_ of all authored dates by proximity (read-and-surface, runs on a calm cadence). The escalator is the _alarm_ — it fires a rung (re-surface → re-route → notify a named human) specifically when a date is near/overdue and unhandled. "Show me what's coming due" → tracker; "this one is slipping, escalate it" → escalator. Producer/consumer: the escalator acts on the dates the tracker surfaces.
- **vs. `stalled-matter-nudge`:** stalled is about _inactivity_ (a matter gone quiet); the escalator is about a _specific authored date approaching_. Different trigger entirely.

## Result

Pending — to be verified via a blind cross-skill selector simulation (the active law skills' descriptions) before the wedge-harden gate, the same method `stalled-matter-nudge`'s selector test records. The escalator's description ("Escalates an approaching or missed firm-authored deadline up a ladder") is written to target the escalate-this-date query without overlapping the tracker's standing-view framing.
