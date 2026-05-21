#!/usr/bin/env bash
# rollback-skill.sh — pin a customer back to a previous content-hash of a skill.
#
# Skills are content-hashed; customer.yaml pins each enabled skill to a hash.
# When a new skill version regresses in prod, this script flips the pin in
# customer.yaml to the prior hash and redeploys. Container rebuilds with the
# old skill code copied in.
#
# Usage:
#   ai-employee/bin/rollback-skill.sh <slug> <skill-name> <target-version-hash>
#
# The target hash must exist in git history (we resolve by checking out the
# skill's directory at the matching commit during the next build). For now,
# this script just updates customer.yaml and triggers a redeploy; the
# version-to-commit lookup is wired in Phase B when we add the skill-history
# index.

set -euo pipefail

SLUG="${1:-}"
SKILL="${2:-}"
TARGET_VERSION="${3:-}"

if [ -z "${SLUG}" ] || [ -z "${SKILL}" ] || [ -z "${TARGET_VERSION}" ]; then
  echo "Usage: $0 <slug> <skill-name> <target-version-hash>" >&2
  echo "       $0 smd inbox-triage 3a2b1c" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CUSTOMER_YAML="${REPO_ROOT}/ai-employee/customers/${SLUG}/customer.yaml"
APP_NAME="hermes-${SLUG}"

[ -f "${CUSTOMER_YAML}" ] || { echo "FATAL: ${CUSTOMER_YAML} missing"; exit 1; }

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [rollback/${SLUG}] $*"; }

# Use Python (yaml lib) to make the version pin change — safer than sed across
# YAML.
log "Rolling back ${SKILL} on ${SLUG} to version ${TARGET_VERSION}..."
uv run --quiet --with pyyaml python3 - "${CUSTOMER_YAML}" "${SKILL}" "${TARGET_VERSION}" <<'PYEOF'
import sys, yaml, pathlib
path, skill_name, target = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    cfg = yaml.safe_load(f)
found = False
for s in cfg.get('skills', []):
    if s['name'] == skill_name:
        prior = s.get('version', 'unknown')
        s['version'] = target
        s.setdefault('rollback_history', []).append({'from': prior, 'to': target})
        found = True
        print(f"Pinned {skill_name}: {prior} -> {target}", file=sys.stderr)
        break
if not found:
    print(f"FATAL: skill '{skill_name}' not enabled in {path}", file=sys.stderr)
    sys.exit(1)
with open(path, 'w') as f:
    yaml.safe_dump(cfg, f, sort_keys=False)
PYEOF

log "Customer.yaml updated; triggering redeploy..."
"${REPO_ROOT}/ai-employee/bin/provision-customer.sh" "${SLUG}"

log "Rollback complete. Inspect 'fly logs -a ${APP_NAME}' to verify the older skill loads."
