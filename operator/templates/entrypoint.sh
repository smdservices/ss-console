#!/usr/bin/env bash
# Root-only process launcher for the broker and non-root gateway.

set -euo pipefail

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [entrypoint] $*"
}

[ "$(id -u)" -eq 0 ] || {
  log "FATAL: entrypoint must start as root to establish separate principals"
  exit 1
}

BROKER_DIR="/var/lib/smd-workspace-broker"
BROKER_SOCKET="/run/smd-workspace-broker/broker.sock"
BROKER_CUSTOMER_PATH="${BROKER_DIR}/customer.yaml"

# Fresh-volume seed (load-bearing). The Workspace broker starts as root BELOW,
# before the privilege drop to the hermes user and BEFORE bootstrap.sh runs its
# own R2 fetch (bootstrap.sh Step 2). On a brand-new volume
# /opt/data/customer.yaml does not exist yet, so the broker `cp` further down
# fails and the boot crash-loops to max-restarts. Seed it here from R2 (the
# source of truth) with the boot-time creds, so a FRESH provision boots with no
# manual volume seed. Idempotent: on a persisted volume the file already exists
# (skip), and bootstrap still re-fetches the latest on every boot. This is a
# regression from #1304 (broker-home isolation introduced the root-side cp);
# the staging gate caught it on first use.
if [ ! -f /opt/data/customer.yaml ]; then
  log "customer.yaml absent on fresh volume — seeding from R2 before broker start"
  : "${R2_BUCKET_CONFIG:?R2_BUCKET_CONFIG required to seed customer.yaml}"
  : "${CUSTOMER_SLUG:?CUSTOMER_SLUG required to seed customer.yaml}"
  _seed_endpoint="${R2_ENDPOINT_URL:-https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com}"
  if ! AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?}" \
       AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?}" \
         aws s3 cp \
           --endpoint-url "${_seed_endpoint}" \
           --only-show-errors \
           "s3://${R2_BUCKET_CONFIG}/vaults/${CUSTOMER_SLUG}/customer.yaml" \
           /opt/data/customer.yaml; then
    log "FATAL: failed to seed customer.yaml from R2 on fresh boot"
    exit 1
  fi
fi
chown -R hermes:hermes /opt/data
rm -rf /opt/data/workspace-broker
rm -f /opt/data/oauth/google.json
mkdir -p "${BROKER_DIR}" "$(dirname "${BROKER_SOCKET}")"
rm -f "${BROKER_DIR}/google.json"
cp /opt/data/customer.yaml "${BROKER_CUSTOMER_PATH}"
chown -R workspace-broker:workspace-broker "${BROKER_DIR}"
chmod 0700 "${BROKER_DIR}"
chown workspace-broker:workspace-connectors "$(dirname "${BROKER_SOCKET}")"
chmod 2750 "$(dirname "${BROKER_SOCKET}")"

export SMD_WORKSPACE_BROKER_SOCKET="${BROKER_SOCKET}"
export SMD_WORKSPACE_CREDENTIAL_PATH="${BROKER_DIR}/google.json"
export SMD_CUSTOMER_YAML="${BROKER_CUSTOMER_PATH}"
export SMD_GATEWAY_PID="$$"

PYTHONPATH="/opt/workspace-broker" \
  /opt/workspace-broker/.venv/bin/python -c \
  'import os; from pathlib import Path; from workspace_broker.google_auth import materialize_credential; materialize_credential(Path(os.environ["SMD_WORKSPACE_CREDENTIAL_PATH"]))'
[ -f "${SMD_WORKSPACE_CREDENTIAL_PATH}" ] || {
  log "FATAL: Workspace broker credential was not materialized"
  exit 1
}
chown workspace-broker:workspace-broker "${SMD_WORKSPACE_CREDENTIAL_PATH}"
chmod 0600 "${SMD_WORKSPACE_CREDENTIAL_PATH}"

setpriv \
  --reuid=workspace-broker \
  --regid=workspace-broker \
  --init-groups \
  --no-new-privs \
  /usr/bin/env -i \
  PATH="/opt/workspace-broker/.venv/bin:/usr/bin:/bin" \
  PYTHONPATH="/opt/workspace-broker" \
  PYTHONUNBUFFERED=1 \
  CUSTOMER_SLUG="${CUSTOMER_SLUG}" \
  SMD_WORKSPACE_BROKER_SOCKET="${SMD_WORKSPACE_BROKER_SOCKET}" \
  SMD_WORKSPACE_CREDENTIAL_PATH="${SMD_WORKSPACE_CREDENTIAL_PATH}" \
  SMD_CUSTOMER_YAML="${SMD_CUSTOMER_YAML}" \
  SMD_GATEWAY_PID="${SMD_GATEWAY_PID}" \
  /opt/workspace-broker/.venv/bin/python \
  -m workspace_broker.server &
BROKER_PID=$!

for _ in 1 2 3 4 5; do
  [ -S "${BROKER_SOCKET}" ] && break
  sleep 1
done
[ -S "${BROKER_SOCKET}" ] || {
  log "FATAL: Workspace broker socket was not created"
  kill "${BROKER_PID}" 2>/dev/null || true
  exit 1
}

unset GOOGLE_SERVICE_ACCOUNT_JSON GOOGLE_TOKEN_JSON GOOGLE_CLIENT_SECRET_JSON
unset GOOGLE_IMPERSONATE_SUBJECT GOOGLE_OAUTH_SCOPES GOOGLE_TOKEN_PATH

export HOME=/opt/data
log "Workspace broker started as uid $(id -u workspace-broker); dropping gateway to hermes"
exec setpriv \
  --reuid=hermes \
  --regid=hermes \
  --init-groups \
  --no-new-privs \
  /app/bootstrap.sh
