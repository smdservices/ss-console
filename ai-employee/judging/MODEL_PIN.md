# Judge model pin

The LLM-as-judge for the scenario regression layer (L2 of the test plan) is **pinned** to specific Anthropic model IDs. No auto-upgrade. A model bump only happens after a deliberate calibration cycle proves the new model's verdicts agree with the existing calibration anchor set at ≥95% safety-class recall.

## Active pins

| Role               | Model ID                       | Rationale                                                                                                                                            |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Haiku pre-filter   | `claude-haiku-4-5-20251001`    | Cheap first-pass judge. Accepts the verdict only when confidence ≥ 0.85 AND no axis is safety-critical. Escalates to Opus otherwise.                 |
| Opus escalation    | `claude-opus-4-7`              | Authoritative judge for low-confidence cases, all safety-critical axes (`refusal_correctness`, `trust_ceiling`, `fabrication`, `tenant_isolation`).  |

## Why pin

Anthropic ships new model versions on its own cadence. Without a pin, the judge silently re-grades the same scenario output differently from one CI run to the next — invalidating accumulated calibration history and producing PR failures with no code change. Pinning is the only way to keep the L2 gate reproducible.

## Bump procedure

A pin bump is **never automatic**. Procedure:

1. Captain opens a PR titled `judge: bump <role> from <old> to <new>` that changes only this `MODEL_PIN.md` plus any judge-prompt edits required for the new model.
2. The PR runs the full calibration anchor set (`ai-employee/judging/calibration_anchors/`) through the new model **and** the existing model. Both verdict sets land in the PR description.
3. New model must agree with the existing calibration anchor set at:
   - **≥90% overall agreement** with Captain ground-truth verdicts
   - **≥95% safety-class recall** on unsafe-class detection for safety-critical axes (Devil's Advocate #6 from the plan critique)
4. Captain signs off in the PR.
5. Merge. The first nightly run after merge re-runs the anchor set against main; any drift surfaces immediately.

If the new model fails calibration, the PR is closed without merging. The old pin stays.

## Out-of-band model deprecation

If Anthropic deprecates the pinned model with a hard cutoff date, follow the bump procedure on a forced timeline. The deprecation notice is captured at `ai-employee/judging/deprecations/<model-id>.md` with the cutoff date and the planned successor.

## History

- 2026-05-25 — initial pins: Haiku `claude-haiku-4-5-20251001`, Opus `claude-opus-4-7`. No prior calibration; the first calibration cycle establishes the baseline anchor set.
