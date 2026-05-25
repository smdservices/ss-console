"""ai-employee/judging — LLM-as-judge harness for the scenario regression layer.

Per the test plan v2 §"Layer 2 — Behavioral regression":

  - ``judge.py`` — single-file LLM-judge with Haiku pre-filter + Opus escalation.
  - ``fabrication_check.py`` — deterministic Pattern A/B fabrication detector that
    runs BEFORE the LLM-judge ever sees the agent's output. If fabrication is
    detected here, the verdict is auto-FAIL with confidence 1.0; the LLM-judge is
    not invoked.
  - ``calibration_anchors/`` — 10-15 anchor scenarios with Captain-graded ground
    truth verdicts. The per-PR calibration sentinel re-judges these on every L2
    run; if LLM-judge agreement with the anchor set drops below 90% on any single
    run, the CI build fails with "calibration drift detected."
  - ``MODEL_PIN.md`` — the Anthropic model IDs the judge is pinned to. No auto-
    upgrade. A version bump triggers full calibration.

The module exists alongside (not inside) ``ai-employee/grading/`` because grading
holds the rubric and Captain's calibration packets (human-authored truth), while
judging holds the runtime LLM-judge that grades scenario runs against that
rubric. Same separation as voice-gate-vs-voice-plugin in the plan §"Locked
answers" #5.
"""
