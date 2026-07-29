# Discovery Response Drafter: the skeleton

## Which skeleton

The firm's own authored response shell for this matter type, when the engagement has
authored one. Where it has not, the SMD default is:

`operator/templates/drafting/skeletons/discovery-response-shell.md`

The default is a rehearsal and demonstration artifact, replaced by the firm's shell at
onboarding (drafting discipline, Part IV). A run that uses the default **says so in the
delivery note**, so an attorney never mistakes an SMD default for the firm's own
template.

## The skeleton is fixed structure (discipline rule 5)

Its structure does not move. Fill every `{{FILL}}` marker from the source its note
names. Convert unfillable markers to `{{NOT IN RECORD}}`. Never add a section, never
reorder sections, and never let a `<!-- GUIDANCE -->` comment leak into the draft.

## Marker contract

The shell's legend governs; this is the drafting-side reading of it.

| Marker                                                 | The drafter's obligation                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `{{FILL: what \| source}}`                             | Fill from that named source, with a parenthetical record cite. Source silent, marker becomes `{{NOT IN RECORD}}`.    |
| `{{NOT IN RECORD: what was sought, where looked}}`     | Leave it standing in the draft. Never supply a plausible substitute. Count it in the delivery note.                  |
| `{{CANDIDATE OBJECTION: ground \| basis \| requests}}` | Propose with the basis in this record. Never adopt. Never propose a ground this set does not raise.                  |
| `{{PRIVILEGE CANDIDATE: item, why}}`                   | Hold out of the compiled draft, list for attorney clearance. Never certify privileged, never certify not privileged. |
| `{{ATTORNEY: decision reserved}}`                      | Lay out the record bearing on the decision and stop. Do not resolve.                                                 |

## Visible-delta rule (gate 9)

Any divergence from the skeleton, a section that could not be filled at all, a
disposition that did not fit the record, a marker converted for a reason worth an
attorney's attention, is marked in **render-visible text inside the draft**. Never in an
HTML comment. A reservation that vanishes when the document renders is a reservation the
attorney never sees, which is how a draft ships with an unmarked hole in it.

## Skeleton fit is not assumed

A skeleton can be wrong for the posture of the case. The graded matrix produced this
unprompted more than once: a drafting arm noticed that a statutory skeleton section did
not fit the case's posture and reserved it rather than filling it. That is correct
behavior here too. Where a shell section does not fit what the record shows, mark it in
render-visible text and reserve it to the attorney rather than filling it with something
that reads well.
