# Demand Letter Drafter: Skeleton

## Which skeleton controls

1. **The firm's own demand skeleton for this matter type**, when the seat carries one.
   At onboarding the firm's templates replace the shipped defaults per matter type
   (drafting-discipline Part IV). If the attorney names a skeleton document on the
   matter, that one controls.
2. **The shipped SMD default**, at
   `operator/templates/drafting/skeletons/demand-skeleton.md`, when the seat carries no
   authored demand skeleton. Using it is a fact the delivery note states plainly: the
   draft was built against an SMD default structure, not the firm's template. Never let
   the default pass silently as the firm's.

## The marker contract

| Marker                                                        | Meaning                                     | What the drafter does                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{{FILL: what \| source}}`                                    | Content built from the named record source. | Fill from that source. If the source is silent, convert to `NOT IN RECORD`. If the fill would require a decision the attorney has not made, convert to `ATTORNEY`. |
| `{{NOT IN RECORD: what was sought, where it was looked for}}` | The record does not establish the fact.     | Leave it in the draft. Never supply a plausible substitute.                                                                                                        |
| `{{ATTORNEY: decision reserved}}`                             | Legal judgment or settlement authority.     | Lay out the record bearing on it, then stop.                                                                                                                       |

**A skeleton marker never authorizes a false statement.** A `{{FILL}}` whose content
would be untrue on the record is converted, not satisfied. The skeleton's
exceeds-limits sentence in section I is the standing example and the prove-out's
decisive probe.

## Structure is fixed

Sections are not added, removed, reordered, or merged, and a section is not dropped
because the record is thin. A thin section carries its markers.

## Divergence is visible (gate 9)

Any divergence from the authored skeleton is marked in **render-visible text**. Never
an HTML comment, never a footnote that a renderer drops. A reservation that disappears
on render is a reservation that reaches a carrier. The prove-out found reservations
vanishing into comments (D29/D30), which is why this is a gate rather than a habit.

Divergences that must be marked visibly:

- A `{{FILL}}` converted to `NOT IN RECORD` or to `ATTORNEY`.
- A skeleton section whose premise the matter does not fit (the section 999 labeling
  and timing mechanics where suit has been filed, for example). The skill reserves the
  question in visible text rather than adapting the section to a posture the skeleton
  was not written for.
- Any place the firm's skeleton and the matter record conflict. That conflict is
  surfaced to the attorney, not resolved by the drafter.

## GUIDANCE comments never leak

The skeleton's `<!-- GUIDANCE: ... -->` blocks are instructions to the drafter. None of
that text appears in the draft, in any form, including paraphrased.

## Pre-transmission review points

The default skeleton closes with a review checklist that is **not part of the letter**.
It is not drafted into the output. The skill's itemized report covers the same ground
as an account of what was done, item by item, and never as a certification that the
review points are satisfied.
