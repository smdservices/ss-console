#!/usr/bin/env bash
# R2 -> git customer.yaml reconciler — ADR 0044 Decision 4, issue #1840.
#
# R2 is the operational source of truth for the live config (Decision 1);
# git is the reviewed/DR record, reconciled FROM R2. This script bounds the
# divergence window: for every provisioned customer it compares the live R2
# customer.yaml against the git working copy and, when they differ AND the
# R2 object is not simply an untouched projection of git (provenance stamp,
# see operator/bin/lib/config_divergence.py), surfaces the divergence.
#
# Modes:
#   --check   (default) report divergences; exit 4 if any exist, 0 if clean.
#   --pr      additionally, for each diverged slug, create a branch
#             `reconcile/r2-<slug>` carrying the R2 version of the file and
#             open (or update) a PR — the reviewed-record path. Requires gh.
#
# Credentials: R2_ENDPOINT_URL / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
# (read access suffices). Locally: run under Infisical
#   infisical run --env=prod --path=/ss -- operator/bin/reconcile-r2-config.sh
# In CI: provided as repo secrets by .github/workflows/r2-config-reconcile.yml.
set -euo pipefail

MODE="${1:---check}"
case "${MODE}" in --check|--pr) ;; *) echo "usage: $0 [--check|--pr]" >&2; exit 2 ;; esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN_DIR="${REPO_ROOT}/operator/bin"
CUSTOMERS_DIR="${REPO_ROOT}/operator/customers"
R2_BUCKET_CONFIG="${R2_BUCKET_CONFIG:-smd-customer-config}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [reconcile-r2] $*"; }
[ -n "${R2_ENDPOINT_URL:-}" ] || { echo "FATAL: R2_ENDPOINT_URL not set (Infisical /ss prod, or CI secrets)" >&2; exit 2; }
[ -n "${R2_ACCESS_KEY_ID:-}" ] || { echo "FATAL: R2_ACCESS_KEY_ID not set" >&2; exit 2; }
[ -n "${R2_SECRET_ACCESS_KEY:-}" ] || { echo "FATAL: R2_SECRET_ACCESS_KEY not set" >&2; exit 2; }
command -v aws >/dev/null 2>&1 || { echo "FATAL: aws CLI not found" >&2; exit 2; }
[ "${MODE}" = "--check" ] || command -v gh >/dev/null 2>&1 || { echo "FATAL: gh CLI required for --pr" >&2; exit 2; }

TMP_DIR="$(mktemp -d -t ss-reconcile-r2)"
trap 'rm -rf "${TMP_DIR}"' EXIT

DIVERGED_SLUGS=()
for dir in "${CUSTOMERS_DIR}"/*/; do
  slug="$(basename "${dir}")"
  case "${slug}" in _*) continue ;; esac # templates are not provisioned customers
  git_yaml="${dir}customer.yaml"
  [ -f "${git_yaml}" ] || continue
  key="vaults/${slug}/customer.yaml"
  r2_yaml="${TMP_DIR}/${slug}.yaml"
  if ! AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
      aws s3 cp "s3://${R2_BUCKET_CONFIG}/${key}" "${r2_yaml}" \
        --endpoint-url "${R2_ENDPOINT_URL}" --only-show-errors >/dev/null 2>&1; then
    log "${slug}: no R2 object (never provisioned) — skip"
    continue
  fi
  stamp="$(AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
    aws s3api head-object --bucket "${R2_BUCKET_CONFIG}" --key "${key}" \
      --endpoint-url "${R2_ENDPOINT_URL}" \
      --query 'Metadata."projected-sha256"' --output text 2>/dev/null || true)"
  GUARD_ARGS=(--git-file "${git_yaml}" --r2-file "${r2_yaml}")
  [ -n "${stamp}" ] && GUARD_ARGS+=(--projected-sha256 "${stamp}")
  status=0
  verdict="$(python3 "${BIN_DIR}/lib/config_divergence.py" "${GUARD_ARGS[@]}" 2>/dev/null)" || status=$?
  case "${status}" in
    0)
      # clean-projection means git moved ahead of R2 (a merged-but-undeployed
      # change) — a deploy question, not a reconciliation one. identical/absent
      # are clean by definition.
      log "${slug}: ${verdict} — no reconciliation needed"
      ;;
    3)
      log "${slug}: DIVERGED — live R2 config is not in git"
      DIVERGED_SLUGS+=("${slug}")
      if [ "${MODE}" = "--pr" ]; then
        branch="reconcile/r2-${slug}"
        (
          cd "${REPO_ROOT}"
          git fetch origin main --quiet
          git checkout -B "${branch}" origin/main --quiet
          cp "${r2_yaml}" "operator/customers/${slug}/customer.yaml"
          if git diff --quiet -- "operator/customers/${slug}/customer.yaml"; then
            log "${slug}: R2 already matches origin/main (local checkout was stale) — no PR"
          else
            git add "operator/customers/${slug}/customer.yaml"
            git commit --quiet -m "chore(operator): reconcile ${slug} customer.yaml from live R2 (ADR 0044 Decision 4)"
            git push --force-with-lease --set-upstream origin "${branch}" --quiet
            gh pr create --title "chore(operator): reconcile ${slug} customer.yaml from live R2 (ADR 0044)" \
              --body "Automated R2 -> git reconciliation (ADR 0044 Decision 4, #1840): the live R2 customer.yaml for \`${slug}\` diverged from git (a live apply landed). This PR makes git the reviewed record of the live state. Review the diff as you would any config change; merging does NOT redeploy anything." \
              2>/dev/null || log "${slug}: PR already open for ${branch} (updated the branch)"
          fi
        )
      fi
      ;;
    *)
      log "${slug}: guard error (exit ${status})"
      exit 2
      ;;
  esac
done

if [ "${#DIVERGED_SLUGS[@]}" -gt 0 ]; then
  log "diverged: ${DIVERGED_SLUGS[*]}"
  [ "${MODE}" = "--pr" ] || exit 4
else
  log "all customers reconciled (git is current with live R2 state)"
fi
