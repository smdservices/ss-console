#!/usr/bin/env bash
# run-voice-gate.sh — drive the blind-test harness for a customer.
#
# Per voice-gate-fallback.md §Verification (item 1 "Gate runner"). The
# bash wrapper exists so Captain can invoke from anywhere; the heavy
# lifting is the TypeScript runner at operator/voice-gate/cli.ts.
#
# Usage (synthetic mode — runs against bundled fixtures + recorded
# identifications, used in CI and for smoke tests):
#
#   operator/bin/run-voice-gate.sh \
#     --customer-slug smith-pi-firm \
#     --panel-id panel-001 \
#     --mode synthetic \
#     --identifications operator/voice-gate/fixtures/example-identifications.json \
#     --allow-undersized
#
# The bundled fixture set is deliberately small (3 drafts/cohort), below
# the production minimum of 10 drafts per authorship (issue #1124). Since
# enforcement defaults ON, the synthetic smoke command MUST pass
# --allow-undersized (honored in synthetic mode only) or it exits 4 at
# validation before scoring.
#
# Usage (live mode — NOT YET IMPLEMENTED):
#
#   operator/bin/run-voice-gate.sh --customer-slug <slug> --panel-id <id> --mode live
#
# Live mode requires the per-customer Hermes D1 binding (#800), the
# voice-sample ingestion store, and the dashboard panel form. The CLI
# returns a clear error pointing at the integration plan; this wrapper
# does not attempt to bridge any of those.
#
# Exit codes mirror the gate state for CI use:
#   0 — PASS
#   1 — NEAR-PASS
#   2 — FAIL
#   3 — live mode not yet implemented
#   4 — runner error (bad args, malformed inputs)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec npx --yes tsx "${REPO_ROOT}/operator/voice-gate/cli.ts" "$@"
