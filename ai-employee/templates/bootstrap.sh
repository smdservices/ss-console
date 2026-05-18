#!/usr/bin/env bash
# bootstrap.sh — container entrypoint for the AI Employee customer instance
#
# Runs at container start. Validates env, resolves skill version pins from
# /app/customer.yaml, runs the safety-substrate invariant checks, then
# starts the Hermes agent loop under the AIEmployee adapter.
#
# Fails fast on any of:
#   - missing required env vars (secrets not set as Fly secrets)
#   - customer.yaml malformed or skill versions un-resolvable
#   - safety-substrate invariant test failures
#
# The substrate gate is non-negotiable: if any of the five invariants fail
# their fixtures, the agent does not start. This is the OpenClaw mitigation.

set -euo pipefail

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [bootstrap] $*"
}

die() {
  log "FATAL: $*"
  exit 1
}

CUSTOMER_SLUG="${CUSTOMER_SLUG:-}"
[ -n "${CUSTOMER_SLUG}" ] || die "CUSTOMER_SLUG env var is unset"

CUSTOMER_YAML="/app/customer.yaml"
[ -f "${CUSTOMER_YAML}" ] || die "customer.yaml missing at ${CUSTOMER_YAML}"

log "Starting bootstrap for customer: ${CUSTOMER_SLUG}"
log "Hermes SHA: $(cat /opt/hermes/HERMES_SHA 2>/dev/null || echo unknown)"

# ---------- Step 1: validate required env vars ----------
# Secrets are set via `fly secrets set` from provision-customer.sh.
# Never echo values; only check presence.
REQUIRED_ENV=(
  ANTHROPIC_API_KEY
  COMPOSIO_API_KEY
  AGENTMAIL_API_KEY
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
)

for var in "${OPTIONAL_ENV[@]}"; do
  if [ -n "${!var:-}" ]; then
    log "env check OK: ${var} present (optional)"
  else
    log "env check: ${var} not set (skill that needs Google OAuth will refuse)"
  fi
done

# ---------- Step 2: resolve skill version pins ----------
# customer.yaml's skills[] entries pin to a content-hash. We verify each
# pinned skill exists in /app/skills/ and matches the pinned hash. A pin
# mismatch is a deploy error — the customer is on a skill version we don't
# have in the image. Rollback or deploy a fresh image with the right SHAs.
log "Resolving skill version pins from customer.yaml..."
python3 /app/adapter/resolve_skill_pins.py "${CUSTOMER_YAML}" /app/skills \
  || die "Skill pin resolution failed; check customer.yaml versions vs /app/skills/ content"
log "Skill pins resolved OK"

# ---------- Step 3: run safety substrate invariant checks ----------
# Phase A.5 gate. The five invariants must hold across compaction, restart,
# tool failure, prompt injection, ceiling-escalation attempts. Re-runs on
# every container start so a Hermes SHA bump can't regress the floor.
log "Running safety substrate invariant checks (Phase A.5 gate)..."
if ! python3 /app/safety-substrate/run_invariants.py \
       --customer "${CUSTOMER_SLUG}" \
       --fixtures /app/safety-substrate/tests \
       --strict ; then
  die "Safety substrate invariant check FAILED — agent will not start. \
Inspect /app/safety-substrate/logs/$(date -u +%Y%m%d).log for which invariant failed."
fi
log "Safety substrate invariants PASSED"

# ---------- Step 4: pause guard ----------
# pause-customer.sh writes a sentinel at /opt/data/.paused. If present, we
# log and exit cleanly — keeps the machine running but agent loop dormant
# until the operator unpauses.
if [ -f /opt/data/.paused ]; then
  log "PAUSE sentinel present at /opt/data/.paused — agent will not start"
  log "Reason: $(cat /opt/data/.paused)"
  # Keep the container alive so `fly ssh console` still works; just don't run agent.
  exec tail -f /dev/null
fi

# ---------- Step 5: register AIEmployee adapter with Hermes ----------
# The adapter wraps Hermes' tool dispatch with the trust-ceiling enforcement
# layer. Skills declare their ceiling in SKILL.md frontmatter; the adapter
# enforces it on every tool call regardless of what the model prompt says.
log "Registering AIEmployee adapter..."
export PYTHONPATH="/app/adapter:/app:${PYTHONPATH:-}"
export AIE_CUSTOMER_YAML="${CUSTOMER_YAML}"
export AIE_SKILLS_DIR="/app/skills"
export AIE_CONNECTORS_DIR="/app/connectors"

# ---------- Step 6: start Hermes ----------
# Drop to the hermes user (uid 10000) via gosu, then exec the agent.
# The Hermes CLI loads skills from $HERMES_HOME/skills/ — bootstrap has
# already symlinked /app/skills/ into the customer's volume.
log "Symlinking skill library into HERMES_HOME..."
mkdir -p "${HERMES_HOME}/skills"
ln -sfn /app/skills/* "${HERMES_HOME}/skills/" 2>/dev/null || true

log "Starting Hermes agent loop..."
# Phase A: run Hermes without --adapter (the AIEmployee adapter is wired in
# Phase A.5 once trust-ceiling enforcement is implemented + tested). For now
# the agent runs with skill-declared ceilings but no code-level enforcement
# — this is acceptable for customer-zero only, not for any paying customer.
# Phase A.5 flips to: hermes run --config ... --adapter aiemployee
exec gosu hermes:hermes /opt/hermes/.venv/bin/hermes run \
  --config "${HERMES_HOME}/config.yaml"
