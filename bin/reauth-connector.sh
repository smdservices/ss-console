#!/usr/bin/env bash
#
# reauth-connector.sh CUSTOMER_SLUG CONNECTOR_SLUG
#
# Captain-invoked. Generates a signed OAuth authorize URL for the given
# customer + connector and emails it to the customer's principal user
# per oauth-lifecycle.md § "Re-authorization (re-consent) flow":
#
#   1. Issue a signed state parameter (HMAC-SHA256, 10-minute TTL)
#      bound to the customer slug + provider + reviewer id.
#   2. Build the provider's authorize URL with that state.
#   3. Email the link to the customer's principal user via Resend.
#
# Phase 1 supports CONNECTOR_SLUG = microsoft-graph. Other providers
# layer in once their registry entry lands in src/lib/oauth/providers/.
#
# Required env (Infisical export OR sourced from .dev.vars):
#   ADMIN_BASE_URL                e.g. https://admin.smd.services
#   PORTAL_BASE_URL               e.g. https://portal.smd.services
#   OAUTH_STATE_SIGNING_KEY       32 bytes, base64-encoded
#   MICROSOFT_GRAPH_CLIENT_ID     Entra ID app registration client id
#   RESEND_API_KEY                Resend API key for outbound email
#   REAUTH_FROM_ADDRESS           verified sender, e.g. captain@smd.services
#   REAUTH_REVIEWER_ID            Captain's Clerk user id (matches state)
#
# Optional:
#   REAUTH_CUSTOMER_EMAIL         override the principal user email
#                                 lookup; useful for dry-run testing
#   DRY_RUN=1                     print the URL + would-be email body,
#                                 don't actually send
#
# This script is intentionally a thin Bash wrapper around a Node
# one-shot. The signing key + URL builders live in TypeScript so a
# single source of truth governs every URL the platform emits.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: reauth-connector.sh CUSTOMER_SLUG CONNECTOR_SLUG

Arguments:
  CUSTOMER_SLUG     customer.yaml customer_id (e.g. acme-law)
  CONNECTOR_SLUG    provider slug; supported: microsoft-graph

Environment:
  See script header.

Exit codes:
  0  success
  1  argument error
  2  missing env
  3  email send failed
USAGE
  exit 1
}

if [ "$#" -ne 2 ]; then
  usage
fi

CUSTOMER_SLUG="$1"
CONNECTOR_SLUG="$2"

case "$CONNECTOR_SLUG" in
  microsoft-graph) ;;
  *)
    echo "FATAL: connector '$CONNECTOR_SLUG' not supported in Phase 1." >&2
    echo "       Currently shipping: microsoft-graph" >&2
    exit 1
    ;;
esac

REQUIRED_VARS=(
  ADMIN_BASE_URL
  PORTAL_BASE_URL
  OAUTH_STATE_SIGNING_KEY
  MICROSOFT_GRAPH_CLIENT_ID
  REAUTH_REVIEWER_ID
)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "FATAL: missing required env vars: ${MISSING[*]}" >&2
  echo "       Source from Infisical: infisical export --env=prod --path=/ss --format=dotenv > .env.reauth" >&2
  exit 2
fi

# Locate the repo root from this script's location so the call works
# from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Single node invocation: signs state, builds URL, prints it. We pipe
# only the URL out so the Bash wrapper can use it without parsing.
URL="$(
  CUSTOMER_SLUG="$CUSTOMER_SLUG" \
  CONNECTOR_SLUG="$CONNECTOR_SLUG" \
  REVIEWER_ID="$REAUTH_REVIEWER_ID" \
  CLIENT_ID="$MICROSOFT_GRAPH_CLIENT_ID" \
  REDIRECT_URI="${PORTAL_BASE_URL%/}/portal/products/operator/oauth/${CONNECTOR_SLUG}/callback" \
  SIGNING_KEY="$OAUTH_STATE_SIGNING_KEY" \
  node --input-type=module -e '
    import { createHmac } from "node:crypto";

    const customer_id = process.env.CUSTOMER_SLUG;
    const provider = process.env.CONNECTOR_SLUG;
    const reviewer_id = process.env.REVIEWER_ID;
    const client_id = process.env.CLIENT_ID;
    const redirect_uri = process.env.REDIRECT_URI;
    const signingKeyB64 = process.env.SIGNING_KEY;

    function b64UrlEncode(buf) {
      return Buffer.from(buf).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    const exp = Math.floor(Date.now() / 1000) + 600; // 10-minute TTL
    const nonce = crypto.randomUUID();
    const payload = JSON.stringify({
      v: 1,
      customer_id,
      provider,
      reviewer_id,
      nonce,
      exp,
    });
    const payloadB64 = b64UrlEncode(payload);

    const keyBytes = Buffer.from(signingKeyB64, "base64");
    const sig = createHmac("sha256", keyBytes).update(payloadB64).digest();
    const sigB64 = b64UrlEncode(sig);

    const state = `${payloadB64}.${sigB64}`;

    // Phase-1 scopes — must match
    // src/lib/oauth/providers/ms-graph.ts MS_GRAPH_PHASE_1_SCOPES (canonical).
    // The Python adapter that previously mirrored these has been removed; the
    // overlay sub-plugin tracked in #1055 will read scopes from a shared source.
    const scopes = [
      "offline_access",
      "User.Read",
      "Mail.Read",
      "Mail.ReadWrite",
      "MailboxSettings.Read",
      "Calendars.ReadWrite",
      "Files.Read",
      "Files.ReadWrite.AppFolder",
    ];

    const params = new URLSearchParams({
      client_id,
      response_type: "code",
      redirect_uri,
      response_mode: "query",
      scope: scopes.join(" "),
      state,
    });
    process.stdout.write(
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}\n`
    );
  '
)"

if [ -z "$URL" ]; then
  echo "FATAL: state-signing step produced no URL" >&2
  exit 1
fi

CUSTOMER_EMAIL="${REAUTH_CUSTOMER_EMAIL:-}"
if [ -z "$CUSTOMER_EMAIL" ]; then
  # Look up principal user from the canonical customer.yaml. In
  # production this lives in the configs repo; for now we read from
  # operator/customers/<slug>/customer.yaml when present and fall
  # back to printing the URL only.
  CUSTOMER_YAML="$REPO_ROOT/operator/customers/$CUSTOMER_SLUG/customer.yaml"
  if [ -f "$CUSTOMER_YAML" ]; then
    CUSTOMER_EMAIL="$(
      awk '
        /^users:/ { in_users = 1; next }
        in_users && /^[^ -]/ { in_users = 0 }
        in_users && /role:[[:space:]]*principal/ { found = 1 }
        in_users && /^[[:space:]]*-/ {
          if (found && email) { print email; exit }
          email = ""; found = 0
        }
        in_users && /email:[[:space:]]*/ {
          sub(/^[^:]*:[[:space:]]*/, "")
          gsub(/^["[:space:]]+|["[:space:]]+$/, "")
          email = $0
        }
        END {
          if (found && email) print email
        }
      ' "$CUSTOMER_YAML"
    )"
  fi
fi

cat <<EOF

Customer slug:    $CUSTOMER_SLUG
Connector:        $CONNECTOR_SLUG
Principal email:  ${CUSTOMER_EMAIL:-(not resolved; pass REAUTH_CUSTOMER_EMAIL)}
Authorize URL:    $URL

EOF

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1 set; not sending email."
  exit 0
fi

if [ -z "$CUSTOMER_EMAIL" ]; then
  echo "FATAL: cannot send — principal email not resolved." >&2
  echo "       Set REAUTH_CUSTOMER_EMAIL or populate users[].role: principal in customer.yaml." >&2
  exit 1
fi

if [ -z "${RESEND_API_KEY:-}" ] || [ -z "${REAUTH_FROM_ADDRESS:-}" ]; then
  echo "FATAL: RESEND_API_KEY or REAUTH_FROM_ADDRESS missing." >&2
  exit 2
fi

# Send via Resend. The URL is the only customer-specific data; we keep
# the body terse and free of marketing.
BODY_TEXT=$(cat <<MSG
Hello,

We need you to re-authorize the SMD Services Operator connection to
your Microsoft 365 account. Click the link below to sign in and grant
access. The link expires in 10 minutes.

$URL

If you did not expect this email, please ignore it and contact SMD
Services directly.

— SMD Services
MSG
)

JSON_PAYLOAD=$(
  CUSTOMER_EMAIL="$CUSTOMER_EMAIL" \
  BODY_TEXT="$BODY_TEXT" \
  REAUTH_FROM_ADDRESS="$REAUTH_FROM_ADDRESS" \
  python3 - <<'PY'
import json, os
print(json.dumps({
    "from": os.environ["REAUTH_FROM_ADDRESS"],
    "to": [os.environ["CUSTOMER_EMAIL"]],
    "subject": "Re-authorize Microsoft 365 access for the Operator",
    "text": os.environ["BODY_TEXT"],
}))
PY
)

HTTP_STATUS=$(
  curl -sS -o /tmp/reauth-resp.json -w "%{http_code}" \
    -X POST "https://api.resend.com/emails" \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD"
)

if [ "$HTTP_STATUS" != "200" ] && [ "$HTTP_STATUS" != "202" ]; then
  echo "FATAL: Resend send failed (HTTP $HTTP_STATUS)" >&2
  cat /tmp/reauth-resp.json >&2
  exit 3
fi

echo "OK: re-consent email sent to $CUSTOMER_EMAIL"
