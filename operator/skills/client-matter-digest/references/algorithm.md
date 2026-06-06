# client-matter-digest algorithm

Source of truth for keeping clients informed without crossing into advice.

## Relationship to matter-status-responder

Same Clio reads, same status-not-advice discipline, opposite trigger:

- `matter-status-responder` — **reactive**, one client asked "where are we?", answer that client.
- `client-matter-digest` — **proactive**, scheduled cadence, reach out before they ask.

Where both could fire for the same matter (a client asks right as a digest is due), the reactive response wins for that client this cycle; the digest skips them to avoid a duplicate. They are a clean directional split, not an overlap.

## Client-appropriate fact selection

```
include:  stage/status change since last update
          activity that advanced the matter (sourced)
          upcoming dates the client should know (hearings, filings, meetings)
          *** what the firm needs from the client *** (signature, document, decision)
exclude:  billing internals, write-off/realization detail
          strategy notes, internal deliberations
          anything the firm marks internal-only
```

The single most useful line in a client update is usually "here's what we need from you" — surface it prominently when present.

## The status-not-advice line

This is the discipline the skill lives or dies on:

| Allowed (status)                                   | Forbidden (advice / prediction)        |
| -------------------------------------------------- | -------------------------------------- |
| "Your hearing is set for [date]."                  | "We expect the hearing to go well."    |
| "We filed the response on [date]."                 | "This strengthens your position."      |
| "We're waiting on the other side to respond."      | "They'll likely settle soon."          |
| "We need your signature on the engagement letter." | "You should sign so we can move fast." |

When unsure whether a sentence informs or advises, it advises — cut it.

## Honest about quiet

A matter with little recent activity gets an honest short update ("no major developments since our last note; next scheduled date is [X]") — never manufactured progress. A fabricated "things are moving along nicely" is both a fabrication invariant breach and a trust corrosion.

## Cadence

`cadence` is firm-authored per matter or practice area (from `customer.yaml` where set). The run selects matters whose last-update age exceeds their cadence. No date math produces client-facing content beyond reflecting authored Clio dates.

## Reviewer-as-sender

The output is always a draft. A human reviews and sends under their own identity. There is no autonomous-send path for client-bound mail in any phase (ADR 0005 floor, non-raisable).
