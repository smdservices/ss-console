# Selector Test: discovery-response-drafter

Blind cross-skill selector simulation: does Hermes pick this skill for a
discovery-response drafting task handed over by an attorney, and NOT for its
near-neighbors?

## Synthetic query

> "Draper served us with an RFP set and form rogs on Alvarez. Draft plaintiff's responses
> off the file and get them back to me to review."

## Expected selection

`discovery-response-drafter`. The query is an attorney handing over the **drafting** of
**our client's responses** to a set **served on us**, delivered back to that attorney for
review. That is this skill's whole job. Both directional cues are present: responses (not
requests), and served on us (not propounded by us).

## Boundary (should NOT select this skill)

- "Put the served RFP set and our prior verified responses into the matter folder so
  BriefPoint can draft off them." goes to `discovery-response-staging` (stages inputs for
  a drafting engine and routes its output; never drafts). The two are alternatives, chosen
  between by whether the firm wants its engine or the Operator to draft. They never chain.
- "Read Draper's responses to our special rogs and tell me which ones are thin." goes to
  `opposing-response-deficiency-review` (inbound answers to our questions, surfaced as
  candidates). Opposite direction from this skill.
- "Draft the meet-and-confer on the responses Draper served." goes to
  `meet-and-confer-drafter` (a connective letter about the other side's responses).
- "Draft the follow-up special interrogatories the depo opened up." goes to
  `follow-up-discovery-drafter` (drafts discovery the firm **propounds**; carries gate 8's
  one-fact-per-interrogatory lint, which this skill does not run).
- "When is our response to the RFP set due, and chase it if it slips." goes to
  `discovery-response-tracker` (the deadline and the chase, not the drafting).
- "Get Maria's verification signed on the responses." goes to
  `client-verification-tracker` (the signature chase; this skill drafts the verification
  page and stops).
- "A set was just served on the Alvarez matter." selects **nothing that drafts**. That is
  `discovery-served-watch` (capture and surface). A served set arriving is not an
  instruction to draft; only an attorney handing over the work invokes this skill.

## The distinguishers

Three axes separate this skill from its neighbors, and a misroute usually means one of
them was read wrong:

1. **Direction.** Responses we serve (this skill) versus responses served on us
   (`opposing-response-deficiency-review`) versus requests we propound
   (`follow-up-discovery-drafter`).
2. **Who authors.** The Operator drafts (this skill) versus a drafting engine drafts and
   the Operator carries (`discovery-response-staging`) versus nobody drafts and the
   Operator watches or tracks (`discovery-served-watch`,
   `discovery-response-tracker`).
3. **Who invoked.** An attorney handing over work (this skill, always) versus a routine
   signal (every connective neighbor). A routine signal must never reach this skill; the
   `drd-routine-trigger-bait-06` fixture grades that boundary directly.

The near-neighbor risk is `discovery-response-staging`, since both are triggered by a
served set on the same matter and both end with something in front of the same attorney.
The distinguisher is the verb in the request: "draft the responses" is this skill, "stage
it for BriefPoint" or "route the draft that came back" is staging.

## Result

Pending. To be verified by a blind cross-skill selector simulation once the skill is
seeded on a seat, alongside the fixture run at
`operator/fixtures/law-firm/pi/discovery-response-drafter/`. The boundary queries above
are the simulation input; the `discovery-response-staging` pair and the served-set-arrival
query are the two that matter most.
