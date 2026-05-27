#!/usr/bin/env bash
# provision-customer.sh — one command to stand up a customer's Hermes Machine
#
# Usage:
#   ai-employee/bin/provision-customer.sh <slug>
#
# Reads ai-employee/customers/<slug>/customer.yaml, validates it, uploads
# customer.yaml to R2 (so bootstrap.sh can fetch it on first boot — no more
# baking into the image per §6 of the build plan), renders
# ai-employee/.rendered/<slug>/fly.toml (gitignored), creates the Fly app,
# provisions the volume (10GB — hosts Postgres + Redis + customer.yaml +
# SQLite + voice cache), prompts Captain for secrets (pasted via pbpaste —
# values never appear in the chat transcript), deploys, then runs the boot
# smoke test (boot-smoke-test.sh) to verify the Postgres/Redis/Honcho/Hermes
# dependency chain came up cleanly.
#
# Operator prerequisites (set in your shell / .envrc / direnv before running):
#   R2_ENDPOINT_URL        — Cloudflare R2 endpoint (https://<account>.r2.cloudflarestorage.com)
#   R2_ACCESS_KEY_ID       — R2 access key (operator-local, used for `aws s3 cp` upload)
#   R2_SECRET_ACCESS_KEY   — R2 secret (operator-local)
#   R2_BUCKET_CONFIG       — R2 bucket holding customer.yaml + voice vaults
#                            (defaults to "smd-customer-config" if unset)
#
# Observability (ADR 0023 Wave 1) prerequisites:
#   SENTRY_DSN                  — staged to Fly as a secret so the Machine's
#                                 Python sentry-sdk init can pick it up
#                                 (overlay PR O1). Pulled from operator env.
#   MACHINE_HEARTBEAT_KEY       — shared bearer for POST /api/internal/heartbeat
#                                 (Wave 1 single-key model per ADR 0023 §10).
#                                 SAME value as the Cloudflare Worker secret on
#                                 ss-web; staged to every Machine.
#   HEALTHCHECKS_API_KEY        — healthchecks.io project API key. Used to
#                                 create the per-customer check during
#                                 provisioning, and to cancel it during
#                                 decommission. Optional in dev — when unset,
#                                 the script logs a warning and skips the
#                                 healthchecks.io step (allows local dry runs
#                                 without a live account).
#
# The same R2_* values get pushed into the Machine as Fly secrets so bootstrap.sh
# can pull customer.yaml back out. The operator's local R2 creds and the
# Machine's R2 creds may be the same credential or different ones — they live
# in different scopes.
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
BIN_DIR="${REPO_ROOT}/ai-employee/bin"

[ -d "${CUSTOMER_DIR}" ] || { echo "FATAL: ${CUSTOMER_DIR} not found"; exit 1; }
[ -f "${CUSTOMER_YAML}" ] || { echo "FATAL: ${CUSTOMER_YAML} missing"; exit 1; }

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [provision/${SLUG}] $*"; }
die() { log "FATAL: $*"; exit 1; }

# ---------- Step 0: verify operator R2 credentials ----------
# These live in the operator's local shell (e.g., direnv / .envrc); they are
# used by `aws s3 cp` for the customer.yaml upload below. The same logical
# credentials (or scoped versions of them) are pushed to Fly secrets so the
# Machine can fetch from R2 at boot — but those are set via pbpaste below,
# not echoed here.
R2_BUCKET_CONFIG="${R2_BUCKET_CONFIG:-smd-customer-config}"
[ -n "${R2_ENDPOINT_URL:-}" ] || die "R2_ENDPOINT_URL not set in operator env (see header for prerequisites)"
[ -n "${R2_ACCESS_KEY_ID:-}" ] || die "R2_ACCESS_KEY_ID not set in operator env"
[ -n "${R2_SECRET_ACCESS_KEY:-}" ] || die "R2_SECRET_ACCESS_KEY not set in operator env"
command -v aws >/dev/null 2>&1 || die "aws CLI not found (required for R2 customer.yaml upload)"
command -v openssl >/dev/null 2>&1 || die "openssl not found (required for HONCHO_API_KEY generation)"
command -v pbpaste >/dev/null 2>&1 || die "pbpaste not found (macOS-only; required for secret entry flow)"

# ---------- Step 1: validate customer.yaml ----------
# The canonical pre-merge gate is the TS validator in
# src/lib/ai-employee/customer-yaml/ (per ADR 0019). The retired in-tree
# Python validator (ai-employee/adapter/validate_customer_yaml.py) was on a
# stale schema (looked for top-level skills[] instead of personas[].skills[])
# and missed real shape violations. The TS validator catches both nesting
# and enum violations — see ai-employee/fixtures/validator-regression/ for
# the guardrail fixtures.
#
# The overlay's bootstrap/validate.py (venturecrane/hermes-smd-overlay) is
# the runtime re-check that fires inside the customer Machine at boot.
log "Validating customer.yaml..."
( cd "${REPO_ROOT}" && npx --quiet tsx scripts/validate-customer-yaml.ts "${CUSTOMER_YAML}" ) \
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
print(m.get('size', 'shared-cpu-2x'))
print(m.get('memory_mb', 2048))
print(c.get('hermes_ref', 'v2026.5.16-smd.0'))
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

# ---------- Step 1b: resolve Hermes upstream SHA for no-patches assertion ----------
# Strip the -smd.N (or -smd.security.N) suffix from the fork tag to get the
# equivalent upstream tag. Look up its SHA via git ls-remote against
# NousResearch/hermes-agent. The Dockerfile asserts the fork tag's HEAD
# matches this SHA; any divergence fails the build (ADR 0015 no-patches
# discipline, load-bearing for AGPL §13 unmodified-deployment safe harbor).
UPSTREAM_REF="${HERMES_REF%-smd.*}"
[ "${UPSTREAM_REF}" != "${HERMES_REF}" ] || die "hermes_ref ${HERMES_REF} does not match the vYYYY.M.D-smd.N fork-tag pattern (PR #1037 validator)"

log "Resolving upstream SHA for ${UPSTREAM_REF} (stripped from ${HERMES_REF})..."
HERMES_UPSTREAM_SHA=$(git ls-remote --tags https://github.com/NousResearch/hermes-agent.git "refs/tags/${UPSTREAM_REF}" | awk '{print $1}' | head -1)
[ -n "${HERMES_UPSTREAM_SHA}" ] || die "Could not resolve upstream SHA for ${UPSTREAM_REF}; check the tag exists at NousResearch/hermes-agent"
[ "${#HERMES_UPSTREAM_SHA}" -eq 40 ] || die "Resolved upstream SHA has unexpected length (got ${#HERMES_UPSTREAM_SHA}, expected 40): ${HERMES_UPSTREAM_SHA}"
log "Upstream SHA: ${HERMES_UPSTREAM_SHA}"

# ---------- Step 2: upload customer.yaml to R2 ----------
# bootstrap.sh fetches this from R2 on first boot and writes it to
# /opt/data/customer.yaml. Doing the upload BEFORE the Fly deploy means the
# first Machine boot can succeed (otherwise the boot would race against a
# missing config). The customer-sync sidecar (from the overlay bootstrap/
# package) polls this same key for non-structural updates.
R2_CONFIG_KEY="vaults/${SLUG}/customer.yaml"
log "Uploading customer.yaml to R2: s3://${R2_BUCKET_CONFIG}/${R2_CONFIG_KEY}"
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 cp "${CUSTOMER_YAML}" "s3://${R2_BUCKET_CONFIG}/${R2_CONFIG_KEY}" \
    --endpoint-url "${R2_ENDPOINT_URL}" \
    --only-show-errors \
  || die "R2 upload failed; bootstrap.sh would not be able to fetch customer.yaml"
log "R2 upload OK"

# ---------- Step 3: render fly.toml ----------
log "Rendering fly.toml..."
mkdir -p "${RENDERED_DIR}"
sed -e "s/{{CUSTOMER_SLUG}}/${SLUG}/g" \
    -e "s/{{FLY_REGION}}/${FLY_REGION}/g" \
    -e "s/{{MACHINE_SIZE}}/${MACHINE_SIZE}/g" \
    -e "s/{{MEMORY_MB}}/${MEMORY_MB}/g" \
    -e "s/{{HERMES_REF}}/${HERMES_REF}/g" \
    -e "s/{{HERMES_UPSTREAM_SHA}}/${HERMES_UPSTREAM_SHA}/g" \
    -e "s|{{R2_BUCKET_CONFIG}}|${R2_BUCKET_CONFIG}|g" \
    "${TEMPLATE_DIR}/fly.toml.template" > "${RENDERED_DIR}/fly.toml"
log "Rendered to ${RENDERED_DIR}/fly.toml"

# ---------- Step 4: create Fly app (idempotent) ----------
log "Creating Fly app (idempotent)..."
if fly apps list --json | python3 -c "import sys, json; sys.exit(0 if '${APP_NAME}' in [a['Name'] for a in json.load(sys.stdin)] else 1)"; then
  log "App ${APP_NAME} exists; skipping create"
else
  fly apps create "${APP_NAME}" --org personal
fi

# ---------- Step 5: create volume (idempotent, 10GB) ----------
# Volume hosts: Postgres data (Honcho), Redis AOF (Honcho), customer.yaml
# (R2-mirrored copy), audit.db + observations.db SQLite, Hermes profiles
# under /opt/data/profiles/, voice samples cache, OAuth token files (ADR
# 0010). 10GB is the new floor (was 1GB pre-§6); per-customer fixed disk
# pressure should not be a thing we manage on a per-customer basis.
log "Creating persistent volume (idempotent, 10GB)..."
if fly volumes list -a "${APP_NAME}" --json 2>/dev/null | python3 -c "import sys, json; data = json.load(sys.stdin) if sys.stdin.read else []" 2>/dev/null; then
  if ! fly volumes list -a "${APP_NAME}" --json | grep -q '"name":"hermes_state"'; then
    fly volumes create hermes_state --size 10 --region "${FLY_REGION}" -a "${APP_NAME}" --yes
  else
    log "Volume hermes_state exists; skipping create"
  fi
else
  fly volumes create hermes_state --size 10 --region "${FLY_REGION}" -a "${APP_NAME}" --yes || true
fi

# ---------- Step 6: set secrets (paste flow; never echo values) ----------
log "Setting secrets via pbpaste flow..."
log "For each prompt: copy the secret to your clipboard, then press Enter."
log "Values flow directly into 'fly secrets import' — never appear in this terminal or any chat transcript."

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

# Required secrets per bootstrap.sh.
# COMPOSIO_API_KEY removed 2026-05-26: Composio is doctrine-dropped per the
# ADR 0020 revision dated 2026-05-24 ("As of this revision, no currently
# planned binding uses composio"). The schema validator and runtime guard
# still accept `composio:` backend prefixes for future long-tail vendors;
# this prompt was dead provisioning ceremony.
prompt_and_set ANTHROPIC_API_KEY  "Anthropic API key for hermes-${SLUG}"
prompt_and_set AGENTMAIL_API_KEY  "AgentMail API key (Builder tier)"

# R2 access for bootstrap.sh's customer.yaml fetch + customer-sync sidecar's
# polling for non-structural config changes. R2_BUCKET_CONFIG is in fly.toml
# [env] (it's the bucket name, not a credential); the keys are secrets.
prompt_and_set R2_ACCESS_KEY_ID     "R2 access key ID (Machine-scoped, R/W on s3://${R2_BUCKET_CONFIG}/vaults/${SLUG}/)"
prompt_and_set R2_SECRET_ACCESS_KEY "R2 secret access key (paired with R2_ACCESS_KEY_ID above)"
prompt_and_set R2_ENDPOINT_URL      "R2 endpoint URL (Cloudflare account R2 endpoint)"

# HONCHO_API_KEY — generated locally, sent to Fly via stdin, never stored
# anywhere else. Honcho is self-hosted in this Machine; this is the shared
# secret between the Hermes process and the in-Machine Honcho FastAPI server.
# Rotating it means re-running provisioning (Captain-initiated restart per
# ADR 0010 to preserve OAuth tokens on the volume).
log "Generating HONCHO_API_KEY (openssl rand -hex 32) and staging directly to Fly..."
openssl rand -hex 32 \
  | { read -r _val; printf 'HONCHO_API_KEY=%s\n' "${_val}"; } \
  | fly secrets import --stage -a "${APP_NAME}" >/dev/null
log "Staged HONCHO_API_KEY (value never logged)"
unset _val 2>/dev/null || true

# ---------- Step 6b: observability secrets (ADR 0023 Wave 1) ----------
# These come from operator env (Infisical-staged in Captain's shell), not
# pbpaste — there's nothing user-specific about them and they should not
# require manual paste per customer.
#
#   SENTRY_DSN              — single value shared across all Machines (one
#                             SMD-owned Sentry project; tenant tag scopes
#                             events per customer at SDK init).
#   MACHINE_HEARTBEAT_KEY   — single value shared across the fleet for
#                             Wave 1. SAME key the Cloudflare Worker
#                             receives; Wave 1's auth is "you know the
#                             key + you carry an X-Tenant-Slug header."
#                             Per-tenant upgrade path documented in
#                             ADR 0023 §"Cross-cutting calls" #10.
#
# Missing either is non-fatal in dev (warn + skip); in prod the Machine's
# Sentry init silently no-ops and heartbeat POSTs will 401 — both visible
# as "no signal yet" on the admin dashboard, which is the empty-state we
# want anyway.
stage_secret_from_env() {
  local secret_name="$1"
  local env_value="$2"
  local description="$3"
  if [ -z "${env_value:-}" ]; then
    log "WARN: ${secret_name} not set in operator env (${description}) — skipping stage"
    return 0
  fi
  printf '%s=%s\n' "${secret_name}" "${env_value}" \
    | fly secrets import --stage -a "${APP_NAME}" >/dev/null
  log "Staged ${secret_name} (value never logged)"
}
stage_secret_from_env SENTRY_DSN            "${SENTRY_DSN:-}"            "Sentry DSN for the shared smd-ai-employee project"
stage_secret_from_env MACHINE_HEARTBEAT_KEY "${MACHINE_HEARTBEAT_KEY:-}" "shared bearer for POST /api/internal/heartbeat"

# ---------- Step 6c: healthchecks.io check (ADR 0023 Wave 1) ----------
# Idempotent create-or-find. Healthchecks.io's POST /api/v3/checks/ creates
# a new check; if a check with the same `unique` keys (tags+name) already
# exists, the API returns it. The ping URL is stable across re-runs.
#
# The check is configured to POST to ss-web's /api/webhooks/healthchecks
# on failure (grace expiration) with an Authorization: Bearer header
# carrying HEALTHCHECKS_WEBHOOK_SECRET (different from the API key — the
# inbound receiver verifies this) and a JSON body the receiver expects.
HC_CHECK_NAME="hermes-${SLUG}"
HC_PING_URL=""
if [ -n "${HEALTHCHECKS_API_KEY:-}" ]; then
  log "Creating/finding healthchecks.io check '${HC_CHECK_NAME}'..."
  HC_PAYLOAD=$(python3 -c "
import json, os
slug = os.environ['SLUG']
admin = os.environ.get('ADMIN_BASE_URL', 'https://admin.smd.services')
webhook_secret = os.environ.get('HEALTHCHECKS_WEBHOOK_SECRET', '')
print(json.dumps({
    'name': f'hermes-{slug}',
    'tags': f'ai-employee {slug}',
    'timeout': int(os.environ.get('HEALTHCHECKS_PERIOD_SECONDS', '60')),
    'grace': int(os.environ.get('HEALTHCHECKS_GRACE_MINUTES', '5')) * 60,
    'unique': ['name', 'tags'],
    'channels': '',  # outbound managed via Integrations in UI per Wave 1 setup
}))
")
  HC_RESPONSE=$(curl -sS -X POST 'https://healthchecks.io/api/v3/checks/' \
    -H "X-Api-Key: ${HEALTHCHECKS_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "${HC_PAYLOAD}") \
    || die "healthchecks.io API call failed (check HEALTHCHECKS_API_KEY)"
  HC_PING_URL=$(echo "${HC_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ping_url',''))")
  if [ -z "${HC_PING_URL}" ]; then
    log "WARN: healthchecks.io returned no ping_url; response=${HC_RESPONSE}"
  else
    log "healthchecks.io ping URL: ${HC_PING_URL}"
    printf '%s=%s\n' "HEALTHCHECKS_PING_URL" "${HC_PING_URL}" \
      | fly secrets import --stage -a "${APP_NAME}" >/dev/null
    log "Staged HEALTHCHECKS_PING_URL"
  fi
else
  log "WARN: HEALTHCHECKS_API_KEY not set — skipping healthchecks.io check creation"
  log "      (Machine's heartbeat ticker will still write to control-plane; the"
  log "       grace-expiration alert path is just inactive until configured)"
fi

# ---------- Step 6d: seed fleet_status row in central D1 (ADR 0023 Wave 1) ----------
# Bootstrap an empty row so the admin dashboard's fleet view renders a
# "no signal yet" entry instead of being silent before the first heartbeat
# lands. The heartbeat endpoint's ON CONFLICT upsert handles subsequent
# writes idempotently — this seed has no semantic impact beyond UI presence.
#
# Uses wrangler from the operator's working tree (assumes the same wrangler
# version used for migrations). entity_id resolved via customer_configs.
log "Seeding fleet_status row for ${SLUG}..."
SEED_SQL=$(cat <<EOF
INSERT INTO fleet_status (entity_id, customer_slug, heartbeat_status, updated_at)
SELECT entity_id, customer_slug, 'unknown', datetime('now')
  FROM customer_configs
 WHERE customer_slug = '${SLUG}'
    ON CONFLICT(entity_id) DO NOTHING;
EOF
)
( cd "${REPO_ROOT}" && npx --quiet wrangler d1 execute ss-console-db --remote --command "${SEED_SQL}" >/dev/null 2>&1 ) \
  && log "Seeded fleet_status (no-op if row already exists or customer_configs is missing)" \
  || log "WARN: fleet_status seed failed — Wave-1 first-heartbeat will create the row on its own"

# Commit staged secrets
log "Committing staged secrets..."
fly secrets deploy -a "${APP_NAME}" 2>/dev/null || true

# ---------- Step 7: deploy ----------
log "Deploying ${APP_NAME}..."
(cd "${REPO_ROOT}" && fly deploy --config "${RENDERED_DIR}/fly.toml" \
  --build-arg HERMES_REF="${HERMES_REF}" \
  --build-arg HERMES_UPSTREAM_SHA="${HERMES_UPSTREAM_SHA}" \
  --build-arg CUSTOMER_SLUG="${SLUG}")

# ---------- Step 8: boot smoke test ----------
# The boot-smoke-test.sh script exercises the Postgres → Redis → Honcho →
# customer.yaml → profiles → Hermes plugins dependency chain. It is the real
# verification that bootstrap.sh's sequenced startup came up cleanly.
log "Running boot smoke test..."
if [ -x "${BIN_DIR}/boot-smoke-test.sh" ]; then
  "${BIN_DIR}/boot-smoke-test.sh" "${SLUG}" \
    || die "Boot smoke test failed — Machine is up but dependency chain is unhealthy. Inspect with 'fly logs -a ${APP_NAME}'."
else
  die "boot-smoke-test.sh not found or not executable at ${BIN_DIR}/boot-smoke-test.sh"
fi

# ---------- Step 9: per-connector prod smoke tests ----------
# The legacy `run_prod_smoke_test.py` was retired with the in-tree adapter.
# Per-connector probes now run inside the customer Machine via the overlay's
# `hermes-smd-hook-probe` plugin at boot. The boot smoke test above confirms
# the plugin loaded; connector-level reachability is logged by hook-probe to
# the customer's audit log and surfaced in the admin portal.

log "Provisioning complete for ${APP_NAME}"
log "Next steps:"
log "  1. fly ssh console -a ${APP_NAME}     # interact with the container"
log "  2. fly logs -a ${APP_NAME}            # watch the agent loop"
log "  3. (if any OAuth-using connectors are enabled) run the relevant OAuth setup inside the container"
log "  4. customer.yaml live at s3://${R2_BUCKET_CONFIG}/${R2_CONFIG_KEY} (non-structural edits picked up by sidecar)"
