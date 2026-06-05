# assessment-eval — prove the loop without voice

The keystone of ADR 0039 build step 1. A local harness that **generates**
multi-turn business-assessment transcripts (an interviewer LLM in conversation
with a simulated-owner LLM) so an interviewer skill's caliber can be judged — and
so we can tell a good interview from a bad one.

It is the analogue of `operator/voice-gate/`: local orchestration, never in the
Cloudflare Workers bundle. No voice, no telephony, no Hermes wiring, no portal,
no D1. Standalone by design.

## What it does and doesn't do

- **Generates** transcripts (this code).
- **Does not grade** them programmatically. Caliber is **human-judged** against
  `rubric.md`; the blind-subagent procedure in `GRADING.md` is the objective
  guardrail (a Phase-0 spike showed it discriminates good from bad by 76 points,
  so no bespoke grader was built).

## Run it

```bash
# real interviewer
ANTHROPIC_API_KEY=sk-ant-... npx tsx operator/assessment-eval/cli.ts --persona rambler

# null negative control — the discrimination test is reading these two side by side
ANTHROPIC_API_KEY=sk-ant-... npx tsx operator/assessment-eval/cli.ts --persona rambler --interviewer null
```

Run-logs land in `operator/grading/runs/assessment-interview/`. Cost is a few
cents per run (Sonnet, conversational turns). CI never runs the CLI — the
network-free unit test (`tests/assessment-eval-harness.test.ts`) covers the loop
mechanics and the PUBLIC/PRIVATE split.

## Layout

| Path                           | Role                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| `conversation.ts`              | the two-agent turn loop + termination (DONE sentinel + MAX_TURNS)         |
| `interviewer.ts` / `owner.ts`  | system-prompt builders (owner sees PUBLIC only)                           |
| `fixtures/loader.ts`           | persona parser; hard PUBLIC/PRIVATE split                                 |
| `llm.ts`                       | the only module importing `src/lib/llm/models.ts`; wired only by `cli.ts` |
| `run-writer.ts`                | transcript → markdown run-log                                             |
| `fixtures/interviewer-skill/`  | the real interviewer SKILL.md + references                                |
| `fixtures/null-interviewer.md` | the negative control                                                      |
| `fixtures/personas/`           | simulated owners (PUBLIC persona + PRIVATE answer key)                    |
| `rubric.md` / `GRADING.md`     | the grading standard + blind-subagent procedure                           |

## Known caveats (carried from the build critique)

- **The interviewer skill is authored runtime-agnostic.** All assessment logic
  (coverage, probing, completion) lives in the SKILL.md as self-executed
  instructions; the DONE sentinel is harness scaffolding only. This is so the
  same skill transfers to Hermes rather than baking logic into this TS loop.
- **Personas should be regrounded in real material.** The `rambler` persona is a
  first fixture; tells were authored alongside the probe repertoire, which risks
  teaching-to-the-test. Phase 3 adds a held-out persona (authored without sight
  of the repertoire) and an adversarial-to-coherence persona; Phase 2 dogfoods a
  real human owner (Scott) to anchor the synthetic reads.
- **A Sonnet owner is a weak proxy for a real owner over voice.** Treat the
  guardrail as a regression signal, not a quality oracle. The human calibration
  round (Phase 3) and dogfood (Phase 2) are the real gate.
