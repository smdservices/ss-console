# Selector Test - opposing-response-deficiency-review

Blind cross-skill selector simulation: does Hermes pick this skill for a "read the other
side's responses and find the gaps" task, and NOT for its near-neighbors (the drafter, the
assembler, the deadline tracker, the document-review sibling)?

## Synthetic query

> "Read the defense's responses to our interrogatories on Reyes and show me where they're
> thin or objecting without answering, so I can decide whether to meet and confer."

## Expected selection

`opposing-response-deficiency-review` - the query is about reading the **opposing side's
discovery responses** to the firm's propounded requests and surfacing candidate gaps
(boilerplate objections, non-answers, evasive answers, missing verifications) for the
attorney to review. Surfacing those candidates is this skill's sole job. Note the query
ends in a decision the _attorney_ makes ("so I can decide whether to meet and confer") -
this skill surfaces the candidates that feed that decision; it does not make it.

## Boundary (should NOT select this skill)

- "Draft the meet-and-confer letter on the defense's thin responses." →
  `meet-and-confer-drafter` (drafts the connective letter under review; this skill never
  drafts).
- "Assemble the separate statement for the motion to compel." →
  `separate-statement-assembler` (collates the CRC 3.1345 request/response/grounds table).
- "What's the deadline to move to compel further responses on Reyes?" →
  `discovery-response-tracker` (the compel deadline; this skill never computes or asserts
  it).
- "Track the response deadlines on the discovery we served and flag if the defense is
  late." → `discovery-response-tracker` (outbound direction: watches the deadline, flags
  late/thin at the deadline level; this skill reads the actual response _content_ and points
  to specific candidate gaps inside it).
- "Read the medical records on Reyes and pull the treatment timeline." →
  `matter-document-review` (general document surfacing; this skill is scoped to opposing
  discovery responses against the propounded requests).
- "Start the client verification for our own interrogatory responses." →
  `client-verification-tracker` (our client's verification signature; this skill flags a
  _missing_ verification on the _opposing_ side's responses as a candidate, it does not
  chase a signature).

## Near-neighbor risk

The sharpest neighbors are `discovery-response-tracker` (outbound) and
`meet-and-confer-drafter` (both touch the opposing side's thin responses). The
distinguishers: the tracker works at the **deadline** level (is a response late, is it
thin, start the compel clock) and this skill works at the **content** level (which specific
requests came back with which candidate gaps); the drafter **produces the letter** and this
skill **surfaces the candidates** the letter would be built from and stops there. Against
`matter-document-review`, this skill is the same surface-only posture applied to a specific,
adversarial document pair (propounded requests vs. opposing responses).

## Result

Pending - verify in the next law-wedge selector simulation that "read the opposing
responses and find the gaps" queries select `opposing-response-deficiency-review`, while
"draft the letter," "assemble the separate statement," and "what's the compel deadline"
queries route to the drafter, the assembler, and the response tracker respectively. The
`description` is scoped to "surfaces candidate gaps … an assist, not an authority" to claim
the deficiency-surfacing space without stealing the drafting or deadline work.
