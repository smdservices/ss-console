# Discovery Response Drafter: the drafting instruction

The instruction handed to the drafting model on every run. Derived from the prove-out
task prompt (`ws1-instruction.txt`, the arm whose graded output established this lane),
generalized so it parameterizes per matter and per set instead of naming one case.

## Context assembly order (fixed)

The drafting context is built in this order every time. The order is load-bearing:
gate 4 (source over summary) is enforced by what sits where in the pile, not by asking
the model to prefer sources.

1. **The discipline, verbatim.** Part I of `operator/templates/drafting/drafting-discipline.md`,
   copied in unchanged. Do not paraphrase it, do not summarize it, do not trim it to fit.
   It is a tested instrument.
2. **The skeleton.** The firm's authored response shell for this matter type, or the SMD
   default (`references/skeleton.md`). Its marker legend travels with it.
3. **The served set or sets**, complete, as served. This is the only acceptable source
   for request text.
4. **Source documents** from the matter record: the operative pleading, medical records
   and billing, employment records, the document collection log, deposition transcripts,
   the records-request log, discovery correspondence, the proof of service on the
   propounded set.
5. **Summaries, indexes, and chronologies**, each labeled NON-CITABLE, orienting only.
6. **The held-out reference list**: document, date, and flag reason for each item
   excluded by the privilege wall. References only. No content from a held-out document
   ever enters the context.
7. **The voice profile**, if the seat carries an authored one, with its precedence rules.
8. **The task instruction** below.

## The task instruction (parameterized)

> Draft `{{PARTY}}`'s responses to the served discovery set or sets provided in the
> context (`{{SETS}}`), using the response shell provided. For each request or
> interrogatory: reproduce the request verbatim from the served set; state the response
> from the matter record with a parenthetical record cite on every factual assertion;
> propose candidate objections where this record supports a basis, each labeled
> CANDIDATE OBJECTION with its ground and that basis; and hold out any
> privilege-adjacent material per your discipline, listing it rather than quoting it.
> Where the record does not establish something the response needs, write
> `{{NOT IN RECORD: what was sought, where you looked}}` and move on. Produce one
> consolidated draft covering every set provided, organized set by set, request by
> request, in the order the requests appear in each served set.

Parameters: `{{PARTY}}` is the responding party as designated in the operative pleading.
`{{SETS}}` names each served set by its exact caption on the served document, including
the device and set number.

## Per-run additions to the instruction

Append only what applies:

- **No skeleton for this artifact class.** State in the delivery note that the SMD
  default shell was used and that the firm's own shell replaces it at onboarding.
- **Form interrogatories in the set.** Add: the Judicial Council number and text come
  from the served set or an authoritative fetched source and are marked as fetched.
  Reconstructing form text from memory is a fabrication (gate 10).
- **Requests for admission in the set.** Add: draft the Form Interrogatory 17.1 answers
  alongside the admission responses, not afterward, so each 17.1 answer tracks its
  admission response.
- **A prior response set exists on the matter.** Add: prior verified responses are a
  source document, and a supplemental response must not contradict a prior verified one
  without the contradiction being marked in render-visible text for the attorney.

## What the instruction never says

Do not add any of the following, in any run, in any wording:

- an instruction to resolve an objection, adopt one, or pick among candidates;
- an instruction to decide privilege, or to state that a privilege review was done;
- an instruction to fill the verification execution date or place;
- an instruction to compute the response deadline as final;
- an instruction to produce a clean or complete draft, or to minimize markers. Pressure
  toward a smooth document is pressure toward invention, which is exactly the failure
  rule 1 exists to prevent. A visible gap is always better than a smooth invention.

## Model routing

Opus-class, per the drafting discipline Part III. The prove-out split the models on
exactly the failures that matter here: refusing a false premise in a servable request,
holding an inadmissibility trap, and not self-contradicting on dates. Mechanical
transcription sub-steps may run lighter; the draft itself never does.
