# Mediation Brief Drafter - Drafting Instruction

The reusable form of the instruction proven in the 2026-07-28 drafting prove-out
(WS3, the mediation brief arm). Two of the graded artifacts in that arm came back
fully CONFIRMED by the adversarial panel, one of them at 34 of 34 deposition cites
with no splices and usable on a first pass. This file is what the skill constructs
around the attorney's request. Do not reword the discipline text it embeds.

## What the attorney actually says

The prove-out instruction was one sentence, and that is representative:

> Pull the TCR, med chron, depositions, and discovery from this matter, and draft
> the mediation brief against my skeleton.

That terseness is the point, and it is not a gap to be filled by asking the
attorney more questions. An attorney who has to specify the assembly order, the
citation convention, and the privilege posture is doing the work the skill exists
to do. The skill takes the one sentence and builds the rest.

The only things the skill asks back for, and only when the record does not supply
them: the exchanged-versus-mediator-only posture, and a skeleton where the firm
has authored one for this matter type and it is not locatable.

## What the skill constructs

The drafting context is assembled in this order, and the order is load-bearing.
Source documents come before summaries because drafters demonstrably trust
whatever is nearest.

1. **The discipline**, loaded verbatim:
   `operator/templates/drafting/drafting-discipline.md`, Part I. Not paraphrased,
   not excerpted, not summarized.
2. **The skeleton**, the firm's authored one for this matter type, or the SMD
   default named in `skeleton.md` with the substitution stated in the delivery
   note.
3. **The posture note**: exchanged, mediator-only, or unresolved. Where it is
   unresolved, the note states plainly that sections VI and VII are drafted safe
   for either destination and the dependent content is reserved.
4. **The source documents**, in this order:
   - the operative pleading and the most recent court notice (caption, case
     number, court, department, trial date)
   - the traffic collision report, face page, narrative, diagram, witness
     statements, injury section
   - the deposition transcripts, certified text, complete, with page and line
     numbering intact
   - the underlying medical records: emergency department, treating providers,
     radiology reports and impressions, operative reports, work status notes
   - the billing file and the employment and wage documentation
   - written discovery from both sides, including responses to contention
     interrogatories
   - the DME report, the expert designations, and any expert reports in the file
   - the lien correspondence and reimbursement notices, with their as-of dates
   - the settlement correspondence file, including any section 998 offers
5. **The navigation aids, marked non-citable**: the medical chronology, any
   transcript excerpt index the firm keeps in the file, any earlier demand
   package. These help the drafter find the document. They are never the cite.
   Where an index is itself work product, it is held out entirely and does not
   appear here at all.
6. **The held-out manifest**: document, date, and reason for each item excluded by
   the privilege wall. References only. No content, no conclusions, no paraphrase.

## The instruction the skill issues to itself

After the assembly above, the drafting step is instructed in these terms:

> Draft the confidential mediation brief for this matter against the skeleton
> provided. The skeleton's structure is fixed: fill every FILL marker from the
> source named in the marker, convert every unfillable marker to a NOT IN RECORD
> marker naming what was sought and where it was looked for, leave every ATTORNEY
> marker standing with the record bearing on that decision laid out beneath it,
> and never let a GUIDANCE comment reach the draft.
>
> Every factual sentence carries a record cite. Depositions by witness surname and
> page and line. Documents by exhibit or Bates. Medical records by provider and
> date. Quote testimony where the words matter rather than characterizing it, and
> quote every radiology impression rather than translating it.
>
> Every quotation must be verbatim and contiguous in the transcript, and must be
> cited to a range that includes the question it actually answered. Never attach a
> quoted answer to a question it did not answer. Never excise a hedge from inside
> quotation marks. Never cut an adverse finding out of a quoted impression.
>
> The confidentiality legend appears in the caption block exactly as the skeleton
> states it.
>
> Do not resolve the valuation range, the general damages figure, current
> authority, the target, or any bracket. Do not decide how far to concede a
> genuinely strong defense position. Determine from the file whether this
> plaintiff's specials are argued billed or paid, stay consistent with that
> determination, and never blend the two into one total; where the file does not
> establish it, reserve it.
>
> Do not write any sentence that describes the completeness of this draft or of
> your review of the record.
>
> Output the draft document only, in clean markdown.

## After the draft

The itemized report is assembled separately and never inside the brief:

- what was read, by document class and count
- what was drafted, by skeleton section
- the NOT IN RECORD list, each with what was sought and where it was looked for
- the ATTORNEY-marker list, each with the record laid out beneath it in the draft
- the held-out list, references only
- the flagged-characterizations list: every framing clause around a quotation,
  with its quotation and cite, for one confirmation pass
- whether the firm's skeleton or the SMD default was used, and whether a firm
  voice profile was applied

The draft, the assembled source set, and the held-out manifest then go to the
drafting gate, and nothing is surfaced until it returns a pass. The gate runs
in-seat where the seat authors `code_execution` and delivery-path on the delivery
path where it does not, which is the normal client posture. See SKILL.md, the
delivery-gate section, for the invocation, the execution points, and the
refuse-on-failure rule.

## What this instruction deliberately does not do

It does not ask the attorney to identify the strong facts, rank the defense
positions, or supply a theory of the case. The record carries those and the draft
follows the record. It also does not ask for a target number, because a skill that
asks for a valuation is a skill that expects to use one.
