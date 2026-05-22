#!/usr/bin/env bash
# prepare-demo-firm.sh: pre-meeting readiness checks for a PI firm demo.
#
# Issue #819 / Platform PRD §16.2. Composes with provision-customer.sh
# (PR #812) by running afterward and verifying the substrate the
# provisioning script left behind. Read-only; never mutates the
# customer config, Fly Machine, or any external service.
#
# Usage:
#   ai-employee/bin/prepare-demo-firm.sh --firm-slug <slug>
#   ai-employee/bin/prepare-demo-firm.sh --firm-slug <slug> --min-voice-samples 10
#
# Exit codes:
#   0  every required check passed
#   2  preflight failed (missing dir / bad slug / template slug)
#   3  at least one required check failed
#   4  unexpected error
#
# Composition with the provisioning flow:
#
#   1. Captain authors ai-employee/customers/{slug}/customer.yaml and
#      dossier.md by copying ai-employee/customers/_template/.
#   2. Captain runs ai-employee/bin/provision-customer.sh {slug} which
#      validates customer.yaml, renders fly.toml, creates the Fly app,
#      sets secrets via pbpaste, deploys, and runs a per-connector
#      smoke test.
#   3. Captain runs this script to verify everything required for the
#      demo is in place: voice samples are ingested, the synthetic
#      matter is seeded, the customer.yaml memory invariants hold.
#
# Step 3 is read-only and re-runnable. Run it repeatedly during demo
# prep until it exits 0.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AIE_ROOT="${REPO_ROOT}/ai-employee"

# Forward all args to the Python CLI so flag handling stays in one
# place. We do not parse --firm-slug here because the CLI needs to
# know the canonical slug anyway and double-parsing risks drift.

# Run from inside ai-employee/ so `bin.lib.demo_prep_cli` resolves as a
# package, matching the layout the other adapter scripts use.
cd "${AIE_ROOT}"

set +e
uv run --quiet --with pyyaml python3 -m bin.lib.demo_prep_cli "$@"
EXIT_CODE=$?
set -e

exit "${EXIT_CODE}"
