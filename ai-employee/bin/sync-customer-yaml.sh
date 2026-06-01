#!/usr/bin/env bash
#
# sync-customer-yaml.sh <slug>
#
# Push an EDITED ai-employee/customers/<slug>/customer.yaml to R2 (the source of
# truth) so it propagates to the running Machine on its next restart.
#
# Why this exists: provision-customer.sh uploads customer.yaml to R2 only at
# provision time, and bootstrap.sh re-fetches from R2 on every boot (so a restart
# picks up the new config). But nothing pushes a *merged edit* to R2 — the live
# customer-sync sidecar is a Phase-2 stub. Without this step, editing and merging
# customer.yaml leaves the running customer on its old on-disk copy. Run this after
# merging a customer.yaml change, then `fly machine restart` (or redeploy) the
# customer's app to apply it.
#
# Validates before uploading (never ships an invalid config to the source of truth).
#
# Required env (stage via your shell, e.g. `infisical run --env prod --path /ss -- ...`):
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  — R2 creds with write on the config bucket
#   R2_ENDPOINT_URL                         — Cloudflare R2 S3 endpoint
# Optional:
#   R2_BUCKET_CONFIG  — config bucket name (default: smd-customer-config)
#
# This script does NOT touch Fly, secrets, or git. It validates + uploads, nothing else.

set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "[sync-customer-yaml] $*"; }

SLUG="${1:-}"
[ -n "${SLUG}" ] || die "usage: sync-customer-yaml.sh <slug>"
echo "${SLUG}" | grep -qE '^[a-z0-9][a-z0-9-]{0,31}$' || die "invalid slug: ${SLUG}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CUSTOMER_YAML="${REPO_ROOT}/ai-employee/customers/${SLUG}/customer.yaml"
[ -f "${CUSTOMER_YAML}" ] || die "not found: ${CUSTOMER_YAML}"

: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID not set in env}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY not set in env}"
: "${R2_ENDPOINT_URL:?R2_ENDPOINT_URL not set in env}"
R2_BUCKET_CONFIG="${R2_BUCKET_CONFIG:-smd-customer-config}"
R2_CONFIG_KEY="vaults/${SLUG}/customer.yaml"

command -v aws >/dev/null 2>&1 || die "aws CLI not found (required for R2 upload)"

# Validate against the canonical TS validator before touching the source of truth.
log "Validating ${CUSTOMER_YAML}..."
( cd "${REPO_ROOT}" && npx --quiet tsx scripts/validate-customer-yaml.ts "${CUSTOMER_YAML}" ) \
  || die "customer.yaml validation failed; not uploading"
log "customer.yaml OK"

log "Uploading to R2: s3://${R2_BUCKET_CONFIG}/${R2_CONFIG_KEY}"
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 cp "${CUSTOMER_YAML}" "s3://${R2_BUCKET_CONFIG}/${R2_CONFIG_KEY}" \
    --endpoint-url "${R2_ENDPOINT_URL}" \
    --only-show-errors \
  || die "R2 upload failed"
log "R2 upload OK"
log "Next: restart the customer's Machine to apply (fly machine restart <id> -a hermes-${SLUG}), or redeploy."
