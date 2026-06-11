#!/usr/bin/env bash
# reprovision-staging.sh — (re)provision the STAGING Operator: the permanent,
# faithful pre-production gate for Operator lifecycle work.
#
# WHY THIS EXISTS: a world-class deploy process never tests changes to the
# deploy/boot/voice/env machinery on the one live customer. This stands up
# hermes-smd-staging from the EXACT same tooling as production, so every cut is
# proven here before it touches a real customer.
#
# ISOLATION (the load-bearing part): the normal reprovision injects every
# Infisical /ss key as an env var, and provision-customer.sh stages the
# per-customer ones (GOOGLE_SERVICE_ACCOUNT_JSON, CLIO_*) onto the Machine.
# Those are the REAL customer credentials. This wrapper:
#   - replaces GOOGLE_SERVICE_ACCOUNT_JSON with a freshly generated ISOLATED
#     service account (gen-staging-google-cred.py) — boots the broker
#     identically to prod, wired to nothing real; and
#   - BLANKS CLIO_* so the real Clio credentials never reach the staging box.
# Result: staging borrows none of the live business's access.
#
# The slug is HARDCODED to smd-staging. This wrapper must never touch a real
# customer.
#
# Usage:  operator/bin/reprovision-staging.sh
set -euo pipefail

SLUG="smd-staging"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec infisical run --env=prod --path=/ss --silent -- bash -c '
  set -euo pipefail
  HERE="$1"; SLUG="$2"
  # Generated isolated Google credential (throwaway RSA key, fictitious project).
  # Value flows env -> fly secrets import; never printed.
  GEN_JSON="$(uv run --quiet --with cryptography python3 "${HERE}/gen-staging-google-cred.py")"
  export GOOGLE_SERVICE_ACCOUNT_JSON="$(printf "%s" "${GEN_JSON}" | base64 | tr -d "\n")"
  unset GEN_JSON
  # Blank real per-customer secrets so they never leak onto the staging Machine.
  # The values are empty strings (blanking), not secrets — gitleaks false positive.
  export CLIO_CLIENT_ID="" CLIO_CLIENT_SECRET="" CLIO_ENCRYPTION_KEY="" CLIO_TOKENS_ENC_B64="" # gitleaks:allow
  # Non-interactive: Machine secrets persist; nothing to paste.
  yes s | "${HERE}/provision-customer.sh" "${SLUG}"
' _ "${HERE}" "${SLUG}"
