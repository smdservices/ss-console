#!/usr/bin/env bash
# boot-smoke-test.sh — verify the dependency chain inside a customer Machine
#
# Usage:
#   operator/bin/boot-smoke-test.sh <customer-slug>
#
# Scope: this is a SMOKE TEST, not an end-to-end test. It verifies that
# bootstrap.sh's sequenced startup (customer.yaml fetched from R2 → Hermes
# profiles materialized → overlay plugins installed → curator disabled) came
# up cleanly. The Postgres/Redis/Honcho checks were removed when the Honcho
# data plane was deferred to Phase 2 (ADR 0016 revised). It does NOT exercise
# a real agent turn, a real LLM call,
# or a real D1 write through a connector. Those require live external
# credentials (MCP servers, Anthropic API, customer's OAuth tokens) and are
# the job of the per-connector prod smoke test in run_prod_smoke_test.py and,
# at higher fidelity, the boot-time end-to-end test described in §6 of the
# build plan.
#
# Each check logs PASS/FAIL with the slug + step name. Exit code: 0 if every
# check passes, non-zero on the first failure (fail-fast).

set -euo pipefail

SLUG="${1:-}"
[ -n "${SLUG}" ] || { echo "Usage: $0 <customer-slug>" >&2; exit 1; }

APP_NAME="hermes-${SLUG}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [smoke/${SLUG}] $*"; }
pass() { log "PASS: $*"; }
fail() { log "FAIL: $*"; exit 1; }

# ssh_exec <step-name> <command>
# Run a command inside the Machine via `fly ssh console`. The command is
# passed as a single string; non-zero exit fails the test with the step name.
ssh_exec() {
  local step="$1"
  shift
  local cmd="$*"
  # `fly ssh console --command` execs the string directly (no shell), so compound
  # commands (&&, |, $(...), [ ]) fail unless wrapped in an explicit shell. Wrap
  # every check in `sh -c` so shell constructs evaluate ON THE MACHINE. (Check
  # commands contain no single quotes, so the single-quoted wrapper is safe.)
  if fly ssh console -a "${APP_NAME}" --command "sh -c '${cmd}'" >/dev/null 2>&1; then
    pass "${step}"
  else
    fail "${step} — command failed: ${cmd}"
  fi
}

# ---------- Step 1: wait for Machine state=started ----------
log "Waiting for Machine state=started (up to 60s)..."
ATTEMPT=0
while [ "${ATTEMPT}" -lt 60 ]; do
  STATE="$(fly status -a "${APP_NAME}" --json 2>/dev/null \
    | python3 -c "import sys, json
try:
    d = json.load(sys.stdin)
    machines = d.get('Machines') or []
    print(machines[0]['state'] if machines else 'none')
except Exception:
    print('error')" 2>/dev/null || echo "error")"
  if [ "${STATE}" = "started" ]; then
    pass "machine-state-started (after ${ATTEMPT}s)"
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done
[ "${STATE}" = "started" ] || fail "machine-state-started — state=${STATE} after 60s"

# ---------- Steps 2-4: Postgres / Redis / Honcho — DEFERRED (Phase 2) ----------
# The Honcho data plane is deferred to Phase 2 (ADR 0016 revised); Phase 1 boots
# on Hermes' flat-file memory core, so there is no Postgres/Redis/Honcho to
# probe here. These checks return when Phase 2 vendors the real Honcho source.

# ---------- Step 5: customer.yaml present on volume ----------
ssh_exec "customer-yaml-present" "test -s /opt/data/customer.yaml"

# ---------- Step 6: Hermes profiles directory exists ----------
# bootstrap.sh's `hermes-smd bootstrap` step materializes one profile per
# entry in customer.yaml.personas[]. v1 customers ship at length 1; we just
# verify the parent directory exists and is non-empty.
ssh_exec "hermes-profiles-dir" "test -d /opt/data/profiles && [ -n \"\$(ls -A /opt/data/profiles)\" ]"

# ---------- Step 7: overlay plugins installed ----------
# `hermes plugins list` should include the four hermes-smd-* plugins
# installed at image-build time via `hermes plugins install venturecrane/hermes-smd-overlay`.
ssh_exec "hermes-plugins-installed" "/opt/hermes/.venv/bin/hermes plugins list | grep -q hermes-smd-"

# ---------- Step 8: Hermes curator disabled (ADR 0017) ----------
# The autonomous curator is turned off per-customer (it rewrites agent-authored
# skills out of band — see docs/adr/0017). bootstrap.sh step 7b enforces
# curator.enabled:false in every profile config; --check re-verifies it held.
ssh_exec "curator-disabled" "/opt/hermes/.venv/bin/python3 /app/ensure-curator-disabled.py --check /opt/data"

log "All boot smoke checks passed for ${APP_NAME}"
