# Follow-Up Discovery Drafter: drafting instruction

The skill-specific half of the drafting context. The shared half is
`operator/templates/drafting/drafting-discipline.md` Part I, which is loaded verbatim
and outranks everything here. This file is the reusable form of the instruction proven
in the 2026-07-28 drafting prove-out (WS2), generalized off that campaign's single
matter so it runs on any matter.

## The assignment, stated to the drafter

> The other side has served its discovery responses (in the context). Draft
> plaintiff's follow-up discovery: a set of Requests for Production, a set of Requests
> for Admission, and a set of Special Interrogatories, each built from the operative
> pleading, the incident documents, and the matter record, targeting what the served
> responses left unestablished. Alongside the sets, produce a short discovery plan:
> what still needs to be established in this case and why, stated as record
> observations, with strategy decisions marked `{{ATTORNEY: decision reserved}}`.
>
> The attorney has named the targets (below). Draft to those targets. Do not decide
> that a response was deficient, and do not add targets of your own beyond what the
> record observation supports.

The attorney's targets are appended to that instruction on each run, either as named
subjects or as the deficiency decisions the attorney reached from
`opposing-response-deficiency-review`. Without them the skill does not draft.

## Building context, in order

1. **Operative pleading first.** The complaint frames what has to be established. It
   is also, in a plaintiff PI matter, a common source of the invention trap: a pleading
   routinely claims categories of damage (future care, permanency, loss of earning
   capacity) that no evidence in the file yet supports. **A pleaded allegation is not a
   record fact.** It establishes what was alleged, never that the thing is true. A
   request may not assume a pleaded fact is established.
2. **Incident and third-party documents.** Collision or incident report, photographs
   and their logs, repair and property records, employment and wage records, medical
   records and bills. These are what premises are built from.
3. **The firm's propounded sets and the served responses,** paired request to
   response. Read them for what is now in the record and what is not.
4. **Summaries, indexes, and excerpt lists go in last and are marked non-citable**
   (gate 4). A drafter that trusts an index over the source will reproduce the index's
   errors and its characterizations. Where an index and a source disagree, the source
   controls, always.
5. **Held-out material never enters this context at all** (gate 1). Attorney-client
   communications and attorney work product, including the firm's own internal
   analysis of the served responses, are excluded structurally, not by asking the
   drafter to ignore them. They are carried as references only: document, date, why
   flagged. Where a fact that appears in a held-out analysis also appears in an
   underlying non-privileged source, cite the underlying source. In the prove-out, an
   arm whose hold-out table certified it had not used the firm's deficiency analysis
   nonetheless lifted a misquote out of it (findings ledger D7). Detection is not the
   weak link; execution is. Hence the structural wall.

## The unestablished-fact pass

Before drafting a single request, work the record into a list. For each subject the
attorney named:

- **What the record now establishes,** with the cite (a verified response, an admitted
  request, a document).
- **What it does not,** with where you looked. A gap is only a gap once you have looked
  for it in the places it would live.
- **What a response asserted without establishing.** An objection asserts nothing. A
  narrative answer that talks past the question establishes only what it actually
  states. Record what the response says, not what it implies.

This list is the source for both the instruments and the plan. Every request traces
to a line on it. A request that does not trace to an unestablished item is not drafted.

## Choosing the instrument for the gap

The record observation determines the instrument. State the reason in the drafting
notes so the reviewing attorney sees why each gap drew the request it drew:

- **Requests for Production** where the gap is a document or thing that exists in
  someone's possession, custody, or control: maintenance records, phone records, the
  policy, the download from a vehicle module, photographs, the personnel file.
- **Requests for Admission** where the gap is a discrete fact that can be admitted or
  denied and, if admitted, is removed from the case: a date, a location, a status, the
  genuineness of a document. Admissions are the instrument that narrows; they are also
  the instrument that carries a cost-of-proof consequence when denied wrongly, which
  is exactly why the decision to serve one is the attorney's.
- **Special Interrogatories** where the gap is a fact the other side knows and no
  document will give you: a contention, an identity, a sequence, a state of knowledge.
  One fact each. See `instrument-mechanics.md`.

Where the same gap could be closed several ways, draft the one that follows from the
record observation and mark the alternative as
`{{ATTORNEY: decision reserved}}`. Choosing among instruments for strategic effect is
strategy.

## Premise discipline while drafting a request

Read every drafted request back for its assumptions. The test is mechanical: strike
out the interrogative frame and look at what is left standing as asserted fact. Every
noun phrase that survives has to have a cite.

- "State the date the hitch receiver was removed from YOUR VEHICLE" assumes a removal.
  If the record says the party elected not to repair it, that assumption is invented,
  and it goes out under the firm's signature.
- "Do YOU contend the hitch receiver was removed from YOUR VEHICLE at any time before
  the incident? If so, state the date" is two interrogatories (see the one-fact rule),
  and neither one assumes anything.

Where the premise cannot be built, do not build the request. Write
`{{NOT IN RECORD: the premise the request would have required, and where it was
looked for}}` in the set at the position the request would have occupied, so the
attorney sees the gap in place rather than being handed a shorter set with a silent
omission.

## The discovery plan

Short, and observational. For each item:

- The subject.
- What the record establishes, cited.
- What it does not establish, and where that was looked for.
- Which drafted request or requests address it, by number.
- Where any choice about it is strategic, `{{ATTORNEY: decision reserved}}` with the
  record bearing on the decision laid out beneath, and nothing resolved.

Banned in the plan: ranking targets by importance, recommending a sequence or a
timeline, assessing the strength of a defense or of the firm's own case, valuing the
case, recommending experts or depositions as a course of action, and any sentence of
the form "we should." Laying out what the record shows about a decision is the job.
Making the decision is not.

Reservation markers are render-visible text (gate 9). Never an HTML comment.

## Register and voice

Servable instruments are the lowest-voice register in the practice. Their form is set
by statute and by the firm's own convention; a drafted set should read like the firm's
other sets and like nothing else. Where the seat carries an authored voice profile,
apply it per its own precedence rules, which will in practice touch only the
definitions block, the preliminary language, and the plan's prose. Where none is
authored, use the plain professional register of the discipline. The prove-out found
voice correctly absent from every served court document across the matrix; that is the
target, not a compromise.

Plain register rules that apply either way: no em dashes, no rhetorical framing, no
adjectives doing argumentative work inside a request ("the obviously defective hitch"),
no characterization of the other side's conduct. A request is a question. Force comes
from the fact it pins down.

## Before surfacing

Every set and the plan pass the lane's mechanical gate
(`operator/templates/drafting/drafting_gate_check.py`), with `--sprog-lint` on the
interrogatory and admission sets. Where the seat authors code execution, the drafter
runs it; where code execution is refused, which is the normal client posture, the gate
runs on the delivery path (not built for this lane). The drafter does not need to know which, and
must not treat a refused execution tool as permission to skip the gate. **No draft
surfaces ungated.**

On any failure, do not surface, do not explain the failure in the delivery note, and do
not ask the attorney to look past it. Rebuild the flagged items and re-run. A gate
result that cannot be confirmed is a failure, not a pass.

Then write the itemized report: what each set targets and the observation behind it,
the counts against the statutory limits, the unbuildable premises, the reserved
decisions, the held-out documents, and the gate result. No completeness sentence
anywhere (gate 3).
