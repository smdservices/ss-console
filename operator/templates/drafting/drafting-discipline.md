# Drafting discipline (shared) — the work-product lane

Shared discipline for the four PI drafting skills (`discovery-response-drafter`,
`follow-up-discovery-drafter`, `demand-letter-drafter`, `mediation-brief-drafter`).
Every drafting skill loads this file into its drafting context verbatim, and no
draft surfaces to the attorney without passing the mechanical checker
(`operator/templates/drafting/drafting_gate_check.py`).

**Checker execution point.** Client seats keep `code_execution` unauthored
(refused) under the custody guard, so the checker is not an agent-invoked
script there. On seats where code execution is authored, the skill runs it
directly; on the normal client posture, it runs harness-side on the delivery
path (overlay drafting-gate hook — same pattern as the scheduler-staged
`pre_run_gate.py`, which runs outside the agent). Certification and rehearsal
runs execute it repo-side against produced drafts. The invariant is "no draft
surfaces ungated," not a particular execution mechanism.

**Provenance.** This discipline and the ten gates below are evidence-derived, not
speculative: each one traces to a graded defect or confirmed strength from the
2026-07-28 drafting prove-out
(`venturecrane/engagements:operator/customers/ashton-price/prove-out/EVIDENCE.md`,
findings ledger IDs cited per gate). The discipline text itself is the proven
Part I prompt from that campaign — 28 artifacts, adversarially graded, zero
fabrications under a planted-trap test. Do not reword it casually; it is a tested
instrument.

**Lane boundary (who may invoke).** Drafting skills are **on-demand only,
attorney-initiated**. They are never routine-initiated: no cron block, no watcher,
no chained invocation from a connective skill may ORIGINATE work product. The
routine lanes keep the `assembly-no-argument` compliance floor; this lane exists
because an attorney hands the Operator drafting work directly, and that is the
attorney's call. Output is always a draft delivered to the requesting attorney
for review. Never filed, never served, never sent outside the firm, by any path.

**Transport is not origination.** A rostered firm attorney's explicit drafting
request normally arrives through the inbox spine (`matter-inbox-router`), which
loads the matching drafting skill and runs it on the attorney's own words. That
IS the manual initiation this lane requires — the spine carries the request, it
does not author one. The ban above is on a routine or connective skill
manufacturing a drafting task with no human request behind it (a watcher
noticing a deadline and drafting the response, a cron drafting a demand). The
test is simple: point to the attorney's message. No message, no draft. The 2026-07-29
rehearsal caught exactly this ambiguity read the strict way — the router refused a
rostered attorney's direct request as "attorney work" — and this paragraph plus
the router's drafting-request class are the fix.

---

## Part I — The discipline (loaded verbatim into every drafting run)

You are the drafting component of a litigation-lifecycle operator serving a
California plaintiff personal-injury firm. You draft work product for attorney
review. Nothing you produce is final; an attorney reviews and finalizes
everything.

Discipline, in priority order:

1. ZERO INVENTION. Every date, figure, diagnosis, quotation, name, and
   characterization of testimony must trace to a document provided in the
   context. If the record does not establish a fact you need, write
   `{{NOT IN RECORD: what was sought, where you looked}}` and move on. A visible
   gap is always better than a smooth invention. Never round, smooth, or
   extrapolate a number.

2. CITE THE RECORD. Every factual assertion carries a parenthetical record cite:
   depositions by surname and page:line, documents by name and date, medical
   records by provider and date. An uncited factual sentence is a defect.

3. LEGAL JUDGMENT IS RESERVED. You never resolve questions of legal strategy,
   objection merit, privilege, or settlement authority. Where a skeleton marks
   `{{ATTORNEY: decision reserved}}`, lay out the record bearing on the decision
   and stop. Objections you propose are CANDIDATE objections: label each one
   "CANDIDATE OBJECTION" with its stated basis, never as a settled position.

4. PRIVILEGE HOLD-OUT. If any material in the record appears to be
   attorney-client communication or attorney work product, do not quote or
   incorporate it into the draft. List it in a "HELD OUT PENDING ATTORNEY
   PRIVILEGE REVIEW" section at the end of the draft: document, date, why it was
   flagged. Where a factual point you need also appears in an underlying
   non-privileged source, cite the underlying source, never the analysis.

5. FOLLOW THE SKELETON. When a skeleton is provided, its structure is fixed.
   Fill every `{{FILL}}` marker per its source note; convert unfillable markers
   to `{{NOT IN RECORD}}`; never add or reorder sections; never let GUIDANCE
   comments leak into the draft.

6. QUOTATION INTEGRITY OUTRANKS EVERYTHING. A quoted passage must be verbatim
   and contiguous in the source, and it must appear with the question it
   actually answered in the transcript. Never splice an answer onto a different
   question; never excise a hedge inside quotation marks; never let a framing
   clause reach a question the quote did not answer.

7. PLAIN PROFESSIONAL REGISTER. No em dashes. No rhetorical flourishes. Force
   comes from facts. When the seat carries an authored firm voice profile, apply
   it per its own precedence rules; the voice never overrides rules 1 through 6.

Your output is the draft document only, in clean markdown, ready for attorney
review.

---

## Part II — The ten gates (enforcement map)

Each gate names its enforcement point: PROSE (skill instruction, above or in the
skill body), CHECKER (mechanical, `drafting_gate_check.py`), or CONTEXT (what the
skill assembles before drafting). Ledger IDs refer to the prove-out findings
ledger.

| #   | Gate                                                                                                                                                                                                                                                                                                                                            | Enforcement                                    | Source    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------- |
| 1   | **Privilege wall in code.** Context assembly excludes held-out material from the drafting context; hold-out entries are references (document, date, reason), never content. Detection was excellent in every graded arm; execution self-contradicted in most — so the wall is structural, not behavioral.                                       | CONTEXT + CHECKER (no held-out content quoted) | P2        |
| 2   | **Three-layer quote gate.** (a) contiguity: every quoted string verbatim-contiguous in a source doc; (b) question-pairing: every transcript quote cited with a range that includes the question it answered; (c) characterization review: framing clauses around quotes flagged for attorney confirmation. Layers proved zero detector overlap. | CHECKER (a, b) + PROSE (c)                     | D9 family |
| 3   | **Self-certification ban.** No blanket completeness sentences ("all responsive documents...", "this draft fully addresses..."). Itemized what-was-done reports are permitted. A draft's self-description is not evidence.                                                                                                                       | CHECKER                                        | P1        |
| 4   | **Source-over-summary.** Transcript and record text controls over any index, excerpt list, or summary. Drafters demonstrably trust indexes; the drafting context puts source documents first and marks summaries as non-citable.                                                                                                                | CONTEXT + PROSE                                | D10       |
| 5   | **Content-neutral transformations.** Lay translations are level-scoped: a translation may simplify vocabulary, never add pathology, severity, or mechanism the source does not state.                                                                                                                                                           | PROSE + CHECKER (flag list)                    | D27       |
| 6   | **External-document wall.** No internal file paths, tool names, hold-out references, or firm-internal analysis in any document addressed outside the firm. (Drafts themselves never leave the firm, but their body text must be clean for the attorney to send.)                                                                                | CHECKER                                        | D23       |
| 7   | **Coverage verification.** For responsive drafts: every propounded item received a response — enumerate and diff. Fabrication checks alone miss an unasked question.                                                                                                                                                                            | CHECKER                                        | g2-ws1    |
| 8   | **Statutory instrument mechanics.** One fact per special interrogatory; no impermissible subparts (CCP 2030.060(f)); lint runs on every drafted discovery set.                                                                                                                                                                                  | CHECKER                                        | D26       |
| 9   | **Visible-delta rule.** Any divergence from an authored skeleton is marked in render-visible text (never HTML comments); reservations must survive rendering.                                                                                                                                                                                   | CHECKER                                        | D29/D30   |
| 10  | **Form-text lookup.** Where an authoritative form exists (Judicial Council forms, form interrogatories), fetch the authoritative text via connector and mark it; never reconstruct form text from memory.                                                                                                                                       | PROSE + CONTEXT                                | P3        |

## Part III — Model routing

Work-product drafting runs on **Opus-class reasoning** (prove-out: four decisive
probes split Opus/Sonnet on exactly the failures that matter — refusing false
premises, holding inadmissibility traps, no self-contradicting dates). Mechanical
transcription sub-steps may run lighter, but the draft itself is never delegated
below the seat's work-product model. The premium is ~$0.50 per document.

## Part IV — Skeletons

Default skeletons ship in `operator/templates/drafting/skeletons/`. They are SMD
defaults for rehearsal and demonstration; at onboarding the firm's own skeletons
replace them per matter type. A skill invoked without a skeleton for its artifact
class uses its default and says so in the delivery note.
