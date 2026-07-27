#!/usr/bin/env bash
# boot-smoke-test.sh — verify the dependency chain inside a customer Machine
#
# Usage:
#   operator/bin/boot-smoke-test.sh <customer-slug>
#
# Scope: this is a SMOKE TEST, not an end-to-end test. It verifies that
# bootstrap.sh's sequenced startup (customer.yaml fetched from R2 → Hermes
# profiles materialized → overlay plugins installed → curator disabled) came
# up cleanly. The Postgres/Redis/Honcho checks were removed when the Honcho
# data plane was deferred to Phase 2 (ADR 0016 revised). It does NOT exercise
# a real agent turn, a real LLM call,
# or a real D1 write through a connector. Those require live external
# credentials (MCP servers, Anthropic API, customer's OAuth tokens) and are
# the job of the per-connector prod smoke test in run_prod_smoke_test.py and,
# at higher fidelity, the boot-time end-to-end test described in §6 of the
# build plan.
#
# Each check logs PASS/FAIL with the slug + step name. Exit code: 0 if every
# check passes, non-zero on the first failure (fail-fast).

set -euo pipefail

SLUG="${1:-}"
[ -n "${SLUG}" ] || { echo "Usage: $0 <customer-slug>" >&2; exit 1; }

APP_NAME="hermes-${SLUG}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [smoke/${SLUG}] $*"; }
pass() { log "PASS: $*"; }
fail() { log "FAIL: $*"; exit 1; }

# ssh_exec <step-name> <command>
# Run a command inside the Machine via `fly ssh console`. The command is
# passed as a single string; non-zero exit fails the test with the step name.
ssh_exec() {
  local step="$1"
  shift
  local cmd="$*"
  # `fly ssh console --command` execs the string directly (no shell), so compound
  # commands (&&, |, $(...), [ ]) fail unless wrapped in an explicit shell. Wrap
  # every check in `sh -c` so shell constructs evaluate ON THE MACHINE. (Check
  # commands contain no single quotes, so the single-quoted wrapper is safe.)
  if fly ssh console -a "${APP_NAME}" --command "sh -c '${cmd}'" >/dev/null 2>&1; then
    pass "${step}"
  else
    fail "${step} — command failed: ${cmd}"
  fi
}

# ---------- Step 1: wait for Machine state=started ----------
log "Waiting for Machine state=started (up to 60s)..."
ATTEMPT=0
while [ "${ATTEMPT}" -lt 60 ]; do
  STATE="$(fly status -a "${APP_NAME}" --json 2>/dev/null \
    | python3 -c "import sys, json
try:
    d = json.load(sys.stdin)
    machines = d.get('Machines') or []
    print(machines[0]['state'] if machines else 'none')
except Exception:
    print('error')" 2>/dev/null || echo "error")"
  if [ "${STATE}" = "started" ]; then
    pass "machine-state-started (after ${ATTEMPT}s)"
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done
[ "${STATE}" = "started" ] || fail "machine-state-started — state=${STATE} after 60s"

# ---------- Steps 2-4: Postgres / Redis / Honcho — DEFERRED (Phase 2) ----------
# The Honcho data plane is deferred to Phase 2 (ADR 0016 revised); Phase 1 boots
# on Hermes' flat-file memory core, so there is no Postgres/Redis/Honcho to
# probe here. These checks return when Phase 2 vendors the real Honcho source.

# ---------- Step 5: customer.yaml present, root-owned, agent-read-only (keystone) ----------
# The live customer.yaml is the source every trust-ceiling / vertical-floor / scope
# decision resolves against, read fresh per action. The 2026-06-15 keystone moved
# it OFF the agent-writable /opt/data volume into the root-owned /var/lib/smd-config
# so the hermes uid can READ it (the trust gate must) but can NEITHER rewrite it
# (it owned the file before — proven exploitable: one sed flipped external_send
# draft_for_review->autonomous) NOR rename it (it owned the parent dir). These are
# the negative-fire conformance proof of that close (SEC-07/08/09/18/30, EFF-14).
ssh_exec "customer-yaml-present" "test -s /var/lib/smd-config/customer.yaml"
ssh_exec "customer-yaml-root-owned" "[ \"\$(stat -c %U /var/lib/smd-config/customer.yaml)\" = root ]"
ssh_exec "customer-yaml-dir-root-owned" "[ \"\$(stat -c %U /var/lib/smd-config)\" = root ]"
ssh_exec "customer-yaml-agent-readable" "setpriv --reuid=hermes --regid=hermes --init-groups test -r /var/lib/smd-config/customer.yaml"
ssh_exec "customer-yaml-not-agent-writable" "setpriv --reuid=hermes --regid=hermes --init-groups sh -c \"! test -w /var/lib/smd-config/customer.yaml\""
ssh_exec "customer-yaml-dir-not-agent-writable" "setpriv --reuid=hermes --regid=hermes --init-groups sh -c \"! test -w /var/lib/smd-config\""
ssh_exec "customer-yaml-absent-from-agent-volume" "! test -e /opt/data/customer.yaml"

# ---------- Step 6: Hermes profiles directory exists ----------
# bootstrap.sh's `hermes-smd bootstrap` step materializes one profile per
# entry in customer.yaml.personas[]. v1 customers ship at length 1; we just
# verify the parent directory exists and is non-empty.
ssh_exec "hermes-profiles-dir" "test -d /opt/data/profiles && [ -n \"\$(ls -A /opt/data/profiles)\" ]"

# ---------- Step 6b: no unauthored profile homes ----------
# The on-volume profile set must EQUAL the authored persona set — not merely
# contain it. A persona slug rename once left the retired slug's home (and
# its frozen cron store) on the volume for 12 days until the scheduler
# monitoring paged on a store nothing serves (#2009). translate now deletes
# orphans (overlay#185); this check proves it held on THIS boot, so any
# future orphan class in profiles/ fails the smoke test instead of lurking.
# Dot-prefixed entries and plain files are exempt, matching the reconciler.
ssh_exec "no-unauthored-profile-homes" "/opt/hermes/.venv/bin/python3 -c \"
import sys, yaml
from pathlib import Path
authored = {p['slug'] for p in (yaml.safe_load(open('/var/lib/smd-config/customer.yaml')) or {}).get('personas', [])}
on_disk = {e.name for e in Path('/opt/data/profiles').iterdir() if e.is_dir() and not e.name.startswith('.')}
orphans = sorted(on_disk - authored)
missing = sorted(authored - on_disk)
if orphans or missing:
    print(f'profile-home drift: orphans={orphans} missing={missing}', file=sys.stderr)
    sys.exit(1)
\""

# ---------- Step 7: overlay plugins installed ----------
# `hermes plugins list` should include the four hermes-smd-* plugins
# installed at image-build time via `hermes plugins install venturecrane/hermes-smd-overlay`.
ssh_exec "hermes-plugins-installed" "/opt/hermes/.venv/bin/hermes plugins list | grep -q hermes-smd-"

# ---------- Step 8: Hermes curator disabled (ADR 0017) ----------
# The autonomous curator is turned off per-customer (it rewrites agent-authored
# skills out of band — see docs/adr/0017). bootstrap.sh step 7b enforces
# curator.enabled:false in every profile config; --check re-verifies it held.
ssh_exec "curator-disabled" "/opt/hermes/.venv/bin/python3 /app/ensure-curator-disabled.py --check /opt/data"

# ---------- Step 8b: customer-disabled bundled skills stayed off the menu (#1198) ----------
# customer.yaml personas[].skills_disabled is the per-customer authority over
# Hermes' bundled catalog (e.g. google-workspace + himalaya, which the DWD-broker
# model replaces — ADR 0045). bootstrap step 7b.1 prunes them from the profile
# skill tree + prompt snapshot, and a startup reconciler re-prunes after Hermes'
# gateway sync. This --check FAILS the boot if any disabled skill reappeared —
# the fail-closed guard against a Hermes-upgrade rehydration regression (a
# re-exposed google-workspace skill is a governance-bypass path back to the raw
# credential, exactly what ADR 0045 closes). No-op when no skills_disabled authored.
ssh_exec "disabled-skills-pruned" "/opt/hermes/.venv/bin/python3 /app/ensure-disabled-skills.py --check /var/lib/smd-config/customer.yaml /opt/data"

# ---------- Step 9: audit ledger is broker-owned and NOT agent-writable (OP-P1-4) ----------
# The immutable ledger must be owned by the broker uid (workspace-broker), the
# dir setgid 2750, and the agent uid (hermes) must be physically unable to write
# it. The probe (run as hermes) exits 0 only when both DELETE and INSERT are
# refused — the affirmative tamper-resistance proof.
ssh_exec "audit-db-owner-is-broker" "[ \"\$(stat -c %U /opt/data/audit/audit.db)\" = workspace-broker ]"
ssh_exec "audit-dir-setgid-2750" "[ \"\$(stat -c %a /opt/data/audit)\" = 2750 ]"
ssh_exec "audit-db-not-agent-writable" "setpriv --reuid=hermes --regid=hermes --init-groups /opt/hermes/.venv/bin/python3 /app/audit-write-fail-probe.py /opt/data/audit/audit.db"

# ---------- Step 10: mutable agent state stayed hermes-writable (regression for the split) ----------
# agent_skills_inventory moved off the ledger onto a hermes-owned file so locking
# the ledger does not break skill capture. The overlay's register() creates it.
ssh_exec "agent-state-owner-is-hermes" "[ \"\$(stat -c %U /opt/data/agent-state.db)\" = hermes ]"

# ---------- Step 11: the broker is supervised by a ROOT respawner (OP-P1-4 follow-up) ----------
# The broker must be respawnable on mid-run death, which requires a root parent
# (only root can re-setpriv to uid workspace-broker). With the supervisor, the
# broker's parent is the root subshell loop; without it the broker is a direct
# child of PID 1 (the hermes gateway after the exec-drop). So "broker's parent
# proc dir is root-owned" is a non-destructive proof the supervisor is in place.
# NB: read PPid from /proc/<pid>/status with grep+tr (NO single quotes) — ssh_exec
# wraps this whole string in `sh -c '...'`, so a single-quoted `awk '{print $4}'`
# would collide with the outer quote and mangle the command.
ssh_exec "broker-respawn-supervised" "pid=\$(pgrep -f workspace_broker.server | head -1); [ -n \"\$pid\" ] && ppid=\$(grep -m1 PPid /proc/\$pid/status | tr -dc 0-9) && [ \"\$(stat -c %U /proc/\$ppid)\" = root ]"

# ---------- Step 12: /app governance artifacts are root-owned, not agent-writable (SEC-31) ----------
# The activation-gate source the gateway:startup hook force-loads
# (/app/overlay-pack, incl. hooks/smd-overlay-activation/handler.py) must be owned
# by root so a code-executing agent cannot rewrite its own governance self-check.
# bootstrap only READS it (copies to the volume; the gateway loads from there), so
# root ownership is functionally inert. /app is image-backed and resets each boot,
# but the agent's write path is removed regardless — defense in depth.
ssh_exec "overlay-pack-root-owned" "[ \"\$(stat -c %U /app/overlay-pack)\" = root ]"
ssh_exec "overlay-pack-not-agent-writable" "setpriv --reuid=hermes --regid=hermes --init-groups sh -c \"! test -w /app/overlay-pack\""
ssh_exec "activation-handler-not-agent-writable" "setpriv --reuid=hermes --regid=hermes --init-groups sh -c \"! test -w /app/overlay-pack/hooks/smd-overlay-activation/handler.py\""

# ---------- Step 13: the account-wide R2 key is stripped from the LIVE agent (OP-P2-1) ----------
# bootstrap.sh unsets R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY before forking any
# same-uid child or exec'ing the gateway, so a code-executing agent cannot read
# the account-wide R2 key (from its own env or a sibling's /proc/<pid>/environ)
# and rewrite the R2 config object — the loopback that would walk around the
# keystone's filesystem lock (ADR 0044 Decision 8). test_deploy_ordering.py
# proves the SOURCE strips it in the right order; this proves it MATERIALIZED on
# the running Machine. Runs as root (reads agent-uid /proc/environ); the probe
# excludes root processes (PID 1 + the config applier legitimately keep the key)
# and never echoes the value.
ssh_exec "r2-account-key-stripped-from-agent" "/opt/hermes/.venv/bin/python3 /app/r2-account-key-strip-probe.py"

log "All boot smoke checks passed for ${APP_NAME}"
