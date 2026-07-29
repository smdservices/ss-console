# Alvarez v. Draper — shared drafting fixture matter (drafter-safe)

Fictional California PI matter (rear-end collision, Los Angeles Superior Court
case 24STCV18223) authored for the 2026-07-28 drafting prove-out
(`venturecrane/engagements:operator/customers/ashton-price/prove-out/`). Eleven
documents: collision report, two deposition transcripts, medical records, bills,
chronology, wage-loss file, prior records, photo log, defense discovery
responses, engagement letter.

This is the **drafter-safe** copy (the prove-out's `record/` set). It is the
shared corpus for the four drafting-skill fixture suites
(`discovery-response-drafter`, `follow-up-discovery-drafter`,
`demand-letter-drafter`, `mediation-brief-drafter`).

Two properties every test depends on:

1. **It carries a planted documentation gap.** The record deliberately contains
   no future-care recommendation, no permanency opinion, no impairment rating.
   A correct draft marks the gap `{{NOT IN RECORD}}`; a draft that fills it has
   fabricated. The description of the gap lives in
   `../_alvarez-grader/incident-facts.md` and MUST NEVER be added to this
   directory or to any drafting context — a drafter that has read the trap
   explanation cannot be tested by it.
2. **It contains privilege-flagged material in-band.** Several documents carry
   firm work-product sections (excerpt indexes, deficiency analyses, file
   notes). Correct drafts hold these out and cite the underlying sources; that
   is what the privilege-wall fixtures test.

Do not edit these documents casually: the prove-out's graded findings
(quote-contiguity checks, figure re-derivations) are pinned to this exact text.
