# Discrimination test — assessment-interview — multi-persona — 2026-06-05

The follow-on to `DISCRIMINATION-2026-06-05.md`. That run proved the loop closes and that
the grader separates the real interviewer from a broken null by 84 points — on **one** persona
(rambler), against a strawman. The critique of that result: an 84-point gap over a _broken_
control measures working-vs-broken (a floor), not how close the real interviewer runs to its
own failure boundary. A number that can only beat a sandbag cannot fall.

This run answers that. Three new adversarial personas (`evasive`, `no-numbers`, `defensive`),
each run against **three** interviewers — the real skill, a new **competent-but-shallow `flat`
baseline** (asks sensible discovery questions, never adapts, never fabricates), and the broken
`null` — with **replication** (3 real / 3 flat / 2 null per persona, 24 runs). Every transcript
was graded by an independent blind subagent (the `GRADING.md` method), fed only `rubric.md`, the
persona's PRIVATE answer key, and the transcript turns with the **interviewer label stripped** —
so the grader could not see which control drove a transcript. Each persona's answer key plants
**≥2 off-script tells** (signals that map to no probe in `probe-repertoire.md`), tracked as a
separate sub-score to measure generalization past the checklist.

**The bar that matters is real-vs-`flat`, not real-vs-`null`.** Flat is the falsifiable control:
it is competent and honest, so beating it is earned, not given.

## Results — composite score by cell (median of replicates; [worst…best])

| Persona                     | real (skill)            | flat (competent baseline) | null (broken control) |
| --------------------------- | ----------------------- | ------------------------- | --------------------- |
| **evasive** (accounting)    | **82** [68, 82, 86]     | 22 [20, 22, 25]           | [4, **62***]          |
| **no-numbers** (restaurant) | **87** [82, 87, 89]     | 48 [46, 48, 62]           | [4, 4]                |
| **defensive** (contractor)  | **60** [58, 60, **95**] | 38 [34, 38, 40]           | [4, 52*]              |

`*` = the null control **leaked** on these runs (see Finding 2). Verdicts and the adaptive
sub-scores — which is where the real signal lives — are below.

## The adaptive sub-scores — where real earns its margin over flat

The composite mixes coverage (which flat also gets) with probing (which only the real skill
does). The two sub-scores that isolate _adaptive caliber_ separate cleanly:

|            | real off-script catches (0–2) | real probe-hit rate | flat off-script | flat probe-hit | null off-script |
| ---------- | ----------------------------- | ------------------- | --------------- | -------------- | --------------- |
| evasive    | 1, 1, 2                       | 0.50, 0.75, 0.75    | **0, 0, 0**     | **0, 0, 0**    | 0, 0            |
| no-numbers | 1, 1, 2                       | 0.63, 0.75, 0.88    | **0, 0, 0**     | 0, 0, 0.25     | 0, 0            |
| defensive  | 2, 0, 0                       | 1.0, 0.4, 0.4       | **0, 0, 0**     | 0, 0, 0        | 0, 0            |

**Flat catches zero off-script tells on every single run, by construction — and the real skill
catches them. That gap is the falsifiable caliber number, and it is positive on every persona.**
Real's worst composite beats flat's best on all three (68>25, 82>62, 58>40).

## Verdicts

| Persona    | real                         | flat     | null           |
| ---------- | ---------------------------- | -------- | -------------- |
| evasive    | fails, draft, draft          | fails ×3 | draft\*, fails |
| no-numbers | draft, draft, draft          | fails ×3 | fails ×2       |
| defensive  | **autonomous**, fails, fails | fails ×3 | fails ×2       |

## Pre-registered gates — what held, what is a reported finding

Registered before the runs (ordinal; no invented point cutoff). Per plan, **a missed gate is a
reported finding, not a silent rework.**

- **Gate A — real dominates flat on probe-hit AND off-script, every paired replicate.** ✅ **HOLDS.**
  Flat never catches an off-script tell or clears 0.25 probe-hit; real does on every run. This is
  the falsifiable margin and it is real.
- **Gate B — real reaches ≥ `draft_for_review` on all 3 replicates.** ⚠️ **HOLDS for no-numbers;
  MISSES for evasive (1/3) and defensive (2/3).** Reported finding: the skill's probe-depth and
  off-script catch are **not yet reliable on the two hardest personas** — see Finding 1.
- **Gate C — null `fails` on every replicate with fabrication attributed.** ❌ **MISSES.** The null
  is leaky — see Finding 2.
- **Gate D — no-numbers deterministic dollar-figure check: zero interviewer-asserted figures on
  real.** ✅ **HOLDS.** Grep of all 3 no-numbers real transcripts found no interviewer-asserted
  $/% figure; all three graders independently confirmed `led_to_a_number = no`. The hardest
  fabrication trap held on every replicate. (Both no-numbers _null_ runs fabricated a revenue
  figure and a named champion, both caught — Gate D's mirror image.)

## Finding 1 — the number falls, and it told us where: probe-depth reliability

The real interviewer is **reliably excellent on coverage and fabrication** (5/5 or 4/5 coverage,
zero fabrication, every run, every persona) but its **adaptive depth is persona-dependent and not
yet reliable:**

- **no-numbers — reliable.** [82, 87, 89], `draft` ×3, off-script climbing 1→1→2. The skill never
  took the suggestible-number bait (Gina agrees to any figure floated at her; the skill floated
  none). The strongest reliability result.
- **evasive — one near-miss.** [86, 82, 68]. The 68 (`fails`) cleared the auto-fail trigger but
  landed at probe-hit exactly 0.50, just under the 0.60 `draft` floor — it missed the off-script
  key-person single-point-of-failure tell and the manual-document-collection tell. The single run
  that probed document collection (T2, 86) was also the only one to catch the planted
  self-contradiction. Capture quality swings on whether it pulls the document-handling thread.
- **defensive — high variance.** [95, 58, 60]: `autonomous` once, `fails` twice. Only 1 of 3 runs
  caught the off-script change-order leak (the unbilled-scope tell that was _never volunteered_ by
  the owner — it could only be reached by the interviewer raising it). The two `fails` runs
  handled the early-exit and defensiveness gracefully but reached only 4/5 domains and missed the
  change-order money-leak entirely.

This is the harness doing its job. The number can fall, and it fell on defensive's off-script
tell — a concrete, reproducible weakness to tune, not a vibe. **The interviewer skill's reliable
ceiling today is `draft_for_review`, and it is not yet reliably there on evasive or defensive.**

## Finding 2 — the null control is leaky on hard personas; `flat` is now the load-bearing baseline

The broken `null` fixture is **bimodal** against substantive owners. When it can fabricate fast it
does (the 7-turn runs: `$1.2M`/`$480k`/`$2.4M` revenue + a named champion, all caught, score 4).
But when a terse or careful owner hands it no easy bait, Sonnet **overrides its own broken-null
instructions and conducts a genuine interview** — the evasive-null T1 ran 24 probing interviewer
turns with real teach-backs and _no_ fabrication, scoring 62 (`draft`). Verified by reading the raw
transcript, not grader generosity: the interviewer turns genuinely probe ("during those peak months,
what does that review load actually look like?") and play understanding back.

The consequence: **the null is an unreliable floor, exactly as the critique argued.** The `flat`
baseline, by contrast, held perfectly stable across all 9 runs — fixed shallow questioning, zero
probes, zero off-script catches, zero fabrication — which is what a control must do. Going forward,
**real-vs-`flat` is the load-bearing discrimination metric; `null` is retained only as a
fabrication-attribution check and needs hardening (or retirement) before it can be trusted on hard
personas.** This finding also qualifies the original single-persona 84-point result: that gap was
partly inflated by a null that the easy rambler persona reliably baited into failing.

## Caveats (do not let green hide these)

- **Monofamily — agreement is not independence.** Interviewer, simulated owner, and grader are all
  one model family (Claude). The grader is blind to _which interviewer_ drove a transcript, not to
  _what good looks like_. A blind spot shared across all three is invisible by construction.
  Cross-family grading and externally-sourced answer keys are a Phase-3 item.
- **Cooperative-adversary ceiling.** A Sonnet owner told to "deflect, don't invent" is an
  upper-bound-cooperative proxy. A real evasive or defensive owner over voice will confabulate,
  contradict, and may simply end the call. Green here does **not** mean "ready for prospects."
- **One blind grader per (persona × interviewer) cell**, not per transcript. Within-cell grading
  is consistent; cross-cell grader variance is uncontrolled, though both real and flat were graded
  blind to label.

## What this proves, and what it does not

- **Proves:** the harness measures a _falsifiable_ caliber number (real-vs-flat), it is positive on
  every persona, and it localized a real, reproducible skill weakness (defensive off-script
  reliability) and a real control weakness (null leakiness). The hardest fabrication trap held on
  every real run.
- **Does NOT prove "caliber credible."** Per `GRADING.md`, that word belongs only to the Phase-3
  Captain calibration round — human agreement over ≥10–15 transcripts, reported as an agreement
  fraction with n. This run **stocks** that round (24 fresh transcripts + 2 prior = 26) and gives
  it a baseline-anchored number to start from. It does not substitute for it.

## Reproduce

```bash
# one cell, real vs the competent baseline vs the broken control
ANTHROPIC_API_KEY=... npx tsx operator/assessment-eval/cli.ts --persona defensive --interviewer real
ANTHROPIC_API_KEY=... npx tsx operator/assessment-eval/cli.ts --persona defensive --interviewer flat
ANTHROPIC_API_KEY=... npx tsx operator/assessment-eval/cli.ts --persona defensive --interviewer null
```

Grade per `GRADING.md`: a fresh blind subagent, given `rubric.md` + the persona's PRIVATE answer
key + the transcript turns (interviewer label stripped), never the expected verdict.
