#!/usr/bin/env bash
# reprovision.sh — one command, no credential hunt, to (re)provision a customer's
# Operator Machine.
#
# WHY THIS EXISTS: the operator-local R2 credentials that provision-customer.sh
# needs (R2_ENDPOINT_URL / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
# R2_BUCKET_CONFIG) were, for months, not stored anywhere discoverable — every
# agent re-derived them and burned ~2h. They now live in Infisical `/ss` (prod)
# and this wrapper injects them, so the recurring trap is closed for good.
#
# (The R2 S3 creds are derivable from CLOUDFLARE_API_TOKEN — id + sha256(value) —
# which is why they need not be minted; see docs/runbooks/operator/first-boot.md
# "R2 credentials".)
#
# Usage:
#   operator/bin/reprovision.sh <slug>            # interactive (you answer secret prompts)
#   yes s | operator/bin/reprovision.sh <slug>    # non-interactive: skip all secret
#                                                 # prompts (Machine secrets persist
#                                                 # across deploy; nothing to re-enter)
#
# Run from the repo root. Equivalent to:
#   infisical run --env=prod --path=/ss --silent -- operator/bin/provision-customer.sh <slug>
set -euo pipefail
SLUG="${1:-}"
[ -n "${SLUG}" ] || { echo "Usage: $0 <customer-slug>" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec infisical run --env=prod --path=/ss --silent -- "${HERE}/provision-customer.sh" "${SLUG}"
