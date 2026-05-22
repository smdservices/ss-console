#!/usr/bin/env bash
# load-demo-fixtures.sh: load (or unload) demo-fixture rows into a
# customer's Hermes Machine substrate. Issue #890.
#
# Loads the 8 synthetic PI matters from PR #832 plus the generated
# communications, calendar items, and synthetic voice samples into the
# per-customer memory + voice stores. Every row is tagged
# is_demo_fixture: true so the unload path can remove them cleanly.
#
# Usage:
#   ai-employee/bin/load-demo-fixtures.sh <customer-slug> <vertical>
#   ai-employee/bin/load-demo-fixtures.sh <customer-slug> <vertical> --unload
#
# v1 vertical: pi (personal-injury). Future verticals register a
# VerticalConfig in bin/lib/demo_fixtures.VERTICAL_REGISTRY.
#
# Safety invariant
# ----------------
# The loader refuses to run when the target customer's substrate
# already holds any row that is NOT tagged is_demo_fixture: true.
# This prevents the demo tool from ever touching real customer data.
# A refusal exits non-zero (code 4); no rows are written or removed.
#
# Exit codes:
#   0  load or unload completed (including idempotent re-runs)
#   2  preflight failed (missing slug / dir / fixtures / unknown vertical)
#   4  safety refusal (target customer holds non-demo rows)
#
# Composition
# -----------
# Runs after `bin/provision-customer.sh` has materialized the customer
# directory + customer.yaml. Does not require the Fly Machine to be
# reachable; the default substrate writer is file-backed under
# ai-employee/customers/{slug}/.demo-fixtures-state.json. Live D1
# wiring is a follow-on (see docs/specs/ai-employee/demo-fixture-loader.md).
#
# Removal
# -------
# `--unload` removes every row tagged is_demo_fixture: true.
# Re-running after removal is a no-op. The unload path enforces the
# same safety invariant: if a non-demo row appears (which should be
# impossible on a demo customer), the tool refuses rather than risk
# deleting it.

set -euo pipefail

SLUG="${1:-}"
VERTICAL="${2:-}"
if [ -z "${SLUG}" ] || [ -z "${VERTICAL}" ]; then
  cat >&2 <<'USAGE'
Usage: load-demo-fixtures.sh <customer-slug> <vertical> [--unload]

Vertical (v1):
  pi   personal-injury law-firm corpus (8 matters + generated docs)

Examples:
  load-demo-fixtures.sh demo-pi-firm pi
  load-demo-fixtures.sh demo-pi-firm pi --unload
USAGE
  exit 2
fi

shift 2

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AIE_ROOT="${REPO_ROOT}/ai-employee"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [load-demo-fixtures/${SLUG}/${VERTICAL}] $*"
}

# Forward all remaining args (e.g. --unload, --customers-root, etc.)
# to the Python CLI so flag handling stays in one place.

log "starting"

cd "${AIE_ROOT}"

set +e
uv run --quiet --with pyyaml python3 -m bin.lib.demo_fixtures_cli \
  "${SLUG}" "${VERTICAL}" "$@"
EXIT_CODE=$?
set -e

case "${EXIT_CODE}" in
  0) log "complete" ;;
  2) log "preflight failed (exit 2); see stderr" ;;
  4) log "safety refusal (exit 4); target customer holds non-demo rows" ;;
  *) log "unexpected exit ${EXIT_CODE}" ;;
esac

exit "${EXIT_CODE}"
