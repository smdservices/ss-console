# Selector Test - mediation-brief-drafter

Blind cross-skill selector simulation: does Hermes pick this skill for a
mediation-brief drafting task, and NOT for its near-neighbors? The near-neighbor
risk here is unusually sharp, because two skills in the same pack describe the
same document and explicitly refuse to write it.

## Synthetic query

> "Pull the TCR, med chron, depositions, and discovery on Alvarez and draft the
> mediation brief against my skeleton."

## Expected selection

`mediation-brief-drafter`. The query asks an attorney-initiated **drafting** job
against **a skeleton**, producing the brief itself. That is this skill's sole
output. The draft returns to the requesting attorney for review; nothing is
submitted or exchanged.

## Boundary (should NOT select this skill)

- "Pull together everything the mediation brief will draw from on Alvarez so I can
  write it." → `mediation-settlement-tracker`. That skill assembles the brief
  INPUTS into a staged packet and leaves the reasoning cell blank. It never writes
  the brief, and this query asks for inputs, not a draft.
- "What's the section 998 acceptance window on Alvarez, and when is the MSC?" →
  `mediation-settlement-tracker`. Settlement-posture deadline capture, no drafting.
- "Assemble the trial binder for Alvarez." → `trial-binder-assembler`. A collation
  of authored components, and it never authors substance.
- "Draft the policy-limits demand on Alvarez." → `demand-letter-drafter`. Same
  lane, same discipline, different artifact and a different audience: a demand is
  addressed to the carrier, a mediation brief to a neutral.
- "Their responses on Alvarez are thin, draft the meet and confer." →
  `meet-and-confer-drafter`. A connective artifact from attorney-flagged
  deficiencies, not work product.
- "Summarize the Alvarez depositions for me." → not this skill. This skill quotes
  transcripts inside a brief; it does not produce standalone summaries, and
  `trial-binder-assembler` explicitly refuses to author one.

## The distinguisher

Three skills touch the mediation brief and only one writes it:

| Skill                          | Relationship to the brief                   | Lane                                        |
| ------------------------------ | ------------------------------------------- | ------------------------------------------- |
| `mediation-settlement-tracker` | assembles its INPUTS, never writes it       | routine, connective                         |
| `trial-binder-assembler`       | collates authored components, never authors | routine, connective                         |
| `mediation-brief-drafter`      | writes the draft                            | on-demand, attorney-initiated, work product |

The selector signal is the combination of an **attorney asking for a draft** and a
**skeleton to draft against**. A query that asks for material, a packet, inputs, a
date, or a status is the tracker. A query that asks for the document is this
skill. A query that asks for the brief but arrives from a routine, a watcher, or a
chained call is refused rather than routed: the lane boundary in
`operator/templates/drafting/drafting-discipline.md` is not a selector preference,
it is a bar.

One more misroute to watch: "get the mediation brief over to the mediator by
Friday" selects nothing in this pack. There is no skill that submits it. The
correct handling is Shape D, a refusal surfaced to the attorney.

## Result

To be run. This skill is authored 2026-07-28 in the same PR as the drafting lane,
and the blind selector simulation runs with the other three drafting skills once
the lane is complete, so the four are tested against each other and against the
connective neighbors in one pass. Record the result here, with its date, in that
run.
