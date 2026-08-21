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

ssh_exec_script() {
  # As ssh_exec, but for a check that CONTAINS SINGLE QUOTES.
  #
  # ssh_exec wraps its command in `sh -c '...'`, so a check carrying a single
  # quote closes the wrapper early and the remainder is mangled — silently, and
  # presenting as a failed check rather than a broken one. The note above has
  # kept every existing check quote-free, which works right up until a check
  # genuinely needs a quoted string (an inline python program, say), at which
  # point the constraint costs more than it saves.
  #
  # Base64 carries the program through both shell layers untouched: the encoded
  # text contains no quotes at all, so nothing can collide. Decoded and run ON
  # THE MACHINE, exactly as written here.
  local step="$1"
  shift
  local cmd="$*"
  local encoded
  encoded="$(printf '%s' "${cmd}" | base64 | tr -d '\n')"
  if fly ssh console -a "${APP_NAME}" \
    --command "sh -c 'echo ${encoded} | base64 -d | sh'" >/dev/null 2>&1; then
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
# QUOTING CONSTRAINT: ssh_exec wraps the command in sh -c '...' — the check
# must contain NO single quotes and NO newlines (the first cut of this step
# used both and never parsed on the Machine; the volume was clean, the check
# was broken). Python strings below are double-quoted only, one line.
ssh_exec "no-unauthored-profile-homes" "/opt/hermes/.venv/bin/python3 -c \"import sys, yaml, pathlib; a = {p[\\\"slug\\\"] for p in (yaml.safe_load(open(\\\"/var/lib/smd-config/customer.yaml\\\")) or {}).get(\\\"personas\\\", [])}; d = {e.name for e in pathlib.Path(\\\"/opt/data/profiles\\\").iterdir() if e.is_dir() and not e.name.startswith(\\\".\\\")}; drift = sorted(d - a) + sorted(a - d); sys.stderr.write(f\\\"profile-home drift: orphans={sorted(d - a)} missing={sorted(a - d)}\\n\\\") if drift else None; sys.exit(1 if drift else 0)\""

# ---------- Step 7: overlay plugins installed ----------
# `hermes plugins list` should include the four hermes-smd-* plugins
# installed at image-build time via `hermes plugins install venturecrane/hermes-smd-overlay`.
ssh_exec "hermes-plugins-installed" "/opt/hermes/.venv/bin/hermes plugins list | grep -q hermes-smd-"

# ---------- Step 7b: the running Hermes IS the pinned Hermes ----------
# Hermes v0.18.0 -> v0.20.4 promotion (ss-console#2444). Every check above passes
# identically on 0.18 and 0.20, so until now boot-smoke could not tell a promoted
# seat from one a peer quietly rebuilt at the old pin from origin/main. The
# image bakes the cloned upstream commit at /opt/hermes/HERMES_SHA (Dockerfile
# hermes_source stage); the authored pin is customer.yaml `hermes_ref`
# (<tag>@<40-hex sha>), read from THIS checkout's operator/customers/<slug>/ —
# the same file provision-customer.sh rendered the build from. A mismatch is the
# one failure that means "the wrong Hermes is running", so it is a FAIL, not a log.
REPO_ROOT_FOR_PIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CUSTOMER_YAML_FOR_PIN="${REPO_ROOT_FOR_PIN}/operator/customers/${SLUG}/customer.yaml"
if [ -f "${CUSTOMER_YAML_FOR_PIN}" ]; then
  # Same interpreter shape provision-customer.sh uses (uv + pyyaml; no yq, and
  # the host python3 has no yaml module).
  EXPECTED_HERMES_SHA="$(uv run --quiet --with pyyaml python3 -c 'import sys, yaml; ref = str((yaml.safe_load(open(sys.argv[1])) or {}).get("hermes_ref", "")); print(ref.split("@", 1)[1] if "@" in ref else "")' "${CUSTOMER_YAML_FOR_PIN}")"
  if printf '%s' "${EXPECTED_HERMES_SHA}" | grep -qE '^[0-9a-f]{40}$'; then
    ssh_exec "hermes-sha-matches-pin" "[ \"\$(tr -d \"[:space:]\" < /opt/hermes/HERMES_SHA)\" = ${EXPECTED_HERMES_SHA} ]"
  else
    fail "hermes-sha-matches-pin — could not read a 40-hex sha from hermes_ref in ${CUSTOMER_YAML_FOR_PIN}"
  fi
else
  fail "hermes-sha-matches-pin — no customer.yaml at ${CUSTOMER_YAML_FOR_PIN} (run from the checkout that provisioned ${SLUG})"
fi

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

# ---------- Step 8c: the matter-mixing READ fence discriminates (ss#2167) ----------
# The fence refuses a session holding one matter's substance from reading a
# second matter's. It is what stops a draft containing two clients' facts from
# ever being COMPOSED — every other matter control fires when a send is
# attempted, by which point that draft exists and is in a paralegal's queue, and
# the firm finding it there is the event the engagement does not survive whether
# or not it was sent.
#
# The probe asserts BOTH directions on purpose: a second matter is refused, AND
# the same matter is still readable. Asserting only the refusal would pass
# against a fence that refused every content read — not a safe fence, a bricked
# Operator the firm switches off. It also fails the boot if the overlay pin
# predates ss#2167, which is the cross-repo drift this catches.
ssh_exec "matter-mixing-fence" "/opt/hermes/.venv/bin/python3 /app/matter-mixing-fence-probe.py"

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

# The check above proves the broker can be RESTARTED. It never opens the socket,
# so it cannot tell a working broker from one whose socket is gone, whose parent
# directory lost its setgid bit, or which is refusing every connection. A seat in
# that state has no document surface at all and reports healthy on every signal
# we watch — the same shape as the 2026-07-16 scheduler outage, which ran eight
# days green because the check confirmed a process EXISTED rather than that it
# WORKED.
#
# `health` is the right call to make: it sits ABOVE the broker's gateway-PID gate
# (workspace_broker/server.py:282 vs :291), so any process may issue it, and it
# reports whether the credential, customer, jobs and audit stores actually
# loaded. Run as the AGENT uid, because "hermes can reach this socket" is the
# property that matters — root reaching it proves nothing about the caller that
# needs it.
#
# SCOPE IT HONESTLY: this proves the socket answers and the stores loaded. It
# CANNOT prove the gateway can authorize a privileged verb, because only the
# gateway process may make that call and this is not it. Claiming otherwise
# would rebuild the blind spot one layer up.
# The socket path is taken from the canonical default rather than the env, and
# that is not laziness: a fresh `fly ssh console` session inherits NONE of the
# app's environment (verified — SMD_WORKSPACE_BROKER_SOCKET is unset there),
# while the entrypoint sets both the env var and this path from the same
# constant. Reading the env here would make the check fail on every seat for a
# reason that has nothing to do with the broker, which is worse than a path that
# can drift. Same idiom as every other absolute path in this file. If the
# entrypoint's SOCKET_PATH ever moves, this line moves with it.
ssh_exec_script "broker-socket-answers-health" "setpriv --reuid=hermes --regid=hermes --init-groups /opt/hermes/.venv/bin/python3 -c \"import socket,os,json,sys; p=os.environ.get('SMD_WORKSPACE_BROKER_SOCKET') or '/run/smd-workspace-broker/broker.sock'; s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.settimeout(5); s.connect(p); s.sendall(b'{\\\"action\\\":\\\"health\\\"}'+bytes([10])); r=json.loads(s.recv(65536).decode()); sys.exit(0 if r.get('ok') and r.get('credential_ready') and r.get('customer_ready') else 1)\""

# ---------- Step 11c: the GATEWAY is supervised, and its loop is beating (P0 ss#2488) ----------
# On 2026-08-20 the paying client's seat wedged for 33 minutes: Hermes' own
# loop-liveness watchdog logged that it was exiting so a supervisor could restart
# it, then did not exit, and nothing at any layer noticed. entrypoint.sh EXECS the
# gateway as the container's main process, the respawner above covers the BROKER,
# and Fly does not restart a Machine on a failing health check.
#
# Deliberately NOT a pid check. The broker note above already says why: a check
# that "confirmed a process EXISTED rather than that it WORKED" is how the
# 2026-07-16 scheduler outage ran eight days green. The supervisor touches
# ${RUN_DIR}/tick at the top of EVERY iteration, so tick freshness fails if the
# loop stops turning for any reason — including the one that would otherwise be
# invisible, an inherited `set -e` killing the subshell on its first failed probe.
ssh_exec "gateway-liveness-supervisor-ticking" "t=/run/smd-gateway-liveness/tick; [ -f \$t ] && [ \$(( \$(date -u +%s) - \$(stat -c %Y \$t) )) -lt 90 ]"

# The supervisor is only as good as the signal it reads, and that signal is
# UPSTREAM's: an asyncio task on the gateway loop rewrites this file every 30s.
# This check is the tripwire for the whole mechanism rotting silently. The path
# is not where the Hermes source implies — _process_hermes_home() reads
# HERMES_HOME (/opt/data), but the file lands under the PROFILE home, which is
# why the supervisor derives it from the gateway's argv. If a future pin drops
# the heartbeat, moves it again, or disables it via `gateway.loop_watchdog`, the
# supervisor would go quietly inert; this fails the provision instead.
#
# Bounded wait rather than a single shot: boot smoke is fail-fast and on a 1 vCPU
# box the first beat can land well after this step runs. Same idea as the
# --wait-gateway-s flag the R2 strip probe below uses.
ssh_exec "gateway-loop-heartbeat-fresh" "n=0; while [ \$n -lt 36 ]; do for f in /opt/data/profiles/*/state/gateway.heartbeat; do [ -f \$f ] || continue; [ \$(( \$(date -u +%s) - \$(stat -c %Y \$f) )) -lt 120 ] && exit 0; done; n=\$((n+1)); sleep 5; done; exit 1"

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
# --wait-gateway-s: on a cold boot this step lands ~75s after boot, before the
# gateway has spawned, and the probe's vacuous-zero fail-closed rule (exit 3)
# FATALed a healthy deploy (ss#2420, seen on both 2026-08-18 reprovisions). The
# wait retries ONLY the no-agent-process verdict; a real offender still fails
# the instant a scan sees it. Later strip probes need no wait — once this one
# passes, the gateway is up.
ssh_exec "r2-account-key-stripped-from-agent" "/opt/hermes/.venv/bin/python3 /app/r2-account-key-strip-probe.py --wait-gateway-s 120"

# ss#2258, the same proof for the AgentMail SEND credential. This is the one
# check that would have caught the incident class before a client ever saw it:
# four fabricated messages reached a real principal from a seat whose agent
# process held an org-wide, all-permission send key, and no static test can tell
# you what is in a running process's environ. The probe takes the var names as
# arguments, so this reuses it verbatim — no second implementation to drift.
#
# What makes this able to FAIL: if entrypoint.sh's `unset AGENTMAIL_SEND_API_KEY`
# is removed, reordered after the exec-drop, or never runs because the strip
# block moved, the gateway inherits the send key and this exits non-zero naming
# the pid. The value is never printed.
ssh_exec "agentmail-send-key-stripped-from-agent" \
  "/opt/hermes/.venv/bin/python3 /app/r2-account-key-strip-probe.py hermes AGENTMAIL_SEND_API_KEY"

# The same proof for the Graph SEND app credential (ss#2258 msgraph wave).
#
# READ WHAT THIS CHECK DOES AND DOES NOT COVER. It proves the BROKER'S copy never
# reaches the agent. It does NOT itself prove the agent cannot send —
# MSGRAPH_CLIENT_SECRET deliberately stays in the gateway (the delta poller and
# the msgraph-mail MCP server need it), and this probe never asks Microsoft what
# that credential is allowed to do.
#
# What makes the agent unable to send is upstream, at provisioning: since
# 2026-08-13 provision-customer.sh REFUSES a seat whose MSGRAPH_SEND_* is not a
# distinct app registration from the gateway's MSGRAPH_* (tests/msgraph-two-app
# -fence.test.ts drives the refusal arms). So on any seat that booted, the
# gateway's credential belongs to a read-only registration that Microsoft refuses
# at /sendMail with 403 ErrorAccessDenied — proven on the sandbox seat 2026-08-13,
# vfy_01KZXX523V6JNWEETG4PSZDQY3. This probe guards the other half: the one
# credential in the tenant that DOES hold Mail.Send is a credential the agent
# genuinely never has.
#
# What makes it able to FAIL: remove or reorder the `unset MSGRAPH_SEND_*` in
# entrypoint.sh on a seat where those are staged, and the gateway inherits them —
# non-zero, naming the pid, never the value. On a seat with no msgraph connector
# nothing is staged and this passes vacuously, which is the honest outcome for a
# credential that does not exist.
ssh_exec "msgraph-send-credential-stripped-from-agent" \
  "/opt/hermes/.venv/bin/python3 /app/r2-account-key-strip-probe.py hermes MSGRAPH_SEND_CLIENT_SECRET MSGRAPH_SEND_CLIENT_ID MSGRAPH_SEND_TENANT_ID"

log "All boot smoke checks passed for ${APP_NAME}"
