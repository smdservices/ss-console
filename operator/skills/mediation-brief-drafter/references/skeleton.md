# Mediation Brief Drafter - Skeleton

## Which skeleton

**The firm's own, whenever the firm has authored one for this matter type.** Per
discipline Part IV, the shipped skeletons are SMD defaults for rehearsal and
demonstration; at onboarding the firm's skeletons replace them. A mediation brief
skeleton is one of the more personal artifacts a plaintiff firm keeps, and a firm
that has one will notice immediately if the Operator drafts against a different
structure.

**The default, when the firm has not authored one, and the delivery note says so.**

```
operator/templates/drafting/skeletons/mediation-brief-skeleton.md
```

A run that used the default and did not say so has misreported what the attorney
is reviewing. The delivery note names the skeleton used, every time.

## The structure is fixed

Eight sections, in this order, from the default skeleton:

| Section       | What it holds                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caption block | Caption, case number, court and department, trial date, mediator and date, the confidentiality legend, and the exchanged-versus-mediator-only attorney marker |
| I             | Introduction, the brief in miniature                                                                                                                          |
| II            | Statement of facts: parties, incident, post-incident sequence, procedural posture                                                                             |
| III           | Liability analysis: duty, breach, causation, comparative fault                                                                                                |
| IV            | Medical treatment and injuries: emergency care, course of treatment, objective findings, gaps and prior conditions, current condition, future care            |
| V             | Damages: economic table with liens, then non-economic                                                                                                         |
| VI            | Defense positions and responses, including the DME                                                                                                            |
| VII           | Settlement posture and demand history                                                                                                                         |
| VIII          | Conclusion, then date, signature block, attachments                                                                                                           |

Sections are never added, never reordered, and never merged. A section the record
cannot support is a section full of visible markers, not a section that
disappears.

## The three markers

Read the skeleton's own marker legend first. The operative rules:

- `{{FILL: what goes here | source}}` is filled from the source the marker names.
  Not from a different source that happens to be closer, and not from the
  chronology when the marker names the underlying record.
- `{{NOT IN RECORD: what was sought, where it was looked for}}` stays in the draft.
  It is never replaced with a plausible substitute, and the pleading is not a
  substitute for a treating record.
- `{{ATTORNEY: decision reserved}}` stays in the draft, with the record bearing on
  the decision laid out beneath it. The skill does not resolve it, and does not
  hint at how it should be resolved.

## Coverage, enumerated

Gate 7's analog for this artifact: every FILL marker in the skeleton resolves to
exactly one of a fill, a NOT IN RECORD marker, or an ATTORNEY marker, and the
report enumerates the diff. A silently dropped marker is a defect of the same
class as a fabricated fill, because both leave the attorney reading a section that
looks complete.

## Visible delta

Gate 9. Any divergence from the authored skeleton, a section the record forced
into a different shape, a marker converted, a reservation carried, is marked in
**render-visible text**. Never in an HTML comment. The graded defect was a
reservation that vanished when the document rendered, which is worse than no
reservation at all: the attorney reads a clean paragraph and never learns it was
qualified.

## GUIDANCE comments

The skeleton's `GUIDANCE` comments are instructions to the drafter. They describe
what a good fill draws from and where this practice's briefs usually go wrong.
They are read and they are never carried into the draft, in any form, including
paraphrased into a sentence of the brief.

## Posture-dependent sections

The caption block carries
`{{ATTORNEY: confirm exchanged brief or mediator-only submission before drafting
sections VI and VII}}`. That marker governs. Sections I through V and the record
half of VI are drafted safe for either destination. The candid half of VI and the
authority content of VII wait on the confirmation. See SKILL.md, the
exchanged-versus-mediator-only section.

## Pre-submission review points

The skeleton ends with ten review points. They are not part of the brief and never
appear in it. They are the attorney's checklist, and the itemized report is
organized so that each one can be checked against it without rereading the whole
draft.
