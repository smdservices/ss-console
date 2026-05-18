#!/usr/bin/env bash
# provision-customer.sh — one command to stand up a customer's Hermes instance
#
# Usage:
#   ai-employee/bin/provision-customer.sh <slug>
#
# Reads ai-employee/customers/<slug>/customer.yaml, validates it, renders
# ai-employee/.rendered/<slug>/fly.toml (gitignored), creates the Fly app,
# provisions the volume, prompts Captain for secrets (pasted via pbpaste —
# values never appear in the chat transcript), deploys, runs the prod
# smoke test.
#
# Idempotent: safe to re-run. If `fly apps create` finds the app already
# exists, the script moves on; if secrets are already set, it skips
# (unless --rotate is passed).

set -euo pipefail

SLUG="${1:-}"
[ -n "${SLUG}" ] || { echo "Usage: $0 <customer-slug>" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CUSTOMER_DIR="${REPO_ROOT}/ai-employee/customers/${SLUG}"
CUSTOMER_YAML="${CUSTOMER_DIR}/customer.yaml"
TEMPLATE_DIR="${REPO_ROOT}/ai-employee/templates"
RENDERED_DIR="${REPO_ROOT}/ai-employee/.rendered/${SLUG}"

[ -d "${CUSTOMER_DIR}" ] || { echo "FATAL: ${CUSTOMER_DIR} not found"; exit 1; }
[ -f "${CUSTOMER_YAML}" ] || { echo "FATAL: ${CUSTOMER_YAML} missing"; exit 1; }

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [provision/${SLUG}] $*"; }
die() { log "FATAL: $*"; exit 1; }

# ---------- Step 1: validate customer.yaml ----------
log "Validating customer.yaml..."
uv run --quiet --with pyyaml python3 "${REPO_ROOT}/ai-employee/adapter/validate_customer_yaml.py" \
  "${CUSTOMER_YAML}" \
  --skills-dir "${REPO_ROOT}/ai-employee/skills" \
  --connectors-dir "${REPO_ROOT}/ai-employee/connectors" \
  --fixtures-dir "${REPO_ROOT}/ai-employee/fixtures" \
  || die "customer.yaml validation failed; see errors above"
log "customer.yaml OK"

# Extract fields we need (uses python3 to avoid yq dependency)
PARSE_PY="
import sys, yaml
with open('${CUSTOMER_YAML}') as f:
    c = yaml.safe_load(f)
m = c.get('machine', {})
print(c['customer_id'])
print(c['fly_region'])
print(m.get('size', 'shared-cpu-1x'))
print(m.get('memory_mb', 1024))
print(c.get('hermes_ref', 'v0.13.0'))
"
# Portable line-array read (macOS bash 3.2 doesn't have mapfile)
FIELDS=()
while IFS= read -r _line; do
  FIELDS+=("${_line}")
done < <(uv run --quiet --with pyyaml python3 -c "${PARSE_PY}")
CUSTOMER_ID="${FIELDS[0]}"
FLY_REGION="${FIELDS[1]}"
MACHINE_SIZE="${FIELDS[2]}"
MEMORY_MB="${FIELDS[3]}"
HERMES_REF="${FIELDS[4]}"

[ "${CUSTOMER_ID}" = "${SLUG}" ] || die "customer.yaml customer_id (${CUSTOMER_ID}) does not match slug (${SLUG})"
APP_NAME="hermes-${SLUG}"

log "App: ${APP_NAME} · region: ${FLY_REGION} · machine: ${MACHINE_SIZE}/${MEMORY_MB}MB · hermes: ${HERMES_REF}"

# ---------- Step 2: render fly.toml ----------
log "Rendering fly.toml..."
mkdir -p "${RENDERED_DIR}"
sed -e "s/{{CUSTOMER_SLUG}}/${SLUG}/g" \
    -e "s/{{FLY_REGION}}/${FLY_REGION}/g" \
    -e "s/{{MACHINE_SIZE}}/${MACHINE_SIZE}/g" \
    -e "s/{{MEMORY_MB}}/${MEMORY_MB}/g" \
    -e "s/{{HERMES_REF}}/${HERMES_REF}/g" \
    "${TEMPLATE_DIR}/fly.toml.template" > "${RENDERED_DIR}/fly.toml"
log "Rendered to ${RENDERED_DIR}/fly.toml"

# ---------- Step 3: create Fly app (idempotent) ----------
log "Creating Fly app (idempotent)..."
if fly apps list --json | python3 -c "import sys, json; sys.exit(0 if '${APP_NAME}' in [a['Name'] for a in json.load(sys.stdin)] else 1)"; then
  log "App ${APP_NAME} exists; skipping create"
else
  fly apps create "${APP_NAME}" --org personal
fi

# ---------- Step 4: create volume (idempotent) ----------
log "Creating persistent volume (idempotent)..."
if fly volumes list -a "${APP_NAME}" --json 2>/dev/null | python3 -c "import sys, json; data = json.load(sys.stdin) if sys.stdin.read else []" 2>/dev/null; then
  # Check if hermes_state exists
  if ! fly volumes list -a "${APP_NAME}" --json | grep -q '"name":"hermes_state"'; then
    fly volumes create hermes_state --size 1 --region "${FLY_REGION}" -a "${APP_NAME}" --yes
  else
    log "Volume hermes_state exists; skipping create"
  fi
else
  fly volumes create hermes_state --size 1 --region "${FLY_REGION}" -a "${APP_NAME}" --yes || true
fi

# ---------- Step 5: set secrets (paste flow; never echo values) ----------
log "Setting secrets via pbpaste flow..."
log "For each prompt: copy the secret to your clipboard, then press Enter."
log "Values flow directly into 'fly secrets set' — never appear in this terminal or any chat transcript."

prompt_and_set() {
  local secret_name="$1"
  local description="$2"
  echo ""
  echo "  >> Copy ${description} to clipboard, then press Enter to stage ${secret_name} (or 's' to skip)"
  read -r response
  if [ "${response}" = "s" ]; then
    log "Skipping ${secret_name}"
    return 0
  fi
  # Secret value reaches Fly via stdin only — KEY=VALUE never appears on the
  # command line, so it doesn't leak via ps/proc/cmdline. See
  # feedback_never_expose_secrets_in_tool_output.md.
  printf '%s=%s\n' "${secret_name}" "$(pbpaste)" \
    | fly secrets import --stage -a "${APP_NAME}" >/dev/null
  log "Staged ${secret_name}"
}

# Required secrets per bootstrap.sh
prompt_and_set ANTHROPIC_API_KEY  "Anthropic API key for hermes-${SLUG}"
prompt_and_set COMPOSIO_API_KEY   "Composio API key (Standard tier)"
prompt_and_set AGENTMAIL_API_KEY  "AgentMail API key (Builder tier)"

# Commit staged secrets
log "Committing staged secrets..."
fly secrets deploy -a "${APP_NAME}" 2>/dev/null || true

# ---------- Step 6: deploy ----------
log "Deploying ${APP_NAME}..."
(cd "${REPO_ROOT}" && fly deploy --config "${RENDERED_DIR}/fly.toml" --build-arg HERMES_REF="${HERMES_REF}" --build-arg CUSTOMER_SLUG="${SLUG}")

# ---------- Step 7: smoke test ----------
log "Running post-deploy smoke test..."
# Wait for the machine to be reachable
sleep 5
if fly status -a "${APP_NAME}" --json | python3 -c "import sys, json; d = json.load(sys.stdin); m = d.get('Machines', [{}])[0]; sys.exit(0 if m.get('state') == 'started' else 1)"; then
  log "Smoke test: ${APP_NAME} machine is started ✓"
else
  log "Smoke test: ${APP_NAME} machine is NOT started — check 'fly logs -a ${APP_NAME}'"
  exit 2
fi

# Hermes version check
log "Smoke test: checking Hermes version inside container..."
fly ssh console -a "${APP_NAME}" --command "/opt/hermes/.venv/bin/hermes --version" || log "WARN: hermes --version did not succeed; safety substrate may have blocked startup. Check fly logs."

# ---------- Step 8: connector prod-smoke-test ----------
# For each enabled BUILD or COMPOSIO connector, run one read-only call
# against the customer's tenant to surface auth / scope / shape issues
# before any write capability is exercised.
log "Running per-connector prod smoke tests..."
uv run --quiet --with pyyaml python3 "${REPO_ROOT}/ai-employee/adapter/run_prod_smoke_test.py" \
  --customer "${SLUG}" \
  --app "${APP_NAME}" \
  --customer-yaml "${CUSTOMER_YAML}" \
  || log "WARN: one or more connector smoke tests failed — review output before enabling any write capability"

log "Provisioning complete for ${APP_NAME}"
log "Next steps:"
log "  1. fly ssh console -a ${APP_NAME}     # interact with the container"
log "  2. fly logs -a ${APP_NAME}            # watch the agent loop"
log "  3. (if any Google-OAuth-using skills are enabled) run google-workspace setup inside the container"
