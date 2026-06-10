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

BROKER_DIR="/opt/data/workspace-broker"
BROKER_SOCKET="/run/smd-workspace-broker/broker.sock"
mkdir -p "${BROKER_DIR}" "$(dirname "${BROKER_SOCKET}")"
chown workspace-broker:workspace-broker "${BROKER_DIR}"
chmod 0700 "${BROKER_DIR}"
chown workspace-broker:workspace-connectors "$(dirname "${BROKER_SOCKET}")"
chmod 2750 "$(dirname "${BROKER_SOCKET}")"

export SMD_WORKSPACE_BROKER_SOCKET="${BROKER_SOCKET}"
export SMD_WORKSPACE_CREDENTIAL_PATH="${BROKER_DIR}/google.json"
export SMD_CUSTOMER_YAML="/opt/data/customer.yaml"
export SMD_GATEWAY_PID="$$"

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
  GOOGLE_SERVICE_ACCOUNT_JSON="${GOOGLE_SERVICE_ACCOUNT_JSON:-}" \
  GOOGLE_TOKEN_JSON="${GOOGLE_TOKEN_JSON:-}" \
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

log "Workspace broker started as uid $(id -u workspace-broker); dropping gateway to hermes"
exec setpriv \
  --reuid=hermes \
  --regid=hermes \
  --init-groups \
  --no-new-privs \
  /app/bootstrap.sh
