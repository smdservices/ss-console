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
  # ADR 0022 Stream 2 — per-customer skill bodies bucket. Bucket name
  # comes from fly.toml [env] (R2_SKILL_BODIES_BUCKET); the bucket-scoped
  # access key + secret are Fly secrets set by provision-customer.sh. The
  # hermes-smd-audit plugin writes SKILL.md bodies here on skill_manage
  # events (write-ahead pattern; see docs/specs/operator/skill-body-persistence.md).
  R2_SKILL_BODIES_BUCKET
  R2_SKILL_BODIES_ACCESS_KEY_ID
  R2_SKILL_BODIES_SECRET_ACCESS_KEY
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

# ============================================================================
# Step 2b: materialize Google credentials to the volume (if provided)
# ============================================================================
# Google connectors read /opt/data/oauth/google.json through _google_auth.py.
# For the external-customer Workspace path, this file is a customer-owned
# service-account key authorized with domain-wide delegation. For the legacy
# user-OAuth path, it is the google-auth authorized-user token relayed by the
# portal OAuth flow. Both Fly secrets are base64-encoded so JSON survives secret
# storage intact. Write 0600, hermes-owned.
GOOGLE_TOKEN_FILE="/opt/data/oauth/google.json"
GOOGLE_AUTH_MODE="$(/opt/hermes/.venv/bin/python3 - "${CUSTOMER_YAML}" <<'PY'
import sys
import yaml

data = yaml.safe_load(open(sys.argv[1])) or {}
ga = data.get("google_auth") or {}
print(ga.get("mode") or "user_oauth")
PY
)" || die "failed to read google_auth.mode from customer.yaml"

if [ "${GOOGLE_AUTH_MODE}" = "dwd" ]; then
  [ -n "${GOOGLE_SERVICE_ACCOUNT_JSON:-}" ] \
    || die "google_auth.mode=dwd requires GOOGLE_SERVICE_ACCOUNT_JSON Fly secret"
  mkdir -p /opt/data/oauth
  ( umask 077; printf '%s' "${GOOGLE_SERVICE_ACCOUNT_JSON}" | base64 -d > "${GOOGLE_TOKEN_FILE}" ) \
    || die "GOOGLE_SERVICE_ACCOUNT_JSON is not valid base64 (expected base64-encoded service-account JSON)"
  if ! /opt/hermes/.venv/bin/python3 - "${GOOGLE_TOKEN_FILE}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    data = json.load(fh)
if data.get("type") != "service_account":
    raise SystemExit("not a service_account key")
if not data.get("client_email") or not data.get("private_key"):
    raise SystemExit("missing service-account key fields")
PY
  then
    die "GOOGLE_SERVICE_ACCOUNT_JSON must decode to a Google service-account key"
  fi
  log "Google service-account credential materialized to ${GOOGLE_TOKEN_FILE} (0600)"
elif [ -n "${GOOGLE_TOKEN_JSON:-}" ]; then
  mkdir -p /opt/data/oauth
  ( umask 077; printf '%s' "${GOOGLE_TOKEN_JSON}" | base64 -d > "${GOOGLE_TOKEN_FILE}" ) \
    || die "GOOGLE_TOKEN_JSON is not valid base64 (expected base64-encoded google.json)"
  log "Google user-OAuth token materialized to ${GOOGLE_TOKEN_FILE} (0600)"
else
  log "No Google credential secret set; Google Workspace connectors unavailable this boot"
fi

# ============================================================================
# Step 2c: materialize Google DWD env from customer.yaml (if mode: dwd)
# ============================================================================
# When customer.yaml authors `google_auth.mode: dwd`, the Google connector CLIs
# run in service-account / domain-wide-delegation mode: _google_auth.credentials
# branches on the on-disk key's "type" and reads the impersonation subject +
# scopes from the environment, FAIL-CLOSED (ss-console #1212 / #1213). Export
# them here from customer.yaml so the gateway (Step 11, same shell) — and the
# execute_code subprocesses it spawns to run the connectors — inherit them.
# No-op for the default user-OAuth customer: nothing is exported and the
# connectors read the relayed authorized-user token at ${GOOGLE_TOKEN_FILE}.
# Tab-delimited key/value so the space-joined scope list survives intact.
GOOGLE_DWD_ENV="$(/opt/hermes/.venv/bin/python3 - "${CUSTOMER_YAML}" <<'PY'
import sys
import yaml

data = yaml.safe_load(open(sys.argv[1])) or {}
ga = data.get("google_auth") or {}
if (ga.get("mode") or "user_oauth") != "dwd":
    sys.exit(0)
subject = (ga.get("subject") or "").strip()
scopes = [s for s in (ga.get("scopes") or []) if isinstance(s, str) and s.strip()]
# Fail-closed parity with the validator + connector: emit nothing on a partial
# DWD block so the connector refuses (no subject/scopes) rather than acting
# under a wrong/empty identity.
if not subject or not scopes:
    sys.exit(0)
print("GOOGLE_IMPERSONATE_SUBJECT\t%s" % subject)
print("GOOGLE_OAUTH_SCOPES\t%s" % " ".join(scopes))
PY
)" || die "failed to read google_auth from customer.yaml"
if [ "${GOOGLE_AUTH_MODE}" = "dwd" ] && [ -z "${GOOGLE_DWD_ENV}" ]; then
  die "google_auth.mode=dwd requires google_auth.subject and google_auth.scopes"
fi
if [ -n "${GOOGLE_DWD_ENV}" ]; then
  while IFS="$(printf '\t')" read -r _key _val; do
    [ -n "${_key}" ] || continue
    export "${_key}=${_val}"
    log "Google DWD env exported: ${_key}"
  done <<EOF
${GOOGLE_DWD_ENV}
EOF
else
  log "google_auth.mode != dwd (or unset); Google connectors use the user-OAuth token"
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
  mkdir -p "${HERMES_HOME}/skills" \
    || die "cannot create ${HERMES_HOME}/skills for the skill catalog seed"
  cp -a /app/skills/. "${HERMES_HOME}/skills/" \
    || die "skill catalog seed failed (/app/skills -> ${HERMES_HOME}/skills) — refusing to boot into a crash-loop"
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
# Step 8: safety substrate invariant checks (Phase A.5 gate)
# ============================================================================
# PRESERVED VERBATIM from the prior bootstrap.sh. The five invariants must
# hold across compaction, restart, tool failure, prompt injection, and
# ceiling-escalation attempts. Re-runs on every container start so a Hermes
# SHA bump can't regress the floor. This is the OpenClaw mitigation.
log "Running safety substrate invariant checks (Phase A.5 gate)..."
if ! /opt/hermes/.venv/bin/python3 /app/safety-substrate/run_invariants.py \
       --customer "${CUSTOMER_SLUG}" \
       --fixtures /app/safety-substrate/tests \
       --strict ; then
  die "Safety substrate invariant check FAILED — agent will not start. \
Inspect /app/safety-substrate/logs/$(date -u +%Y%m%d).log for which invariant failed."
fi
log "Safety substrate invariants PASSED"

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
mkdir -p "${HERMES_HOME}/logs" "${HERMES_HOME}/profiles/${ACTIVE_PROFILE}/logs"

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
if [ -d "${OVERLAY_PLUGIN_DIR}" ]; then
  log "Overlay plugin present on the volume (${OVERLAY_PLUGIN_DIR})"
else
  log "Overlay plugin absent (volume shadows build-time install); installing at runtime..."
  # Clear a stale/empty plugins dir (e.g. a root-owned dir left by a diagnostic).
  # rm needs only parent write (${HERMES_HOME} is hermes-owned), not target
  # ownership, so this succeeds even on a root-owned empty dir.
  rm -rf "${HERMES_HOME}/plugins" 2>/dev/null || true
  /opt/hermes/.venv/bin/hermes plugins install venturecrane/hermes-smd-overlay --enable \
    || die "runtime overlay plugin install failed — refusing to launch a harness-less gateway"
  [ -d "${OVERLAY_PLUGIN_DIR}" ] \
    || die "overlay plugin dir missing after install — refusing to launch a harness-less gateway"
  log "Overlay plugin installed + enabled at runtime"
fi

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

log "Launching Hermes gateway for profile '${ACTIVE_PROFILE}' (overlay plugins enabled)..."

exec /opt/hermes/.venv/bin/hermes -p "${ACTIVE_PROFILE}" gateway run
