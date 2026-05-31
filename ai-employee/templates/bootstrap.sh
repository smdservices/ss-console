#!/usr/bin/env bash
# bootstrap.sh — container entrypoint for the AI Employee customer Machine
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
  # events (write-ahead pattern; see docs/specs/ai-employee/skill-body-persistence.md).
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

# Per-customer optional env (Google OAuth tokens land here after the OAuth
# flow runs in-container). Not required at boot; specific skills check.
OPTIONAL_ENV=(
  GOOGLE_TOKEN_JSON
  GOOGLE_CLIENT_SECRET_JSON
  # Honcho (inferred memory) is deferred to Phase 2 (ADR 0016 revised). These
  # are unused at boot in Phase 1; kept optional for forward-compat so the
  # Phase-2 vendor can stage them without a bootstrap change.
  SMD_D1_OBSERVATIONS_BINDING
  HONCHO_API_KEY
  # R2 endpoint URL override (defaults to the Cloudflare R2 S3 endpoint).
  R2_ENDPOINT_URL
  # AGENTMAIL_API_KEY — the persona's own outbound mailbox identity (ADR 0005
  # reviewer-as-sender). NOW CONSUMED: a customer.yaml `Email` connector with
  # backend `mcp:agentmail` is materialized by the overlay translator
  # (bootstrap.translate._materialize_mcp_servers) into the profile's
  # `mcp_servers` block, injecting this key as the `x-api-key` header. Kept
  # OPTIONAL on purpose — if it is unset the translator logs and skips the
  # agentmail server (the Machine still boots; the Email connector is simply
  # not wired) rather than crashlooping on a missing key.
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
# Storage model change (§6): customer.yaml lives on the volume, not baked
# into the image. R2 at vaults/<slug>/customer.yaml is the source of truth;
# provisioning writes it there. Bootstrap fetches to /opt/data on first boot
# and uses the volume copy on subsequent boots.
CUSTOMER_YAML="/opt/data/customer.yaml"
R2_ENDPOINT_URL="${R2_ENDPOINT_URL:-https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com}"
R2_CUSTOMER_YAML_URI="s3://${R2_BUCKET_CONFIG}/vaults/${CUSTOMER_SLUG}/customer.yaml"

if [ -f "${CUSTOMER_YAML}" ]; then
  log "customer.yaml present on volume: ${CUSTOMER_YAML}"
else
  log "customer.yaml missing on volume; fetching from R2: ${R2_CUSTOMER_YAML_URI}"
  # awscli is installed in the Dockerfile. R2 speaks S3 with a custom endpoint.
  AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
  AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
    aws s3 cp \
      --endpoint-url "${R2_ENDPOINT_URL}" \
      "${R2_CUSTOMER_YAML_URI}" \
      "${CUSTOMER_YAML}" \
    || die "Failed to fetch customer.yaml from R2 (${R2_CUSTOMER_YAML_URI})"
  log "customer.yaml fetched from R2 -> ${CUSTOMER_YAML}"
fi

# ============================================================================
# Step 2b: materialize the Google OAuth token to the volume (if provided)
# ============================================================================
# crane_gmail.py (the inbox-triage fetch path) reads a Google authorized-user
# token at /opt/data/oauth/google.json per ADR 0010. The token is delivered
# BASE64-ENCODED as the GOOGLE_TOKEN_JSON Fly secret (base64 so the JSON's
# quotes/braces survive dotenv secret storage intact). Scope is gmail.modify
# (read + archive + trash + draft; the token CANNOT send, enforced at Google).
# Write it 0600, hermes-owned. crane_gmail refreshes and rewrites this file in
# place, so it must be writable by hermes. Skipped if unset — Gmail triage is
# simply unavailable that boot, no crash.
GOOGLE_TOKEN_FILE="/opt/data/oauth/google.json"
if [ -n "${GOOGLE_TOKEN_JSON:-}" ]; then
  mkdir -p /opt/data/oauth
  ( umask 077; printf '%s' "${GOOGLE_TOKEN_JSON}" | base64 -d > "${GOOGLE_TOKEN_FILE}" ) \
    || die "GOOGLE_TOKEN_JSON is not valid base64 (expected base64-encoded google.json)"
  log "Google OAuth token materialized to ${GOOGLE_TOKEN_FILE} (0600)"
else
  log "GOOGLE_TOKEN_JSON not set; Gmail triage unavailable this boot"
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
# `hermes curator run --dry-run` (see docs/runbooks/ai-employee/curator-supervised-consolidation.md).
#
# The declarative home for this flag is the overlay's customer.yaml -> config
# translation; this entrypoint guard is the belt that holds even if the overlay
# has not yet shipped the same flag. Idempotent.
log "Disabling Hermes curator in profile configs (ADR 0017)..."
/opt/hermes/.venv/bin/python3 /app/ensure-curator-disabled.py "${HERMES_HOME}" \
  || die "Failed to disable curator in profile configs (ADR 0017)"
log "Curator disabled in profile config(s)"

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

log "Launching Hermes gateway for profile '${ACTIVE_PROFILE}' (overlay plugins enabled)..."

exec /opt/hermes/.venv/bin/hermes -p "${ACTIVE_PROFILE}" gateway run
