# Discrimination test — assessment-interview — 2026-06-05

The Phase-1 deliverable: prove the loop closes **and** that the harness can tell a
good interview from a bad one. Same persona (`rambler`), two interviewers, each
transcript graded by an independent blind subagent (the method in `GRADING.md`),
blind to the expected verdict.

| Interviewer                                       | Verdict        | Score | Coverage | Probe-hit rate | Teach-backs | Fabrications                                                                      | Termination                                  |
| ------------------------------------------------- | -------------- | ----- | -------- | -------------- | ----------- | --------------------------------------------------------------------------------- | -------------------------------------------- |
| `assessment-interview` (real, thin Phase-1 skill) | **autonomous** | 96    | 5/5      | 4/4 (1.0)      | 4           | none                                                                              | done_signal, 23 turns                        |
| `null` (negative control)                         | **fails**      | 12    | 0 probed | 0/4 (0.0)      | 0           | **2 high-severity** ($2.8M revenue + "Maria will own this" champion, both caught) | done_signal, 7 turns, premature-DONE flagged |

**Discrimination gap: 84 points — `autonomous` vs `fails`.** On live-generated
transcripts, not hand-authored ones.

## What this proves (and what it doesn't)

- **Loop closed** — transcripts generate, terminate, and land. ✅
- **The harness discriminates** — an 84-point, verdict-separating gap between the
  real interviewer and the null control. ✅
- **Fabrication attribution works** — the null control's two invented client-facing
  facts were both caught and attributed to the interviewer; the real interviewer's
  faithful reflection of owner-stated facts was correctly NOT flagged. ✅
- **NOT yet "caliber credible."** One real run scoring 96 is encouraging signal, not
  proof. The honest caliber gate is the Phase-3 Captain calibration round over
  ≥10–15 transcripts, reported as an agreement fraction with n. Do not over-read a
  single autonomous score.

## Grader notes worth carrying to Phase 2

The real-transcript grader flagged two stylistic (non-rubric) tendencies to tighten
in the fleshed-out skill: the interviewer leans on affirmation/flattery that
occasionally borders on leading the witness, and it accepted the owner's
"we're better than average" pushback on customer experience without probing what
"solid Google reviews" means operationally.

## Reproduce

```bash
ANTHROPIC_API_KEY=... npx tsx operator/assessment-eval/cli.ts --persona rambler --interviewer real
ANTHROPIC_API_KEY=... npx tsx operator/assessment-eval/cli.ts --persona rambler --interviewer null
```

The two transcripts graded here are committed alongside this summary as the first
golden-transcript candidates for the Phase-3 CI drift sentinel (Captain-assigned
verdicts: real → autonomous, null → fails).
