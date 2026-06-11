#!/usr/bin/env bash
# bootstrap.sh — container entrypoint for the Operator customer Machine
#
# Per §6 of the locked build plan and ADRs 0007/0010/0016/0019, this script
# runs a sequenced startup under tini (PID 1, zombie reaper). Steps 3-6 (the
# Honcho data plane) are DEFERRED to Phase 2 per the revised ADR 0016 — see
# that block below — so the Phase-1 sequence is:
#
#   1.  Validate required env vars.
#   2.  Verify (or fetch from R2) /opt/data/customer.yaml.
#   3-6. Honcho data plane — deferred to Phase 2 (no Postgres/Redis/Honcho).
#   7.  Run `hermes-smd bootstrap` (customer.yaml -> per-profile config + SOUL.md).
#   7b. Disable the Hermes curator in each profile config (ADR 0017).
#   8.  Run the safety-substrate invariant checks (Phase A.5 gate).
#   9.  Pause guard.
#   10. customer-sync sidecar (R2 poller) — NOT launched in Phase 1 (the overlay
#       reload path is unimplemented; see that step).
#   11. exec the Hermes gateway for the active persona profile (`-p <slug>`;
#       becomes the foreground child of tini).
#
# Memory (ADR 0016, revised 2026-05-30): Phase 1 runs on Hermes' always-on
# flat-file core (MEMORY.md/USER.md). Honcho (inferred memory) is a swappable
# provider deferred to Phase 2; the customer-owned memory file lives in D1/R2.
#
# Storage model:
#   - customer.yaml is volume-mounted, NOT baked into the image.
#   - Provisioning writes it to R2 at vaults/<slug>/customer.yaml.
#   - First boot: fetch from R2 -> /opt/data/customer.yaml.
#   - Subsequent boots: use the volume copy.
#
# Process supervision:
#   - tini (PID 1) reaps zombies and forwards signals.
#   - The gateway runs as the foreground (exec) child.
#
# Fails fast on any of:
#   - missing required env vars
#   - customer.yaml missing AND not fetchable from R2
#   - `hermes-smd bootstrap` error (bad customer.yaml structure)
#   - safety-substrate invariant test failures

set -euo pipefail

# Activate the Hermes venv for the whole entrypoint. The overlay CLI
# (hermes-smd) and the hermes gateway are installed ONLY in /opt/hermes/.venv;
# bootstrap.sh invokes `hermes-smd` and `hermes` as bare commands. Without the
# venv on PATH, a bare `hermes`/`hermes-smd` would not resolve and the Machine
# would crash at step 7 / step 11.
export PATH="/opt/hermes/.venv/bin:${PATH}"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [bootstrap] $*"
}

die() {
  log "FATAL: $*"
  exit 1
}

# Replace a volume dir with a fresh copy of ${src}, TOLERANT of stray root-owned
# files inside the old ${dest}. We `mv` the old dir aside instead of `rm -rf`-ing
# it: a rename only needs write+exec on the (hermes-owned) PARENT dir, not on the
# dir's contents — so a root-owned file left inside (e.g. a __pycache__/*.pyc
# written by a root `ssh console` that imported the overlay) cannot make this fail
# under `set -e` and crash-loop the boot (the ss-console#1285 self-inflicted
# outage: bootstrap runs as hermes and `rm -rf` choked on root-owned .pyc). The
# moved-aside copy is best-effort cleaned; if its root-owned files survive the rm
# that is harmless — it is out of the plugin/hook search path.
replace_dir_tolerant() {
  _rdt_src="$1"; _rdt_dest="$2"
  if [ -e "${_rdt_dest}" ]; then
    mv "${_rdt_dest}" "${_rdt_dest}.stale.$$" \
      || die "could not move aside stale dir ${_rdt_dest} (is its parent hermes-writable?)"
    rm -rf "${_rdt_dest}.stale.$$" 2>/dev/null || true
  fi
  cp -r "${_rdt_src}" "${_rdt_dest}"
}

# NOTE: the wait_for() bounded-retry helper and supervise() restart wrapper
# were removed with the Honcho data plane (steps 3-6); Postgres/Redis/Honcho
# were their only callers. Phase 2 reintroduces supervision when it vendors the
# real Honcho api + deriver processes.

CUSTOMER_SLUG="${CUSTOMER_SLUG:-}"
[ -n "${CUSTOMER_SLUG}" ] || die "CUSTOMER_SLUG env var is unset"

log "Starting bootstrap for customer: ${CUSTOMER_SLUG}"
log "Hermes SHA: $(cat /opt/hermes/HERMES_SHA 2>/dev/null || echo unknown)"

# ============================================================================
# Step 1: validate required env vars
# ============================================================================
# Secrets are set via `fly secrets set` from provision-customer.sh. Never echo
# values; only check presence.
REQUIRED_ENV=(
  ANTHROPIC_API_KEY
  # R2 access for customer.yaml fetch (vaults/<slug>/customer.yaml).
  R2_BUCKET_CONFIG
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  # D1 binding for the audit log (ADR 0017). The observations-mirror binding
  # (SMD_D1_OBSERVATIONS_BINDING) and HONCHO_API_KEY are optional in Phase 1 —
  # they only matter once Honcho is wired (Phase 2; ADR 0016 revised).
  SMD_D1_AUDIT_BINDING
  # ADR 0022 Stream 2 — per-customer skill bodies bucket NAME (from fly.toml
  # [env]; always present). The bucket-scoped access key + secret are now
  # OPTIONAL (see OPTIONAL_ENV) — agent-authored skill persistence is fail-soft
  # and OFF by default (OP-P0-2). Requiring the credentials here would brick the
  # boot once the account-wide fallback is removed and no scoped token is authored.
  R2_SKILL_BODIES_BUCKET
)

for var in "${REQUIRED_ENV[@]}"; do
  if [ -z "${!var:-}" ]; then
    die "Required env var ${var} is unset (set via fly secrets)"
  fi
  log "env check OK: ${var} present"
done

# Per-customer optional env. DWD customers set GOOGLE_SERVICE_ACCOUNT_JSON;
# legacy user-OAuth customers set GOOGLE_TOKEN_JSON. Specific connector skills
# check for the credential they need.
OPTIONAL_ENV=(
  GOOGLE_TOKEN_JSON
  GOOGLE_SERVICE_ACCOUNT_JSON
  GOOGLE_CLIENT_SECRET_JSON
  # Honcho (inferred memory) is deferred to Phase 2 (ADR 0016 revised). These
  # are unused at boot in Phase 1; kept optional for forward-compat so the
  # Phase-2 vendor can stage them without a bootstrap change.
  SMD_D1_OBSERVATIONS_BINDING
  HONCHO_API_KEY
  # R2 endpoint URL override (defaults to the Cloudflare R2 S3 endpoint).
  R2_ENDPOINT_URL
  # Optional for customers that still bind AgentMail as an MCP connector.
  AGENTMAIL_API_KEY
  # Bucket-scoped R2 token for agent-authored SKILL.md persistence (ADR 0022
  # Stream 2). OPTIONAL + fail-soft: present only when an engagement deliberately
  # enables skill persistence with a bucket-scoped token. Absent (the default,
  # incl. customer-zero) => skill_capture.load_r2_config_from_env() returns None
  # and the write path no-ops. NEVER the account-wide pair (OP-P0-2).
  R2_SKILL_BODIES_ACCESS_KEY_ID
  R2_SKILL_BODIES_SECRET_ACCESS_KEY
)

for var in "${OPTIONAL_ENV[@]}"; do
  if [ -n "${!var:-}" ]; then
    log "env check OK: ${var} present (optional)"
  else
    log "env check: ${var} not set (default will apply)"
  fi
done

# ============================================================================
# Step 2: verify (or fetch) customer.yaml on the volume
# ============================================================================
# Storage model (§6): customer.yaml lives on the volume, not baked into the
# image. R2 at vaults/<slug>/customer.yaml is the SOURCE OF TRUTH; provisioning
# (and operator/bin/sync-customer-yaml.sh, for edits) writes it there.
# Bootstrap re-fetches from R2 on EVERY boot so merged config edits propagate on
# restart, falling back to the volume copy only if R2 is unreachable. (The live
# no-restart reload path — the customer-sync sidecar — is a Phase-2 stub.)
CUSTOMER_YAML="/opt/data/customer.yaml"
R2_ENDPOINT_URL="${R2_ENDPOINT_URL:-https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com}"
R2_CUSTOMER_YAML_URI="s3://${R2_BUCKET_CONFIG}/vaults/${CUSTOMER_SLUG}/customer.yaml"

# Re-fetch from R2 (source of truth) on EVERY boot so merged customer.yaml edits
# propagate on restart. Previously bootstrap only fetched when the volume copy was
# ABSENT, so edits to an already-provisioned machine never reached it (the
# customer-sync sidecar is a Phase-2 stub). Fetch to a temp path and atomically
# swap, so a transient R2 failure never corrupts or strands the existing copy;
# fall back to the volume copy if R2 is unreachable; die only if neither yields a
# config. awscli is installed in the Dockerfile; R2 speaks S3 with a custom endpoint.
if AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
   AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
     aws s3 cp \
       --endpoint-url "${R2_ENDPOINT_URL}" \
       --only-show-errors \
       "${R2_CUSTOMER_YAML_URI}" \
       "${CUSTOMER_YAML}.r2.tmp"; then
  mv -f "${CUSTOMER_YAML}.r2.tmp" "${CUSTOMER_YAML}"
  log "customer.yaml refreshed from R2 (source of truth): ${R2_CUSTOMER_YAML_URI}"
elif [ -f "${CUSTOMER_YAML}" ]; then
  rm -f "${CUSTOMER_YAML}.r2.tmp" 2>/dev/null || true
  log "WARN: R2 fetch failed; using existing volume copy: ${CUSTOMER_YAML}"
else
  die "customer.yaml not on volume and R2 fetch failed (${R2_CUSTOMER_YAML_URI})"
fi
chmod 0644 "${CUSTOMER_YAML}" \
  || die "customer.yaml must be readable by the separate Workspace broker principal"

# ============================================================================
# Step 2a: sync the voice vault to the volume (agent holds NO R2 credential)
# ============================================================================
# The voice plugin reads the customer's content-free voice samples from R2
# (vaults/<slug>/voice/). We fetch them HERE at boot — with the same boot-time
# creds used for the customer.yaml fetch above, which are STRIPPED before the
# gateway exec (OP-P0-2) — and point the plugin at the local mirror via
# SMD_VOICE_VAULT_DIR. Net: the agent process holds no R2 credential for voice,
# yet voice works. Samples change only when an operator re-ingests a corpus (a
# deliberate out-of-band action), so a boot snapshot is sufficient. This runs as
# the hermes user (entrypoint already dropped privilege), so synced files are
# hermes-owned — no extra chown, no race with entrypoint's blanket chown.
export SMD_VOICE_VAULT_DIR="${HERMES_HOME:-/opt/data}/voice"
R2_VOICE_PREFIX="s3://${R2_BUCKET_CONFIG}/vaults/${CUSTOMER_SLUG}/voice/"
# Empty/absent vault is the COMMON case (no corpus ingested yet) and MUST NOT
# fail the boot under `set -e`: probe first, sync only when non-empty, and never
# `die`. When empty we leave SMD_VOICE_VAULT_DIR's dir absent so reader_from_env
# falls through and the plugin reports INACTIVE (accurate), rather than ACTIVE
# with zero samples.
if AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
   AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
     aws s3 ls --endpoint-url "${R2_ENDPOINT_URL}" "${R2_VOICE_PREFIX}" 2>/dev/null | grep -q .; then
  mkdir -p "${SMD_VOICE_VAULT_DIR}"
  if AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
     AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
       aws s3 cp --recursive --only-show-errors \
         --endpoint-url "${R2_ENDPOINT_URL}" \
         "${R2_VOICE_PREFIX}" "${SMD_VOICE_VAULT_DIR}/"; then
    log "voice vault synced to ${SMD_VOICE_VAULT_DIR} (agent holds no R2 credential for voice)"
  else
    log "WARN: voice vault sync failed; voice INACTIVE this boot (non-fatal)"
  fi
else
  log "no voice vault at ${R2_VOICE_PREFIX} (no corpus ingested) — voice stays inactive"
fi

# ============================================================================
# Step 2b: verify mediated Workspace broker readiness
# ============================================================================
# entrypoint.sh started the broker as a separate uid and removed every Google
# credential variable from this gateway process. The broker reads the authored
# subject/scopes directly from customer.yaml and is the only process permitted
# to read its credential file.
[ -n "${SMD_WORKSPACE_BROKER_SOCKET:-}" ] \
  || die "SMD_WORKSPACE_BROKER_SOCKET is unset; refusing ambient Workspace auth"
[ -S "${SMD_WORKSPACE_BROKER_SOCKET}" ] \
  || die "Workspace broker socket missing: ${SMD_WORKSPACE_BROKER_SOCKET}"
if ! /opt/hermes/.venv/bin/python3 - \
  "${SMD_WORKSPACE_BROKER_SOCKET}" "${CUSTOMER_YAML}" \
  "${SMD_AUDIT_BROKER_SOCKET:-}" "${SMD_D1_AUDIT_BINDING:-}" <<'PY'
import json
import socket
import sqlite3
import sys

import yaml

socket_path, customer_path, audit_socket, audit_db = sys.argv[1:]
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
    client.settimeout(5)
    client.connect(socket_path)
    client.sendall(b'{"action":"health"}\n')
    response = json.loads(client.makefile("rb").readline())
if response.get("ok") is not True or response.get("customer_ready") is not True:
    raise SystemExit("broker health check failed")
customer = yaml.safe_load(open(customer_path, encoding="utf-8")) or {}
google_auth = customer.get("google_auth") or {}
if google_auth and response.get("credential_ready") is not True:
    raise SystemExit("customer has google_auth but broker has no credential")
# OP-P1-4: when audit writes route through the broker, refuse to launch an
# unaudited gateway. Assert the broker opened the ledger AND that the hermes
# mode=ro read seam can read it while the broker holds the only RW handle.
if audit_socket:
    if response.get("audit_ready") is not True:
        raise SystemExit("broker audit ledger not ready (OP-P1-4)")
    ro = sqlite3.connect(f"file:{audit_db}?mode=ro", uri=True)
    try:
        ro.execute("SELECT COUNT(*) FROM audit_log").fetchone()
    finally:
        ro.close()
PY
then
  die "Workspace broker health/readiness check failed"
fi
log "Workspace broker ready; gateway environment is credential-free"

# ============================================================================
# Step 2d: seed the Clio MCP OAuth token to the volume (if Clio connector enabled)
# ============================================================================
# The clio-mcp stdio server (wired into mcp_servers by the overlay materializer,
# v0.4.6+) reads its OAuth token from ~/.clio-mcp/tokens.enc (hermes home =
# /opt/data), AES-256-GCM encrypted under ENCRYPTION_KEY. The consent was
# captured off-box (no browser in a headless Machine); we seed the encrypted
# token here from the CLIO_TOKENS_ENC_B64 Fly secret. The connector REFRESHES
# and rewrites the file in place thereafter, so we only seed when ABSENT — never
# clobber a refreshed token on the persistent volume. The client_id/secret +
# ENCRYPTION_KEY reach the subprocess via the materialized mcp_servers env block
# (ENCRYPTION_KEY <- CLIO_ENCRYPTION_KEY remap), not from here.
CLIO_ENABLED="$(/opt/hermes/.venv/bin/python3 - "${CUSTOMER_YAML}" <<'PY'
import sys
import yaml

data = yaml.safe_load(open(sys.argv[1])) or {}
conns = data.get("connectors") or {}
for rec in conns.values():
    if (
        isinstance(rec, dict)
        and rec.get("enabled")
        and str(rec.get("backend", "")) == "mcp:clio-oktopeak"
    ):
        print("yes")
        break
PY
)" || die "failed to read connectors from customer.yaml"

if [ "${CLIO_ENABLED}" = "yes" ]; then
  CLIO_TOKEN_DIR="/opt/data/.clio-mcp"
  CLIO_TOKEN_FILE="${CLIO_TOKEN_DIR}/tokens.enc"
  if [ -f "${CLIO_TOKEN_FILE}" ]; then
    log "Clio token already on volume (${CLIO_TOKEN_FILE}); leaving in place (connector refreshes it)"
  elif [ -n "${CLIO_TOKENS_ENC_B64:-}" ]; then
    [ -n "${CLIO_ENCRYPTION_KEY:-}" ] \
      || die "mcp:clio-oktopeak enabled with a seed token but CLIO_ENCRYPTION_KEY is unset (token could not be decrypted at runtime)"
    mkdir -p "${CLIO_TOKEN_DIR}"
    ( umask 077; printf '%s' "${CLIO_TOKENS_ENC_B64}" | base64 -d > "${CLIO_TOKEN_FILE}" ) \
      || die "CLIO_TOKENS_ENC_B64 is not valid base64 (expected base64 of ~/.clio-mcp/tokens.enc)"
    chmod 600 "${CLIO_TOKEN_FILE}"
    log "Clio OAuth token seeded to ${CLIO_TOKEN_FILE} (0600)"
  else
    log "mcp:clio-oktopeak enabled but no CLIO_TOKENS_ENC_B64 seed; connector unauthenticated until a token is provided"
  fi
fi

# ============================================================================
# Steps 3-6: Honcho data plane — DEFERRED to Phase 2 (ADR 0016, revised)
# ============================================================================
# Previously: start Postgres, start Redis, run `python -m honcho.migrations`,
# start `python -m honcho.server`. That integration was fictional — `honcho-ai`
# is the Honcho CLIENT SDK, not the server, so those module invocations never
# existed and the Machine died here at every boot. Real Honcho v3.0.7 is the
# plastic-labs/honcho SOURCE repo (fastapi api + `python -m src.deriver`,
# pgvector, mandatory LLM provider).
#
# Per the revised ADR 0016 (Option 2): the customer-owned memory file lives in
# our D1/R2; Honcho is a swappable INFERRED-memory provider that sits behind it
# and is deferred to Phase 2. Phase 1 runs on Hermes' always-on flat-file core
# (MEMORY.md/USER.md), which Hermes auto-creates at profile boot. Postgres +
# Redis remain installed in the image (for Phase 2) but are not started here.

# ============================================================================
# Step 6b: seed/refresh the repo skill catalog onto the volume (#1206)
# ============================================================================
# Repo skills are baked into the image at /app/skills (Dockerfile
# `COPY operator/skills/ /app/skills/`), but the catalog the overlay's
# pin-resolver reads at step 7 is ${HERMES_HOME}/skills (= /opt/data/skills, the
# Fly VOLUME). On a persisted volume the baked catalog is SHADOWED — the SAME
# failure mode handled for the overlay plugin pack further below — so a skill
# added to the repo and bound in customer.yaml is present in the image but
# ABSENT on the volume the resolver checks, and `hermes-smd bootstrap` (step 7)
# crash-loops with "skill '<name>' not found at /opt/data/skills/<name>"
# (#1197, #1206).
#
# Fix: additively overlay /app/skills onto ${HERMES_HOME}/skills on every boot.
# ADDITIVE, never a destructive mirror — agent-authored skills that live only on
# the volume (ADR 0017) are preserved; repo skills are refreshed to the image
# version (the image is the deploy unit). The copy runs as the hermes user into
# the hermes-owned volume. FAIL-CLOSED: a Machine whose bound catalog cannot be
# seeded MUST NOT proceed to a guaranteed crash-loop with a misleading error.
if [ -d /app/skills ]; then
  log "Seeding repo skill catalog onto the volume (/app/skills -> ${HERMES_HOME}/skills)..."
  # If the catalog ROOT is itself a stale symlink (an older seeding approach
  # aliased the whole dir back into /app/skills), drop the link before seeding —
  # never write THROUGH it into the read-only image tree, and never let the
  # per-skill clear below recurse through it and delete the source. `-L` tests
  # the link; `rm -f` drops only the link, not its target.
  if [ -L "${HERMES_HOME}/skills" ]; then
    rm -f "${HERMES_HOME}/skills" \
      || die "cannot clear stale ${HERMES_HOME}/skills symlink for the skill catalog seed"
  fi
  mkdir -p "${HERMES_HOME}/skills" \
    || die "cannot create ${HERMES_HOME}/skills for the skill catalog seed"
  # Per-skill replace, scoped to one repo skill name at a time. Each repo skill
  # overwrites any stale volume entry of the SAME name — including a symlink
  # alias left by an older seeding approach, which is what made a bare
  # `cp -a /app/skills/. ${HERMES_HOME}/skills/` abort with "are the same file"
  # and crash-loop the boot on a persisted volume. Agent-authored skills (present
  # only on the volume, never under /app/skills) are never iterated, so the
  # overlay stays ADDITIVE (ADR 0017). The `-L` guard removes an aliasing entry
  # as a LINK (never recursing into /app/skills); a real stale dir is removed in
  # place. FAIL-CLOSED: any unseedable bound skill stops the boot here rather
  # than at a misleading "skill not found" crash in step 7.
  for _src in /app/skills/*/; do
    [ -e "${_src}" ] || continue
    _name=$(basename "${_src}")
    _dst="${HERMES_HOME}/skills/${_name}"
    if [ -L "${_dst}" ]; then
      rm -f "${_dst}" \
        || die "skill catalog seed: cannot clear stale alias ${_dst}"
    else
      rm -rf "${_dst}" \
        || die "skill catalog seed: cannot clear stale ${_dst}"
    fi
    cp -a "${_src}" "${_dst}" \
      || die "skill catalog seed failed for ${_name} (/app/skills -> ${HERMES_HOME}/skills) — refusing to boot into a crash-loop"
  done
  log "Skill catalog seeded ($(find "${HERMES_HOME}/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ') skill dir(s) on volume)"
else
  log "WARNING: /app/skills absent from image; skipping catalog seed (bound skills must already be on the volume)"
fi

# ============================================================================
# Step 7: hermes-smd bootstrap (customer.yaml -> per-profile config)
# ============================================================================
# Installed at image build time via `pip install hermes-smd-overlay`. Reads
# /opt/data/customer.yaml, writes N profile directories under
# $HERMES_HOME/profiles/<slug>/ with config.yaml and SOUL.md. Phase 1 emits no
# memory-provider block (flat-file core); the `hermes-smd bootstrap` CLI takes
# no --honcho-* flags (those were never valid args — passing them aborted the
# step). Honcho wiring returns in Phase 2 (ADR 0016 revised).
log "Running hermes-smd bootstrap (customer.yaml -> profiles)..."
hermes-smd bootstrap \
  --customer-yaml "${CUSTOMER_YAML}" \
  --hermes-home "${HERMES_HOME}" \
  || die "hermes-smd bootstrap failed; check customer.yaml structure"
log "Profile config(s) generated under ${HERMES_HOME}/profiles/"

# Step 7a: write customer-owned operator identity facts into SOUL.md. The
# overlay-generated SOUL covers persona and tone, but the agent also needs the
# authored customer Workspace identity and connector path to answer identity
# questions correctly over Telegram.
log "Writing customer-owned operator identity facts into SOUL.md..."
/opt/hermes/.venv/bin/python3 /app/ensure-operator-identity.py "${CUSTOMER_YAML}" "${HERMES_HOME}" \
  || die "Failed to write operator identity facts into SOUL.md"
log "Operator identity facts written"

# ============================================================================
# Step 7b: disable the Hermes curator (ADR 0017 / ss-console#1135)
# ============================================================================
# Hermes' curator runs an autonomous LLM consolidation pass over agent-authored
# skills on a 7-day cron (agent/curator.py:_run_llm_review()), rewriting and
# consolidating skill CONTENT via skill_manage. That out-of-band rewrite
# corrupts our audit provenance and produces unsupervised structural skill
# drift, so ADR 0017 disables it per-customer. We enforce it here — after the
# profile configs exist (step 7) and BEFORE Hermes (and its gateway cron
# ticker) starts in step 11 — which also closes the fresh-install ticker
# footgun (NousResearch/hermes-agent#18373). In-conversation skill
# auto-creation (skill_manage) stays enabled; only the background curator is
# off. Consolidation is run on demand under Captain supervision via
# `hermes curator run --dry-run` (see docs/runbooks/operator/curator-supervised-consolidation.md).
#
# The declarative home for this flag is the overlay's customer.yaml -> config
# translation; this entrypoint guard is the belt that holds even if the overlay
# has not yet shipped the same flag. Idempotent.
log "Disabling Hermes curator in profile configs (ADR 0017)..."
/opt/hermes/.venv/bin/python3 /app/ensure-curator-disabled.py "${HERMES_HOME}" \
  || die "Failed to disable curator in profile configs (ADR 0017)"
log "Curator disabled in profile config(s)"

# Step 7b.1: enforce persona-disabled bundled skills. Hermes bundles a broad
# universal skill catalog into every profile; customer.yaml skills_disabled is
# the per-customer authority. Apply it after hermes-smd bootstrap writes the
# profile skill tree and prompt snapshot, before the gateway can expose a
# disabled connector path to the model.
log "Removing customer-disabled bundled skills from profile catalogs..."
/opt/hermes/.venv/bin/python3 /app/ensure-disabled-skills.py "${CUSTOMER_YAML}" "${HERMES_HOME}" \
  || die "Failed to enforce persona skills_disabled entries"
log "Disabled skill guard passed"

# Hermes' gateway startup sync can rehydrate bundled skill directories after
# this preflight guard runs. Keep a short-lived reconciler alive during gateway
# startup so disabled bundled skills are removed again after that sync without
# mutating the overlay's profile `skills` list shape.
(
  for _ in 1 2 3 4 5 6; do
    sleep 5
    /opt/hermes/.venv/bin/python3 /app/ensure-disabled-skills.py "${CUSTOMER_YAML}" "${HERMES_HOME}" \
      || true
  done
) &

# Step 7c: fail closed if Telegram would run without an allowlist (ADR 0033).
# TELEGRAM_BOT_TOKEN alone auto-enables Hermes' Telegram platform, and the pinned
# ref fails OPEN on an empty allowlist (telegram.py: `if not allowed_csv: return
# True`) — so a token without an allowlist = a bot anyone can talk to. This guard
# refuses to launch unless an allowlist is resolvable from TELEGRAM_ALLOWED_USERS
# or a profile config's telegram.allow_from (authored via customer.yaml). No-op
# when TELEGRAM_BOT_TOKEN is unset.
log "Verifying Telegram allowlist (fail-closed, ADR 0033)..."
/opt/hermes/.venv/bin/python3 /app/ensure-telegram-allowlist.py "${HERMES_HOME}" \
  || die "Telegram allowlist guard failed (ADR 0033): refusing to launch an unrestricted bot"
log "Telegram allowlist guard passed"

# ============================================================================
# Step 8: safety substrate invariant checks — MOVED below the overlay refresh
# ============================================================================
# The Phase A.5 gate now runs AFTER the overlay refresh + activation-hook seed
# (search "Phase A.5 gate — runs AFTER overlay refresh" below), not here.
#
# WHY (ss-console#1285 follow-up — crash-loop deadlock). invariant_8 validates
# that the volume overlay carries the fan-out __init__.py. The refresh that
# REPAIRS the overlay from the image-pinned pack runs later in this script. With
# the gate HERE (before the refresh), a volume overlay left partial — e.g. an
# interrupted refresh where `rm -rf` completed but `cp` did not, which a restart
# racing a boot can cause — failed invariant_8 and the `die` killed the boot
# BEFORE the refresh could repair it. Every reboot repeated it: an unbreakable
# crash-loop. Moving the gate to after the refresh makes each boot repair the
# overlay first, then validate what will actually launch — self-healing.

# ============================================================================
# Step 9: pause guard
# ============================================================================
# PRESERVED VERBATIM from the prior bootstrap.sh. pause-customer.sh writes a
# sentinel at /opt/data/.paused; if present, we log and park on tail so
# `fly ssh console` still works but the agent loop stays dormant.
if [ -f /opt/data/.paused ]; then
  log "PAUSE sentinel present at /opt/data/.paused — agent will not start"
  log "Reason: $(cat /opt/data/.paused)"
  # Keep the container alive so `fly ssh console` still works; just don't run agent.
  exec tail -f /dev/null
fi

# ============================================================================
# Step 10: customer-sync sidecar (R2 poller) — NOT launched (unimplemented)
# ============================================================================
# The sidecar's purpose is to poll R2 at vaults/<slug>/customer.yaml and apply
# non-structural changes in place (SIGHUP reload). It is NOT launched in Phase 1
# for two reasons: (1) the overlay's `start_customer_sync` raises
# NotImplementedError (the reload path is a tracked follow-on), and (2) the
# `hermes-smd customer-sync` CLI does not accept the `--r2-endpoint` flag this
# script previously passed, so argparse aborted it immediately. Launching it
# backgrounded only spammed a guaranteed crash into the logs on every boot.
# Structural changes already require a Captain re-provision (ADR 0019); until
# the reload path is implemented, non-structural edits also go through a
# re-provision. Re-enable here once the overlay ships the sidecar.

# ============================================================================
# Step 11: launch the Hermes gateway for the active persona (foreground/tini)
# ============================================================================
# The unattended runtime is `hermes gateway run`, NOT `hermes chat`. `chat` is
# an interactive REPL — as PID-1's foreground child with no TTY it would hit
# EOF on stdin and exit, never staying up. The gateway is the long-lived daemon
# that listens for cron triggers (e.g. the daily inbox-triage run) and inbound
# webhook events and drives them through the agent + overlay plugin surface
# (audit / trust / inbound / outbound / voice). `gateway run` is the upstream-
# documented foreground mode for containers.
#
# The gateway MUST target the persona profile, not the bare default profile.
# A plain `hermes gateway run` runs Hermes' built-in `default` profile, which
# has no model, no SOUL.md, no skills, and no connector wiring — i.e. NOT the
# customer's agent. Step 7 wrote the persona profiles under
# $HERMES_HOME/profiles/<slug>/; we select the active one with `-p <slug>`
# (a global flag that works in any position; the profile dir is sufficient,
# no separate `hermes profile create` needed).
#
# Active persona = the first persona with `status: active` (else the first
# persona). Phase 1 customers run a single active persona, so one gateway. The
# multi-active-persona case (one gateway per persona) is an ADR 0011 Phase-2
# concern; until then we launch the single active persona's gateway.
ACTIVE_PROFILE="$(/opt/hermes/.venv/bin/python3 - "${CUSTOMER_YAML}" <<'PY'
import sys
import yaml

data = yaml.safe_load(open(sys.argv[1])) or {}
personas = data.get("personas") or []
active = [p for p in personas if p.get("status") == "active" and p.get("slug")]
fallback = [p for p in personas if p.get("slug")]
chosen = (active or fallback or [None])[0]
print(chosen["slug"] if chosen else "")
PY
)" || die "failed to read active persona from customer.yaml"
[ -n "${ACTIVE_PROFILE}" ] || die "no active persona with a slug in customer.yaml"
log "Active persona profile: ${ACTIVE_PROFILE}"
PROFILE_HERMES_HOME="${HERMES_HOME}/profiles/${ACTIVE_PROFILE}"

# `exec` so the gateway inherits the foreground slot under tini cleanly.
#
# Overlay plugins were installed at image build time under ~/.hermes/plugins/.
# customer.yaml + skills + connector wiring resolve through the overlay's
# bootstrap CLI invoked in step 7.
#
# Ensure the gateway's log directories exist and are writable by the hermes
# user. Hermes writes a rotating log and does NOT create the parent dir itself
# — on a fresh volume the open() would fail. The volume root and the profile
# dir are hermes-owned, so these mkdirs create hermes-owned, writable dirs.
mkdir -p "${HERMES_HOME}/logs" "${PROFILE_HERMES_HOME}/logs"

# ---------- Ensure overlay plugins are PRESENT on the volume (before gateway) ----------
# The Dockerfile's `hermes plugins install` lands the overlay pack under
# ${HERMES_HOME} (= /opt/data) — the Fly VOLUME mountpoint. On a persisted volume
# the build-time install is SHADOWED, so the overlay pack (trust / inbound / audit
# / voice hooks — the safety harness) is ABSENT at runtime and the gateway would
# boot WITHOUT it. Re-install here, idempotently, as the hermes user, after the
# volume mount and before the gateway launches.
#
# Use a deterministic DIRECTORY check, NOT `hermes plugins list` — the list does
# not report an installed-but-not-yet-loaded pack before the gateway starts (that
# false-negative previously dragged a healthy install into a fail-closed abort).
# FAIL-CLOSED on a genuine install failure: a Machine whose overlay pack cannot be
# installed MUST NOT serve (matches the Dockerfile build-time hard gate).
# The dir check is a no-op skip on the common path: a fresh volume receives the
# build-time-installed pack via Fly's empty-volume copy, and a persisted volume
# keeps it across deploys — so the slow `git clone` only runs in the rare reseed
# case and does not normally delay the public :8643 listener below.
OVERLAY_PLUGIN_DIR="${HERMES_HOME}/plugins/hermes-smd-overlay"
OVERLAY_PACK="/app/overlay-pack"
# REFRESH the volume's overlay from the image-pinned pack on EVERY boot — do NOT
# skip when a dir is merely present. The volume (/opt/data) persists across
# deploys and shadows the build-time install, so a presence-only check kept a
# STALE overlay forever: every OVERLAY_REF bump rebuilt the image but the running
# gateway kept loading the old volume copy, and the overlay sat inert — no audit,
# no trust enforcement (ss-console#1285). Refreshing from the pinned, non-volume
# pack makes a bump actually take effect, and is idempotent on a steady-state
# boot (same bytes).
if [ -d "${OVERLAY_PACK}" ]; then
  log "Refreshing overlay on the volume from the image-pinned pack (${OVERLAY_PACK})..."
  mkdir -p "${HERMES_HOME}/plugins"
  # replace_dir_tolerant (mv-aside, not rm -rf) so a stray root-owned file in the
  # old overlay dir can't crash-loop the boot under set -e. cp (not cp -a): the
  # copies are owned by the running hermes user, not the root-owned image source —
  # a root-owned volume file would break a later hermes-user write (the
  # .skills_prompt_snapshot.json FATAL we hit).
  replace_dir_tolerant "${OVERLAY_PACK}" "${OVERLAY_PLUGIN_DIR}"
  /opt/hermes/.venv/bin/hermes plugins enable hermes-smd-overlay >/dev/null 2>&1 || true
  [ -f "${OVERLAY_PLUGIN_DIR}/__init__.py" ] \
    || die "overlay fan-out __init__.py missing after refresh — refusing to launch an ungoverned gateway"
  log "Overlay refreshed on the volume (fan-out register present)"
elif [ -d "${OVERLAY_PLUGIN_DIR}" ]; then
  # No staged pack (older image) but a volume copy exists — leave it; the
  # activation invariant is the backstop that halts boot if it is inert.
  log "Overlay present on the volume; no image pack to refresh from (${OVERLAY_PLUGIN_DIR})"
else
  log "Overlay absent and no image pack; installing at runtime (unpinned fallback)..."
  rm -rf "${HERMES_HOME}/plugins" 2>/dev/null || true
  /opt/hermes/.venv/bin/hermes plugins install venturecrane/hermes-smd-overlay --enable \
    || die "runtime overlay plugin install failed — refusing to launch a harness-less gateway"
  [ -d "${OVERLAY_PLUGIN_DIR}" ] \
    || die "overlay plugin dir missing after install — refusing to launch a harness-less gateway"
  log "Overlay plugin installed + enabled at runtime"
fi

# `hermes -p <profile>` rewrites HERMES_HOME to the profile directory before
# importing Hermes modules. Plugin discovery therefore scans the profile's
# plugins directory, not the root volume directory refreshed above. Materialize
# the same pinned pack into the active profile and enable it in that profile's
# config so force-discovery from the gateway process can load it.
PROFILE_OVERLAY_PLUGIN_DIR="${PROFILE_HERMES_HOME}/plugins/hermes-smd-overlay"
if [ -d "${OVERLAY_PACK}" ]; then
  mkdir -p "${PROFILE_HERMES_HOME}/plugins"
  replace_dir_tolerant "${OVERLAY_PACK}" "${PROFILE_OVERLAY_PLUGIN_DIR}"
elif [ -d "${OVERLAY_PLUGIN_DIR}" ]; then
  mkdir -p "${PROFILE_HERMES_HOME}/plugins"
  replace_dir_tolerant "${OVERLAY_PLUGIN_DIR}" "${PROFILE_OVERLAY_PLUGIN_DIR}"
else
  die "overlay source missing before profile materialization — refusing to launch an ungoverned gateway"
fi
[ -f "${PROFILE_OVERLAY_PLUGIN_DIR}/__init__.py" ] \
  || die "profile overlay fan-out missing (${PROFILE_OVERLAY_PLUGIN_DIR}) — refusing to launch an ungoverned gateway"
/opt/hermes/.venv/bin/hermes -p "${ACTIVE_PROFILE}" plugins enable hermes-smd-overlay >/dev/null \
  || die "failed to enable hermes-smd-overlay in active profile ${ACTIVE_PROFILE}"
log "Overlay materialized + enabled in active profile"

# ---------- Seed the gateway-startup ACTIVATION GATE onto the volume ----------
# The overlay's LIVE governance gate is a HookRegistry handler
# (hooks/smd-overlay-activation) that fires at gateway:startup IN the gateway
# process: it force-loads the overlay into the live PluginManager singleton, then
# drives a REAL pre_tool_call dispatch self-check and fails closed (os._exit) if the
# operator is not actually governed. This closes ss-console#1285 — registered hooks
# were inert on the live gateway because its plugin singleton was cached (idempotent
# discovery) WITHOUT the overlay; the pre-gateway safety-substrate invariant could
# not catch it (it runs in a different process and asserts its own singleton).
#
# Hermes' `-p <profile>` handling rewrites HERMES_HOME before gateway/hooks.py
# defines its module-level HOOKS_DIR. The live gateway therefore loads handlers
# from ${PROFILE_HERMES_HOME}/hooks, not the root volume's hooks directory. Seed
# the selected profile directly. Refresh on every boot so an OVERLAY_REF bump
# takes effect. Uses cp -r (not -a) so files land hermes-owned.
if [ -d "${OVERLAY_PACK}/hooks" ]; then
  _HOOKS_SRC="${OVERLAY_PACK}/hooks"
elif [ -d "${OVERLAY_PLUGIN_DIR}/hooks" ]; then
  _HOOKS_SRC="${OVERLAY_PLUGIN_DIR}/hooks"
else
  _HOOKS_SRC=""
fi
PROFILE_HOOKS_DIR="${PROFILE_HERMES_HOME}/hooks"
ACTIVATION_HOOK_DIR="${PROFILE_HOOKS_DIR}/smd-overlay-activation"
if [ -n "${_HOOKS_SRC}" ]; then
  log "Seeding overlay gateway hooks into active profile from ${_HOOKS_SRC}..."
  mkdir -p "${PROFILE_HOOKS_DIR}"
  for _hookdir in "${_HOOKS_SRC}"/*/; do
    [ -d "${_hookdir}" ] || continue
    _name="$(basename "${_hookdir}")"
    # mv-aside (same root-owned-.pyc tolerance as the overlay refresh): a root
    # `ssh console` that loaded handler.py would leave a root-owned __pycache__
    # here, which a plain `rm -rf` under set -e would choke on.
    replace_dir_tolerant "${_hookdir}" "${PROFILE_HOOKS_DIR}/${_name}"
  done
  log "Overlay gateway hooks seeded into active profile"
fi
# FAIL-CLOSED: the live activation gate must be wired no matter which overlay branch
# ran above. Without it the gateway has no in-process check that the overlay governs
# live turns — the exact unverified state ss-console#1285 shipped. Better to crash-loop
# (Fly restarts) than to serve an operator we cannot prove is governed.
{ [ -f "${ACTIVATION_HOOK_DIR}/HOOK.yaml" ] && [ -f "${ACTIVATION_HOOK_DIR}/handler.py" ]; } \
  || die "overlay activation gate missing (${ACTIVATION_HOOK_DIR}) — refusing to launch a gateway with no live governance self-check (ss-console#1285)"

# ============================================================================
# Step 8 (moved): safety substrate invariant checks — Phase A.5 gate — runs AFTER overlay refresh
# ============================================================================
# Runs here, AFTER the overlay refresh + activation-hook seed above, so
# invariant_8 validates the freshly-repaired overlay (fan-out __init__.py
# present) rather than a stale/partial volume copy left by an interrupted prior
# boot — which previously deadlocked into a crash-loop (see "Step 8" note above).
# The five invariants must still hold across compaction, restart, tool failure,
# prompt injection, and ceiling-escalation attempts; re-run every boot so a
# Hermes SHA bump can't regress the floor (OpenClaw mitigation).
log "Running safety substrate invariant checks (Phase A.5 gate)..."
if ! /opt/hermes/.venv/bin/python3 /app/safety-substrate/run_invariants.py \
       --customer "${CUSTOMER_SLUG}" \
       --fixtures /app/safety-substrate/tests \
       --strict ; then
  die "Safety substrate invariant check FAILED — agent will not start. \
Inspect /app/safety-substrate/logs/$(date -u +%Y%m%d).log for which invariant failed."
fi
log "Safety substrate invariants PASSED"

# Inbound webhook front-door gate (overlay `hermes-smd-webhook-gate`). It binds
# the public port (8643), verifies the vendor signature (AgentMail), and forwards
# to the gateway's machine-local :8644 with the Generic header. FAIL-CLOSED: only
# launched when a per-vendor webhook secret is present — no public webhook surface
# without a verifying secret. Runs as a supervised background child under tini; a
# restart loop keeps it up, while the gateway exec below stays PID-1's foreground.
if [ -n "${WEBHOOK_SECRET_AGENTMAIL:-}" ]; then
  ( while true; do
      /opt/hermes/.venv/bin/hermes-smd-webhook-gate || true
      echo "[bootstrap] webhook-gate exited non-zero; restarting in 2s" >&2
      sleep 2
    done ) &
  log "Inbound webhook gate launched (public :8643 -> gateway :8644)"
else
  log "WEBHOOK_SECRET_AGENTMAIL unset; webhook gate NOT launched (no inbound webhook)"
fi

# Strip the account-wide R2 credential before handing off to the agent (OP-P0-2,
# docs/security/operator-threat-model.md). R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
# are an ACCOUNT-WIDE R2 key (R/W on every bucket in the account); their
# in-Machine consumers are the customer.yaml fetch (Step 2) and the voice-vault
# sync (Step 2a) above — both BOOT-time and both BEFORE this strip. The agent's
# own skill-body writer (skill_capture.py) uses the bucket-SCOPED
# R2_SKILL_BODIES_* pair plus R2_ENDPOINT_URL — NOT these — and voice reads its
# vault from the local SMD_VOICE_VAULT_DIR mirror, so the account-wide key must
# not remain in the gateway env where an injection could exfiltrate it
# cross-tenant. ORDERING IS LOAD-BEARING: this unset MUST stay AFTER the R2 fetch
# + voice sync (Step 2/2a) and BEFORE the gateway exec; moving it earlier breaks
# them (R2_ACCESS_KEY_ID is read by the `aws s3 cp`s above). R2_ENDPOINT_URL is
# intentionally KEPT — the scoped skill-body writer reads it, and it is an
# endpoint URL, not a credential.
unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY

log "Launching Hermes gateway for profile '${ACTIVE_PROFILE}' (overlay plugins enabled)..."

exec /opt/hermes/.venv/bin/hermes -p "${ACTIVE_PROFILE}" gateway run
