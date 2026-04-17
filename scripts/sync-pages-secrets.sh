#!/usr/bin/env bash
#
# Sync Cloudflare Pages secrets from Infisical.
#
# ## Why this exists
#
# Cloudflare Pages projects with a `wrangler.toml` `[vars]` block treat that
# file as the authoritative source of deployment bindings. Every
# `wrangler pages deploy` run silently overrides the deployment's secret
# bindings so they reach the runtime as empty strings — including secrets
# set via `wrangler pages secret put` or the Cloudflare dashboard.
#
# The effect is invisible: Resend email silently falls back to console logs,
# Claude calls 401, Stripe/SignWell webhooks stop working, etc. No deploy
# failure, no error — just empty values at runtime.
#
# This script is the durable fix. It reads all secrets from Infisical at
# the configured venture path and re-binds them to the Pages production
# deployment after every deploy.
#
# ## Usage
#
# Local (authenticated Infisical session):
#   bash scripts/sync-pages-secrets.sh                      # default path /ss, project ss-web
#   bash scripts/sync-pages-secrets.sh --dry-run            # list what would be set
#   bash scripts/sync-pages-secrets.sh --path /ss --env prod --project ss-web
#
# CI (requires INFISICAL_TOKEN machine-identity token):
#   env INFISICAL_TOKEN=... bash scripts/sync-pages-secrets.sh
#
# ## Exit codes
#   0 - Success (or dry-run completed)
#   1 - Infisical not authenticated / no secrets found
#   2 - Configuration or argument error

set -euo pipefail

# ---------- Defaults ----------
INFISICAL_ENV="prod"
INFISICAL_PATH="/ss"
PAGES_PROJECT="ss-web"
DRY_RUN=0

# ---------- Args ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) INFISICAL_ENV="$2"; shift 2 ;;
    --path) INFISICAL_PATH="$2"; shift 2 ;;
    --project) PAGES_PROJECT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h)
      sed -n '2,35p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown arg '$1'" >&2
      exit 2
      ;;
  esac
done

# ---------- Preflight ----------
command -v infisical >/dev/null 2>&1 || { echo "error: infisical CLI not found"; exit 2; }
command -v npx >/dev/null 2>&1 || { echo "error: npx not found"; exit 2; }

# Infisical auth:
#   - If INFISICAL_TOKEN is set (CI / machine identity), use it via --token flag
#   - Otherwise assume the CLI has an interactive session (local dev)
AUTH_FLAG=""
if [[ -n "${INFISICAL_TOKEN:-}" ]]; then
  AUTH_FLAG="--token=$INFISICAL_TOKEN"
fi

# ---------- Enumerate secrets in Infisical ----------
echo "Listing Infisical secrets at path=$INFISICAL_PATH env=$INFISICAL_ENV"
SECRET_NAMES=$(
  infisical secrets $AUTH_FLAG \
    --env="$INFISICAL_ENV" \
    --path="$INFISICAL_PATH" \
    --silent 2>/dev/null \
    | grep -oE "^│ [A-Z_][A-Z0-9_]+\s" \
    | tr -d '│ ' \
    | sort -u \
    | grep -v '^SECRET$' \
    || true
)

if [[ -z "$SECRET_NAMES" ]]; then
  echo "error: no secrets found at $INFISICAL_PATH (auth?)" >&2
  exit 1
fi

COUNT=$(echo "$SECRET_NAMES" | wc -l | tr -d ' ')
echo "Found $COUNT secrets."

# ---------- Sync each ----------
FAILED=0
while IFS= read -r name; do
  [[ -z "$name" ]] && continue

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] would sync $name"
    continue
  fi

  # Read value from Infisical (stdout only) and pipe directly into wrangler.
  # Value never lands in a shell variable — minimises accidental exposure.
  if infisical secrets get "$name" $AUTH_FLAG \
       --env="$INFISICAL_ENV" \
       --path="$INFISICAL_PATH" \
       --plain 2>/dev/null \
     | tr -d '\n' \
     | npx --yes wrangler pages secret put "$name" --project-name "$PAGES_PROJECT" 2>&1 \
     | grep -qE "Success|Uploaded"
  then
    echo "  ✓ $name"
  else
    echo "  ✗ $name (failed)"
    FAILED=$((FAILED+1))
  fi
done <<< "$SECRET_NAMES"

if [[ $FAILED -gt 0 ]]; then
  echo "$FAILED secret(s) failed to sync" >&2
  exit 1
fi

echo "Sync complete."
