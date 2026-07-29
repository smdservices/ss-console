# Selector Test: follow-up-discovery-drafter

Blind cross-skill selector simulation: does Hermes pick this skill for a follow-up
discovery drafting request, and NOT for its near-neighbors?

## Synthetic query

> "The defense responses on Alvarez are in. Draft me the next round: production
> requests, admissions, and special rogs going after what they left open, plus a short
> plan of what we still need to establish."

## Expected selection

`follow-up-discovery-drafter`. The query asks to **draft new instruments** aimed at
what the served responses left unestablished, plus the accompanying plan. That is this
skill's sole job. The output is work product drafted for the requesting attorney,
never served.

## Boundary (should NOT select this skill)

- "Draft our responses to the interrogatories they served on us." →
  `discovery-response-drafter` (responding party, our answers to their requests; this
  skill propounds).
- "Look at the defense responses and tell me which ones are deficient." →
  `opposing-response-deficiency-review` (surfaces candidate gaps for the attorney to
  weigh; this skill drafts new discovery from targets the attorney has already named,
  and never rules on deficiency).
- "Their responses are thin. Draft the meet-and-confer and tell me the compel window." →
  `meet-and-confer-drafter` (the remedy is compelling a further response to the old
  round, not propounding a new round).
- "Assemble the separate statement for the motion to compel further." →
  `separate-statement-assembler` (the item-by-item table for the motion).
- "What's our deadline to respond to the set they served?" →
  `discovery-response-tracker` (the responding party's deadline lane).
- "Track the deadlines on the discovery we served and chase them when they're late." →
  `discovery-response-tracker`, outbound direction (tracking and chasing a propounded
  set, not drafting the next one).

The near-neighbor risk is `opposing-response-deficiency-review` and
`meet-and-confer-drafter`, since all three sit downstream of the same event: the other
side's responses arriving. The distinguisher is the **remedy**. The deficiency review
surfaces candidates and rules on nothing. The meet-and-confer drafter pursues a
**further response to the same requests**. This skill pursues the facts in a **new
round of instruments**. Which remedy the case needs is the attorney's call, and this
skill never makes it: it drafts only against targets the attorney named.

A second distinguisher worth stating, because it is the one a selector is most likely
to miss: this skill is **work product on the drafting lane**, so it is
attorney-initiated only. A routine or scheduled invocation must not select it at all.
Queries phrased as standing instructions ("every time their responses come in, draft the
next round") select nothing here; they surface as Shape C and go back to the attorney.

## Result

To run at connect, on the live seat, against the fixture set at
`operator/fixtures/law-firm/pi/follow-up-discovery-drafter/`. The prove-out ran on a
bare API harness with no selector in the loop, so no selector result is claimed here
yet. Record the result and the date in this section when the blind simulation runs.
