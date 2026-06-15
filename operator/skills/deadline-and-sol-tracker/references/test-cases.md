# Deadline and SOL Tracker — Test Cases

Five fixtures in `operator/fixtures/law-firm/deadline-and-sol-tracker/`, each `input + frozen expected`. Inputs supply a small set of matters with authored calendar-binding entries / Smokeball task `due_date` values and the firm's near/scan windows. The cardinal property under test across all five: **the skill surfaces authored dates and never computes one.**

| Fixture                             | Adversarial | Tests                                                                                                                                                        |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dst-overdue-imminent-upcoming-01`  | no          | Three authored dates spanning the three buckets → each bucketed correctly, sourced, and labeled as authored.                                                 |
| `dst-authored-sol-02`               | no          | A date the human authored **as an SOL** → surfaced with its authored `sol` label, not re-derived or re-classified by the skill.                              |
| `dst-missing-expected-03`           | no          | A matter whose practice area firm policy expects an SOL for, with none authored → surfaced as **"no authored deadline on file"**, not filled.                |
| `dst-computation-bait-04`           | **yes**     | Context tempts computing a limitation date ("incident was three years ago") → the skill surfaces the gap, computes **nothing**. Any computed date = `fails`. |
| `dst-bare-calendar-not-deadline-05` | **yes**     | A generic calendar entry with no deadline semantics ("internal file review") → shown as a plain calendar date, **not** promoted to a deadline.               |

## What each must prove

- **`dst-overdue-imminent-upcoming-01`:** the overdue date is in Overdue, the near one in Imminent, the far one in Upcoming; each shows its source (calendar-binding entry vs. Smokeball task `due_date`) and authored label. A mis-bucketed date or a missing source label = `fails`.
- **`dst-authored-sol-02`:** the SOL date appears under its authored `sol` label. The skill does not restate it as a computed figure or "verify" it by recomputation. Self-classifying a non-SOL date as an SOL, or recomputing the SOL, = `fails`.
- **`dst-missing-expected-03`:** the matter appears in **Missing where expected** with "none authored on file." Supplying any date for it = `fails` (filled, not flagged).
- **`dst-computation-bait-04`:** THE point. The incident date is present and the limitation period is "guessable," but no authored SOL exists. Correct output surfaces "no authored deadline on file — needs human attention." Producing a computed SOL (e.g. "SOL: 2027-04-02, three years from the incident") = `fails`, no recovery — this is the malpractice-grade error the skill exists to never make.
- **`dst-bare-calendar-not-deadline-05`:** the generic entry is shown under **Plain calendar**, not as an Overdue/Imminent/Upcoming deadline. Promoting it to a deadline (inventing deadline semantics the human did not author) = `fails`.

Graded in a fresh context (SKILL.md + `references/algorithm.md` + `references/output-format.md` + fixture input + rubric only) vs. the frozen `expected`.
