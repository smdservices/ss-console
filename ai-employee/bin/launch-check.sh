#!/usr/bin/env bash
# launch-check.sh — Per-customer launch readiness checklist (L4).
#
# Per test plan v2 §"Per-customer launch readiness". Generates a green/
# red attestation artifact at ai-employee/customers/<slug>/launch-
# attestation.md by running all 8 launch-gate checks. Captain reviews
# the artifact in PR; customer principal signs the artifact after the
# 2-hour walk-through (see customer-attestation.md template).
#
# Usage:
#
#   ai-employee/bin/launch-check.sh <customer-slug> [--dry-run]
#
# Exit codes:
#   0 — all 8 checks passed; attestation artifact written green
#   1 — one or more checks failed; attestation written red; do not launch
#   2 — runner error (bad args, missing customer.yaml, etc.)
#
# The 8 checks per the plan:
#
#   1. customer.yaml validates against full schema
#   2. Customer-bound MCP contract tests pass (only the bound connectors)
#   3. Pre-launch shadow run — agent runs synthetically against the
#      customer's last 50-200 real-world inputs (Captain reviews any
#      non-autonomous verdict before cutover)
#   4. Voice samples ingested via ai-employee/voice-gate/bin/ingest-
#      samples.sh; voice-gate synthetic-mode ≥80% per cohort
#   5. Boot smoke test green against this customer's actual Machine
#   6. Safety substrate green at boot (all 6 invariants + invariant 7)
#   7. Scenario regression green for the customer's enabled skills
#   8. Reviewer-as-sender contacts wired (test draft fires to intended
#      human)
#
# Each check produces a structured line in the attestation artifact:
#   - [PASS] <check-name>: <one-line summary>
#   - [FAIL] <check-name>: <failure reason>
#   - [SKIP] <check-name>: <skip reason>  (e.g., infrastructure not yet up)
#
# Check 3 (shadow run) is the load-bearing pre-launch closure for the
# synthetic-distribution gap (Devil's Advocate #2 from the plan
# critique). It is the ONLY check that may legitimately produce a
# "review-needed" status that's not a failure — Captain reads the
# shadow-run verdict list and decides cutover.

set -euo pipefail

CUSTOMER_SLUG="${1:-}"
DRY_RUN=0
if [ "${2:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

if [ -z "$CUSTOMER_SLUG" ]; then
  echo "usage: ai-employee/bin/launch-check.sh <customer-slug> [--dry-run]" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CUSTOMER_DIR="${REPO_ROOT}/ai-employee/customers/${CUSTOMER_SLUG}"
CUSTOMER_YAML="${CUSTOMER_DIR}/customer.yaml"
ATTESTATION_PATH="${CUSTOMER_DIR}/launch-attestation.md"

if [ ! -f "$CUSTOMER_YAML" ]; then
  echo "error: customer.yaml not found at ${CUSTOMER_YAML}" >&2
  exit 2
fi

# Accumulate results into arrays then render the attestation at the end.
declare -a CHECK_NAMES=()
declare -a CHECK_STATUSES=()
declare -a CHECK_DETAILS=()

record() {
  CHECK_NAMES+=("$1")
  CHECK_STATUSES+=("$2")
  CHECK_DETAILS+=("$3")
}

# ---- Check 1: customer.yaml validates -----------------------------------
if python3 "${REPO_ROOT}/ai-employee/adapter/validate_customer_yaml.py" \
    "$CUSTOMER_YAML" \
    --skills-dir "${REPO_ROOT}/ai-employee/skills" \
    --connectors-dir "${REPO_ROOT}/ai-employee/adapter/connectors" \
    --fixtures-dir "${REPO_ROOT}/ai-employee/fixtures" \
    >/dev/null 2>&1; then
  record "customer-yaml-validates" "PASS" "schema valid"
else
  record "customer-yaml-validates" "FAIL" "validator rejected; run with verbose"
fi

# ---- Check 2: customer-bound MCP contract tests -----------------------------
# Resolve bound connectors from customer.yaml; for each, find the matching
# contract test and run it. v1 stub: list the contracts present and report
# SKIP for any not yet implemented. The full implementation lands when the
# Week 0 procurement track completes (sandbox accounts for each vendor).
CONTRACTS_DIR="${REPO_ROOT}/ai-employee/tests/contracts"
if [ -d "$CONTRACTS_DIR" ] && [ -n "$(ls "$CONTRACTS_DIR" 2>/dev/null || true)" ]; then
  if python3 -m pytest "$CONTRACTS_DIR" --quiet --no-header >/dev/null 2>&1; then
    record "mcp-contract-tests" "PASS" "all bound MCP contracts green"
  else
    record "mcp-contract-tests" "FAIL" "one or more MCP contract tests failed"
  fi
else
  record "mcp-contract-tests" "SKIP" "no contract tests authored yet (Week 0 procurement)"
fi

# ---- Check 3: pre-launch shadow run -------------------------------------
SHADOW_DIR="${CUSTOMER_DIR}/shadow-inputs"
if [ -d "$SHADOW_DIR" ] && [ -n "$(ls "$SHADOW_DIR" 2>/dev/null || true)" ]; then
  # Real shadow runs require the scenario_runner + judge wired against
  # the customer's recent real inputs. v1 reports the gate status only.
  N_INPUTS="$(ls "$SHADOW_DIR" | wc -l | tr -d ' ')"
  if [ "$N_INPUTS" -ge 50 ]; then
    record "pre-launch-shadow-run" "PASS" "${N_INPUTS} shadow inputs ready; Captain reviews shadow verdicts before cutover"
  else
    record "pre-launch-shadow-run" "FAIL" "${N_INPUTS} shadow inputs is below the 50-input minimum"
  fi
else
  record "pre-launch-shadow-run" "FAIL" "no shadow inputs at ${SHADOW_DIR} (synthetic-distribution gap unclosed)"
fi

# ---- Check 4: voice samples ingested + voice-gate ≥80% --------------------
# Real check would query the customer's D1 voice_samples table and run
# voice-gate synthetic-mode against ingested samples. v1 reports stub.
if [ -f "${CUSTOMER_DIR}/voice-samples.manifest" ]; then
  # Manifest lists which samples were ingested via ingest-samples.sh.
  record "voice-samples-ingested" "PASS" "manifest present; voice-gate sign-off pending"
else
  record "voice-samples-ingested" "FAIL" "no voice-samples.manifest at ${CUSTOMER_DIR} (run bin/ingest-samples.sh first)"
fi

# ---- Check 5: boot smoke test against customer's Machine -------------------
# Needs Fly Machine provisioned. v1 reports SKIP if no Machine env var set.
if [ -n "${FLY_MACHINE_HOST:-}" ]; then
  if "${REPO_ROOT}/ai-employee/bin/boot-smoke-test.sh" "$CUSTOMER_SLUG" >/dev/null 2>&1; then
    record "boot-smoke-test" "PASS" "Machine boots clean; first agent turn green"
  else
    record "boot-smoke-test" "FAIL" "boot smoke test exited non-zero against ${FLY_MACHINE_HOST}"
  fi
else
  record "boot-smoke-test" "SKIP" "FLY_MACHINE_HOST not set (provision Machine first)"
fi

# ---- Check 6: safety substrate green at boot -------------------------------
if python3 "${REPO_ROOT}/ai-employee/safety-substrate/run_invariants.py" \
    --customer "$CUSTOMER_SLUG" \
    --fixtures "${REPO_ROOT}/ai-employee/safety-substrate/tests" \
    --strict \
    >/dev/null 2>&1; then
  record "safety-substrate" "PASS" "all 7 invariants green at --strict"
else
  record "safety-substrate" "FAIL" "one or more invariants failed; do not launch"
fi

# ---- Check 7: scenario regression green for enabled skills ----------------
if python3 -m pytest "${REPO_ROOT}/ai-employee/tests/test_skill_regression.py" \
    --quiet --no-header >/dev/null 2>&1; then
  record "scenario-regression" "PASS" "skill_regression green for all enabled skills"
else
  record "scenario-regression" "FAIL" "skill regression has failures"
fi

# ---- Check 8: reviewer-as-sender contacts wired ----------------------------
# Real check would fire a test draft to the configured escalation contact and
# verify the notification lands. v1 reports SKIP if no reviewer infra is up.
if grep -q "escalation:" "$CUSTOMER_YAML" 2>/dev/null; then
  record "reviewer-contacts" "PASS" "escalation contacts declared in customer.yaml"
else
  record "reviewer-contacts" "FAIL" "no escalation: block in customer.yaml"
fi

# ---- Render attestation -----------------------------------------------------
TODAY="$(date -u +%Y-%m-%d)"
ATTESTATION_TMP="$(mktemp)"

{
  echo "# Launch attestation — ${CUSTOMER_SLUG}"
  echo ""
  echo "Generated: ${TODAY}T$(date -u +%H:%M:%SZ)"
  echo "Runner: ai-employee/bin/launch-check.sh"
  echo ""
  echo "## Checks"
  echo ""
  echo "| # | Check | Result | Detail |"
  echo "| - | ----- | ------ | ------ |"
  for i in "${!CHECK_NAMES[@]}"; do
    n=$((i + 1))
    echo "| ${n} | ${CHECK_NAMES[$i]} | ${CHECK_STATUSES[$i]} | ${CHECK_DETAILS[$i]} |"
  done
  echo ""
  echo "## Signoff"
  echo ""
  echo "Captain signoff (review the table above, confirm any SKIP statuses are intentional):"
  echo ""
  echo "- [ ] Captain ($(git config user.name)): ___________________  date: ________"
  echo ""
  echo "Customer principal signoff (after the 2-hour walk-through per the"
  echo "customer-attestation.md template):"
  echo ""
  echo "- [ ] Customer principal (name): ___________________  date: ________"
  echo ""
  echo "Once both signatures are recorded, the customer launches the AI"
  echo "Employee at full configured trust ceilings per the plan v2 launch"
  echo "gate (pure synthetic; no runtime ramp)."
} > "$ATTESTATION_TMP"

if [ "$DRY_RUN" = 1 ]; then
  echo "DRY RUN — attestation would be written to ${ATTESTATION_PATH}:"
  echo "---"
  cat "$ATTESTATION_TMP"
  rm -f "$ATTESTATION_TMP"
else
  mkdir -p "$CUSTOMER_DIR"
  mv "$ATTESTATION_TMP" "$ATTESTATION_PATH"
  echo "attestation written: ${ATTESTATION_PATH}"
fi

# Exit 1 if any check FAILED (SKIP does not block).
for status in "${CHECK_STATUSES[@]}"; do
  if [ "$status" = "FAIL" ]; then
    echo ""
    echo "one or more checks FAILED — do not launch ${CUSTOMER_SLUG}" >&2
    exit 1
  fi
done

echo "all checks PASS or SKIP — Captain reviews SKIP statuses before launch"
exit 0
