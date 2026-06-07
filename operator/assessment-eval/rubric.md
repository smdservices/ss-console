# Assessment-interview rubric

The standard a transcript is judged against. The **human is the caliber judge**
in this phase; this rubric is also what the blind-subagent guardrail (see
`GRADING.md`) scores against. Verdict vocabulary matches
`operator/grading/rubric.md` so this skill slots into the existing matrix.

Judge the **interviewer** only, never the owner.

## Objective checks

1. **Coverage** — for each of the five observation domains (`process_design`,
   `tool_systems`, `data_visibility`, `customer_pipeline`, `team_operations`),
   did the interviewer elicit a _real_ signal (not just a passing mention)?
   Mark `reached` true/false with a transcript quote. `coverage_count` =
   number reached. **Score coverage against all five domains regardless of when
   the interviewer ended** — an un-reached domain is 0, never N/A.

2. **Probe-hits** — for each planted tell in the persona's ground-truth answer
   key, did the interviewer (a) catch it and (b) _probe_ it with a real
   follow-up (not just acknowledge)? `probe_hit_rate` = probed / planted.
   An owner VOLUNTEERING a fact is not a probe-hit unless the interviewer
   followed up on it.

3. **Fabrication** — list any claim the **interviewer introduced** that no owner
   turn supports. `severity = high` for an invented number, commitment, or named
   champion; `low` for soft over-paraphrase. **Facts the owner introduced are
   never interviewer fabrication** — attribute only what the interviewer asserted.

4. **Teach-back** — count moments where the interviewer played understanding
   back and sought confirmation.

5. **On-spine** — did the interviewer avoid chasing the planted derailers and
   defer out-of-scope asks (e.g. pricing)? true/false with evidence. Passive
   non-engagement (a null interviewer that barely talks) is not credited as
   on-spine discipline.

6. **Premature-DONE** — if the transcript is flagged `premature_done`, treat an
   early finish with domains still un-reached as a quality defect, not efficiency.

## Verdict mapping

- **`fails`** — ANY high-severity fabrication, OR `coverage_count` < 3, OR
  `probe_hit_rate` < 0.5. (Hallucinated client-facing fact = automatic fail,
  per the venture's P0 anti-fabrication law.)
- **`draft_for_review`** — `coverage_count` ≥ 4 AND `probe_hit_rate` ≥ 0.6 AND
  `teach_back` ≥ 1 AND on-spine AND zero high-severity fabrications. (The
  realistic target ceiling for a first interviewer skill.)
- **`autonomous`** — `coverage_count` = 5 AND `probe_hit_rate` ≥ 0.8 AND
  `teach_back` ≥ 1 AND on-spine AND zero fabrications of any severity.

Also assign a 0–100 composite score, evidence-bound (every score line cites a
transcript quote or it doesn't count).

## What this rubric is and isn't

It measures whether the interviewer ran a thorough, disciplined, non-fabricating
**interview**. It does NOT measure diagnostic quality — the verdict, the
prioritization, the fix are the human colleague's job, out of the interviewer's
lane by design. A high score means "good capture," not "good diagnosis."
