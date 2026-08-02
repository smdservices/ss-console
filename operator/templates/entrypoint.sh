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
# Validate a CANDIDATE customer.yaml before it becomes the live one, using the
# SAME on-box validator the ADR 0044 live applier uses. Until ss #2082 the boot
# fetch did a bare `cp` then `mv -f` with no check at all, and only the poller
# validated. That asymmetry was survivable while the R2 object was written by
# hand at provision time; auto-publish arms it. An object the poller REJECTS
# stays in R2, and the next restart (a Fly migration, an OOM, an unrelated
# redeploy) adopted it unvalidated, hours or days after the merge that put it
# there and with nothing tying the crash to that merge.
#
# Structural validation ONLY. The applier's safety layer (config_applier.safety)
# is deliberately NOT run here: it enforces live-apply transition rules, and the
# rebuild-class fields it refuses on the live path (persona tone, vertical,
# model) are precisely the ones a RESTART exists to deliver. Running it here
# would refuse the changes this path is for.
#
# Exit 2 means the validator itself is unimportable. That is treated exactly
# like an invalid config: a substrate we cannot check is not a substrate we
# adopt from (the standing fail-closed posture, same as the invariant_7 gate
# further down, which refuses boot on a missing module rather than skipping).
validate_candidate_config() {
  /opt/hermes/.venv/bin/python3 - "$1" <<'PY'
import sys
from pathlib import Path

try:
    from bootstrap.validate import validate_customer_yaml
except Exception as exc:  # noqa: BLE001 - any import failure is a refusal
    print(f"candidate config validator unimportable: {exc}", file=sys.stderr)
    raise SystemExit(2)

errors = validate_customer_yaml(Path(sys.argv[1]))
for err in errors:
    print(f"  {err}", file=sys.stderr)
raise SystemExit(1 if errors else 0)
PY
}

_seed_endpoint="${R2_ENDPOINT_URL:-https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com}"
if AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?}" \
     AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?}" \
       aws s3 cp \
         --endpoint-url "${_seed_endpoint}" \
         --only-show-errors \
         "s3://${R2_BUCKET_CONFIG}/vaults/${CUSTOMER_SLUG}/customer.yaml" \
         "${LIVE_CUSTOMER_YAML}.r2.tmp"; then
  _r2_fetched=1
else
  _r2_fetched=0
fi

_r2_usable=0
if [ "${_r2_fetched}" -eq 1 ]; then
  if validate_candidate_config "${LIVE_CUSTOMER_YAML}.r2.tmp"; then
    _r2_usable=1
  elif [ $? -eq 2 ]; then
    log "WARN: cannot validate the R2 customer.yaml (validator unimportable); refusing to adopt it"
  else
    log "WARN: R2 customer.yaml REFUSED by the on-box validator (errors above); refusing to adopt it"
  fi
fi

if [ "${_r2_usable}" -eq 1 ]; then
  mv -f "${LIVE_CUSTOMER_YAML}.r2.tmp" "${LIVE_CUSTOMER_YAML}"
  log "customer.yaml refreshed from R2 (source of truth) into ${CONFIG_DIR}"
elif [ -f "${LIVE_CUSTOMER_YAML}" ]; then
  # Fail-static: the Machine comes up on the config it was already serving. A
  # bad publish costs the seat its update, never its uptime.
  rm -f "${LIVE_CUSTOMER_YAML}.r2.tmp" 2>/dev/null || true
  if [ "${_r2_fetched}" -eq 1 ]; then
    log "WARN: keeping the existing root-owned customer.yaml (the R2 object was not adopted)"
  else
    log "WARN: R2 fetch failed; using existing root-owned customer.yaml"
  fi
else
  rm -f "${LIVE_CUSTOMER_YAML}.r2.tmp" 2>/dev/null || true
  if [ "${_r2_fetched}" -eq 1 ]; then
    log "FATAL: no local customer.yaml and the R2 object was refused (${R2_BUCKET_CONFIG}/vaults/${CUSTOMER_SLUG}); nothing valid to boot on"
  else
    log "FATAL: customer.yaml not present and R2 fetch failed (${R2_BUCKET_CONFIG}/vaults/${CUSTOMER_SLUG})"
  fi
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

# Establishment spool (ADR 0085, ss#2161/#2162). The tree an admin-instructed
# voice/shape submission crosses on its way from the agent to the root
# establish_intake daemon: the broker uid writes staging/ and runs/, root
# writes results/. hermes gets NO access at any level — the client corpus and
# the submitted spec transit this tree, and the agent uid must not be able to
# rewrite a submission after broker validation (the intake stat-verifies the
# writer uid on the other side).
#
# EVERY directory is explicitly owned and moded, converged on every boot —
# never mkdir -p defaults. A default-moded ancestor silently widens the whole
# tree (the spec_applier _harden_ancestors incident); the tree's guarantee is
# only as strong as its loosest dir. The root dir denies hermes (0750, group
# workspace-broker); the children add group-write because the broker creates
# staging sets and run dirs there and unlinks a result after its one-shot
# read. Root writes results/ files 0640 root:workspace-broker.
ESTABLISH_SPOOL_DIR="/opt/data/establish-spool"
export SMD_ESTABLISH_SPOOL_DIR="${ESTABLISH_SPOOL_DIR}"
# The intake's poll cadence (root child inherits this env; default matches the
# intake's own built-in default, stated here so it is tunable per seat).
export SMD_ESTABLISH_POLL_SECONDS="${SMD_ESTABLISH_POLL_SECONDS:-5}"
install -d -o root -g workspace-broker -m 0750 "${ESTABLISH_SPOOL_DIR}"
install -d -o root -g workspace-broker -m 0770 "${ESTABLISH_SPOOL_DIR}/staging"
install -d -o root -g workspace-broker -m 0770 "${ESTABLISH_SPOOL_DIR}/runs"
install -d -o root -g workspace-broker -m 0770 "${ESTABLISH_SPOOL_DIR}/results"

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
    SMD_ESTABLISH_SPOOL_DIR="${SMD_ESTABLISH_SPOOL_DIR}" \
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

# Authored-spec tree (ss ADR 0083, #2084). The customer's per-output-class voice
# and format specifications, installed ROOT-OWNED under the same root-owned
# ${CONFIG_DIR} as customer.yaml, for the same reason and by the same argument.
#
# WHY ROOT, restated because it is the item this change exists for: `read_file`
# is a READ-class tool — unfenced, and it does not taint the session. A spec the
# agent could WRITE would therefore be a persistent, untainted, self-authored
# prompt-injection channel that survives restarts: strictly worse than a tainted
# inbound email, which at least fences the turn. That is the same self-loopback
# this file's keystone comment above records being proven live on
# hermes-smd-staging 2026-06-15, where one `sed` against an agent-writable config
# flipped external_send from draft_for_review to autonomous. The fix then was
# root ownership rather than policy, and it is root ownership here.
#
# 0755 dir / 0644 files: the agent MUST read these (an unread spec fails its
# send gate) and must never write them. The boot invariant below refuses to
# serve if that asymmetry does not hold on disk.
SPEC_DIR="${CONFIG_DIR}/specs"
export SMD_SPEC_DIR="${SPEC_DIR}"
mkdir -p "${SPEC_DIR}"
chown root:root "${SPEC_DIR}"
chmod 0755 "${SPEC_DIR}"

# Boot fetch, synchronous and BEFORE the privilege drop. The poller further down
# would install the same tree seconds later, which is too late: bootstrap.sh runs
# translate.py right after the drop, and translate renders each profile's
# SKILL.md spec POINTER from the installed manifest. Fetch-then-stamp, or the
# first boot stamps nothing and the agent cannot find the spec it is gated on.
#
# Never fatal. A missing vault object is the ordinary state of a seat whose
# customer has authored nothing; a refused document leaves the previously
# installed tree standing (fail-static). An un-adoptable spec must not cost the
# seat its uptime — the runtime gate, not the boot, decides whether an output
# whose declared spec never arrived may be produced.
if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_BUCKET_CONFIG:-}" ] \
   && /opt/hermes/.venv/bin/python -c "import spec_applier" 2>/dev/null; then
  if /opt/hermes/.venv/bin/python -m spec_applier --once; then
    log "authored-spec boot fetch complete (${SPEC_DIR})"
  else
    log "WARN: authored-spec boot fetch exited non-zero; keeping the installed spec tree"
  fi
else
  log "Authored-spec boot fetch NOT run (R2 config creds absent, or spec_applier not in this overlay)"
fi

# Re-assert ownership after the fetch. The applier hardens each file it writes,
# but asserting here too means a tree left behind by an OLDER overlay build — one
# whose applier predates the hardening — is corrected on this boot rather than
# tripping the invariant below and refusing an otherwise healthy Machine.
chown -R root:root "${SPEC_DIR}"
find "${SPEC_DIR}" -type d -exec chmod 0755 {} +
find "${SPEC_DIR}" -type f -exec chmod 0644 {} +

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

# Root-side authored-spec applier (ss ADR 0083 #2084). Same shape, same
# principal, same respawn discipline as the config applier above, and forked at
# the same point for the same reason: it must survive the exec-drop below and
# keep uid 0, because root is the only principal that may write ${SPEC_DIR}.
# It polls the portal-written vault object and installs a verified, root-owned
# spec tree, so a customer's correction reaches the running Machine without a
# reboot — the runtime read of a spec is a plain file read, so a replaced body
# takes effect on the next read with nothing baked into a running process.
#
# Two writers, two key spaces, never the same object: the git->R2 publisher owns
# vaults/<slug>/customer.yaml, the portal owns vaults/<slug>/output-classes.json.
# A dead applier never blocks the gateway — fail-static, not fail-open: spec
# updates simply stop arriving and the installed tree keeps serving.
if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_BUCKET_CONFIG:-}" ] \
   && /opt/hermes/.venv/bin/python -c "import spec_applier" 2>/dev/null; then
  ( while true; do
      /opt/hermes/.venv/bin/python -m spec_applier || true
      log "spec applier exited; restarting in 5s"
      sleep 5
    done ) &
  log "Root authored-spec applier launched (uid 0; polls R2 for live spec changes)"
else
  log "Root authored-spec applier NOT launched (R2 config creds absent, or spec_applier not in this overlay)"
fi

# Root-side establishment intake (ADR 0085, ss#2161/#2162). Same shape, same
# principal, same respawn discipline as the appliers above, forked at the same
# point for the same reason: it must survive the exec-drop below and keep
# uid 0, because it holds the R2 write credential and runs the distillation
# compiler gates over broker-authored submissions in ${ESTABLISH_SPOOL_DIR}/runs,
# installing a gated result into the vault object the spec applier polls.
#
# Gated on `import establish_intake` so a lagging overlay pin degrades to a
# LOUD "not launched" line, never a broken boot — establish_submit runs then
# queue unprocessed until the overlay catches up (fail-static: the installed
# spec tree keeps serving). The intake emits its own boot line on launch; the
# rehearsal pre-flight asserts one of these two lines, so a silent
# not-launched cannot read as healthy.
if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_BUCKET_CONFIG:-}" ] \
   && /opt/hermes/.venv/bin/python -c "import establish_intake" 2>/dev/null; then
  ( while true; do
      /opt/hermes/.venv/bin/python -m establish_intake || true
      log "establishment intake exited; restarting in 5s"
      sleep 5
    done ) &
  log "Root establishment intake launched (uid 0; polls ${ESTABLISH_SPOOL_DIR}/runs for admin-instructed voice/shape submissions)"
else
  log "Root establishment intake NOT launched (R2 config creds absent, or establish_intake not in this overlay); establish_submit runs will queue unprocessed"
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

# Connector-health ledger dir (ADR 0080, shared/connector_ledger.py): the
# agent-side plugin and the Graph channel chokepoint write per-server call
# outcomes here; the gate's heartbeat connector_check reads them. Same trap as
# smd-mcp above — /run is root-owned, hermes cannot mkdir it (first surfaced
# live on hermes-smd-staging 2026-07-25: every record silently failed and a
# real Graph 401 outage read as legit-empty green). This dir is a BOOT
# CONTRACT: connector_check treats a missing dir as check-broken and PAGES.
CONNECTOR_HEALTH_DIR="/run/smd-connector-health"
mkdir -p "${CONNECTOR_HEALTH_DIR}"
chown hermes:hermes "${CONNECTOR_HEALTH_DIR}"
chmod 0700 "${CONNECTOR_HEALTH_DIR}"

# ============================================================================
# ADR 0009 / SEC-22 — cross-machine isolation boot check (fail-closed)
# ============================================================================
# The last root gate before the privilege-drop to the hermes gateway. Verify
# that every Phase-1 storage binding — the per-customer R2 skill-bodies bucket,
# the shared config bucket, and the on-volume SQLite paths (SMD_D1_AUDIT_BINDING
# / SMD_D1_AGENT_STATE_BINDING) — resolves to THIS Machine's own customer
# namespace, derived from CUSTOMER_SLUG. A binding that names another customer's
# slug, escapes the volume root (ADR 0007), or is unbound is the cross-Machine
# isolation failure mode ADR 0009 exists to catch: refuse to serve.
#
# verify_at_boot() (the invariant_7 __main__ shim) reads the real env; on a
# violation it prints the offending binding to stderr AND emits an
# INVARIANT_BOOT_CHECK_FAILED row through the broker's append-only audit_append
# (SMD_AUDIT_BROKER_SOCKET is live at this point — the broker started above, and
# this root process is still the admitted SMD_GATEWAY_PID peer). The exit code
# is the load-bearing refusal; audit-emit is best-effort and never weakens it.
# On a clean boot verify_at_boot returns 0 without touching the broker socket.
#
# Runs BEFORE any skill loads, connector authenticates, or memory read — all of
# that is post-exec, in bootstrap/gateway. FAIL-CLOSED on a degraded substrate:
# a missing OR unimportable invariant module is itself a refusal (exit 3), never
# a silent skip — no stub/NoOp path reports a false pass (the standing
# fail-closed posture, e.g. bootstrap.sh's harness-less-gateway gates).
INVARIANT7_BOOT_CHECK="/app/safety-substrate/invariants/invariant_7.py"
if [ ! -f "${INVARIANT7_BOOT_CHECK}" ]; then
  log "FATAL: cross-machine isolation boot check module missing (${INVARIANT7_BOOT_CHECK}); refusing to boot (ADR 0009 / SEC-22)"
  exit 3
fi
if /opt/hermes/.venv/bin/python3 "${INVARIANT7_BOOT_CHECK}"; then
  log "Cross-machine isolation boot check PASSED (ADR 0009 / SEC-22)"
else
  log "FATAL: INVARIANT_BOOT_CHECK_FAILED — cross-machine isolation boot check refused boot (ADR 0009 / SEC-22); see stderr for the offending binding or a module import error (both fail closed)"
  exit 3
fi

# ============================================================================
# ss ADR 0083 / #2084 — authored-spec tree ownership boot check (fail-closed)
# ============================================================================
# The second root gate before the privilege drop. Verify that ${SMD_SPEC_DIR}
# and everything under it is NOT writable by the hermes uid, and that nothing in
# it symlinks out of the tree.
#
# WHY IT REFUSES BOOT rather than warning. An authored spec enters the drafting
# context by being READ, and `read_file` is READ-class: unfenced, always allowed,
# and it does not taint the session. A spec the agent can WRITE is therefore a
# persistent, untainted, self-authored instruction channel surviving restarts —
# worse than a tainted inbound email, which at least fences its turn. This is the
# same self-loopback shape the keystone comment at the top of this file records
# from hermes-smd-staging 2026-06-15, and it got the same answer: root ownership,
# structurally enforced, not a policy anyone has to remember.
#
# An ABSENT spec dir PASSES — no spec installed means nothing to author and
# nothing any consumer reads. Same fail-closed posture as the invariant_7 gate
# above: a missing or unimportable module is itself a refusal (exit 3), never a
# silent skip.
SPEC_OWNERSHIP_CHECK="/app/safety-substrate/invariants/spec_dir_ownership.py"
if [ ! -f "${SPEC_OWNERSHIP_CHECK}" ]; then
  log "FATAL: authored-spec ownership boot check module missing (${SPEC_OWNERSHIP_CHECK}); refusing to boot (ss ADR 0083)"
  exit 3
fi
if /opt/hermes/.venv/bin/python3 "${SPEC_OWNERSHIP_CHECK}"; then
  log "Authored-spec tree ownership check PASSED (ss ADR 0083)"
else
  log "FATAL: SPEC_DIR_OWNERSHIP_CHECK_FAILED — the authored-spec tree is writable by the agent uid, or reaches outside itself; refusing to boot (ss ADR 0083); see stderr for the offending paths"
  exit 3
fi

exec setpriv \
  --reuid=hermes \
  --regid=hermes \
  --init-groups \
  --no-new-privs \
  /app/bootstrap.sh
