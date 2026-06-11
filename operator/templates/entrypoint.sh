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

# OP-P1-4 audit ledger: owned by the broker uid, readable (not writable) by the
# agent uid via the audit-readers group. The agent's only write path is the
# broker's append-only audit_append verb.
AUDIT_DIR="/opt/data/audit"
AUDIT_DB="${AUDIT_DIR}/audit.db"
LEGACY_AUDIT_DB="/opt/data/audit.db"
# Group-readable default so the broker's rollback journal is readable by the
# hermes mode=ro read seam during a write window. Explicit chmods below for the
# 0700/0600 broker paths are unaffected by this.
umask 027

# Agent owns its data EXCEPT the broker-owned audit subtree (R1). A plain
# `chown -R hermes:hermes /opt/data` would re-own the ledger back to hermes on
# every reboot and silently false-close the tamper-resistance.
find /opt/data -path "${AUDIT_DIR}" -prune -o -print0 | xargs -0 -r chown hermes:hermes

# Convergent (idempotent, every-boot) audit-ledger establishment. Never drops
# rows. Fails loud rather than silently diverging two ledgers (R5 / DA #5).
mkdir -p "${AUDIT_DIR}"
if [ -f "${LEGACY_AUDIT_DB}" ] && [ -f "${AUDIT_DB}" ]; then
  log "FATAL: both ${LEGACY_AUDIT_DB} and ${AUDIT_DB} exist; refusing to diverge the audit ledger (manual merge required)"
  exit 1
fi
if [ -f "${LEGACY_AUDIT_DB}" ]; then
  mv "${LEGACY_AUDIT_DB}" "${AUDIT_DB}"
  for _s in -journal -wal -shm; do
    if [ -f "${LEGACY_AUDIT_DB}${_s}" ]; then mv "${LEGACY_AUDIT_DB}${_s}" "${AUDIT_DB}${_s}"; fi
  done
fi
# Pre-create with the correct owner/mode so the broker opens an existing 0640
# file (sqlite preserves a file's mode/owner; a broker-created file would
# inherit umask and risk a 0600 the read seam cannot read).
if [ ! -f "${AUDIT_DB}" ]; then
  install -o workspace-broker -g audit-readers -m 0640 /dev/null "${AUDIT_DB}"
fi
# Re-assert owner/mode every boot (convergent, never conditional-on-legacy).
chown workspace-broker:audit-readers "${AUDIT_DIR}"
chmod 2750 "${AUDIT_DIR}"
chown workspace-broker:audit-readers "${AUDIT_DB}"
chmod 0640 "${AUDIT_DB}"
for _s in -journal -wal -shm; do
  if [ -f "${AUDIT_DB}${_s}" ]; then
    chown workspace-broker:audit-readers "${AUDIT_DB}${_s}"
    chmod 0640 "${AUDIT_DB}${_s}"
  fi
done
# Fail-closed: the hermes read seam must be able to read the ledger.
setpriv --reuid=hermes --regid=hermes --init-groups test -r "${AUDIT_DB}" \
  || { log "FATAL: ${AUDIT_DB} not hermes-readable after perm convergence"; exit 1; }

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
  SMD_AUDIT_DB_PATH="${AUDIT_DB}" \
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
