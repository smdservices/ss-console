#!/usr/bin/env bash
# Wrapper for connector smoke tests (issue #852).
#
# Invokes ai-employee/adapter/run_prod_smoke_test.py with the customer's
# customer.yaml. Used in two modes:
#
#   * Provisioning-time: called from bin/provision-customer.sh after
#     `fly deploy` succeeds. Exit code 2 aborts provisioning; exit 1
#     prints a warning but continues so Captain can decide.
#
#   * Periodic: invoked by the per-customer Cron Trigger (wiring lands
#     in a follow-on PR). The same exit-code semantics apply; the cron
#     wrapper additionally pipes failures into the dashboard alert
#     channel.
#
# Usage:
#
#   bin/run-connector-smoke-tests.sh <customer-slug> [<app-name>]
#
# When <app-name> is omitted, defaults to "hermes-<slug>" per the
# provisioning naming convention.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $(basename "$0") <customer-slug> [<app-name>]" >&2
  exit 64
fi

SLUG="$1"
APP_NAME="${2:-hermes-${SLUG}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CUSTOMER_YAML="${REPO_ROOT}/ai-employee/customers/${SLUG}/customer.yaml"

if [[ ! -f "${CUSTOMER_YAML}" ]]; then
  echo "FATAL: customer.yaml not found at ${CUSTOMER_YAML}" >&2
  exit 2
fi

echo "Running connector smoke tests for customer=${SLUG} app=${APP_NAME}"

# Use uv to source pyyaml without polluting the global env. The Python
# script handles its own sys.path setup so we do NOT cd into ai-employee.
set +e
uv run --quiet --with pyyaml python3 \
  "${REPO_ROOT}/ai-employee/adapter/run_prod_smoke_test.py" \
  --customer "${SLUG}" \
  --app "${APP_NAME}" \
  --customer-yaml "${CUSTOMER_YAML}"
EXIT_CODE=$?
set -e

case "${EXIT_CODE}" in
  0)
    echo "Connector smoke: PASS"
    ;;
  1)
    echo "Connector smoke: PARTIAL -- review output before enabling write capabilities"
    ;;
  2)
    echo "Connector smoke: FAIL -- aborting; do not enable write capabilities"
    ;;
  *)
    echo "Connector smoke: unexpected exit ${EXIT_CODE}"
    ;;
esac

exit "${EXIT_CODE}"
