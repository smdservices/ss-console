#!/usr/bin/env bash
#
# connect-smokeball.sh CUSTOMER_SLUG
#
# Captain-invoked. Prints a Smokeball authorize URL for the firm-delegated
# (authorization_code) connect flow (ADR 0053). The Captain hands the URL to the
# firm; the firm signs into Smokeball + clicks Allow; Smokeball redirects to the
# hosted callback (/api/operator/smokeball/connect-callback) which exchanges the
# code, relays the refresh token to the Machine, and renders "✓ Connected".
#
# The seat's environment + region are read from its customer.yaml smokeball
# connector block (default us / staging). The matching app client_id is sourced
# from the operator env: SMOKEBALL_STAGING_CLIENT_ID (staging) or
# SMOKEBALL_PROD_CLIENT_ID (production). The client SECRET is NOT needed here
# (only the callback exchanges the code).
#
# This is the INITIATE half only — it prints a URL and never sends email and
# never touches a secret value. Run under the operator env so the signing key +
# client id are present:
#
#   infisical run --env=prod --path=/ss -- bin/connect-smokeball.sh ashton-price
#
# Required env (Infisical /ss):
#   OAUTH_STATE_SIGNING_KEY   32 bytes, base64 — the same key the callback verifies with
#   PORTAL_BASE_URL           e.g. https://portal.smd.services (origin of the callback)
#   SMOKEBALL_STAGING_CLIENT_ID  (staging seats)  OR
#   SMOKEBALL_PROD_CLIENT_ID     (production seats)
#
# Optional:
#   SMOKEBALL_CONNECT_REVIEWER_ID  audit id carried in the state (default: "connect-script")

set -euo pipefail

usage() {
  echo "Usage: connect-smokeball.sh CUSTOMER_SLUG" >&2
  exit 1
}

[ "$#" -eq 1 ] || usage
CUSTOMER_SLUG="$1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CUSTOMER_YAML="$REPO_ROOT/operator/customers/$CUSTOMER_SLUG/customer.yaml"
[ -f "$CUSTOMER_YAML" ] || { echo "FATAL: no customer.yaml at $CUSTOMER_YAML" >&2; exit 1; }

# Read environment + region from the smokeball connector block (defaults staging/us).
SB_FIELDS=()
while IFS= read -r _line; do SB_FIELDS+=("${_line}"); done < <(
  CUSTOMER_YAML="$CUSTOMER_YAML" uv run --quiet --with pyyaml python3 -c "
import os, yaml
with open(os.environ['CUSTOMER_YAML']) as f:
    c = yaml.safe_load(f) or {}
sb = {}
for conn in (c.get('connectors') or {}).values():
    if isinstance(conn, dict) and str(conn.get('backend', '')) == 'mcp:smokeball':
        sb = conn
        break
print(str(sb.get('environment', 'staging')).strip().lower())
print(str(sb.get('region', 'us')).strip().lower())
"
)
SB_ENV="${SB_FIELDS[0]:-staging}"
SB_REGION="${SB_FIELDS[1]:-us}"
[ "$SB_ENV" = "production" ] || SB_ENV="staging"   # normalize anything else to staging

# Auth host by (region, environment) — must match the connector + provider tables.
case "${SB_REGION}:${SB_ENV}" in
  us:production) AUTH_HOST="https://auth.smokeball.com" ;;
  us:staging)    AUTH_HOST="https://datastaging-auth.smokeball.com" ;;
  au:production) AUTH_HOST="https://auth.smokeball.com.au" ;;
  au:staging)    AUTH_HOST="https://datastaging-auth.smokeball.com.au" ;;
  uk:production) AUTH_HOST="https://auth.smokeball.co.uk" ;;
  uk:staging)    AUTH_HOST="https://datastaging-auth.smokeball.co.uk" ;;
  *) echo "FATAL: unknown region/environment ${SB_REGION}/${SB_ENV}" >&2; exit 1 ;;
esac

# Client id from the environment-matched operator-env name.
if [ "$SB_ENV" = "production" ]; then
  CLIENT_ID="${SMOKEBALL_PROD_CLIENT_ID:-}"
  CLIENT_ID_SRC="SMOKEBALL_PROD_CLIENT_ID"
else
  CLIENT_ID="${SMOKEBALL_STAGING_CLIENT_ID:-}"
  CLIENT_ID_SRC="SMOKEBALL_STAGING_CLIENT_ID"
fi

MISSING=()
[ -n "${OAUTH_STATE_SIGNING_KEY:-}" ] || MISSING+=("OAUTH_STATE_SIGNING_KEY")
[ -n "${PORTAL_BASE_URL:-}" ]         || MISSING+=("PORTAL_BASE_URL")
[ -n "${CLIENT_ID}" ]                 || MISSING+=("${CLIENT_ID_SRC}")
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "FATAL: missing required env: ${MISSING[*]}" >&2
  echo "       Run under: infisical run --env=prod --path=/ss -- bin/connect-smokeball.sh ${CUSTOMER_SLUG}" >&2
  exit 2
fi

REDIRECT_URI="${PORTAL_BASE_URL%/}/api/operator/smokeball/connect-callback"
PROVIDER="smokeball:${SB_REGION}:${SB_ENV}"
REVIEWER_ID="${SMOKEBALL_CONNECT_REVIEWER_ID:-connect-script}"

# Single node invocation: signs state (same HMAC scheme as src/lib/oauth/state.ts),
# builds the authorize URL, prints only the URL. Scopes mirror
# SMOKEBALL_OPERATOR_SCOPES in src/lib/oauth/providers/smokeball.ts (keep in sync).
URL="$(
  CUSTOMER_SLUG="$CUSTOMER_SLUG" \
  PROVIDER="$PROVIDER" \
  REVIEWER_ID="$REVIEWER_ID" \
  CLIENT_ID="$CLIENT_ID" \
  REDIRECT_URI="$REDIRECT_URI" \
  AUTH_HOST="$AUTH_HOST" \
  SIGNING_KEY="$OAUTH_STATE_SIGNING_KEY" \
  node --input-type=module -e '
    import { createHmac } from "node:crypto";

    const customer_id = process.env.CUSTOMER_SLUG;
    const provider = process.env.PROVIDER;
    const reviewer_id = process.env.REVIEWER_ID;
    const client_id = process.env.CLIENT_ID;
    const redirect_uri = process.env.REDIRECT_URI;
    const auth_host = process.env.AUTH_HOST;
    const signingKeyB64 = process.env.SIGNING_KEY;

    function b64UrlEncode(buf) {
      return Buffer.from(buf).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    const exp = Math.floor(Date.now() / 1000) + 600; // 10-minute TTL
    const nonce = crypto.randomUUID();
    const payload = JSON.stringify({ v: 1, customer_id, provider, reviewer_id, nonce, exp });
    const payloadB64 = b64UrlEncode(payload);
    const keyBytes = Buffer.from(signingKeyB64, "base64");
    const sigB64 = b64UrlEncode(createHmac("sha256", keyBytes).update(payloadB64).digest());
    const state = `${payloadB64}.${sigB64}`;

    const scopes = [
      "matters/read", "contacts/read", "mattertypes/read", "stages/read",
      "tasks/read", "staff/read", "roles/read", "documents/read",
      "memos/read", "memos/write", "bankaccounts/read", "bankaccountbalances/read",
      "billingconfiguration/read", "fees/read", "expenses/read",
      "webhooks/read", "webhooks/write",
    ];

    const params = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri,
      scope: scopes.join(" "),
      state,
    });
    process.stdout.write(`${auth_host}/oauth2/authorize?${params.toString()}\n`);
  '
)"

[ -n "$URL" ] || { echo "FATAL: state-signing step produced no URL" >&2; exit 1; }

cat <<EOF

Smokeball connect — ${CUSTOMER_SLUG}
  environment:   ${SB_ENV}  (region ${SB_REGION}, host ${AUTH_HOST})
  redirect_uri:  ${REDIRECT_URI}
  state TTL:     10 minutes

Hand this URL to the firm. They sign into Smokeball + click Allow:

${URL}

EOF
