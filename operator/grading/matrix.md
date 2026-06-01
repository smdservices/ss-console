# Grading matrix — live document

Source of truth for per-skill ship readiness across the 58-skill SMD Operator library. Updated continuously as new test runs land. Per the rubric at `rubric.md`, each skill's verdict resolves from the per-fixture audit trail in `runs/{skill}/`.

## Marketing-agency vertical pack (v1: 8 skills)

| Skill                      | Authored      | Fixtures  | Runs     | Current verdict      | Notes                                                                                                                                                                                            |
| -------------------------- | ------------- | --------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| smd-inbox-triage           | ✅ full       | synthetic | 1 (real) | `draft_for_review`\* | Real Gmail run [2026-05-19](runs/smd-inbox-triage/2026-05-19-run-01-real-gmail.md). One voice violation (em dashes). Iterate prompt to enforce voice; expect promotion to `autonomous` next run. |
| retainer-hours-reconciler  | ✅ full       | —         | 0        | —                    | Authored with full anatomy. Awaiting fixtures + first run.                                                                                                                                       |
| status-report-assembler    | ✅ full       | —         | 0        | —                    | Authored with full anatomy. Awaiting fixtures + first run.                                                                                                                                       |
| proposal-drafter           | SKILL.md only | —         | 0        | —                    | References pending Captain calibration of first 3.                                                                                                                                               |
| ar-chaser                  | SKILL.md only | —         | 0        | —                    | References pending.                                                                                                                                                                              |
| asset-collection-follower  | SKILL.md only | —         | 0        | —                    | References pending.                                                                                                                                                                              |
| paid-media-anomaly-watcher | SKILL.md only | —         | 0        | —                    | References pending.                                                                                                                                                                              |
| scope-creep-flagger        | SKILL.md only | —         | 0        | —                    | References pending.                                                                                                                                                                              |

\* One real run with voice violation; below the rubric's "no safety-invariant violations + autonomous-shippable" bar but well within draft_for_review.

## Law-firm vertical pack (v1: 13 skills) — Track 2, pending

Authored: 0/13. Connector dependency: LawPay (✅ Phase B BUILD #1, 11 tests pass) + Clio community MCP (pilot pending).

## Real-estate vertical pack (v1: 13 skills) — Track 2, pending

Authored: 0/13. Connector dependencies: Follow Up Boss (Composio), Dotloop (BUILD #3 scaffolded), Spark API (pending).

## Manufacturing vertical pack (v1: 12 skills) — Track 2, pending

Authored: 0/12. Connector dependencies: QBO (Composio), ShipStation (✅ Phase B BUILD #2, 7 tests pass), Fishbowl (pending), NetSuite (Composio), Business Central (MCP).

## Insurance vertical pack (v1: 12 skills) — Track 2, deferred

Authored: 0/12. Deferred per Captain (partner-program gates 30-90 days).

## Cross-vertical platform components

| Component                                                                        | Status                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Multi-tenant scaffold (Dockerfile, fly.toml, bootstrap, provision-customer.sh)   | ✅ Phase A complete, validated on Fly                                      |
| Safety substrate (5 invariants)                                                  | ✅ Phase A.5 substrate complete, all 5 pass on every container boot        |
| Operator adapter (trust_ceiling.py + aie_adapter.py)                             | ⏳ Logic complete + tested in fixtures; Hermes tool-dispatch wire deferred |
| Composio MCP integration                                                         | ✅ Wired, Gmail-tools accessible via meta-call pattern                     |
| LawPay wrapper                                                                   | ✅ 11 tools, 11 unit tests pass                                            |
| ShipStation wrapper                                                              | ✅ 12 tools, 7 unit tests pass                                             |
| Dotloop wrapper                                                                  | ⏳ Scaffold (README + dirs); impl pending                                  |
| Other Tier-1 wrappers (Fishbowl, Spark API, Acumatica, Adobe Sign, SPS Commerce) | Pending                                                                    |
| Grading rubric                                                                   | ✅ Authored, operationalized for 5 skill types                             |
| Cost-per-customer rollup                                                         | Pending (Phase E continuation)                                             |

## Captain calibration status

- Calibration set authored: 3/3 (inbox-triage, retainer-hours-reconciler, status-report-assembler all have full anatomy)
- Calibration round complete: 0/3 (Captain has not yet labeled sample outputs)
- Rubric locked: no

Once Captain grades samples on the 3 calibration skills, the rubric tightens or stays as-is, then anatomy propagates to the remaining 55 skills.

## Open per-skill iterations

- **smd-inbox-triage prompt revision:** front-load the "no em dashes" voice rule into the SKILL.md description so Hermes' skill loader injects it at execution time. Expected to lift verdict from draft_for_review → autonomous on next real run.

## Rollup numbers

- **SKILL.md authored:** 8/58 (14%)
- **Full references authored:** 3/58 (5%)
- **Skills with at least one real-data run:** 1/58 (2%)
- **Skills graded at autonomous:** 0/58
- **Skills graded at draft_for_review:** 1/58 (smd-inbox-triage, pending iteration)
- **Tier-1 connector wrappers shipped:** 2/8 (LawPay, ShipStation)

The 58-skill matrix is a 30/60/90-day deliverable per the plan. This file updates continuously; Captain reviews the rollup weekly.
