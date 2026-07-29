# Demand Letter Drafter: Drafting Instruction

The instruction handed to the drafting model, after
`operator/templates/drafting/drafting-discipline.md` has been loaded verbatim. This is
the reusable form of the prove-out's WS3 instruction
(`venturecrane/engagements:operator/customers/ashton-price/prove-out/prompts/ws3-demand-instruction.txt`),
generalized from one fictional claimant to any matter and hardened with what the
graded run found.

## The instruction

> Draft a policy-limits demand letter on behalf of the claimant named in the matter
> record, using the demand skeleton provided, filled from the matter record: the
> traffic collision report, the medical records and bills, the medical chronology, the
> wage-loss documentation, and the deposition transcripts. Follow every skeleton marker
> convention. Your output is the letter only, in clean markdown.

Everything below scopes that instruction. It is not optional context; it is part of the
instruction.

## What the record is, and what it is not

**Citable sources**, in the order the context presents them:

| Source                                            | Cite as                            | Carries                                                                     |
| ------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| Traffic collision report                          | agency, report number, page        | incident, parties, primary collision factor, witness statements as recorded |
| Medical records                                   | provider, date                     | complaints, findings, diagnoses as the provider stated them                 |
| Radiology and diagnostic reports                  | study type, date, reading provider | impressions, quoted                                                         |
| Billing records and EOBs                          | Bates or document name             | every figure in the specials table                                          |
| Lien correspondence                               | lienholder, letter date            | asserted amounts as of a stated date                                        |
| Employment verification, pay records, tax records | document, date                     | the wage rate                                                               |
| Work status notes, disability certifications      | provider, date                     | the authority for time out of work                                          |
| Deposition transcripts                            | surname, page:line                 | testimony, verbatim and contiguous, with its question                       |
| Claim correspondence                              | correspondent, date                | claim number, adjuster, carrier, any limits disclosure                      |

**Not citable, for different reasons:**

- **The medical chronology, any records index, any excerpt list.** These are navigation
  aids. Use them to order section III and to find the underlying record; cite the
  underlying record. A summary's characterization is never adopted (gate 4). In the
  prove-out one arm held an index out as privileged and still adopted its
  characterization, which is why this is stated as a rule rather than assumed.
- **The complaint and any pleading.** A pleading states a claim. It does not establish
  a fact. The prove-out record was built so the complaint pleads future damages no
  evidence supports; no arm took it, and no arm may.
- **Held-out material.** It is not in your context. Its reference (document, date,
  reason) appears in the hold-out list, and you do not reconstruct its content from the
  reference.
- **An adjuster's or a party's assertion in correspondence.** Citable as a statement
  that was made, attributed to who made it and when. Not authority for the fact
  asserted, and never authority to fill a reserved marker.

## Section-by-section scoping

**I. Introduction.** Who the firm represents, the incident in one line, the letter's
nature and its acceptance period. The exceeds-limits sentence is filled only when the
record's computed figures exceed the disclosed limits by arithmetic alone; otherwise it
is reserved, with the arithmetic shown. See the settlement-authority section of
SKILL.md. Do not argue here.

**II. Liability.** Build from the collision report first, then party and witness
statements, then scene evidence, then vehicle damage. Where the report assigns a primary
collision factor with a Vehicle Code citation, quote it and cite the report page. Where
it does not, do not manufacture one. Cite only the Vehicle Code section the record
supports. Address comparative fault where the record raises it; where it does not, state
that the report assigns no fault to the claimant and cite the page. If the record
contains no independent corroboration of the collision mechanism, mark it rather than
narrating over it. Note that some findings in a collision report are subject to
admissibility limits at trial; a demand is not a trial, but do not convert an
inadmissible disposition into a liability conclusion. Sever the disposition from the
argument, as the prove-out's best arms did.

**III. Injuries and treatment.** Chronological: mechanism and immediate complaints,
first treatment contact, imaging with the impression quoted, the course of conservative
care, any interventional or surgical care, current status. Every diagnosis is attributed
to the provider who made it and the date. A diagnosis the record carries as an
impression, a rule-out, or a working diagnosis is not restated as established. Lay
translation may simplify vocabulary and may not add pathology, severity, mechanism,
causation, or permanence (gate 5). Prognosis is never characterized beyond what a
treating provider wrote.

**III.F. Future care** is the planted-gap section. Fill it only from a future-care
recommendation a treating provider made **in writing**, with the provider, the date, and
the recommendation as written. Cost figures only where a written estimate or life care
plan exists. If no provider recommended future care in writing, the subsection is a
`{{NOT IN RECORD}}` marker naming what was sought and where it was looked for. Where the
record affirmatively forecloses future care (a treating provider discharged the claimant,
or testified that none is anticipated), cite that testimony or record: closing the
subject with the record is stronger than leaving it open, and dodging the subject
entirely is the weakest of the three. Never project future care from a diagnosis.

**IV. Medical specials.** From the billing records, not the chronology. One row per
provider with its source. Never blend billed and paid into one total. The column that
carries the demand figure depends on how the claimant treated, which is read from the
file. If the file does not establish it, mark it. Every lienholder, the nature of the
interest, and the asserted amount as of a stated date; an unresolved lien amount is a
marker naming the lienholder, not an omission.

**V. Wage loss.** Three elements or no computation: documented time out of work, a
provider work-status authority for it, and a substantiated rate. Show the arithmetic
with each input's source. Future earning capacity only on a written opinion.

**VI. General damages.** Argued from documented human consequence, never from a
multiplier or a formula. Baseline before, impact after, duration and trajectory to date,
each attributed to its source (treating records, the claimant's own account, deposition
testimony). **State no general damages number in this section, and derive none anywhere
in the letter.** A general-damages valuation is settlement authority.

**VII. Demand and deadline.** The limits as disclosed with the disclosure source and
date. The demand figure itself, and whether to demand limits at all, is
`{{ATTORNEY: decision reserved}}`. The release language is the skeleton's, unchanged.
The acceptance deadline is a marker for the attorney to fill at transmission, with the
statutory minimum for each method shown; it is never stated as a date. Nothing about
what follows expiration.

**VIII. Enclosures.** Itemize only what is actually attached. Every figure asserted in
the letter should trace to something on this list.

## Output discipline

- Your output is the letter only. The itemized report and the hold-out list are
  assembled by the skill around your draft; do not write them into the letter.
- No blanket completeness sentence anywhere ("this letter fully documents...", "all
  records have been enclosed...", "the foregoing establishes..."). Gate 3. A draft's
  self-description is not evidence.
- No internal file paths, tool names, or hold-out references in the letter body
  (gate 6). The `{{ATTORNEY}}` and `{{NOT IN RECORD}}` markers do stay, in
  render-visible text, and the attorney resolves them before transmission.
- No em dashes. Force comes from facts.
