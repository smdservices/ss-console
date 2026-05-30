#!/usr/bin/env bash
# bootstrap.sh — container entrypoint for the AI Employee customer Machine
#
# Per §6 of the locked build plan and ADRs 0007/0010/0016/0019, this script
# runs an 11-step sequenced startup under tini (PID 1, zombie reaper):
#
#   1.  Validate required env vars.
#   2.  Verify (or fetch from R2) /opt/data/customer.yaml.
#   3.  Start Postgres (Honcho's data store) as a supervised child.
#   4.  Start Redis (Honcho's queue/cache) as a supervised child.
#   5.  Run Honcho schema migrations (idempotent).
#   6.  Start Honcho FastAPI server as a supervised child.
#   7.  Run `hermes-smd bootstrap` (customer.yaml -> per-profile config + SOUL.md).
#   7b. Disable the Hermes curator in each profile config (ADR 0017).
#   8.  Run the safety-substrate invariant checks (Phase A.5 gate).
#   9.  Pause guard.
#   10. Start `hermes-smd customer-sync` sidecar (R2 poller).
#   11. exec Hermes (becomes the foreground child of tini).
#
# Storage model:
#   - customer.yaml is volume-mounted, NOT baked into the image.
#   - Provisioning writes it to R2 at vaults/<slug>/customer.yaml.
#   - First boot: fetch from R2 -> /opt/data/customer.yaml.
#   - Subsequent boots: use the volume copy.
#
# Process supervision:
#   - tini (PID 1) reaps zombies and forwards signals.
#   - Postgres, Redis, Honcho, and the customer-sync sidecar are launched
#     under restart wrappers so a crashed dependency self-heals.
#   - The memory-mirror plugin handles graceful degradation when Honcho is
#     unhealthy mid-session; this script does not health-monitor Honcho at
#     runtime (only at startup).
#
# Fails fast on any of:
#   - missing required env vars
#   - customer.yaml missing AND not fetchable from R2
#   - Postgres/Redis/Honcho not healthy within bounded retries
#   - Honcho schema migration error
#   - `hermes-smd bootstrap` error (bad customer.yaml structure)
#   - safety-substrate invariant test failures

set -euo pipefail

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [bootstrap] $*"
}

die() {
  log "FATAL: $*"
  exit 1
}

# Bounded retry helper: wait_for <description> <max_attempts> <sleep_seconds> <check_command...>
wait_for() {
  local desc="$1"
  local max="$2"
  local delay="$3"
  shift 3
  local attempt=1
  while (( attempt <= max )); do
    if "$@" >/dev/null 2>&1; then
      log "${desc} ready (attempt ${attempt}/${max})"
      return 0
    fi
    log "${desc} not ready, retry ${attempt}/${max} in ${delay}s..."
    sleep "${delay}"
    attempt=$(( attempt + 1 ))
  done
  return 1
}

# Restart-on-crash wrapper for foundational child processes. Logs a
# fatal-style line on each crash so the audit plugin / operator sees the
# transition; tini still reaps the dying child.
supervise() {
  local name="$1"
  shift
  (
    while true; do
      log "supervisor: starting ${name}"
      if "$@"; then
        log "supervisor: ${name} exited 0; restarting in 5s"
      else
        local rc=$?
        log "supervisor: ${name} exited ${rc}; restarting in 5s"
      fi
      sleep 5
    done
  ) &
  log "supervisor: ${name} pid=$!"
}

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
  # D1 bindings for the audit + observations mirror tables (ADR 0016/0017).
  SMD_D1_AUDIT_BINDING
  SMD_D1_OBSERVATIONS_BINDING
  # Honcho FastAPI access token, generated per-Machine at provisioning.
  HONCHO_API_KEY
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
  # R2 endpoint URL override (defaults to the Cloudflare R2 S3 endpoint).
  R2_ENDPOINT_URL
  # COMPOSIO_API_KEY — doctrine-dropped per ADR 0020 (revision 2026-05-24: "no
  # currently planned binding uses composio"). provision-customer.sh stopped
  # staging it on 2026-05-26, so requiring it here was a guaranteed fail-closed
  # boot crashloop. Kept as optional for forward-compat: a future customer.yaml
  # with a composio: connector backend can stage it, and the runtime guard still
  # accepts the prefix. No customer-zero code path consumes it.
  COMPOSIO_API_KEY
  # AGENTMAIL_API_KEY — the persona's own outbound mailbox identity (ADR 0005
  # reviewer-as-sender; ADR 0008). Deferred to Phase 2 multi-persona (ADR 0011)
  # and not yet implemented: no connector, OAuth flow, plugin, or skill code
  # reads it (cost_rollup.py only maps it as a future cost-driver category).
  # SMD customer-zero acts on the principal's Gmail via mcp:google-gmail, not an
  # agent mailbox, so requiring it blocked boot for no functional reason. Re-
  # require when a persona email identity is actually wired.
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
# Step 3: start Postgres (Honcho data store)
# ============================================================================
# Honcho stores conclusions/observations in Postgres. Data dir lives on the
# volume so it survives Machine restarts. Initialize on first boot; subsequent
# boots reuse the cluster. Postgres runs as the hermes user (uid 10000) — the
# image creates the data dir with hermes ownership.
PGDATA="/opt/data/honcho/pg"
PG_BIN="/usr/lib/postgresql/16/bin"
export PGDATA

if [ ! -s "${PGDATA}/PG_VERSION" ]; then
  log "Postgres data dir empty; running initdb (first boot)"
  mkdir -p "${PGDATA}"
  "${PG_BIN}/initdb" \
    --pgdata "${PGDATA}" \
    --username "honcho" \
    --auth-local "trust" \
    --auth-host "trust" \
    --encoding "UTF8" \
    --locale "C" \
    || die "Postgres initdb failed"
  # Listen on localhost only; no external exposure.
  cat >> "${PGDATA}/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = 5432
unix_socket_directories = '/tmp'
EOF
  log "Postgres cluster initialized"
fi

# Supervised start. pg_ctl backgrounds itself; we use postgres directly so
# tini sees the process. The supervise() wrapper keeps it alive.
supervise "postgres" "${PG_BIN}/postgres" -D "${PGDATA}"

# Health-wait. 30 attempts × 1s = 30s ceiling.
if ! wait_for "Postgres" 30 1 "${PG_BIN}/pg_isready" -h 127.0.0.1 -p 5432 -U honcho; then
  die "Postgres did not become ready within 30s"
fi

# Ensure the honcho database exists (createdb is idempotent via DO block).
"${PG_BIN}/psql" -h 127.0.0.1 -U honcho -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='honcho'" | grep -q 1 \
  || "${PG_BIN}/createdb" -h 127.0.0.1 -U honcho honcho \
  || die "Failed to create honcho database"
log "Postgres ready (database=honcho)"

# ============================================================================
# Step 4: start Redis (Honcho cache/queue)
# ============================================================================
# AOF persistence keeps Honcho's queue durable across restarts. Data dir lives
# on the volume.
REDIS_DIR="/opt/data/honcho/redis"
mkdir -p "${REDIS_DIR}"

supervise "redis" redis-server \
  --bind 127.0.0.1 \
  --port 6379 \
  --appendonly yes \
  --dir "${REDIS_DIR}" \
  --protected-mode no \
  --save ""

if ! wait_for "Redis" 30 1 redis-cli -h 127.0.0.1 -p 6379 ping; then
  die "Redis did not become ready within 30s"
fi
log "Redis ready"

# ============================================================================
# Step 5: Honcho schema migrations
# ============================================================================
# Idempotent — Honcho's migration runner is safe to re-run on every boot.
# Tuned config knobs from ADR 0016 are applied via env vars consumed by the
# Honcho process itself (set in step 6) and via the hermes-smd bootstrap
# translator in step 7 (writes them into each profile's memory-provider
# config). We export DB/Redis URLs here so the migration runner can find them.
export HONCHO_DB_URL="postgresql://honcho@127.0.0.1:5432/honcho"
export HONCHO_REDIS_URL="redis://127.0.0.1:6379/0"

log "Running Honcho schema migrations..."
python3 -m honcho.migrations \
  || die "Honcho schema migration failed"
log "Honcho migrations applied"

# ============================================================================
# Step 6: start Honcho FastAPI server
# ============================================================================
# Local-only on port 8000; the memory-mirror plugin in Hermes talks to it via
# 127.0.0.1.
supervise "honcho" python3 -m honcho.server \
  --host 127.0.0.1 \
  --port 8000

if ! wait_for "Honcho FastAPI" 60 1 curl -fsS http://127.0.0.1:8000/health; then
  die "Honcho FastAPI did not become healthy within 60s"
fi
log "Honcho FastAPI ready"

# ============================================================================
# Step 7: hermes-smd bootstrap (customer.yaml -> per-profile config)
# ============================================================================
# Installed at image build time via `pip install hermes-smd-overlay`. Reads
# /opt/data/customer.yaml, writes N profile directories under
# $HERMES_HOME/profiles/<slug>/ with config.yaml and SOUL.md. Each profile's
# memory-provider block is configured to talk to the local Honcho FastAPI
# with the ADR 0016 tuned knobs.
log "Running hermes-smd bootstrap (customer.yaml -> profiles)..."
hermes-smd bootstrap \
  --customer-yaml "${CUSTOMER_YAML}" \
  --hermes-home "${HERMES_HOME}" \
  --honcho-url "http://127.0.0.1:8000" \
  --honcho-api-key "${HONCHO_API_KEY}" \
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
# Step 10: customer-sync sidecar (R2 poller)
# ============================================================================
# Polls R2 at vaults/<slug>/customer.yaml every 5 minutes. On non-structural
# change: rewrites /opt/data/customer.yaml and signals Hermes (SIGHUP) to
# reload profile config. On structural change: logs warning + posts to admin
# portal, but does NOT restart (preserves OAuth tokens per ADR 0010).
log "Starting customer-sync sidecar (R2 polling every 300s)..."
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  hermes-smd customer-sync \
    --customer-yaml "${CUSTOMER_YAML}" \
    --r2-bucket "${R2_BUCKET_CONFIG}" \
    --r2-endpoint "${R2_ENDPOINT_URL}" \
    --interval 300 \
    &
SIDECAR_PID=$!
log "customer-sync sidecar pid=${SIDECAR_PID}"

# ============================================================================
# Step 11: launch Hermes (foreground under tini)
# ============================================================================
# Overlay plugins were installed at image build time and live under
# ~/.hermes/plugins/. The first profile in personas[] (the only one in v1 per
# the §7 validator) becomes the active session. `exec` so Hermes inherits
# PID-1-ish ownership under tini cleanly — tini still reaps the foundational
# children (Postgres, Redis, Honcho, sidecar) launched above.
#
# The legacy `PYTHONPATH=/app/adapter:...` export and AIE_* env vars were
# removed when the in-tree adapter retired. The overlay plugin surface
# (audit / trust / voice / memory-mirror / hook-probe) is the runtime path;
# customer.yaml + skills + connector wiring all resolve through the
# overlay's bootstrap CLI invoked above.
log "Launching Hermes (overlay plugins enabled)..."

exec /opt/hermes/.venv/bin/hermes chat
