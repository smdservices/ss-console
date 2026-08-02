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
# never touches a secret value. Before minting anything it runs a mechanical
# gate (#2149/#2171): the target seat must be running the overlay ref pinned on
# origin/main AND origin/main's runtime-control registry must record the
# identifier gate as `enforced`. Requires `fly` auth for the seat probe.
# Run under the operator env so the signing key + client id are present:
#
#   infisical run --env=prod --path=/ss -- bin/connect-smokeball.sh ashton-price
#
# Required env (Infisical /ss):
#   OPERATOR_OAUTH_STATE_MASTER  master key; we derive the per-customer state key
#                                HMAC(master, slug) — the same value provisioning
#                                staged on the Machine as SMOKEBALL_OAUTH_STATE_KEY
#                                (ADR 0054). The Machine verifies our state with it.
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
if [[ ! "${CUSTOMER_SLUG}" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then
  echo "FATAL: invalid slug '${CUSTOMER_SLUG}' (must match ^[a-z0-9][a-z0-9-]{0,31}$)" >&2
  exit 1
fi
APP_NAME="hermes-${CUSTOMER_SLUG}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CUSTOMER_YAML="$REPO_ROOT/operator/customers/$CUSTOMER_SLUG/customer.yaml"
[ -f "$CUSTOMER_YAML" ] || { echo "FATAL: no customer.yaml at $CUSTOMER_YAML" >&2; exit 1; }

# ---------------------------------------------------------------------------
# MECHANICAL GATE (#2149 / #2171). A refresh token is the highest-trust artifact
# this venture handles; it must never land on a seat that (a) is not running the
# pinned overlay, or (b) is running a pin whose identifier gate has not been
# PROVEN to refuse fabricated identifiers on a live seat. Both refusals read
# origin/main, never the local checkout — a stale checkout must not vouch for
# itself (the 2026-07-31 wrong-image incident). There is deliberately NO escape
# hatch: the fix for a refusal is to rebuild the seat or land the enforcement
# proof (#2171 PR 3), not to bypass the gate.
git -C "${REPO_ROOT}" fetch origin --quiet \
  || echo "WARN: git fetch failed; comparing against the last-known origin/main" >&2

# (a) Seat currency: the running seat's SMD_OVERLAY_REF (container ENV, baked by
# operator/templates/Dockerfile) must equal origin/main's pinned overlayRef.
EXPECTED_REF="$(git -C "${REPO_ROOT}" show origin/main:operator/contracts/overlay-pairs.json \
  | sed -n 's/.*"overlayRef"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' | head -1)"
if [[ ! "${EXPECTED_REF}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "FATAL: could not read overlayRef from origin/main overlay-pairs.json" >&2
  exit 1
fi
# Resolve the gateway pid INLINE on the seat (seat-probe.sh pattern — Fly's
# PID 1 is their init and does not carry image ENV). No running gateway means
# the seat cannot be verified, and a seat whose gateway is down should not be
# receiving a token anyway — refuse.
RUNNING_REF="$(fly ssh console -a "${APP_NAME}" -C "sh -c '
GPID=\$(pgrep -f \"hermes.*gateway run\" | head -1)
[ -n \"\${GPID}\" ] || exit 1
tr \"\\0\" \"\\n\" < /proc/\${GPID}/environ | grep ^SMD_OVERLAY_REF= | cut -d= -f2
'" 2>/dev/null | tr -cd '0-9a-f')"
if [[ ! "${RUNNING_REF}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "FATAL: could not read SMD_OVERLAY_REF from ${APP_NAME}'s gateway process —" >&2
  echo "       cannot verify the seat is current, so refusing (fail closed)." >&2
  echo "       Is the Machine running with a live gateway?" >&2
  exit 3
fi
if [ "${RUNNING_REF}" != "${EXPECTED_REF}" ]; then
  echo "REFUSED: ${APP_NAME} runs overlay ${RUNNING_REF:0:12} but origin/main pins ${EXPECTED_REF:0:12}." >&2
  echo "         A token must not land on a stale seat (#2149). Rebuild first:" >&2
  echo "           yes s | operator/bin/reprovision.sh ${CUSTOMER_SLUG}" >&2
  exit 3
fi

# (b) Enforcement: origin/main's runtime-control registry must record the
# identifier gate as `enforced` (live-proven refuse mode, #2171). A seat can be
# CURRENT and still non-enforcing — currency alone is not enough.
GATE_STATUS="$(git -C "${REPO_ROOT}" show origin/main:operator/contracts/runtime-controls.yaml \
  | uv run --quiet --with pyyaml python3 -c "
import sys, yaml
d = yaml.safe_load(sys.stdin) or {}
print(str(((d.get('controls') or {}).get('identifier_gate') or {}).get('status', 'absent')))
")"
if [ "${GATE_STATUS}" != "enforced" ]; then
  echo "REFUSED: identifier_gate status on origin/main is '${GATE_STATUS}', not 'enforced'." >&2
  echo "         The report->refuse flip (#2171) has not been proven live; no token" >&2
  echo "         lands before enforcement (Captain directive 2026-08-02)." >&2
  exit 3
fi
echo "gate: ${APP_NAME} on pinned overlay ${EXPECTED_REF:0:12}; identifier_gate enforced — proceeding" >&2

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
[ -n "${OPERATOR_OAUTH_STATE_MASTER:-}" ] || MISSING+=("OPERATOR_OAUTH_STATE_MASTER")
[ -n "${CLIENT_ID}" ]                     || MISSING+=("${CLIENT_ID_SRC}")
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "FATAL: missing required env: ${MISSING[*]}" >&2
  echo "       Run under: infisical run --env=prod --path=/ss -- bin/connect-smokeball.sh ${CUSTOMER_SLUG}" >&2
  exit 2
fi

# Derive the per-customer OAuth state key (ADR 0054): HMAC(master, slug) — the
# SAME derivation provision-customer.sh stages on the Machine as
# SMOKEBALL_OAUTH_STATE_KEY. The Machine verifies the state we sign here with its
# own copy of this key, so a state we mint for one customer only verifies on that
# customer's Machine.
STATE_KEY="$(printf '%s' "${CUSTOMER_SLUG}" | openssl dgst -sha256 -hmac "${OPERATOR_OAUTH_STATE_MASTER}" | awk '{print $NF}')"

# The callback lives on the customer's OWN Machine (ADR 0054) — not a shared
# Worker — so the firm's Smokeball OAuth never touches shared SMD infrastructure.
# The firm's app registers exactly this redirect URI.
REDIRECT_URI="https://${APP_NAME}.fly.dev/oauth/smokeball/callback"
PROVIDER="smokeball:${SB_REGION}:${SB_ENV}"
REVIEWER_ID="${SMOKEBALL_CONNECT_REVIEWER_ID:-connect-script}"

# Single node invocation: signs state, builds the authorize URL, prints only the
# URL. The HMAC key is the derived per-customer key used as RAW UTF-8 bytes —
# matching the Machine verifier (shared/oauth_callback.py key.encode()).
#
# No `scope` parameter: Smokeball applies the app registration's configured
# scope set implicitly (their console-generated install URLs omit scope), and
# an explicit list containing anything absent from the app definition bounces
# the whole authorize with invalid_scope — which is how the 2026-07-02 connect
# failed after the app's scope cleanup. The app definition is the single source
# of truth for what the token carries; the connector logs granted_scopes on
# first successful call, which is where to verify what actually came through.
URL="$(
  CUSTOMER_SLUG="$CUSTOMER_SLUG" \
  PROVIDER="$PROVIDER" \
  REVIEWER_ID="$REVIEWER_ID" \
  CLIENT_ID="$CLIENT_ID" \
  REDIRECT_URI="$REDIRECT_URI" \
  AUTH_HOST="$AUTH_HOST" \
  STATE_KEY="$STATE_KEY" \
  node --input-type=module -e '
    import { createHmac } from "node:crypto";

    const customer_id = process.env.CUSTOMER_SLUG;
    const provider = process.env.PROVIDER;
    const reviewer_id = process.env.REVIEWER_ID;
    const client_id = process.env.CLIENT_ID;
    const redirect_uri = process.env.REDIRECT_URI;
    const auth_host = process.env.AUTH_HOST;
    const stateKey = process.env.STATE_KEY;

    function b64UrlEncode(buf) {
      return Buffer.from(buf).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    const exp = Math.floor(Date.now() / 1000) + 600; // 10-minute TTL
    const nonce = crypto.randomUUID();
    const payload = JSON.stringify({ v: 1, customer_id, provider, reviewer_id, nonce, exp });
    const payloadB64 = b64UrlEncode(payload);
    // Key used as raw UTF-8 bytes (Buffer.from(string)) to match the Python verifier.
    const sigB64 = b64UrlEncode(createHmac("sha256", Buffer.from(stateKey)).update(payloadB64).digest());
    const state = `${payloadB64}.${sigB64}`;

    const params = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri,
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
