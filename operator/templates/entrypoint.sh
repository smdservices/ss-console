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

# Keystone (audit 2026-06-15 — SEC-07/08/09/18/30, EFF-14, proven-live on
# hermes-smd-staging). The live customer.yaml is the source every trust-ceiling /
# vertical-floor / scope decision resolves against, read fresh per action. It MUST
# NOT live on the agent-writable /opt/data volume: the hermes uid owns that tree,
# so the agent could rewrite its own ceiling (proven: one sed flipped
# external_send draft_for_review->autonomous) or rename the file (it owns the dir).
# It lives in a fully root-owned directory, world-readable (0644) but NEVER
# writable or renameable by the hermes uid. Root — this entrypoint plus the
# ADR-0044 config applier — is the only writer.
CONFIG_DIR="/var/lib/smd-config"
LIVE_CUSTOMER_YAML="${CONFIG_DIR}/customer.yaml"

# Root fetches the authoritative customer.yaml from R2 (source of truth) on EVERY
# boot into the root-owned ${CONFIG_DIR}. This REPLACES the former hermes-side
# fetch in bootstrap.sh Step 2, which wrote an agent-writable copy on /opt/data —
# the keystone hole. The broker `cp` further down and the gateway both read this
# root-owned copy. R2 is the only source on a fresh volume. A pre-keystone
# persisted volume may still carry an agent-owned /opt/data/customer.yaml: migrate
# it once, then remove it so no writable copy survives. Idempotent every boot.
mkdir -p "${CONFIG_DIR}"
chown root:root "${CONFIG_DIR}"
chmod 0755 "${CONFIG_DIR}"
: "${R2_BUCKET_CONFIG:?R2_BUCKET_CONFIG required to fetch customer.yaml}"
: "${CUSTOMER_SLUG:?CUSTOMER_SLUG required to fetch customer.yaml}"
if [ -f /opt/data/customer.yaml ] && [ ! -f "${LIVE_CUSTOMER_YAML}" ]; then
  mv /opt/data/customer.yaml "${LIVE_CUSTOMER_YAML}"
  log "migrated legacy /opt/data/customer.yaml -> ${LIVE_CUSTOMER_YAML} (keystone relocation)"
fi
_seed_endpoint="${R2_ENDPOINT_URL:-https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com}"
if AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?}" \
     AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?}" \
       aws s3 cp \
         --endpoint-url "${_seed_endpoint}" \
         --only-show-errors \
         "s3://${R2_BUCKET_CONFIG}/vaults/${CUSTOMER_SLUG}/customer.yaml" \
         "${LIVE_CUSTOMER_YAML}.r2.tmp"; then
  mv -f "${LIVE_CUSTOMER_YAML}.r2.tmp" "${LIVE_CUSTOMER_YAML}"
  log "customer.yaml refreshed from R2 (source of truth) into ${CONFIG_DIR}"
elif [ -f "${LIVE_CUSTOMER_YAML}" ]; then
  rm -f "${LIVE_CUSTOMER_YAML}.r2.tmp" 2>/dev/null || true
  log "WARN: R2 fetch failed; using existing root-owned customer.yaml"
else
  log "FATAL: customer.yaml not present and R2 fetch failed (${R2_BUCKET_CONFIG}/vaults/${CUSTOMER_SLUG})"
  exit 1
fi
# Root owns it; the agent reads (0644) but cannot write or rename it (the parent
# dir is root-owned). This is the structural close of the self-loopback.
chown root:root "${LIVE_CUSTOMER_YAML}"
chmod 0644 "${LIVE_CUSTOMER_YAML}"
rm -f /opt/data/customer.yaml

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

# Agent owns its data EXCEPT the broker-owned audit subtree (R1). This REPLACES
# a plain `chown -R hermes:hermes /opt/data`, which would re-own the ledger back
# to hermes on every reboot and silently false-close the tamper-resistance.
find /opt/data -path "${AUDIT_DIR}" -prune -o -print0 | xargs -0 -r chown hermes:hermes

# NOTE: the broker reaches the ledger via the bind mount established below, NOT
# by traversing /opt/data. The Hermes gateway chmods its home (/opt/data) to
# 0700 mid-boot, which strips any group-traverse we could grant here — so the
# write path must not depend on the home dir's mode.

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

# Bind-mount the ledger dir to a root-owned path the broker can always traverse,
# independent of /opt/data's mode (the gateway flips the home to 0700 mid-boot).
# Same underlying volume inodes as ${AUDIT_DIR}; the broker writes via this path,
# the hermes read seam reads via ${AUDIT_DB} (hermes owns its home). /run is a
# fresh tmpfs each boot, so re-create the mountpoint and bind idempotently.
AUDIT_BIND_DIR="/run/smd-audit"
AUDIT_BIND_DB="${AUDIT_BIND_DIR}/audit.db"
mkdir -p "${AUDIT_BIND_DIR}"
mountpoint -q "${AUDIT_BIND_DIR}" \
  || mount --bind "${AUDIT_DIR}" "${AUDIT_BIND_DIR}" \
  || { log "FATAL: could not bind-mount ${AUDIT_DIR} -> ${AUDIT_BIND_DIR}"; exit 1; }

rm -rf /opt/data/workspace-broker
rm -f /opt/data/oauth/google.json
mkdir -p "${BROKER_DIR}" "$(dirname "${BROKER_SOCKET}")"
rm -f "${BROKER_DIR}/google.json"
cp "${LIVE_CUSTOMER_YAML}" "${BROKER_CUSTOMER_PATH}"
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

# The broker is the SECOND principal that BOTH the Google capability path AND the
# OP-P1-4 audit_append path depend on. Define its launch ONCE; the supervisor
# below uses it for the first start and every respawn. env -i with a fixed
# allowlist — the broker reads its Google credential from the materialized file
# (SMD_WORKSPACE_CREDENTIAL_PATH), never from env, so a respawn needs nothing the
# parent later unsets.
launch_broker() {
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
    SMD_AGENT_UID="$(id -u hermes)" \
    SMD_AUDIT_DB_PATH="${AUDIT_BIND_DB}" \
    /opt/workspace-broker/.venv/bin/python \
    -m workspace_broker.server
}

# Root-side respawn supervisor (OP-P1-4 follow-up). WITHOUT it, a broker that dies
# mid-run is never restarted: audit_append then fails OPEN (rows silently dropped,
# the exact gap OP-P1-4 closes) and Google capability stops, with no signal. We
# fork the supervisor while STILL ROOT — before the exec-drop to hermes at the
# bottom — so each respawn can re-setpriv a fresh broker to uid workspace-broker
# (a hermes process could not re-acquire that uid). The server unlinks its stale
# socket on bind (server.py), so respawns rebind cleanly. SMD_GATEWAY_PID is the
# entrypoint PID, preserved across the exec, so the SO_PEERCRED gate still admits
# the gateway after a respawn. A broker that is broken from the FIRST boot is NOT
# masked: the parent's socket-wait below still FATALs the whole Machine (Fly
# restarts it); the supervisor only covers death AFTER a healthy first start. The
# `if` guard keeps the inherited `set -e` from killing the loop on a non-zero
# broker exit. (Fail-open-with-respawn is intentional for this PR; the stronger
# fail-closed ack-before-dispatch is deferred to the autonomous-send workstream.)
(
  while true; do
    if launch_broker; then _brk_rc=0; else _brk_rc=$?; fi
    log "Workspace broker exited (rc=${_brk_rc}); respawning in 2s"
    sleep 2
  done
) &
SUPERVISOR_PID=$!

for _ in 1 2 3 4 5; do
  [ -S "${BROKER_SOCKET}" ] && break
  sleep 1
done
[ -S "${BROKER_SOCKET}" ] || {
  log "FATAL: Workspace broker socket was not created"
  kill "${SUPERVISOR_PID}" 2>/dev/null || true
  exit 1
}

unset GOOGLE_SERVICE_ACCOUNT_JSON GOOGLE_TOKEN_JSON GOOGLE_CLIENT_SECRET_JSON
unset GOOGLE_IMPERSONATE_SUBJECT GOOGLE_OAUTH_SCOPES GOOGLE_TOKEN_PATH

export HOME=/opt/data

# Keystone wiring: point the ADR-0044 applier (the root writer) and every
# agent-side reader at the root-owned live config. SMD_APPLIER_VOLUME_PATH is the
# applier's write/read target; SMD_CUSTOMER_YAML_PATH is what
# shared.customer_config.from_volume() (trust gate, reply channel, webhook-router)
# resolves at runtime. The gateway exec below inherits both (no env -i), so the
# agent reads the root-owned copy and has no writable path to its own ceiling.
export SMD_APPLIER_VOLUME_PATH="${LIVE_CUSTOMER_YAML}"
export SMD_CUSTOMER_YAML_PATH="${LIVE_CUSTOMER_YAML}"

log "Workspace broker started as uid $(id -u workspace-broker); dropping gateway to hermes"

# Root-side config applier (ADR 0044 live reconfiguration). Forked here as a
# ROOT background child — BEFORE the exec-drop to hermes below — so it survives
# the exec and keeps uid 0. It polls R2 for an updated customer.yaml, validates +
# safety-checks it (config_applier + the parity validator), and atomically writes
# it to ${LIVE_CUSTOMER_YAML} (via SMD_APPLIER_VOLUME_PATH) so the agent picks up
# entitlement / scope / skill / webhook / demo changes on its NEXT action — no reboot.
#
# WHY ROOT (ADR 0044 Decision 5, hardened by the 2026-06-15 keystone): the live
# customer.yaml now lives in the root-owned ${CONFIG_DIR}, so root is the ONLY
# principal that can write it — the hermes agent reads it (0644) but cannot rewrite
# its own ceiling or rename the file (previously it could; proven live on
# hermes-smd-staging 2026-06-15). The R2 pull credential lives in THIS root
# process's env, which the hermes agent cannot read from /proc (different uid) — so
# the control-plane apply credential never reaches the data plane (ADR 0026 +
# OP-P2-1). The agent holds no config-write credential and no inbound verb that can
# trigger an apply.
#
# Forked AFTER the GOOGLE_* unset above so it never carries Google creds. Respawn
# loop self-heals; a dead applier never blocks the gateway (config changes simply
# stop applying until it restarts — fail-static, not fail-open: the running config
# and its enforced ceilings are untouched). v1 is instant-tier only (the
# live-writable fields are read fresh per action; no gateway reload). Launched
# only when the R2 config credentials are present.
if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_BUCKET_CONFIG:-}" ] \
   && /opt/hermes/.venv/bin/python -c "import config_applier" 2>/dev/null; then
  ( while true; do
      /opt/hermes/.venv/bin/python -m config_applier || true
      log "config applier exited; restarting in 5s"
      sleep 5
    done ) &
  log "Root config applier launched (uid 0; polls R2 for live customer.yaml changes)"
else
  log "Root config applier NOT launched (R2 config creds absent, or config_applier not in this overlay)"
fi

# MCP channel cross-process result/thread store (shared/mcp_result_store.py +
# shared/mcp_thread_store.py). The webhook gate (:8643) and the agent's result-sink
# plugin (inside the Hermes gateway) BOTH read/write here to hand a synchronous
# /mcp answer back to the caller; the default path is /run/smd-mcp. /run is a
# root-owned tmpfs, so the unprivileged hermes processes cannot mkdir it themselves
# (Permission denied → the answer never lands and the gate's 55s poll always times
# out; first surfaced on the Machine-hosted /mcp path, hermes-pilot-smokeball
# 2026-06-24). Create it hermes-owned now, while still root — both processes run as
# hermes (the exec-drop below), so a single hermes-owned 0700 dir serves both.
# tmpfs is correct: results are short-lived and scoped to one in-flight request.
MCP_STORE_DIR="/run/smd-mcp"
mkdir -p "${MCP_STORE_DIR}"
chown hermes:hermes "${MCP_STORE_DIR}"
chmod 0700 "${MCP_STORE_DIR}"

exec setpriv \
  --reuid=hermes \
  --regid=hermes \
  --init-groups \
  --no-new-privs \
  /app/bootstrap.sh
