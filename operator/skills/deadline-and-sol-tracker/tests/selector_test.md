# Selector test — deadline-and-sol-tracker

Asserts Hermes' skill selector picks `deadline-and-sol-tracker` for a firm-initiated "what is coming due" date scan, and does not misroute to `matter-status-digest` (the broad state-of-the-practice digest) or `stalled-matter-nudge` (an inactivity scan).

## Synthetic query

> Show me what court dates and filing deadlines are coming up across our matters so nothing gets missed.

## Expected selection

`deadline-and-sol-tracker`

## Why the adjacency is clean

- **vs. `matter-status-digest`:** the digest reports overall matter state (open-by-stage, quiet matters, trust); the tracker is specifically the critical-date proximity view. A query about _dates coming due_ targets the tracker; a query about _where every matter stands_ targets the digest. (Same producer/consumer adjacency wedge.md documents for digest vs. responder.)
- **vs. `stalled-matter-nudge`:** stalled is about _inactivity_ (matters gone quiet); the tracker is about _upcoming authored dates_. Opposite signals — quiet-too-long vs. date-approaching.

## Result

Pending — to be verified via a blind cross-skill selector simulation (the 8 active law skills' descriptions) before the wedge harden gate, the same method `stalled-matter-nudge`'s selector test records. The tracker's description ("Surfaces the firm's authored court dates, filing deadlines, and statute-of-limitations dates by proximity") is written to target this query class without overlapping the digest's "state of the practice" framing.
