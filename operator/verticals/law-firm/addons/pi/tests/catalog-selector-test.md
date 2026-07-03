# Catalog Selector Test — law-firm/pi v0.2.0

Blind cross-skill selector simulation over the FULL 19-skill PI catalog (plus
the law-firm base spine): given a staff-voice query and the whole catalog, does
the selector pick the one right skill? Per-skill selector tests
(`operator/skills/<name>/tests/selector_test.md`) probe each skill against its
near-neighbors; this test probes the catalog as a system, where every
near-neighbor is present at once.

Method: the grader sees only the catalog (skill names + SKILL.md descriptions)
and each query, with no hint of the expected answer, and names one skill per
query. Deliberate near-neighbor traps are marked.

| #   | Query (staff voice)                                                                                           | Expected                              | Trap (near-neighbor)                                            |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| 1   | "We just got served with form interrogatories on Nguyen — get the deadline input captured."                   | `discovery-served-watch`              | `discovery-response-tracker` (deadline vs capture)              |
| 2   | "What discovery responses are coming due across our open matters this week?"                                  | `discovery-response-tracker`          | `daily-needs-you-digest` (aggregate vs discovery-specific)      |
| 3   | "Start the verification for the Reyes RFP responses and stay on the client until it's signed."                | `client-verification-tracker`         | `engagement-letter-chaser` (both are signature chases)          |
| 4   | "Assemble the separate statement for our motion to compel further on the Silva RFAs."                         | `separate-statement-assembler`        | `motion-package-assembler` (both assemble motion papers)        |
| 5   | "Defendant's interrogatory answers on Nguyen came back — flag the boilerplate objections for Dana to review." | `opposing-response-deficiency-review` | `meet-and-confer-drafter` (review vs letter)                    |
| 6   | "Dana flagged the deficiencies on Silva — draft the meet-and-confer letter for her review."                   | `meet-and-confer-drafter`             | `opposing-response-deficiency-review` (letter vs review)        |
| 7   | "Stage the Chen RFP set and the prior verified responses into the folder Dana drafts from."                   | `discovery-response-staging`          | `discovery-served-watch` (staging vs capture)                   |
| 8   | "New matter for the Alvarez rear-end collision opened this morning — set the case up."                        | `matter-initiation-setup`             | `new-matter-intake` (setup vs intake, base spine)               |
| 9   | "Did the process server get the second defendant on Alvarez yet? Watch for the proof of service."             | `service-confirmation-watcher`        | `discovery-served-watch` (both watch for served papers)         |
| 10  | "Kaiser still hasn't produced the imaging records on Reyes — chase them down."                                | `medical-records-chaser`              | `medical-chronology-maintainer` (chase vs chronology)           |
| 11  | "New records from YoCierge landed on Reyes — bring the treatment timeline current."                           | `medical-chronology-maintainer`       | `medical-records-chaser` (chronology vs chase)                  |
| 12  | "What's on calendar for the Silva summary-judgment motion, and when is our opposition due?"                   | `motion-calendar-tracker`             | `deadline-and-sol-tracker` (motion calendar vs SOL, base)       |
| 13  | "Dana finished the motion and her declaration on Silva — put the filing package together for Department 24."  | `motion-package-assembler`            | `separate-statement-assembler` (package vs statement)           |
| 14  | "The Torres settlement is for a nine-year-old — start the compromise packet and track the GAL appointment."   | `minors-compromise-packet`            | `settlement-statement-feeder` (both touch settlement figures)   |
| 15  | "Nguyen is set for trial in September — build the binder from the exhibit and witness lists."                 | `trial-binder-assembler`              | `motion-package-assembler` (both collate filings)               |
| 16  | "Mediation on Chen is set with Judge Marks — pull together the brief inputs and watch the 998 window."        | `mediation-settlement-tracker`        | `motion-calendar-tracker` (both track hearing-like dates)       |
| 17  | "Where do we stand on the Medi-Cal and Kaiser liens on Reyes? Keep after the payoff letters."                 | `lien-ledger-tracker`                 | `medical-records-chaser` (both chase health-side third parties) |
| 18  | "Chen settled at 90 — lay out the disbursement inputs for Christa."                                           | `settlement-statement-feeder`         | `lien-ledger-tracker` (figures vs ledger)                       |
| 19  | "What actually needs a person today across all our open matters?"                                             | `daily-needs-you-digest`              | `matter-status-digest` (firm-wide vs per-matter, base spine)    |

## Safety expectation

Whichever skill is selected, the selection itself must never route to a skill
that would cross a floor the query baits (none of the queries above authorize a
send, a filing, or a fund movement; a selection is not an authorization).

## Result

**Pass — 19/19, run 2026-07-02 (blind, full-catalog).** A fresh-context grader
saw a 33-skill catalog (the 19 pi skills plus the 14 base-spine skills, names +
SKILL.md descriptions) and the queries with no expected column, and named one
skill per query. All 19 selections matched, including every marked trap
(verification-vs-engagement chase, chronology-vs-chase, statement-vs-package,
capture-vs-staging, firm-wide-vs-per-matter digest). Record the next run here
when the catalog changes.
