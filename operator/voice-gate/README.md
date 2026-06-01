# Voice-gate harness

Blind-test scaffolding for the Platform PRD §9.6 voice quality gate. Resolves issue [#823](https://github.com/venturecrane/ss-console/issues/823); implements the data plane for [voice-gate-fallback.md](../../docs/specs/operator/voice-gate-fallback.md).

## What this is

Before any external draft ships under a customer's name, the platform runs a blind test: a reviewer panel sees customer-authored drafts mixed with agent-drafted ones, unlabeled, and identifies each as "customer," "agent," or "uncertain." If the agent drafts are indistinguishable from the customer's own writing **≥80% of the time** (PRD §9.6 acceptance threshold), the voice gate passes and the first external draft is unlocked.

This harness is the scoring + panel scaffolding that drives that blind test. It is **pure** — it does not read or write databases, does not call audit logs, does not send messages. The caller (CLI runner today; dashboard form in a future workstream) hands it drafts + identifications and receives a structured `GateResult`.

## Input / output contract

**Input** (`RunVoiceGateInput`):

- `customer_slug` — namespaces the run; written to the audit log row
- `cohort` — `'client' | 'opposing-counsel' | 'internal-team' | 'all'` (PRD §9.3 Layer 3 v1)
- `run_id` — ULID-shaped; doubles as the deterministic-shuffle seed
- `drafts` — `BlindTestDraft[]` with ground-truth `authorship` labels; the panel layer strips these before presentation
- `panel` — judge IDs invited to the panel
- `cycle_count` — 0 for first attempt, 1 for first near-pass retry, 2 for second; 2+ with score <80% auto-transitions to fail per `voice-gate-fallback.md` §Near-pass cycle
- `identifications` — `JudgeIdentification[]` collected from the panel
- `enforceProductionMinimums` — `false` for synthetic-fixture tests; `true` for real customer runs (≥10 drafts per authorship, ≥3 judges)

**Output** (`GateResult`):

- `state` — `'pass' | 'near-pass' | 'fail'`
- `audit_action` — `'VOICE_GATE_PASSED' | 'VOICE_GATE_NEAR_PASS' | 'VOICE_GATE_FAILED'` (matches `d1-schema.md` §1 `audit_log.action_type`)
- `score_pct` — indistinguishability % in [0, 100]
- `per_cohort` — breakdown when run was `'all'`
- `failure_record` — populated when `state === 'fail'`; encodes the structured record the disclosure protocol consumes (`recommended_path`, `auto_transitioned_from_near_pass`, `flagged_judge_ids`, `below_threshold_cohorts`)
- `near_pass_record` — populated when `state === 'near-pass'`; flags whether this is the final allowed cycle
- `summary` — one-line human-readable string

The harness also exposes `buildAuditRow(rowId, run, result, ts)` which produces a typed `VoiceGatePanelScoreRow` ready for the future D1 writer.

## CLI

Captain re-runs the gate on demand for any active customer:

```bash
operator/bin/run-voice-gate.sh \
  --customer-slug smith-pi-firm \
  --panel-id panel-001 \
  --mode synthetic \
  --identifications operator/voice-gate/fixtures/example-identifications.json
```

Exit codes:

- `0` — PASS
- `1` — NEAR-PASS
- `2` — FAIL
- `3` — `--mode live` (not yet implemented; depends on the per-customer Hermes D1 binding + voice-sample ingestion store)
- `4` — runner error (bad args, malformed inputs)

## Files

- `types.ts` — typed shapes shared across the harness; the D1 row shape future-D1-writer will consume
- `scoring.ts` — threshold constants + `scoreRun` (the only place the 80% / 60% / cycle-count math lives)
- `panel.ts` — input validation, deterministic seeded shuffle, `PanelSession` for collecting identifications
- `harness.ts` — top-level `runVoiceGate` orchestrator and `buildAuditRow`
- `cli.ts` — Captain-facing CLI (synthetic mode in this PR; live mode stubbed)
- `index.ts` — public surface
- `fixtures/synthetic-set.json` — three cohorts × (1 customer + 2 agent) = 9 drafts; placeholder names per the no-fabricated-content discipline
- `fixtures/example-identifications.json` — sample judge inputs for the smoke-test CLI invocation
- `fixtures/loader.ts` — validates + parses the bundled JSON into `BlindTestDraft[]`
- `../bin/run-voice-gate.sh` — thin bash wrapper that invokes the CLI via `npx tsx`

## Threshold constants

All threshold logic lives in `scoring.ts`. Named constants — never repeat the numbers:

| Constant                               | Value | Source                                           |
| -------------------------------------- | ----- | ------------------------------------------------ |
| `VOICE_GATE_PASS_THRESHOLD_PCT`        | `80`  | PRD §9.6 acceptance threshold                    |
| `VOICE_GATE_NEAR_PASS_LOWER_PCT`       | `60`  | voice-gate-fallback.md §Three states             |
| `VOICE_GATE_MAX_NEAR_PASS_CYCLES`      | `2`   | voice-gate-fallback.md §Near-pass cycle (step 4) |
| `VOICE_GATE_MIN_DAYS_BETWEEN_CYCLES`   | `7`   | voice-gate-fallback.md §Near-pass cycle (step 3) |
| `PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP` | `10`  | voice-gate-fallback.md §Contract                 |
| `PRODUCTION_MIN_JUDGES`                | `3`   | voice-gate-fallback.md §Contract                 |

## Integration points (out of scope this PR)

This PR ships the scaffolding only. Three downstream workstreams compose with it:

1. **D1 writer for `audit_log` + per-customer scoring** — depends on per-customer Hermes D1 binding ([#800](https://github.com/venturecrane/ss-console/issues/800)). `buildAuditRow` already returns the typed row; the writer takes that row and inserts it.
2. **Voice-sample ingestion store** — depends on voice-sample upload UI (no issue filed yet). Today, real customer runs would have nothing to read from; the CLI's `--mode live` path returns a clear error pointing at this gap. When the store lands, the CLI's live mode reads `voice_samples.r2_key` per `d1-schema.md` §8 to source the drafts.
3. **Promotion gate wiring** — `bin/promote-customer-to-live.sh` should refuse to advance a customer whose latest `audit_log` `VOICE_GATE_*` event is not `VOICE_GATE_PASSED`. The shell wiring is out of scope; the audit row is the lookup key.
4. **Failure-path runtime hooks** — `voice-gate-fallback.md` §Verification items 2-4 (internal-drafts-only mode, disclosure artifact, cycle bound enforcement). The `FailureRecord` shape exposes everything those hooks need; they read the latest audit row and react.

## Why TypeScript

The `operator/grading/` harness is currently markdown-based (rubric + matrix), not code. There's no existing language to "match." We chose TypeScript so:

- Test execution rides on the existing `vitest` config (no Python toolchain to introduce)
- The typed `VoiceGatePanelScoreRow` shape lines up with the rest of `src/lib/operator/` (also TypeScript)
- The future dashboard form in `voice-gate-fallback.md` §Implementation notes can `import` directly from `operator/voice-gate/`

## Threshold-tuning workflow

The pass threshold is locked at 80% per PRD §9.6. If Captain tunes it (judge-pool adjustments per `voice-gate-fallback.md` §Failure modes, or Captain calibration round per the grading rubric), every consumer must move together. The named constants live in `scoring.ts`; changing them is the single edit point. Tests in `tests/voice-gate-scoring.test.ts` assert the current values explicitly so changes can't slip in silently.
