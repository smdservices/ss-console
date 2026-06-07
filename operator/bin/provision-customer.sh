#!/usr/bin/env bash
# provision-customer.sh — one command to stand up a customer's Hermes Machine
#
# Usage:
#   operator/bin/provision-customer.sh <slug>
#
# Reads operator/customers/<slug>/customer.yaml, validates it, uploads
# customer.yaml to R2 (so bootstrap.sh can fetch it on first boot — no more
# baking into the image per §6 of the build plan), renders
# operator/.rendered/<slug>/fly.toml (gitignored), creates the Fly app,
# provisions the volume (10GB — hosts customer.yaml + SQLite + voice cache;
# Phase 2 adds Postgres + Redis for Honcho), prompts Captain for secrets
# (pasted via pbpaste — values never appear in the chat transcript), deploys,
# then runs the boot smoke test (boot-smoke-test.sh) to verify the Hermes
# profile + plugin chain came up cleanly.
#
# CANONICAL INVOCATION (do not hunt for R2 creds — they are in Infisical /ss prod):
#   operator/bin/reprovision.sh <slug>
#   # which is exactly:
#   infisical run --env=prod --path=/ss --silent -- operator/bin/provision-customer.sh <slug>
# The R2_* below are injected by that `infisical run`. They were historically NOT
# stored anywhere (every agent re-derived them and lost ~2h); they are now in
# Infisical /ss and are derivable from CLOUDFLARE_API_TOKEN (id + sha256(value)).
# See docs/runbooks/operator/first-boot.md "R2 credentials".
#
# Operator prerequisites (injected by reprovision.sh; or set manually before running):
#   R2_ENDPOINT_URL        — Cloudflare R2 endpoint (https://<account>.r2.cloudflarestorage.com)
#   R2_ACCESS_KEY_ID       — R2 access key (operator-local, used for `aws s3 cp` upload)
#   R2_SECRET_ACCESS_KEY   — R2 secret (operator-local)
#   R2_BUCKET_CONFIG       — R2 bucket holding customer.yaml + voice vaults
#                            (defaults to "smd-customer-config" if unset)
#   CF_API_TOKEN           — Cloudflare API token with "Workers R2 Storage: Edit"
#                            scope at the account level. Used by ADR 0022 Stream 2
#                            to create the per-customer skill-bodies R2 bucket
#                            (ss-operator-<slug>-skills). Optional in dev —
#                            when unset, the script logs a warning and skips the
#                            bucket-create step (the operator can create it via
#                            the CF dashboard before re-running).
#   CF_ACCOUNT_ID          — Cloudflare account ID (32-char hex). Required when
#                            CF_API_TOKEN is set; ignored otherwise.
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

# Validate the slug charset as the FIRST action (issue #1127). The slug flows
# into filesystem paths, central-D1 SQL, a sed RHS, a python -c program, and
# R2 keys below — all before the customer_id==SLUG equality check. Constraining
# it to a DNS-style label (no quotes, slashes, ampersands, or shell
# metacharacters) closes the SQL-injection / sed-corruption / RCE vectors at
# the source. Mirrors decommission_cli.py's guard.
if [[ ! "${SLUG}" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then
  echo "invalid slug '${SLUG}' (must match ^[a-z0-9][a-z0-9-]{0,31}$)" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CUSTOMER_DIR="${REPO_ROOT}/operator/customers/${SLUG}"
CUSTOMER_YAML="${CUSTOMER_DIR}/customer.yaml"
TEMPLATE_DIR="${REPO_ROOT}/operator/templates"
RENDERED_DIR="${REPO_ROOT}/operator/.rendered/${SLUG}"
BIN_DIR="${REPO_ROOT}/operator/bin"

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
# If these are unset you almost certainly ran this script directly instead of
# through the wrapper. The creds are in Infisical /ss prod — do NOT re-derive them.
R2_HINT="R2 creds missing. Run via: operator/bin/reprovision.sh ${SLUG}  (= infisical run --env=prod --path=/ss -- operator/bin/provision-customer.sh ${SLUG}). They live in Infisical /ss prod; see docs/runbooks/operator/first-boot.md."
[ -n "${R2_ENDPOINT_URL:-}" ] || die "R2_ENDPOINT_URL not set. ${R2_HINT}"
[ -n "${R2_ACCESS_KEY_ID:-}" ] || die "R2_ACCESS_KEY_ID not set. ${R2_HINT}"
[ -n "${R2_SECRET_ACCESS_KEY:-}" ] || die "R2_SECRET_ACCESS_KEY not set. ${R2_HINT}"
command -v aws >/dev/null 2>&1 || die "aws CLI not found (required for R2 customer.yaml upload)"
command -v pbpaste >/dev/null 2>&1 || die "pbpaste not found (macOS-only; required for secret entry flow)"

# ---------- Step 1: validate customer.yaml ----------
# The canonical pre-merge gate is the TS validator in
# src/lib/operator/customer-yaml/ (per ADR 0019). The retired in-tree
# Python validator (operator/adapter/validate_customer_yaml.py) was on a
# stale schema (looked for top-level skills[] instead of personas[].skills[])
# and missed real shape violations. The TS validator catches both nesting
# and enum violations — see operator/fixtures/validator-regression/ for
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
print(c.get('hermes_ref', 'v2026.5.16@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0'))
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

# ---------- Step 1b: split the upstream pin into tag + SHA (ADR 0024) ----------
# hermes_ref pins upstream Hermes as v{YYYY}.{M}.{D}@{40-hex-sha}. The tag
# before '@' is the clone target; the SHA after '@' is the immutable pin the
# Dockerfile asserts the cloned HEAD against. Because the SHA travels in the
# ref itself, we do NOT resolve it from a live upstream lookup here (this is
# the availability fix in ADR 0024 — provisioning no longer phones a second
# repo). The venturecrane/hermes-agent fork was retired by ADR 0024; the
# Dockerfile clones NousResearch/hermes-agent directly.
HERMES_UPSTREAM_TAG="${HERMES_REF%@*}"
HERMES_UPSTREAM_SHA="${HERMES_REF#*@}"
[ "${HERMES_UPSTREAM_TAG}" != "${HERMES_REF}" ] || die "hermes_ref ${HERMES_REF} is missing the @<sha> pin; expected v{YYYY}.{M}.{D}@{40-hex-sha} per ADR 0024"
[ "${#HERMES_UPSTREAM_SHA}" -eq 40 ] || die "hermes_ref SHA has unexpected length (got ${#HERMES_UPSTREAM_SHA}, expected 40): ${HERMES_UPSTREAM_SHA}"
case "${HERMES_UPSTREAM_SHA}" in *[!0-9a-f]*) die "hermes_ref SHA must be lowercase hex: ${HERMES_UPSTREAM_SHA}" ;; esac
log "Hermes upstream pin: ${HERMES_UPSTREAM_TAG} @ ${HERMES_UPSTREAM_SHA}"

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
# Per-customer skill bodies bucket name (ADR 0022 Stream 2). One bucket per
# customer; the bucket itself is the trust boundary. Bucket-scoped access
# keys are entered via the secret-paste flow below; the bucket name is
# rendered into fly.toml [env] (not a credential, just a string).
R2_SKILL_BODIES_BUCKET="ss-operator-${SLUG}-skills"
sed -e "s/{{CUSTOMER_SLUG}}/${SLUG}/g" \
    -e "s/{{FLY_REGION}}/${FLY_REGION}/g" \
    -e "s/{{MACHINE_SIZE}}/${MACHINE_SIZE}/g" \
    -e "s/{{MEMORY_MB}}/${MEMORY_MB}/g" \
    -e "s/{{HERMES_REF}}/${HERMES_REF}/g" \
    -e "s/{{HERMES_UPSTREAM_TAG}}/${HERMES_UPSTREAM_TAG}/g" \
    -e "s/{{HERMES_UPSTREAM_SHA}}/${HERMES_UPSTREAM_SHA}/g" \
    -e "s|{{R2_BUCKET_CONFIG}}|${R2_BUCKET_CONFIG}|g" \
    -e "s|{{R2_SKILL_BODIES_BUCKET}}|${R2_SKILL_BODIES_BUCKET}|g" \
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
# Volume hosts: customer.yaml (R2-mirrored copy), audit.db SQLite, Hermes
# profiles + flat-file memory (MEMORY.md/USER.md) under /opt/data/profiles/,
# voice samples cache, OAuth token files (ADR 0010). Phase 2 adds Postgres +
# Redis (Honcho) + observations.db. 10GB is the floor (was 1GB pre-§6);
# per-customer fixed disk pressure should not be a thing we manage per customer.
log "Creating persistent volume (idempotent, 10GB)..."
# Count existing hermes_state volumes with a real JSON parse. The prior check
# grepped for '"name":"hermes_state"', which NEVER matched — `fly volumes list
# --json` pretty-prints '"name": "hermes_state"' WITH a space after the colon —
# so every (re)provision silently minted a fresh, unattached 10GB orphan volume.
# Fail closed: if volumes cannot be enumerated, refuse to create rather than risk
# yet another orphan.
VOL_COUNT="$(fly volumes list -a "${APP_NAME}" --json 2>/dev/null | python3 -c '
import sys, json
try:
    vols = json.load(sys.stdin)
except Exception:
    sys.exit(2)
print(sum(1 for v in vols if isinstance(v, dict) and v.get("name") == "hermes_state"))
')" || VOL_COUNT="ERR"
if [ "${VOL_COUNT}" = "ERR" ]; then
  die "could not enumerate volumes for ${APP_NAME}; refusing to create a possibly-duplicate volume"
elif [ "${VOL_COUNT}" -ge 1 ]; then
  log "Volume hermes_state exists (${VOL_COUNT}); skipping create"
else
  fly volumes create hermes_state --size 10 --region "${FLY_REGION}" -a "${APP_NAME}" --yes
fi

# ---------- Step 5b: create per-customer skill-bodies R2 bucket (ADR 0022 Stream 2) ----------
# Per Captain decision (2026-05-27): one R2 bucket per customer for agent-
# authored skill body persistence. The bucket name is deterministic
# (ss-operator-<slug>-skills); creation is idempotent via CF API.
#
# If CF_API_TOKEN / CF_ACCOUNT_ID are unset, the script logs a warning and
# skips the create step — the operator must create the bucket manually via
# the CF dashboard before the Machine boots. Future agent-authored skills
# would otherwise fail the write-ahead R2 PUT and surface as r2_status='failed'
# in the per-customer agent_skills_inventory.
if [ -n "${CF_API_TOKEN:-}" ] && [ -n "${CF_ACCOUNT_ID:-}" ]; then
  log "Creating per-customer R2 bucket: ${R2_SKILL_BODIES_BUCKET}"
  CF_BUCKET_RESPONSE=$(curl -sS -X POST \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${R2_SKILL_BODIES_BUCKET}\"}" 2>&1 || true)
  if echo "${CF_BUCKET_RESPONSE}" | grep -q '"success":true'; then
    log "R2 bucket created: ${R2_SKILL_BODIES_BUCKET}"
  elif echo "${CF_BUCKET_RESPONSE}" | grep -q '"code":10004'; then
    # Cloudflare error 10004 = bucket already exists. Idempotent re-run is fine.
    log "R2 bucket ${R2_SKILL_BODIES_BUCKET} already exists; skipping create"
  else
    # Any other error — log but don't die. The operator can create manually
    # and re-run; the secret-paste prompts below will still capture the
    # bucket-scoped credentials.
    log "WARN: R2 bucket create did not succeed. Response: ${CF_BUCKET_RESPONSE}"
    log "WARN: Create the bucket manually via the CF dashboard before the Machine boots."
  fi
else
  log "WARN: CF_API_TOKEN or CF_ACCOUNT_ID not set; skipping R2 bucket auto-create."
  log "WARN: Create '${R2_SKILL_BODIES_BUCKET}' via the CF dashboard before the Machine boots."
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
# AGENTMAIL_API_KEY removed 2026-05-29: the persona's own outbound mailbox
# identity (ADR 0005 reviewer-as-sender / ADR 0008) is deferred to Phase 2
# multi-persona (ADR 0011) and not yet implemented — no connector, OAuth flow,
# plugin, or skill code reads it (cost_rollup.py only maps it as a future
# cost-driver category). bootstrap.sh moved it to OPTIONAL_ENV in lockstep.
# This prompt was dead provisioning ceremony; customers act on real mailboxes
# via mcp:google-gmail / ms-graph, not an agent mailbox. Re-add when a persona
# email identity is actually wired.
prompt_and_set ANTHROPIC_API_KEY  "Anthropic API key for hermes-${SLUG}"

# R2 access for bootstrap.sh's customer.yaml fetch + customer-sync sidecar's
# polling for non-structural config changes. R2_BUCKET_CONFIG is in fly.toml
# [env] (it's the bucket name, not a credential); the keys are secrets.
prompt_and_set R2_ACCESS_KEY_ID     "R2 access key ID (Machine-scoped, R/W on s3://${R2_BUCKET_CONFIG}/vaults/${SLUG}/)"
prompt_and_set R2_SECRET_ACCESS_KEY "R2 secret access key (paired with R2_ACCESS_KEY_ID above)"
prompt_and_set R2_ENDPOINT_URL      "R2 endpoint URL (Cloudflare account R2 endpoint)"

# ADR 0022 Stream 2 — bucket-scoped R2 credentials for the per-customer
# skill bodies bucket. Issue these via the CF dashboard with a policy
# scoped to ${R2_SKILL_BODIES_BUCKET} only (Object Read + Write). The
# bucket itself is the trust boundary per ADR 0007; a misconfigured token
# scope would be the only path to cross-tenant leakage, so the operator
# verifies the scope before pasting.
prompt_and_set R2_SKILL_BODIES_ACCESS_KEY_ID "R2 access key ID scoped to bucket ${R2_SKILL_BODIES_BUCKET}"
prompt_and_set R2_SKILL_BODIES_SECRET_ACCESS_KEY "R2 secret access key paired with R2_SKILL_BODIES_ACCESS_KEY_ID above"

# HONCHO_API_KEY — DEFERRED to Phase 2 (ADR 0016 revised). No in-Machine Honcho
# server is provisioned in Phase 1, so there is no shared secret to generate.
# Phase 2 reintroduces this when it vendors the real plastic-labs/honcho source.

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
stage_secret_from_env SENTRY_DSN            "${SENTRY_DSN:-}"            "Sentry DSN for the shared smd-operator project"
stage_secret_from_env MACHINE_HEARTBEAT_KEY "${MACHINE_HEARTBEAT_KEY:-}" "shared bearer for POST /api/internal/heartbeat"

# ---------- Step 6b-clio: connector secrets (law vertical + Google DWD) ----------
# Staged from operator env (Infisical /ss, injected by reprovision.sh's
# `infisical run --path=/ss`), same no-paste pattern as observability. Each is
# warn+skip when unset, so a customer that doesn't use a given connector still
# provisions cleanly.
#
# Clio (mcp:clio-oktopeak): client_id/secret authenticate the OAuth app; the
# encryption key decrypts the seed token; CLIO_TOKENS_ENC_B64 is the base64 of
# ~/.clio-mcp/tokens.enc captured at off-box consent (bootstrap.sh Step 2d seeds
# it; the overlay materializer reads id/secret/key into the mcp_servers env).
stage_secret_from_env CLIO_CLIENT_ID         "${CLIO_CLIENT_ID:-}"         "Clio OAuth app client id"
stage_secret_from_env CLIO_CLIENT_SECRET     "${CLIO_CLIENT_SECRET:-}"     "Clio OAuth app client secret"
stage_secret_from_env CLIO_ENCRYPTION_KEY    "${CLIO_ENCRYPTION_KEY:-}"    "AES key for the Clio token file (subprocess reads it as ENCRYPTION_KEY)"
stage_secret_from_env CLIO_TOKENS_ENC_B64    "${CLIO_TOKENS_ENC_B64:-}"    "base64 of the seed ~/.clio-mcp/tokens.enc"

# Google service-account key (DWD). REQUIRED for any customer.yaml with
# google_auth.mode: dwd — bootstrap.sh Step 2b dies without it. Base64-encoded
# service-account JSON. Shared across the smd.services domain (one SA, domain-wide
# delegation impersonating each customer's authored subject).
stage_secret_from_env GOOGLE_SERVICE_ACCOUNT_JSON "${GOOGLE_SERVICE_ACCOUNT_JSON:-}" "base64 service-account key (domain-wide delegation)"

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
    'tags': f'operator {slug}',
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
  --build-arg HERMES_UPSTREAM_TAG="${HERMES_UPSTREAM_TAG}" \
  --build-arg HERMES_UPSTREAM_SHA="${HERMES_UPSTREAM_SHA}" \
  --build-arg CUSTOMER_SLUG="${SLUG}")

# ---------- Step 8: boot smoke test ----------
# The boot-smoke-test.sh script exercises the customer.yaml → profiles → Hermes
# plugins → curator-disabled dependency chain. It is the real verification that
# bootstrap.sh's sequenced startup came up cleanly. (Postgres/Redis/Honcho
# checks return in Phase 2 — ADR 0016 revised.)
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
