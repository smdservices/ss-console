#!/usr/bin/env bash
# provision-customer.sh — one command to stand up a customer's Hermes Machine
#
# Usage:
#   operator/bin/provision-customer.sh <slug>
#
# Reads operator/customers/<slug>/customer.yaml, validates it, uploads
# customer.yaml to R2 (so bootstrap.sh can fetch it on first boot — no more
# baking into the image per §6 of the build plan), renders
# operator/.rendered/<slug>/fly.toml (gitignored), creates the Fly app,
# provisions the volume (10GB — hosts customer.yaml + SQLite + voice cache;
# Phase 2 adds Postgres + Redis for Honcho), prompts Captain for secrets
# (pasted via pbpaste — values never appear in the chat transcript), deploys,
# then runs the boot smoke test (boot-smoke-test.sh) to verify the Hermes
# profile + plugin chain came up cleanly.
#
# CANONICAL INVOCATION (do not hunt for R2 creds — they are in Infisical /ss prod):
#   operator/bin/reprovision.sh <slug>
#   # which is exactly:
#   infisical run --env=prod --path=/ss --silent -- operator/bin/provision-customer.sh <slug>
# The R2_* below are injected by that `infisical run`. They were historically NOT
# stored anywhere (every agent re-derived them and lost ~2h); they are now in
# Infisical /ss and are derivable from CLOUDFLARE_API_TOKEN (id + sha256(value)).
# See docs/runbooks/operator/first-boot.md "R2 credentials".
#
# Operator prerequisites (injected by reprovision.sh; or set manually before running):
#   R2_ENDPOINT_URL        — Cloudflare R2 endpoint (https://<account>.r2.cloudflarestorage.com)
#   R2_ACCESS_KEY_ID       — R2 access key (operator-local, used for `aws s3 cp` upload)
#   R2_SECRET_ACCESS_KEY   — R2 secret (operator-local)
#   R2_BUCKET_CONFIG       — R2 bucket holding customer.yaml + voice vaults
#                            (defaults to "smd-customer-config" if unset)
#   CF_API_TOKEN           — Cloudflare API token with "Workers R2 Storage: Edit"
#                            scope at the account level. Used by ADR 0022 Stream 2
#                            to create the per-customer skill-bodies R2 bucket
#                            (ss-operator-<slug>-skills). Optional in dev —
#                            when unset, the script logs a warning and skips the
#                            bucket-create step (the operator can create it via
#                            the CF dashboard before re-running).
#   CF_ACCOUNT_ID          — Cloudflare account ID (32-char hex). Required when
#                            CF_API_TOKEN is set; ignored otherwise.
#
# Observability (ADR 0023 Wave 1) prerequisites:
#   SENTRY_DSN_OPERATOR         — smd-operator project DSN, staged to Fly under
#                                 the Machine name SENTRY_DSN so the Python
#                                 sentry-sdk init picks it up (overlay PR O1).
#                                 Pulled from operator env. Deliberately NOT
#                                 sourced from SENTRY_DSN (that key is ss-web's).
#   MACHINE_HEARTBEAT_KEY       — shared bearer for POST /api/internal/heartbeat
#                                 (Wave 1 single-key model per ADR 0023 §10).
#                                 SAME value as the Cloudflare Worker secret on
#                                 ss-web; staged to every Machine.
#   HEALTHCHECKS_API_KEY        — healthchecks.io project API key. Used to
#                                 create the per-customer check during
#                                 provisioning, and to cancel it during
#                                 decommission. Optional in dev — when unset,
#                                 the script logs a warning and skips the
#                                 healthchecks.io step (allows local dry runs
#                                 without a live account).
#
# The same R2_* values get pushed into the Machine as Fly secrets so bootstrap.sh
# can pull customer.yaml back out. The operator's local R2 creds and the
# Machine's R2 creds may be the same credential or different ones — they live
# in different scopes.
#
# Idempotent: safe to re-run. If `fly apps create` finds the app already
# exists, the script moves on; if secrets are already set, it skips
# (unless --rotate is passed).

set -euo pipefail

SLUG="${1:-}"
[ -n "${SLUG}" ] || { echo "Usage: $0 <customer-slug>" >&2; exit 1; }

# Validate the slug charset as the FIRST action (issue #1127). The slug flows
# into filesystem paths, central-D1 SQL, a sed RHS, a python -c program, and
# R2 keys below — all before the customer_id==SLUG equality check. Constraining
# it to a DNS-style label (no quotes, slashes, ampersands, or shell
# metacharacters) closes the SQL-injection / sed-corruption / RCE vectors at
# the source.
#
# CANONICAL SLUG PATTERN (#2285) — the runtime's, because it is the strictest
# and it is the one that decides whether a seat can boot at all. Four sites
# used to carry four different patterns, and the LOOSEST of them
# (`^[a-z0-9-]+$`, in the CI publisher/syncer) was the one that wrote to R2 and
# D1. A slug like `acme-` or a single character therefore provisioned,
# published, and projected, then died at boot inside
# operator/adapter/namespace_assertion.py as what that file calls "a
# bootstrap-time invariant failure". Every site now enforces the same shape:
# lowercase alphanumerics + dashes, 2-40 chars, no leading or trailing dash.
# Keep these in step — tests/customer-slug-pattern.test.ts runs one candidate
# table through all of them and fails the moment two disagree.
if [[ ! "${SLUG}" =~ ^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$ ]]; then
  echo "invalid slug '${SLUG}' (must match ^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$)" >&2
  exit 2
fi

# Export SLUG so inline python subprocesses inherit it. The healthchecks.io step
# (added #1993) reads os.environ['SLUG'] and a shell positional is NOT in a
# child's env otherwise — KeyError('SLUG') aborted every reprovision fleet-wide.
# Validated above, so exporting is safe.
export SLUG

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CUSTOMER_DIR="${REPO_ROOT}/operator/customers/${SLUG}"
CUSTOMER_YAML="${CUSTOMER_DIR}/customer.yaml"
TEMPLATE_DIR="${REPO_ROOT}/operator/templates"
RENDERED_DIR="${REPO_ROOT}/operator/.rendered/${SLUG}"
BIN_DIR="${REPO_ROOT}/operator/bin"

[ -d "${CUSTOMER_DIR}" ] || { echo "FATAL: ${CUSTOMER_DIR} not found"; exit 1; }
[ -f "${CUSTOMER_YAML}" ] || { echo "FATAL: ${CUSTOMER_YAML} missing"; exit 1; }

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [provision/${SLUG}] $*"; }
die() { log "FATAL: $*"; exit 1; }

# ---------- Step 0-: the build source is what you think it is ----------
#
# REPO_ROOT is derived from THIS SCRIPT'S OWN LOCATION, so the image is built
# from whichever checkout you invoked — not from a canonical one. That is easy
# to state and easy to forget, because runbooks, muscle memory, and shell
# history all say `~/dev/ss-console/operator/bin/reprovision.sh` while an
# agent's verified work is usually sitting in a worktree under
# `.claude/worktrees/`.
#
# WHAT THIS COSTS WHEN IT GOES WRONG (2026-07-31). The primary checkout sat two
# commits behind origin/main carrying thirty staged entries that reverted a
# whole merged programme — the config publisher, both CI guards, a migration,
# the Dockerfile and entrypoint changes — with OVERLAY_REF still on the previous
# pin. A reprovision in that state builds an image containing none of the work,
# pins the wrong overlay, and EXITS ZERO. Every observation taken afterwards is
# then a true statement about the wrong artifact, which is worse than a failure,
# because a failure gets investigated and a green run gets believed.
#
# So: refuse by default, and print the resolved source on every run so a
# reprovision can never leave doubt about which tree produced the image.
# Escape hatch is deliberate, named, and loud — the same shape as
# SS_ALLOW_PRIMARY_WRITES and SS_ALLOW_UNREAD_ENGAGEMENT_WRITES.
assert_build_source_is_current() {
  log "Build source: ${REPO_ROOT}"

  if ! git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
    log "WARN: ${REPO_ROOT} is not a git checkout; source currency cannot be verified"
    return 0
  fi

  local head_sha upstream_sha dirty behind pin manifest_pin
  head_sha="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
  log "Build source HEAD: ${head_sha}"

  # A stale index reverting merged work is exactly the incident above, and it
  # presents as ordinary dirt. Report the paths — "dirty" alone sends people
  # looking for their own edits rather than at a damaged index.
  #
  # `.claude/` is excluded, and ONLY `.claude/`. It holds agent session markers
  # and the worktrees themselves, so it is dirty in essentially every working
  # checkout; it is in `.dockerignore` and no COPY in the Dockerfile names it,
  # so it cannot reach the image this guard protects. On the guard's FIRST real
  # use it refused a rebuild over a lone `parallel-isolation-required-<uuid>`
  # marker (#2101). That matters more than the nuisance: a guard that trips on
  # ordinary working conditions teaches people to reach for
  # SS_ALLOW_DIVERGENT_SOURCE by reflex, and a reflexive bypass is worse than no
  # guard — it is one everybody believes is protecting them while it is waved
  # through unread. Reaching for the flag has to stay a decision.
  #
  # Narrow ON PURPOSE. The tempting widening is "exclude whatever .dockerignore
  # excludes", which is wrong: an untracked source file elsewhere in the tree
  # genuinely can change the image, and .dockerignore also excludes paths whose
  # presence in git still matters. `.claude/` is the one directory that is
  # session state by definition — the repo already treats it specially, since
  # .claude/hooks/worktree-guard.mjs exempts it from the read-only primary rule
  # for exactly this reason.
  #
  # The pattern anchors to porcelain's `XY ` prefix (two status chars plus a
  # space) so it matches a top-level `.claude/` and not some nested
  # `src/.claude/` that would be a genuine surprise worth refusing.
  # `|| true` is load-bearing: grep exits 1 when it emits nothing, which under
  # `set -euo pipefail` aborts the script on a CLEAN tree — the guard would kill
  # every well-formed build while letting dirty ones through to the next check.
  dirty="$(git -C "${REPO_ROOT}" status --porcelain 2>/dev/null | grep -v '^...\.claude/' || true)"
  dirty="$(printf '%s' "${dirty}" | head -20)"
  if [ -n "${dirty}" ] && [ "${SS_ALLOW_DIVERGENT_SOURCE:-}" != "1" ]; then
    echo "${dirty}" >&2
    die "build source ${REPO_ROOT} has uncommitted changes (above). An image built from a \
dirty tree is not the code you reviewed. Commit, stash, or reset it — or set \
SS_ALLOW_DIVERGENT_SOURCE=1 if you deliberately mean to build from these exact bytes."
  fi

  # Non-fatal: an offline operator should not be blocked, but they should know
  # the comparison below is against whatever origin/main was last fetched.
  git -C "${REPO_ROOT}" fetch origin --quiet 2>/dev/null \
    || log "WARN: could not fetch origin; comparing against the last-known origin/main"

  if git -C "${REPO_ROOT}" rev-parse --verify origin/main >/dev/null 2>&1; then
    upstream_sha="$(git -C "${REPO_ROOT}" rev-parse --short origin/main)"
    behind="$(git -C "${REPO_ROOT}" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
    if [ "${behind}" != "0" ] && [ "${SS_ALLOW_DIVERGENT_SOURCE:-}" != "1" ]; then
      die "build source is ${behind} commit(s) behind origin/main (HEAD ${head_sha}, \
origin/main ${upstream_sha}). Whatever landed in those commits will NOT be in this image. \
Update it, or set SS_ALLOW_DIVERGENT_SOURCE=1 to build this ref on purpose."
    fi
  fi

  # The vitest drift gate proves these agree at MERGE time. Nothing proved it at
  # BUILD time, which is the only moment it protects an actual image.
  pin="$(sed -n 's/^ARG OVERLAY_REF="\([0-9a-f]*\)".*/\1/p' "${TEMPLATE_DIR}/Dockerfile" | head -1)"
  manifest_pin="$(sed -n 's/.*"overlayRef"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' \
    "${REPO_ROOT}/operator/contracts/overlay-pairs.json" | head -1)"
  if [ -n "${pin}" ] && [ -n "${manifest_pin}" ] && [ "${pin}" != "${manifest_pin}" ]; then
    die "OVERLAY_REF mismatch: Dockerfile pins ${pin}, overlay-pairs.json pins ${manifest_pin}. \
The image would ship an overlay the pair manifest does not describe."
  fi
  [ -n "${pin}" ] && log "Overlay pin: ${pin}"

  if [ "${SS_ALLOW_DIVERGENT_SOURCE:-}" = "1" ]; then
    log "WARN: SS_ALLOW_DIVERGENT_SOURCE=1 — source currency checks bypassed BY REQUEST. \
The image is being built from ${REPO_ROOT} at ${head_sha} exactly as it stands."
  fi
}

assert_build_source_is_current

# ---------- Step 0: verify operator R2 credentials ----------
# These live in the operator's local shell (e.g., direnv / .envrc); they are
# used by `aws s3 cp` for the customer.yaml upload below. The same logical
# credentials (or scoped versions of them) are pushed to Fly secrets so the
# Machine can fetch from R2 at boot — but those are set via pbpaste below,
# not echoed here.
R2_BUCKET_CONFIG="${R2_BUCKET_CONFIG:-smd-customer-config}"
# If these are unset you almost certainly ran this script directly instead of
# through the wrapper. The creds are in Infisical /ss prod — do NOT re-derive them.
R2_HINT="R2 creds missing. Run via: operator/bin/reprovision.sh ${SLUG}  (= infisical run --env=prod --path=/ss -- operator/bin/provision-customer.sh ${SLUG}). They live in Infisical /ss prod; see docs/runbooks/operator/first-boot.md."
[ -n "${R2_ENDPOINT_URL:-}" ] || die "R2_ENDPOINT_URL not set. ${R2_HINT}"
[ -n "${R2_ACCESS_KEY_ID:-}" ] || die "R2_ACCESS_KEY_ID not set. ${R2_HINT}"
[ -n "${R2_SECRET_ACCESS_KEY:-}" ] || die "R2_SECRET_ACCESS_KEY not set. ${R2_HINT}"
command -v aws >/dev/null 2>&1 || die "aws CLI not found (required for R2 customer.yaml upload)"
command -v pbpaste >/dev/null 2>&1 || die "pbpaste not found (macOS-only; required for secret entry flow)"

# ---------- Step 0.5: R2 config key ----------
# git is the single source of truth for customer.yaml; provisioning projects
# it to R2 unconditionally (Step 2), and bootstrap.sh fetches this key at boot.
R2_CONFIG_KEY="vaults/${SLUG}/customer.yaml"

# ---------- Step 1: validate customer.yaml ----------
# The canonical pre-merge gate is the TS validator in
# src/lib/operator/customer-yaml/ (per ADR 0019). The retired in-tree
# Python validator (operator/adapter/validate_customer_yaml.py) was on a
# stale schema (looked for top-level skills[] instead of personas[].skills[])
# and missed real shape violations. The TS validator catches both nesting
# and enum violations — see operator/fixtures/validator-regression/ for
# the guardrail fixtures.
#
# The overlay's bootstrap/validate.py (venturecrane/hermes-smd-overlay) is
# the runtime re-check that fires inside the customer Machine at boot.
log "Validating customer.yaml..."
( cd "${REPO_ROOT}" && npx --quiet tsx scripts/validate-customer-yaml.ts "${CUSTOMER_YAML}" ) \
  || die "customer.yaml validation failed; see errors above"
log "customer.yaml OK"

# Extract fields we need (uses python3 to avoid yq dependency)
PARSE_PY="
import sys, yaml
with open('${CUSTOMER_YAML}') as f:
    c = yaml.safe_load(f)
m = c.get('machine', {})
print(c['customer_id'])
print(c['fly_region'])
print(m.get('size', 'shared-cpu-2x'))
print(m.get('memory_mb', 2048))
print(c.get('hermes_ref', 'v2026.7.1@7c1a029553d87c43ecff8a3821336bc95872213b'))
"
# Portable line-array read (macOS bash 3.2 doesn't have mapfile)
FIELDS=()
while IFS= read -r _line; do
  FIELDS+=("${_line}")
done < <(uv run --quiet --with pyyaml python3 -c "${PARSE_PY}")
CUSTOMER_ID="${FIELDS[0]}"
FLY_REGION="${FIELDS[1]}"
MACHINE_SIZE="${FIELDS[2]}"
MEMORY_MB="${FIELDS[3]}"
HERMES_REF="${FIELDS[4]}"

[ "${CUSTOMER_ID}" = "${SLUG}" ] || die "customer.yaml customer_id (${CUSTOMER_ID}) does not match slug (${SLUG})"
APP_NAME="hermes-${SLUG}"

log "App: ${APP_NAME} · region: ${FLY_REGION} · machine: ${MACHINE_SIZE}/${MEMORY_MB}MB · hermes: ${HERMES_REF}"

# ---------- Step 1b: split the upstream pin into tag + SHA (ADR 0024) ----------
# hermes_ref pins upstream Hermes as v{YYYY}.{M}.{D}@{40-hex-sha}. The tag
# before '@' is the clone target; the SHA after '@' is the immutable pin the
# Dockerfile asserts the cloned HEAD against. Because the SHA travels in the
# ref itself, we do NOT resolve it from a live upstream lookup here (this is
# the availability fix in ADR 0024 — provisioning no longer phones a second
# repo). The venturecrane/hermes-agent fork was retired by ADR 0024; the
# Dockerfile clones NousResearch/hermes-agent directly.
HERMES_UPSTREAM_TAG="${HERMES_REF%@*}"
HERMES_UPSTREAM_SHA="${HERMES_REF#*@}"
[ "${HERMES_UPSTREAM_TAG}" != "${HERMES_REF}" ] || die "hermes_ref ${HERMES_REF} is missing the @<sha> pin; expected v{YYYY}.{M}.{D}@{40-hex-sha} per ADR 0024"
[ "${#HERMES_UPSTREAM_SHA}" -eq 40 ] || die "hermes_ref SHA has unexpected length (got ${#HERMES_UPSTREAM_SHA}, expected 40): ${HERMES_UPSTREAM_SHA}"
case "${HERMES_UPSTREAM_SHA}" in *[!0-9a-f]*) die "hermes_ref SHA must be lowercase hex: ${HERMES_UPSTREAM_SHA}" ;; esac
log "Hermes upstream pin: ${HERMES_UPSTREAM_TAG} @ ${HERMES_UPSTREAM_SHA}"

# ---------- Step 2: upload customer.yaml to R2 ----------
# bootstrap.sh fetches this from R2 on first boot and writes it to
# /opt/data/customer.yaml. Doing the upload BEFORE the Fly deploy means the
# first Machine boot can succeed (otherwise the boot would race against a
# missing config). The customer-sync sidecar (from the overlay bootstrap/
# package) polls this same key for non-structural updates.
log "Uploading customer.yaml to R2: s3://${R2_BUCKET_CONFIG}/${R2_CONFIG_KEY}"
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 cp "${CUSTOMER_YAML}" "s3://${R2_BUCKET_CONFIG}/${R2_CONFIG_KEY}" \
    --endpoint-url "${R2_ENDPOINT_URL}" \
    --only-show-errors \
  || die "R2 upload failed; bootstrap.sh would not be able to fetch customer.yaml"
log "R2 upload OK"

# ---------- Step 3: render fly.toml ----------
log "Rendering fly.toml..."
mkdir -p "${RENDERED_DIR}"
# Per-customer skill bodies bucket name (ADR 0022 Stream 2). One bucket per
# customer; the bucket itself is the trust boundary. Bucket-scoped access
# keys are entered via the secret-paste flow below; the bucket name is
# rendered into fly.toml [env] (not a credential, just a string).
R2_SKILL_BODIES_BUCKET="ss-operator-${SLUG}-skills"
sed -e "s/{{CUSTOMER_SLUG}}/${SLUG}/g" \
    -e "s/{{FLY_REGION}}/${FLY_REGION}/g" \
    -e "s/{{MACHINE_SIZE}}/${MACHINE_SIZE}/g" \
    -e "s/{{MEMORY_MB}}/${MEMORY_MB}/g" \
    -e "s/{{HERMES_REF}}/${HERMES_REF}/g" \
    -e "s/{{HERMES_UPSTREAM_TAG}}/${HERMES_UPSTREAM_TAG}/g" \
    -e "s/{{HERMES_UPSTREAM_SHA}}/${HERMES_UPSTREAM_SHA}/g" \
    -e "s|{{R2_BUCKET_CONFIG}}|${R2_BUCKET_CONFIG}|g" \
    -e "s|{{R2_SKILL_BODIES_BUCKET}}|${R2_SKILL_BODIES_BUCKET}|g" \
    "${TEMPLATE_DIR}/fly.toml.template" > "${RENDERED_DIR}/fly.toml"
log "Rendered to ${RENDERED_DIR}/fly.toml"

# ---------- Step 4: create Fly app (idempotent) ----------
log "Creating Fly app (idempotent)..."
if fly apps list --json | python3 -c "import sys, json; sys.exit(0 if '${APP_NAME}' in [a['Name'] for a in json.load(sys.stdin)] else 1)"; then
  log "App ${APP_NAME} exists; skipping create"
else
  fly apps create "${APP_NAME}" --org personal
fi

# ---------- Step 5: create volume (idempotent, 10GB) ----------
# Volume hosts: customer.yaml (R2-mirrored copy), audit.db SQLite, Hermes
# profiles + flat-file memory (MEMORY.md/USER.md) under /opt/data/profiles/,
# voice samples cache, OAuth token files (ADR 0010). Phase 2 adds Postgres +
# Redis (Honcho) + observations.db. 10GB is the floor (was 1GB pre-§6);
# per-customer fixed disk pressure should not be a thing we manage per customer.
log "Creating persistent volume (idempotent, 10GB)..."
# Count existing hermes_state volumes with a real JSON parse. The prior check
# grepped for '"name":"hermes_state"', which NEVER matched — `fly volumes list
# --json` pretty-prints '"name": "hermes_state"' WITH a space after the colon —
# so every (re)provision silently minted a fresh, unattached 10GB orphan volume.
# Fail closed: if volumes cannot be enumerated, refuse to create rather than risk
# yet another orphan.
VOL_COUNT="$(fly volumes list -a "${APP_NAME}" --json 2>/dev/null | python3 -c '
import sys, json
try:
    vols = json.load(sys.stdin)
except Exception:
    sys.exit(2)
print(sum(1 for v in vols if isinstance(v, dict) and v.get("name") == "hermes_state"))
')" || VOL_COUNT="ERR"
if [ "${VOL_COUNT}" = "ERR" ]; then
  die "could not enumerate volumes for ${APP_NAME}; refusing to create a possibly-duplicate volume"
elif [ "${VOL_COUNT}" -ge 1 ]; then
  log "Volume hermes_state exists (${VOL_COUNT}); skipping create"
else
  fly volumes create hermes_state --size 10 --region "${FLY_REGION}" -a "${APP_NAME}" --yes
fi

# ---------- Step 5b: create per-customer skill-bodies R2 bucket (ADR 0022 Stream 2) ----------
# Per Captain decision (2026-05-27): one R2 bucket per customer for agent-
# authored skill body persistence. The bucket name is deterministic
# (ss-operator-<slug>-skills); creation is idempotent via CF API.
#
# If CF_API_TOKEN / CF_ACCOUNT_ID are unset, the script logs a warning and
# skips the create step — the operator must create the bucket manually via
# the CF dashboard before the Machine boots. Future agent-authored skills
# would otherwise fail the write-ahead R2 PUT and surface as r2_status='failed'
# in the per-customer agent_skills_inventory.
if [ -n "${CF_API_TOKEN:-}" ] && [ -n "${CF_ACCOUNT_ID:-}" ]; then
  log "Creating per-customer R2 bucket: ${R2_SKILL_BODIES_BUCKET}"
  CF_BUCKET_RESPONSE=$(curl -sS -X POST \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${R2_SKILL_BODIES_BUCKET}\"}" 2>&1 || true)
  if echo "${CF_BUCKET_RESPONSE}" | grep -q '"success":true'; then
    log "R2 bucket created: ${R2_SKILL_BODIES_BUCKET}"
  elif echo "${CF_BUCKET_RESPONSE}" | grep -q '"code":10004'; then
    # Cloudflare error 10004 = bucket already exists. Idempotent re-run is fine.
    log "R2 bucket ${R2_SKILL_BODIES_BUCKET} already exists; skipping create"
  else
    # Any other error — log but don't die. The operator can create manually
    # and re-run; the secret-paste prompts below will still capture the
    # bucket-scoped credentials.
    log "WARN: R2 bucket create did not succeed. Response: ${CF_BUCKET_RESPONSE}"
    log "WARN: Create the bucket manually via the CF dashboard before the Machine boots."
  fi
else
  log "WARN: CF_API_TOKEN or CF_ACCOUNT_ID not set; skipping R2 bucket auto-create."
  log "WARN: Create '${R2_SKILL_BODIES_BUCKET}' via the CF dashboard before the Machine boots."
fi

# ---------- Step 6: set secrets (paste flow; never echo values) ----------
log "Setting secrets via pbpaste flow..."
log "For each prompt: copy the secret to your clipboard, then press Enter."
log "Values flow directly into 'fly secrets import' — never appear in this terminal or any chat transcript."

prompt_and_set() {
  local secret_name="$1"
  local description="$2"
  # Agent / non-interactive path FIRST: when the secret is already present in
  # the operator env (reprovision.sh runs this under `infisical run --path=/ss`,
  # which injects every /ss key as an env var), stage it from there — no
  # clipboard, no prompt. This is what lets an agent run the provisioner: the
  # values flow vault -> env -> `fly secrets import` and never touch a terminal
  # or transcript. Closes the recurring "agents can't paste, re-derive for 2h"
  # trap reprovision.sh documents. A human with the secret only on their
  # clipboard (not in /ss) falls through to the prompt below.
  local env_value="${!secret_name:-}"
  if [ -n "${env_value}" ]; then
    printf '%s=%s\n' "${secret_name}" "${env_value}" \
      | fly secrets import --stage -a "${APP_NAME}" >/dev/null
    log "Staged ${secret_name} from operator env (value never logged)"
    return 0
  fi
  echo ""
  echo "  >> Copy ${description} to clipboard, then press Enter to stage ${secret_name} (or 's' to skip)"
  read -r response
  if [ "${response}" = "s" ]; then
    log "Skipping ${secret_name}"
    return 0
  fi
  # Secret value reaches Fly via stdin only — KEY=VALUE never appears on the
  # command line, so it doesn't leak via ps/proc/cmdline. See
  # feedback_never_expose_secrets_in_tool_output.md.
  printf '%s=%s\n' "${secret_name}" "$(pbpaste)" \
    | fly secrets import --stage -a "${APP_NAME}" >/dev/null
  log "Staged ${secret_name}"
}

# stage_secret_from_env: stage NAME from a value already in the operator env
# (Infisical /ss via `infisical run`), warn-and-skip when unset. Defined here so
# both Step 6 (R2 skill-bodies) and Step 6b (observability / connector) can use
# it — bash needs the definition before the first call.
stage_secret_from_env() {
  local secret_name="$1"
  local env_value="$2"
  local description="$3"
  if [ -z "${env_value:-}" ]; then
    log "WARN: ${secret_name} not set in operator env (${description}) — skipping stage"
    return 0
  fi
  printf '%s=%s\n' "${secret_name}" "${env_value}" \
    | fly secrets import --stage -a "${APP_NAME}" >/dev/null
  log "Staged ${secret_name} (value never logged)"
}

# Required secrets per bootstrap.sh.
# AGENTMAIL_API_KEY removed 2026-05-29: the persona's own outbound mailbox
# identity (ADR 0005 / ADR 0008) is deferred to Phase 2
# multi-persona (ADR 0011) and not yet implemented — no connector, OAuth flow,
# plugin, or skill code reads it (cost_rollup.py only maps it as a future
# cost-driver category). bootstrap.sh moved it to OPTIONAL_ENV in lockstep.
# This prompt was dead provisioning ceremony; customers act on real mailboxes
# via mcp:google-gmail / ms-graph, not an agent mailbox. Re-add when a persona
# email identity is actually wired.
# ANTHROPIC_API_KEY: prefer the per-seat WORKSPACE key from /ss (ADR 0062 §2 —
# per-customer Anthropic workspaces are the cost-attribution boundary; the
# usage-report ingest groups by workspace_id). Same per-seat convention as
# WEBHOOK_SECRET_AGENTMAIL__<CUSTOMER_ID> below. Falls back to the interactive
# clipboard prompt when no per-seat key is vaulted (pre-workspace seats), which
# reprovision runs answer 's' to — leaving the Machine's existing key in place.
_ANTH_SEAT_KEY_NAME="ANTHROPIC_API_KEY__$(printf '%s' "${CUSTOMER_ID}" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
_ANTH_SEAT_KEY="${!_ANTH_SEAT_KEY_NAME:-}"
if [ -n "${_ANTH_SEAT_KEY}" ]; then
  stage_secret_from_env ANTHROPIC_API_KEY "${_ANTH_SEAT_KEY}" "per-seat Anthropic workspace key (${_ANTH_SEAT_KEY_NAME})"
else
  prompt_and_set ANTHROPIC_API_KEY  "Anthropic API key for hermes-${SLUG}"
fi

# R2 access for bootstrap.sh's customer.yaml fetch + customer-sync sidecar's
# polling for non-structural config changes. R2_BUCKET_CONFIG is in fly.toml
# [env] (it's the bucket name, not a credential); the keys are secrets.
prompt_and_set R2_ACCESS_KEY_ID     "R2 access key ID (Machine-scoped, R/W on s3://${R2_BUCKET_CONFIG}/vaults/${SLUG}/)"
prompt_and_set R2_SECRET_ACCESS_KEY "R2 secret access key (paired with R2_ACCESS_KEY_ID above)"
prompt_and_set R2_ENDPOINT_URL      "R2 endpoint URL (Cloudflare account R2 endpoint)"

# ADR 0022 Stream 2 — skill-bodies bucket R2 credentials. OPTIONAL + FAIL-SOFT,
# and the account-wide fallback is REMOVED (OP-P0-2,
# docs/security/operator-threat-model.md). These vars remain in the agent process
# env (skill_capture.py writes agent-authored SKILL bodies in-process), so they
# must NEVER be the account-wide R2 pair (R/W on every bucket in the account) —
# that would put a cross-tenant crown jewel in the agent env, reachable by any
# injection. The earlier posture silently defaulted them to that account-wide
# pair; that default is GONE.
#
# Staged ONLY when a genuinely bucket-scoped token is present in Infisical /ss
# (env=prod). When absent (the default — e.g. customer-zero, whose agent runs
# fixed repo skills and authors none), nothing is staged: skill_capture resolves
# no R2 config and NO-OPS (load_r2_config_from_env -> None), so the agent simply
# does not persist agent-authored skills. No new key is created to close OP-P0-2;
# the over-broad key is removed instead. If an engagement later turns on
# agent-authored skill persistence, mint ONE bucket-scoped token (read+write on
# ${R2_SKILL_BODIES_BUCKET} only) and add it to /ss — no code change. NEVER the
# account-wide pair.
# CONVERGENT (not just "don't stage"): a prior provisioning defaulted these to the
# account-wide pair and they are already DEPLOYED on existing Machines (verified:
# R2_SKILL_BODIES_* share the exact secret digest of R2_ACCESS_KEY_ID/SECRET on
# customer-zero). So when no scoped token is authored we must actively UNSET them,
# or the account-wide key lingers in the agent env across reprovisions. `fly
# secrets unset --stage` is a no-op when the secret isn't set.
if [ -n "${R2_SKILL_BODIES_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SKILL_BODIES_SECRET_ACCESS_KEY:-}" ]; then
  stage_secret_from_env R2_SKILL_BODIES_ACCESS_KEY_ID \
    "${R2_SKILL_BODIES_ACCESS_KEY_ID}" \
    "bucket-scoped R2 access key ID for ${R2_SKILL_BODIES_BUCKET} (never the account-wide pair)"
  stage_secret_from_env R2_SKILL_BODIES_SECRET_ACCESS_KEY \
    "${R2_SKILL_BODIES_SECRET_ACCESS_KEY}" \
    "bucket-scoped R2 secret access key for ${R2_SKILL_BODIES_BUCKET} (never the account-wide pair)"
else
  log "R2_SKILL_BODIES_* not authored in /ss — removing any stale value from the Machine so the account-wide key cannot linger in the agent env (agent-authored skill persistence stays off; OP-P0-2)"
  fly secrets unset --stage -a "${APP_NAME}" \
    R2_SKILL_BODIES_ACCESS_KEY_ID R2_SKILL_BODIES_SECRET_ACCESS_KEY >/dev/null 2>&1 \
    || log "R2_SKILL_BODIES_* already absent on the Machine (nothing to unset)"
fi

# HONCHO_API_KEY — DEFERRED to Phase 2 (ADR 0016 revised). No in-Machine Honcho
# server is provisioned in Phase 1, so there is no shared secret to generate.
# Phase 2 reintroduces this when it vendors the real plastic-labs/honcho source.

# ---------- Step 6b: observability secrets (ADR 0023 Wave 1) ----------
# These come from operator env (Infisical-staged in Captain's shell), not
# pbpaste — there's nothing user-specific about them and they should not
# require manual paste per customer.
#
#   SENTRY_DSN_OPERATOR     — single value shared across all Machines: the
#                             smd-operator project's DSN; tenant tag scopes
#                             events per customer at SDK init. Staged onto the
#                             Machine under the name SENTRY_DSN (what
#                             shared/sentry_init.py reads). NEVER source this
#                             from plain SENTRY_DSN: that /ss key is the
#                             ss-web console Worker's DSN (wrangler secret
#                             bulk ships it), and sourcing it here silently
#                             routed every seat's events into the ss-web
#                             project — found 2026-08-02 by the #2150 runtime
#                             kill-test (vfy_01KZ1T07TGPKZ61M6KV97KMXQ6). One
#                             key with two consumers in different projects is
#                             the bug; the split name is the fix.
#   MACHINE_HEARTBEAT_KEY   — single value shared across the fleet for
#                             Wave 1. SAME key the Cloudflare Worker
#                             receives; Wave 1's auth is "you know the
#                             key + you carry an X-Tenant-Slug header."
#                             Per-tenant upgrade path documented in
#                             ADR 0023 §"Cross-cutting calls" #10.
#
# Missing either is non-fatal in dev (warn + skip); in prod the Machine's
# Sentry init silently no-ops and heartbeat POSTs will 401 — both visible
# as "no signal yet" on the admin dashboard, which is the empty-state we
# want anyway.
stage_secret_from_env SENTRY_DSN            "${SENTRY_DSN_OPERATOR:-}"   "smd-operator project DSN (from SENTRY_DSN_OPERATOR; never the console's SENTRY_DSN)"
stage_secret_from_env MACHINE_HEARTBEAT_KEY "${MACHINE_HEARTBEAT_KEY:-}" "shared bearer for POST /api/internal/heartbeat"

# OPERATOR_RUNTIME_READ_KEY — PER-CUSTOMER bearer for the console→Machine runtime
# read endpoint (ADR 0043 path A). Unlike the shared heartbeat key, this is
# derived per customer: key = HMAC-SHA256(OPERATOR_RUNTIME_READ_SECRET, customer_id).
# The master (OPERATOR_RUNTIME_READ_SECRET) lives ONLY on ss-web; each Machine
# holds only its own derived key, so a key extracted from one Machine cannot read
# another. The console derives the SAME value via WebCrypto
# (src/lib/operator/runtime-read-transport.ts → deriveRuntimeReadKey); the HMAC
# input MUST be byte-identical — the slug string with NO trailing newline
# (printf '%s'), matching the TS TextEncoder. This exact command is pinned by
# tests/runtime-read-transport.test.ts ("cross-side") so the two never drift.
if [ -n "${OPERATOR_RUNTIME_READ_SECRET:-}" ]; then
  _rt_key="$(printf '%s' "${SLUG}" | openssl dgst -sha256 -hmac "${OPERATOR_RUNTIME_READ_SECRET}" | sed 's/^.*= //')"
  stage_secret_from_env OPERATOR_RUNTIME_READ_KEY "${_rt_key}" "per-customer runtime read bearer (ADR 0043 A)"
  unset _rt_key
else
  log "WARN: OPERATOR_RUNTIME_READ_SECRET not set in operator env — skipping runtime read key (runtime drill-ins stay empty for this Machine)"
fi

# WEBHOOK_SECRET_MCP — per-customer bearer for the console→Machine async handoff
# endpoint (/webhooks/handoff, ADR 0043 Phase 2). Same derivation as the runtime
# read key: HMAC-SHA256(OPERATOR_MCP_WEBHOOK_SECRET, slug), printf '%s' (no
# newline), matching src/lib/operator/mcp/webhook-transport.ts → deriveRuntimeReadKey.
# The console sends the derived bearer; the Machine verifies it. Gate also re-uses
# it as WEBHOOK_SECRET_HANDOFF so the internal Hermes adapter can re-verify the
# forwarded hop.
if [ -n "${OPERATOR_MCP_WEBHOOK_SECRET:-}" ]; then
  _mcp_key="$(printf '%s' "${SLUG}" | openssl dgst -sha256 -hmac "${OPERATOR_MCP_WEBHOOK_SECRET}" | sed 's/^.*= //')"
  stage_secret_from_env WEBHOOK_SECRET_MCP     "${_mcp_key}" "per-customer MCP handoff bearer (Phase 2)"
  stage_secret_from_env WEBHOOK_SECRET_HANDOFF "${_mcp_key}" "Hermes adapter re-verify secret for the handoff route (= WEBHOOK_SECRET_MCP)"
  unset _mcp_key
else
  log "WARN: OPERATOR_MCP_WEBHOOK_SECRET not set in operator env — skipping MCP handoff key (operator_handoff_task returns not_configured)"
fi

# ---------- Step 6b-clio: connector secrets (law vertical + Google DWD) ----------
# Staged from operator env (Infisical /ss, injected by reprovision.sh's
# `infisical run --path=/ss`), same no-paste pattern as observability. Each is
# warn+skip when unset, so a customer that doesn't use a given connector still
# provisions cleanly.
#
# Clio (mcp:clio-oktopeak): client_id/secret authenticate the OAuth app; the
# encryption key decrypts the seed token; CLIO_TOKENS_ENC_B64 is the base64 of
# ~/.clio-mcp/tokens.enc captured at off-box consent (bootstrap.sh Step 2d seeds
# it; the overlay materializer reads id/secret/key into the mcp_servers env).
stage_secret_from_env CLIO_CLIENT_ID         "${CLIO_CLIENT_ID:-}"         "Clio OAuth app client id"
stage_secret_from_env CLIO_CLIENT_SECRET     "${CLIO_CLIENT_SECRET:-}"     "Clio OAuth app client secret"
stage_secret_from_env CLIO_ENCRYPTION_KEY    "${CLIO_ENCRYPTION_KEY:-}"    "AES key for the Clio token file (subprocess reads it as ENCRYPTION_KEY)"
stage_secret_from_env CLIO_TOKENS_ENC_B64    "${CLIO_TOKENS_ENC_B64:-}"    "base64 of the seed ~/.clio-mcp/tokens.enc"

# AgentMail (mcp:agentmail). TWO keys per seat since ss#2258, and they are NOT
# interchangeable:
#
#   AGENTMAIL_API_KEY      -> the gateway (agent-reachable). Inbox-scoped, with
#                             message_send and draft_send WITHHELD. The agent
#                             reads and drafts its own mailbox; if any code path
#                             on the Machine tries to transmit, AgentMail itself
#                             refuses. That fence is the vendor's, not ours,
#                             which is what makes it hold "no matter where the
#                             send came from."
#   AGENTMAIL_SEND_API_KEY -> the workspace broker ONLY. Inbox-scoped WITH
#                             message_send. entrypoint.sh materializes it to a
#                             0600 broker-owned file and unsets it before the
#                             gateway exists, so it is never in agent-reachable
#                             env. Every send goes through a broker verb that
#                             fences the recipient against the seat's own
#                             authored config and writes the audit row itself.
#
# Mint both with POST /v0/api-keys carrying `inbox_id` (the seat's own inbox) and
# a `permissions` whitelist; see docs/security/operator-threat-model.md. The old
# single org-wide key (unscoped, every permission, one value shared by every
# seat) is what let a rehearsal seat mail a real client principal with no audit
# row on four days in 2026-08. Retiring it at the vendor is the step that kills
# the copies already written to every seat's volume — a seat that still holds it
# is not fixed by this provisioning change alone.
#
# Both are staged ONLY for a customer whose customer.yaml binds the agentmail
# adapter.
#
# WEBHOOK_SECRET_AGENTMAIL is the Svix signing secret the webhook gate verifies. It
# is PER-CUSTOMER, NOT account-wide: each customer's inbox is wired to its own
# webhook (created out of band via the AgentMail dashboard/API), and that webhook
# carries its own secret that only verifies THAT customer's inbound. So prefer the
# per-customer value staged in /ss as WEBHOOK_SECRET_AGENTMAIL__<CUSTOMER_ID>
# (uppercased; non-alnum -> _), and fall back to the global WEBHOOK_SECRET_AGENTMAIL
# only for legacy single-webhook setups. Without the per-customer source a reprovision
# overwrites a customer's own webhook secret with the global one and inbound email
# silently stops verifying — the 2026-06-12 inbound failure, generalized to every
# multi-customer AgentMail seat.
if grep -qE 'adapter:[[:space:]]*agentmail|backend:[[:space:]]*mcp:agentmail' \
    "${CUSTOMER_DIR}/customer.yaml" 2>/dev/null; then
  # PER-SEAT, and it has to be. Both keys are scoped to ONE inbox at the vendor
  # (ss#2258), so a single shared value is no longer merely untidy — staging one
  # seat's key onto another gives that seat a credential for a mailbox it does
  # not own, and its own mailbox becomes unreachable. Same convention and the
  # same reasoning as WEBHOOK_SECRET_AGENTMAIL__<CID> below, whose comment
  # records the identical bug one layer over: a reprovision silently overwriting
  # a customer's own value with the global one.
  #
  # The global fallback is kept ONLY for the pre-scoped-key transition. It is a
  # migration affordance, not a supported end state: once every seat has vaulted
  # AGENTMAIL_API_KEY__<CID>, the bare names should go.
  _AGENTMAIL_CID="$(printf '%s' "${CUSTOMER_ID}" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
  _AGENTMAIL_READ_NAME="AGENTMAIL_API_KEY__${_AGENTMAIL_CID}"
  _AGENTMAIL_SEND_NAME="AGENTMAIL_SEND_API_KEY__${_AGENTMAIL_CID}"
  stage_secret_from_env AGENTMAIL_API_KEY "${!_AGENTMAIL_READ_NAME:-${AGENTMAIL_API_KEY:-}}" "AgentMail read/draft credential for the gateway (inbox-scoped, NO send permission; per-seat ${_AGENTMAIL_READ_NAME}, else global)"
  stage_secret_from_env AGENTMAIL_SEND_API_KEY "${!_AGENTMAIL_SEND_NAME:-${AGENTMAIL_SEND_API_KEY:-}}" "AgentMail send credential for the broker ONLY (inbox-scoped, message_send; stripped from agent env; per-seat ${_AGENTMAIL_SEND_NAME}, else global)"
  unset _AGENTMAIL_CID _AGENTMAIL_READ_NAME _AGENTMAIL_SEND_NAME
  _AGENTMAIL_WH_KEY="WEBHOOK_SECRET_AGENTMAIL__$(printf '%s' "${CUSTOMER_ID}" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
  _AGENTMAIL_WH_SECRET="${!_AGENTMAIL_WH_KEY:-${WEBHOOK_SECRET_AGENTMAIL:-}}"
  stage_secret_from_env WEBHOOK_SECRET_AGENTMAIL "${_AGENTMAIL_WH_SECRET}" "AgentMail Svix webhook signing secret (per-customer ${_AGENTMAIL_WH_KEY}, else global)"
  # SMD_WEBHOOK_SIGNING_SECRET is what the Hermes-side router verifies the gate's
  # forwarded X-Webhook-Signature with. The gate re-signs its forward hop with the
  # ROUTE secret (webhook_gate.py: "same secret"), so the router's signing secret IS
  # the agentmail route secret — stage them equal, or inbound never routes to a skill.
  stage_secret_from_env SMD_WEBHOOK_SIGNING_SECRET "${_AGENTMAIL_WH_SECRET}" "router forward-verify secret (== agentmail route secret)"
  unset _AGENTMAIL_WH_KEY _AGENTMAIL_WH_SECRET
fi

# Microsoft Graph app-only mail (adapter: msgraph, backend: mcp:msgraph-mail —
# email-channel-seam ADR 0078 / spec D5). The connector authenticates app-only
# (tenant + client id + client secret) against a mailbox pinned by config, tenant-
# scoped by ApplicationAccessPolicy. Staged ONLY for a customer whose customer.yaml
# binds the msgraph Email adapter. tenant_id / client_id / mailbox are non-secret
# and read straight from the msgraph_auth block; the client SECRET is client-
# custodied (ADR 0010) and never in the yaml — msgraph_auth.secret_ref names the
# Fly secret (fly-secret:<NAME>), whose VALUE is sourced from the operator env,
# preferring the per-customer <NAME>__<CUSTOMER_ID> so a reprovision of one seat
# never pulls another tenant's secret. The connector reads all four as env vars
# (MSGRAPH_TENANT_ID / MSGRAPH_CLIENT_ID / MSGRAPH_CLIENT_SECRET / MSGRAPH_MAILBOX).
if grep -qE 'adapter:[[:space:]]*msgraph|backend:[[:space:]]*mcp:msgraph-mail' \
    "${CUSTOMER_DIR}/customer.yaml" 2>/dev/null; then
  MSG_PARSE_PY="
import yaml
with open('${CUSTOMER_YAML}') as f:
    c = yaml.safe_load(f) or {}
auth = {}
for conn in (c.get('connectors') or {}).values():
    if isinstance(conn, dict) and str(conn.get('adapter', '')) == 'msgraph':
        auth = conn.get('msgraph_auth') or {}
        break
print(str(auth.get('tenant_id') or '').strip())
print(str(auth.get('client_id') or '').strip())
print(str(auth.get('mailbox') or '').strip())
print(str(auth.get('secret_ref') or '').strip())
"
  MSG_FIELDS=()
  while IFS= read -r _line; do MSG_FIELDS+=("${_line}"); done \
    < <(uv run --quiet --with pyyaml python3 -c "${MSG_PARSE_PY}")
  _MSG_TENANT="${MSG_FIELDS[0]:-}"
  _MSG_CLIENT="${MSG_FIELDS[1]:-}"
  _MSG_MAILBOX="${MSG_FIELDS[2]:-}"
  _MSG_SECRET_REF="${MSG_FIELDS[3]:-}"
  # Derive the Fly/operator-env secret NAME from the secret_ref (strip the
  # fly-secret: prefix). Defaults to MSGRAPH_CLIENT_SECRET when unauthored.
  _MSG_SECRET_NAME="${_MSG_SECRET_REF#fly-secret:}"
  [ -n "${_MSG_SECRET_NAME}" ] && [ "${_MSG_SECRET_NAME}" != "${_MSG_SECRET_REF}" ] \
    || _MSG_SECRET_NAME="MSGRAPH_CLIENT_SECRET"
  # Per-customer source for the client secret, else the global by that name.
  _MSG_SECRET_CID_KEY="${_MSG_SECRET_NAME}__$(printf '%s' "${CUSTOMER_ID}" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
  _MSG_SECRET_VALUE="${!_MSG_SECRET_CID_KEY:-${!_MSG_SECRET_NAME:-}}"

  log "Microsoft Graph mail seat: mailbox=${_MSG_MAILBOX} (client secret from ${_MSG_SECRET_CID_KEY}, else ${_MSG_SECRET_NAME})"
  stage_secret_from_env MSGRAPH_TENANT_ID     "${_MSG_TENANT}"        "Microsoft Graph tenant id (from msgraph_auth.tenant_id)"
  stage_secret_from_env MSGRAPH_CLIENT_ID     "${_MSG_CLIENT}"        "Microsoft Graph app client id (from msgraph_auth.client_id)"
  stage_secret_from_env MSGRAPH_MAILBOX       "${_MSG_MAILBOX}"       "Microsoft Graph pinned operator mailbox (from msgraph_auth.mailbox)"
  stage_secret_from_env MSGRAPH_CLIENT_SECRET "${_MSG_SECRET_VALUE}"  "Microsoft Graph app client secret (per-customer ${_MSG_SECRET_CID_KEY}, else ${_MSG_SECRET_NAME})"
  # ss#2258: the SEND-side Graph app credential, which only the workspace broker
  # ever sees (root materializes it to a 0600 file and unsets these before the
  # exec-drop). Separate names because they are meant to become a separate app
  # registration — read-only for the agent, send-capable only for the broker —
  # which is the ONLY way to give this channel the vendor-enforced fence the
  # AgentMail channel already has (a Graph app-only token is always `/.default`,
  # so one registration cannot be two permission sets).
  #
  # The fallback to the read app's values is a MIGRATION AFFORDANCE and nothing
  # more. While it is taken, the broker's key is the agent's key, so only the
  # governed path is fenced; a rogue in-agent path can still mint its own token.
  # Staging real MSGRAPH_SEND_* values for a seat is what ends that, and it needs
  # no code change — only these three variables pointing at the second app.
  _MSG_SEND_CID="$(printf '%s' "${CUSTOMER_ID}" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
  _MSG_SEND_TENANT_KEY="MSGRAPH_SEND_TENANT_ID__${_MSG_SEND_CID}"
  _MSG_SEND_CLIENT_KEY="MSGRAPH_SEND_CLIENT_ID__${_MSG_SEND_CID}"
  _MSG_SEND_SECRET_KEY="MSGRAPH_SEND_CLIENT_SECRET__${_MSG_SEND_CID}"
  _MSG_SEND_TENANT="${!_MSG_SEND_TENANT_KEY:-${MSGRAPH_SEND_TENANT_ID:-${_MSG_TENANT}}}"
  _MSG_SEND_CLIENT="${!_MSG_SEND_CLIENT_KEY:-${MSGRAPH_SEND_CLIENT_ID:-${_MSG_CLIENT}}}"
  _MSG_SEND_SECRET="${!_MSG_SEND_SECRET_KEY:-${MSGRAPH_SEND_CLIENT_SECRET:-${_MSG_SECRET_VALUE}}}"
  if [ "${_MSG_SEND_CLIENT}" = "${_MSG_CLIENT}" ]; then
    log "  msgraph SEND app == READ app on this seat (migration fallback): the broker fences the governed path, but the agent's own credential can still transmit. Stage ${_MSG_SEND_CLIENT_KEY} to close it."
  fi
  stage_secret_from_env MSGRAPH_SEND_TENANT_ID     "${_MSG_SEND_TENANT}"  "Graph SEND app tenant id (broker-only; per-customer ${_MSG_SEND_TENANT_KEY})"
  stage_secret_from_env MSGRAPH_SEND_CLIENT_ID     "${_MSG_SEND_CLIENT}"  "Graph SEND app client id (broker-only; per-customer ${_MSG_SEND_CLIENT_KEY})"
  stage_secret_from_env MSGRAPH_SEND_CLIENT_SECRET "${_MSG_SEND_SECRET}"  "Graph SEND app client secret (broker-only; per-customer ${_MSG_SEND_SECRET_KEY})"
  # Loopback signing secrets for the delta poller (ADR 0078 / email-channel-seam
  # D1). Unlike AgentMail's Svix secret these are NOT vendor-issued — the poller
  # signs its own loopback POST with WEBHOOK_SECRET_MSGRAPH and the Hermes webhook
  # adapter re-verifies it, all inside this one Machine. SMD_WEBHOOK_SIGNING_SECRET
  # is what the overlay router verifies the gate's forwarded signature with, and
  # the gate re-signs its forward hop with the ROUTE secret (same rule the
  # AgentMail branch above relies on), so on an msgraph seat it MUST equal the
  # msgraph route secret or polled mail never routes to a skill. Prefer a
  # per-customer override so a reprovision is reproducible; otherwise generate a
  # fresh per-seat value (safe — both ends read it from the same freshly-deployed
  # env, so a rotation is atomic and touches no external party).
  _MSG_WH_KEY="WEBHOOK_SECRET_MSGRAPH__$(printf '%s' "${CUSTOMER_ID}" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
  _MSG_WH_SECRET="${!_MSG_WH_KEY:-${WEBHOOK_SECRET_MSGRAPH:-}}"
  [ -n "${_MSG_WH_SECRET}" ] || _MSG_WH_SECRET="$(openssl rand -hex 32)"
  stage_secret_from_env WEBHOOK_SECRET_MSGRAPH "${_MSG_WH_SECRET}" "msgraph delta-poller loopback signing secret (per-customer ${_MSG_WH_KEY}, else generated)"
  stage_secret_from_env SMD_WEBHOOK_SIGNING_SECRET "${_MSG_WH_SECRET}" "router forward-verify secret (== msgraph route secret on an msgraph seat)"
  unset MSG_PARSE_PY MSG_FIELDS _MSG_TENANT _MSG_CLIENT _MSG_MAILBOX _MSG_SECRET_REF \
    _MSG_SECRET_NAME _MSG_SECRET_CID_KEY _MSG_SECRET_VALUE _MSG_WH_KEY _MSG_WH_SECRET \
    _MSG_SEND_CID _MSG_SEND_TENANT_KEY _MSG_SEND_CLIENT_KEY _MSG_SEND_SECRET_KEY \
    _MSG_SEND_TENANT _MSG_SEND_CLIENT _MSG_SEND_SECRET
fi

# Brave Search (native:brave-free, ADR 0070). BRAVE_SEARCH_API_KEY is the env var
# Hermes' native brave-free provider reads. The Hosted-Agent tier uses Brave's
# FREE tier (one shared, SMD-owned key; $0, no runaway spend; keeps "your only
# bill is Anthropic" true). Staged ONLY for a customer whose customer.yaml binds a
# native:brave-* backend. Missing at boot => the provider stays unavailable
# (Hermes falls back / no web search), fail-closed, no crashloop.
if grep -qE 'backend:[[:space:]]*.?native:brave' "${CUSTOMER_DIR}/customer.yaml" 2>/dev/null; then
  stage_secret_from_env BRAVE_SEARCH_API_KEY "${BRAVE_SEARCH_API_KEY:-}" "Brave Search API key (native brave-free provider; web search)"
fi

# Google service-account key (DWD). REQUIRED for any customer.yaml with
# google_auth.mode: dwd — bootstrap.sh Step 2b dies without it. Base64-encoded
# service-account JSON. Shared across the smd.services domain (one SA, domain-wide
# delegation impersonating each customer's authored subject).
stage_secret_from_env GOOGLE_SERVICE_ACCOUNT_JSON "${GOOGLE_SERVICE_ACCOUNT_JSON:-}" "base64 service-account key (domain-wide delegation)"

# ---------- Step 6b-smokeball: Smokeball connector creds (ADR 0053, name remap) --
# mcp:smokeball reads env-agnostic SMOKEBALL_CLIENT_ID/SECRET/API_KEY. The operator
# env holds them under environment-specific names — SMOKEBALL_STAGING_* (the
# approved app's STAGING credentials; the pilot seat) and SMOKEBALL_PROD_* (its
# PRODUCTION credentials, staged for go-live) — so this is a NAME REMAP the
# manifest-driven loop below can't do. A third vault set, SMOKEBALL_SEED_*, is
# App 1 (the original client_credentials staging app) and is used ONLY by the
# rehearsal-office seeder (operator/customers/pilot-smokeball/seed/) — never by
# provisioning, and it must never be written over the STAGING/PROD names
# (2026-07-04: App 2's rollout once overwrote App 1's values; hence the split). The seat declares which environment it is via the smokeball connector
# block in customer.yaml:
#
#   connectors:
#     PracticeManagement:
#       backend: mcp:smokeball
#       environment: staging | production   # default staging; selects host pair + cred set
#       auth_mode: client_credentials | authorization_code   # default client_credentials
#       account_id: <id>                     # optional; multi-account URL prefix
#
# SMOKEBALL_ENVIRONMENT is a REQUIRED runtime secret (the overlay fail-closes the
# connector if it is unset) so a prod seat can never silently default to staging.
# The authorization_code refresh token is NOT staged here — it is obtained at the
# connect step (operator/bin/connect-smokeball.sh) and set as SMOKEBALL_REFRESH_TOKEN
# directly. A prod seat whose SMOKEBALL_PROD_* creds are not yet in the operator env
# simply warns+skips → the connector is unwired this boot (boot-before-token), and
# wires once the creds land.
if grep -qE 'backend:[[:space:]]*mcp:smokeball' "${CUSTOMER_DIR}/customer.yaml" 2>/dev/null; then
  SB_PARSE_PY="
import yaml
with open('${CUSTOMER_YAML}') as f:
    c = yaml.safe_load(f) or {}
sb = {}
for conn in (c.get('connectors') or {}).values():
    if isinstance(conn, dict) and str(conn.get('backend', '')) == 'mcp:smokeball':
        sb = conn
        break
print(str(sb.get('environment', 'staging')).strip().lower())
print(str(sb.get('auth_mode', 'client_credentials')).strip().lower())
print(str(sb.get('account_id') or '').strip())
"
  SB_FIELDS=()
  while IFS= read -r _line; do SB_FIELDS+=("${_line}"); done \
    < <(uv run --quiet --with pyyaml python3 -c "${SB_PARSE_PY}")
  SB_ENV="${SB_FIELDS[0]:-staging}"
  SB_AUTH_MODE="${SB_FIELDS[1]:-client_credentials}"
  SB_ACCOUNT_ID="${SB_FIELDS[2]:-}"

  if [ "${SB_ENV}" = "production" ]; then
    _sb_cid="${SMOKEBALL_PROD_CLIENT_ID:-}"
    _sb_sec="${SMOKEBALL_PROD_CLIENT_SECRET:-}"
    _sb_key="${SMOKEBALL_PROD_API_KEY:-}"
    _sb_src="SMOKEBALL_PROD"
  else
    SB_ENV="staging"  # normalize anything non-production to staging (fail-safe)
    _sb_cid="${SMOKEBALL_STAGING_CLIENT_ID:-}"
    _sb_sec="${SMOKEBALL_STAGING_CLIENT_SECRET:-}"
    _sb_key="${SMOKEBALL_STAGING_API_KEY:-}"
    _sb_src="SMOKEBALL_STAGING"
  fi

  log "Smokeball seat: environment=${SB_ENV} auth_mode=${SB_AUTH_MODE} (creds from ${_sb_src}_*)"
  stage_secret_from_env SMOKEBALL_CLIENT_ID     "${_sb_cid}" "Smokeball OAuth client id (from ${_sb_src}_CLIENT_ID)"
  stage_secret_from_env SMOKEBALL_CLIENT_SECRET "${_sb_sec}" "Smokeball OAuth client secret (from ${_sb_src}_CLIENT_SECRET)"
  stage_secret_from_env SMOKEBALL_API_KEY       "${_sb_key}" "Smokeball x-api-key per-request app key (from ${_sb_src}_API_KEY)"
  # Required per-seat — value is always present (default staging), never silently prod-as-staging.
  stage_secret_from_env SMOKEBALL_ENVIRONMENT   "${SB_ENV}"  "Smokeball host environment (staging|production)"
  # Optional per-seat. client_credentials is the connector default, so stage AUTH_MODE
  # only when the firm-delegated grant is authored; account_id only when present.
  if [ "${SB_AUTH_MODE}" = "authorization_code" ]; then
    stage_secret_from_env SMOKEBALL_AUTH_MODE "authorization_code" "Smokeball grant: firm-delegated (refresh token set at the connect step)"
    # Per-customer OAuth state-signing key (ADR 0054): HMAC(master, slug), the same
    # derivation as the runtime-read key (ADR 0043). The Machine verifies the connect
    # state with this; the connect initiator derives the SAME key to sign. The master
    # lives ONLY in the operator env (/ss) — each Machine gets only its own derived key.
    if [ -n "${OPERATOR_OAUTH_STATE_MASTER:-}" ]; then
      _sb_state_key="$(printf '%s' "${SLUG}" | openssl dgst -sha256 -hmac "${OPERATOR_OAUTH_STATE_MASTER}" | awk '{print $NF}')"
      stage_secret_from_env SMOKEBALL_OAUTH_STATE_KEY "${_sb_state_key}" "per-customer Smokeball OAuth state key (ADR 0054; HMAC(master,slug))"
      unset _sb_state_key
    else
      log "WARN: OPERATOR_OAUTH_STATE_MASTER unset — SMOKEBALL_OAUTH_STATE_KEY not derived; the connect callback will reject all state until it is staged"
    fi
  fi
  if [ -n "${SB_ACCOUNT_ID}" ]; then
    stage_secret_from_env SMOKEBALL_ACCOUNT_ID "${SB_ACCOUNT_ID}" "Smokeball multi-account URL prefix"
  fi
  # Smokeball webhook ingress (overlay webhook-gate). Staged only when the seat
  # declares a smokeball webhook_url — otherwise these are unused. Two secrets:
  #   WEBHOOK_SECRET_SMOKEBALL — the HMAC key the gate verifies with. It MUST equal
  #     the `key` set on the Smokeball subscription. Smokeball uses it as RAW UTF-8
  #     bytes, so it is staged byte-identical (printf '%s', no whsec_/base64/newline
  #     transform — unlike the Svix secret). Per-customer
  #     WEBHOOK_SECRET_SMOKEBALL__<CUSTOMER_ID>, else the global.
  #   WEBHOOK_SMOKEBALL_CLIENT_ID — OUR Smokeball API ClientId, fed into the signed
  #     string {Timestamp}|{RequestId}|{ClientId} (Smokeball never sends it). It is
  #     the same client id the connector authenticates with (SMOKEBALL_CLIENT_ID ==
  #     ${_sb_cid}); a per-customer override exists only for the rare case the signing
  #     ClientId differs in byte form from the OAuth client id (confirm vs a real
  #     delivery). Without these the smokeball route fail-closes (gate 401).
  if grep -qE 'webhook_url:.*/webhooks/smokeball' "${CUSTOMER_DIR}/customer.yaml" 2>/dev/null; then
    _SB_WH_KEY="WEBHOOK_SECRET_SMOKEBALL__$(printf '%s' "${CUSTOMER_ID}" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
    _SB_WH_SECRET="${!_SB_WH_KEY:-${WEBHOOK_SECRET_SMOKEBALL:-}}"
    stage_secret_from_env WEBHOOK_SECRET_SMOKEBALL "${_SB_WH_SECRET}" "Smokeball webhook HMAC key == subscription key, raw bytes (per-customer ${_SB_WH_KEY}, else global)"
    _SB_WH_CID_KEY="WEBHOOK_SMOKEBALL_CLIENT_ID__$(printf '%s' "${CUSTOMER_ID}" | tr '[:lower:]-' '[:upper:]_' | tr -cd 'A-Z0-9_')"
    _SB_WH_CID="${!_SB_WH_CID_KEY:-${_sb_cid}}"
    stage_secret_from_env WEBHOOK_SMOKEBALL_CLIENT_ID "${_SB_WH_CID}" "Smokeball API ClientId fed into the webhook HMAC (per-customer ${_SB_WH_CID_KEY}, else = SMOKEBALL_CLIENT_ID)"
    unset _SB_WH_KEY _SB_WH_SECRET _SB_WH_CID_KEY _SB_WH_CID
  fi
  unset SB_PARSE_PY SB_FIELDS SB_ENV SB_AUTH_MODE SB_ACCOUNT_ID _sb_cid _sb_sec _sb_key _sb_src
fi

# ---------- Step 6b-authored: author-built connector secrets (ADR 0053) ----------
# Data-driven from each author-built connector's manifest.toml
# (operator/connectors/<name>/manifest.toml) — the generic replacement for
# per-connector grep blocks. For static / client_credentials connectors we stage
# every declared required_secret NAME from the operator env (Infisical /ss),
# warn+skip when unset, same no-paste pattern as the vendor blocks above. Adding
# an author-built connector needs NO edit here.
#
# authorization_code connectors are deliberately NOT handled here: their
# token-on-volume custody (the *_TOKENS_ENC_B64 seed + any var remap) stays in
# the overlay registry + its dedicated custody step, so the manifest never
# becomes a second, contradictory wiring spec. The manifest carries secret NAMES
# only; the registry owns how each is wired.
_CONNECTORS_DIR="${REPO_ROOT}/operator/connectors"
if [ -d "${_CONNECTORS_DIR}" ]; then
  # Capture via $(...) command substitution + a <<< here-string — NOT a
  # `done < <(python3 ... <<'PY')` process substitution. A heredoc INSIDE a <(...)
  # process substitution trips a "bad substitution: no closing ')' in <(" parse
  # error on some bash builds (it aborted a live reprovision 2026-06-23); a
  # heredoc inside $() command substitution is fine (see the CLIO_ENABLED probe).
  _authored_secrets="$(
    python3 - "${_CONNECTORS_DIR}" <<'PY'
import pathlib
import sys
import tomllib

# Connectors whose operator-env credential NAMES differ from their runtime names
# (a remap the flat loop cannot do) are staged by a dedicated block above; skip
# them here so the loop does not warn that the runtime name is unset.
# NOTE: keep this heredoc body free of apostrophes. macOS bash 3.2 mis-parses a
# stray apostrophe inside a heredoc-in-command-substitution and consumes to EOF
# (that aborted a reprovision on 2026-06-23).
REMAP_HANDLED = {"smokeball"}
root = pathlib.Path(sys.argv[1])
for manifest in sorted(root.glob("*/manifest.toml")):
    if manifest.parent.name in REMAP_HANDLED:
        continue
    try:
        data = tomllib.loads(manifest.read_text())
    except (OSError, tomllib.TOMLDecodeError):
        continue
    conn = data.get("connector", data)
    # static / client_credentials → flat env staging here. authorization_code →
    # token-on-volume custody (handled outside this loop).
    if conn.get("auth_model") not in ("static", "client_credentials"):
        continue
    for secret in conn.get("required_secrets", []):
        name = secret.get("runtime_env")
        if name:
            print(f"{manifest.parent.name}\t{name}")
PY
  )"
  while IFS=$'\t' read -r _conn_name _secret_name; do
    [ -n "${_secret_name}" ] || continue
    stage_secret_from_env "${_secret_name}" "${!_secret_name:-}" \
      "author-built connector ${_conn_name} secret (ADR 0053)"
  done <<< "${_authored_secrets}"
  unset _conn_name _secret_name _authored_secrets
fi
unset _CONNECTORS_DIR

# ---------- Step 6c: healthchecks.io check (ADR 0023 Wave 1) ----------
# Idempotent create-or-find. Healthchecks.io's POST /api/v3/checks/ creates
# a new check; if a check with the same `unique` keys (tags+name) already
# exists, the API returns it. The ping URL is stable across re-runs.
#
# The check is configured to POST to ss-web's /api/webhooks/healthchecks
# on failure (grace expiration) with an Authorization: Bearer header
# carrying HEALTHCHECKS_WEBHOOK_SECRET (different from the API key — the
# inbound receiver verifies this) and a JSON body the receiver expects.
HC_CHECK_NAME="hermes-${SLUG}"
HC_PING_URL=""
if [ -n "${HEALTHCHECKS_API_KEY:-}" ]; then
  log "Creating/finding healthchecks.io check '${HC_CHECK_NAME}'..."
  # SLUG is a script-local shell variable — it must be passed into the python
  # subprocess env explicitly. (Latent since Wave 1: this branch only runs
  # when HEALTHCHECKS_API_KEY exists, which first happened 2026-07-25; the
  # unexported read KeyError'd and killed the whole provision.)
  HC_PAYLOAD=$(SLUG="${SLUG}" python3 -c "
import json, os
slug = os.environ['SLUG']
admin = os.environ.get('ADMIN_BASE_URL', 'https://admin.smd.services')
webhook_secret = os.environ.get('HEALTHCHECKS_WEBHOOK_SECRET', '')
print(json.dumps({
    'name': f'hermes-{slug}',
    'tags': f'operator {slug}',
    'timeout': int(os.environ.get('HEALTHCHECKS_PERIOD_SECONDS', '60')),
    'grace': int(os.environ.get('HEALTHCHECKS_GRACE_MINUTES', '5')) * 60,
    'unique': ['name', 'tags'],
    'channels': '',  # outbound managed via Integrations in UI per Wave 1 setup
}))
")
  HC_RESPONSE=$(curl -sS -X POST 'https://healthchecks.io/api/v3/checks/' \
    -H "X-Api-Key: ${HEALTHCHECKS_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "${HC_PAYLOAD}") \
    || die "healthchecks.io API call failed (check HEALTHCHECKS_API_KEY)"
  HC_PING_URL=$(echo "${HC_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ping_url',''))")
  if [ -z "${HC_PING_URL}" ]; then
    log "WARN: healthchecks.io returned no ping_url; response=${HC_RESPONSE}"
  else
    log "healthchecks.io ping URL: ${HC_PING_URL}"
    printf '%s=%s\n' "HEALTHCHECKS_PING_URL" "${HC_PING_URL}" \
      | fly secrets import --stage -a "${APP_NAME}" >/dev/null
    log "Staged HEALTHCHECKS_PING_URL"
  fi
else
  log "WARN: HEALTHCHECKS_API_KEY not set — skipping healthchecks.io check creation"
  log "      (Machine's heartbeat ticker will still write to control-plane; the"
  log "       grace-expiration alert path is just inactive until configured)"
fi

# ---------- Step 6d: seed fleet_status row in central D1 (ADR 0023 Wave 1) ----------
# Bootstrap an empty row so the admin dashboard's fleet view renders a
# "no signal yet" entry instead of being silent before the first heartbeat
# lands. The heartbeat endpoint's ON CONFLICT upsert handles subsequent
# writes idempotently — this seed has no semantic impact beyond UI presence.
#
# Uses wrangler from the operator's working tree (assumes the same wrangler
# version used for migrations). entity_id resolved via customer_configs.
#
# THE CONFLICT TARGET IS LOAD-BEARING (#2286). Migration 0093 re-keyed
# fleet_status from `entity_id TEXT PRIMARY KEY` to `customer_slug TEXT PRIMARY
# KEY` — several seats share one entity, so an entity-keyed row collapsed two
# seats into one. entity_id survives only as a plain, NON-UNIQUE index, and
# SQLite rejects an ON CONFLICT target that names no PRIMARY KEY or UNIQUE
# constraint: the whole statement is a parse error, seeding zero rows. This
# statement carried ON CONFLICT(entity_id) from 0093 until #2286 and never
# seeded again — silently, because the stderr was discarded (see below) and
# the WARN read like a transient hiccup. The TypeScript writer was corrected
# at the same time as the migration; keep the two in step:
# src/pages/api/internal/heartbeat.ts (upsertFleetStatus).
log "Seeding fleet_status row for ${SLUG}..."
SEED_SQL=$(cat <<EOF
INSERT INTO fleet_status (entity_id, customer_slug, heartbeat_status, updated_at)
SELECT entity_id, customer_slug, 'unknown', datetime('now')
  FROM customer_configs
 WHERE customer_slug = '${SLUG}'
    ON CONFLICT(customer_slug) DO NOTHING;
EOF
)
# stderr is CAPTURED AND REPORTED, never discarded (#2286). `2>&1 >/dev/null`
# orders the redirects so the capture takes stderr only: a schema mismatch here
# is a defect to read in the provisioning log, not a shrug.
if SEED_ERR=$( cd "${REPO_ROOT}" && npx --quiet wrangler d1 execute ss-console-db --remote --command "${SEED_SQL}" 2>&1 >/dev/null ); then
  log "Seeded fleet_status (no-op if row already exists or customer_configs is missing)"
else
  log "WARN: fleet_status seed failed — Wave-1 first-heartbeat will create the row on its own"
  log "WARN: wrangler stderr: ${SEED_ERR}"
fi

# ---------- Step 7: deploy (new image + staged secrets, atomically) ----------
# DEPLOY ORDERING IS LOAD-BEARING — do NOT add a separate `fly secrets deploy`
# before this. `fly secrets deploy` "redeploys the CURRENT release with the
# staged secrets" — i.e. it applies staged secret REMOVALS/changes to the OLD,
# still-running image BEFORE the new image rolls. When a reprovision changes the
# secret contract (e.g. drops a var the old image marked required), that restarts
# the old image without it → its own env check fails → crash-loop → max-restart →
# STOPPED, with no self-heal (the 2026-06-11 ~18-min customer-zero outage).
# `fly deploy` applies staged secrets as part of the NEW release — even when the
# image digest is unchanged — so the running code and its secret contract always
# change together. (Verified against flyctl v0.4.x docs + the staging gate.)
log "Deploying ${APP_NAME} (new image + staged secrets roll together)..."
(cd "${REPO_ROOT}" && fly deploy --config "${RENDERED_DIR}/fly.toml" \
  --build-arg HERMES_REF="${HERMES_REF}" \
  --build-arg HERMES_UPSTREAM_TAG="${HERMES_UPSTREAM_TAG}" \
  --build-arg HERMES_UPSTREAM_SHA="${HERMES_UPSTREAM_SHA}" \
  --build-arg CUSTOMER_SLUG="${SLUG}")

# Post-deploy guard: `fly deploy` must have applied EVERY staged secret as part
# of the new release. If any remain STAGED (the STATUS column in
# `fly secrets list`), the running image and its secret contract have drifted —
# fail loudly rather than leave a staged-but-unapplied secret to surprise a
# later boot/restart. This is the backstop for the "atomic" claim above.
log "Verifying no secrets remain staged after deploy..."
if fly secrets list -a "${APP_NAME}" 2>/dev/null | grep -qw Staged; then
  die "secrets remain STAGED after fly deploy (not applied to the running image). Inspect: fly secrets list -a ${APP_NAME}"
fi
log "All staged secrets applied by the deploy."

# ---------- Step 8: boot smoke test ----------
# The boot-smoke-test.sh script exercises the customer.yaml → profiles → Hermes
# plugins → curator-disabled dependency chain. It is the real verification that
# bootstrap.sh's sequenced startup came up cleanly. (Postgres/Redis/Honcho
# checks return in Phase 2 — ADR 0016 revised.)
log "Running boot smoke test..."
if [ -x "${BIN_DIR}/boot-smoke-test.sh" ]; then
  "${BIN_DIR}/boot-smoke-test.sh" "${SLUG}" \
    || die "Boot smoke test failed — Machine is up but dependency chain is unhealthy. Inspect with 'fly logs -a ${APP_NAME}'."
else
  die "boot-smoke-test.sh not found or not executable at ${BIN_DIR}/boot-smoke-test.sh"
fi

# ---------- Step 9: per-connector prod smoke tests ----------
# The legacy `run_prod_smoke_test.py` was retired with the in-tree adapter.
# Per-connector probes now run inside the customer Machine via the overlay's
# `hermes-smd-hook-probe` plugin at boot. The boot smoke test above confirms
# the plugin loaded; connector-level reachability is logged by hook-probe to
# the customer's audit log and surfaced in the admin portal.

log "Provisioning complete for ${APP_NAME}"
log "Next steps:"
log "  1. fly ssh console -a ${APP_NAME}     # interact with the container"
log "  2. fly logs -a ${APP_NAME}            # watch the agent loop"
log "  3. (if any OAuth-using connectors are enabled) run the relevant OAuth setup inside the container"
log "  4. customer.yaml live at s3://${R2_BUCKET_CONFIG}/${R2_CONFIG_KEY} (non-structural edits picked up by sidecar)"
