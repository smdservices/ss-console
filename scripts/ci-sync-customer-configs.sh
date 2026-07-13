#!/usr/bin/env bash
# CI auto-sync: customer.yaml (git source of truth) → customer_configs D1
# projection (#1308, ADR 0012 §5).
#
# Closes the stale-projection window: before this job, a merged customer.yaml
# change never reached the live portal until someone remembered to re-project
# by hand — the mechanism behind the "removed in git but still shows live"
# failure class (see feedback: the persona-name saga, 2026-07-08/13).
#
# Behavior per changed slug:
#   - Row exists in customer_configs  → re-project via the canonical script
#     (validates, provenance-guarded, idempotent SQL) and apply --remote.
#     The upsert deliberately never updates entity_id, so a routine CI sync
#     can never repoint a config to a different client (cross-tenant guard,
#     see customer-config-projection.ts).
#   - No row (never seeded)           → WARN and skip. The FIRST projection
#     of a new customer stays a Captain-gated manual step (it binds the
#     config to an owning entity).
#
# Inputs (env): BEFORE_SHA, AFTER_SHA — the push range from the workflow.
# Wrangler auth: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env vars.
set -euo pipefail

DB=ss-console-db
BEFORE="${BEFORE_SHA:?BEFORE_SHA required}"
AFTER="${AFTER_SHA:?AFTER_SHA required}"

# A force-push or branch-create event has a zero BEFORE sha; fall back to the
# single pushed commit so we never diff against nothing.
if [[ "$BEFORE" =~ ^0+$ ]]; then
  BEFORE="${AFTER}~1"
fi

mapfile -t changed < <(git diff --name-only "$BEFORE" "$AFTER" -- 'operator/customers/*/customer.yaml' || true)

if [[ ${#changed[@]} -eq 0 ]]; then
  echo "No customer.yaml changes in ${BEFORE}..${AFTER} — nothing to sync."
  exit 0
fi

fail=0
for path in "${changed[@]}"; do
  # A deleted customer dir yields a path with no file on disk — retirement is
  # a manual, Captain-gated operation, never an automatic row drop.
  if [[ ! -f "$path" ]]; then
    echo "::warning::$path was removed; customer retirement is manual (no automatic projection drop)."
    continue
  fi

  slug=$(basename "$(dirname "$path")")
  # Template/staging dirs are not live customers.
  if [[ "$slug" == _* ]]; then
    echo "Skipping template dir: $slug"
    continue
  fi
  # The slug becomes part of a SQL literal below; constrain it hard.
  if [[ ! "$slug" =~ ^[a-z0-9-]+$ ]]; then
    echo "::error::Refusing to sync suspicious slug: $slug"
    fail=1
    continue
  fi

  echo "── Syncing $slug ──"
  entity_id=$(npx wrangler d1 execute "$DB" --remote --json \
    --command "SELECT entity_id FROM customer_configs WHERE customer_slug = '$slug'" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s)[0].results;process.stdout.write(r.length?r[0].entity_id:'')})")

  if [[ -z "$entity_id" ]]; then
    echo "::warning::$slug has no customer_configs row — first projection is Captain-gated; run scripts/project-customer-config.ts manually."
    continue
  fi

  out="scripts/.generated/ci-project-${slug}.sql"
  npx tsx scripts/project-customer-config.ts "$slug" "$entity_id" \
    --actor="system:deploy.yml/sync-customer-configs" --synced-by=ci --out="$out"
  npx wrangler d1 execute "$DB" --remote --file="$out"

  # Prove the write landed: the live row's git_sha must now name this commit's
  # version of the file.
  want=$(git log -1 --format=%H -- "$path")
  got=$(npx wrangler d1 execute "$DB" --remote --json \
    --command "SELECT git_sha FROM customer_configs WHERE customer_slug = '$slug'" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s)[0].results;process.stdout.write(r.length?r[0].git_sha:'')})")
  if [[ "$got" == "$want" ]]; then
    echo "$slug projected: git_sha=$got"
  else
    echo "::error::$slug projection did not land (want $want, live row has $got)"
    fail=1
  fi
done

exit "$fail"
