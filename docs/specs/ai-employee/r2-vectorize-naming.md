# R2 Object Key + Vectorize Index Naming

**Spec for issue #801.** Per-customer storage isolation enforced through naming convention. Decommissioning depends on enumerable prefixes. Cross-Machine query prohibition (invariant #7) depends on the runtime verifying its bindings match its slug.

## Source

- platform-prd.md §7.6 (storage architecture), §7.5 (invariant #7)
- `docs/pm/ai-employee/prd-contributions/round-1/technical-lead.md` R2 + Vectorize sections

## Contract

### R2 buckets

**One R2 bucket per customer:** `hermes-{customer-slug}-r2`.

**Key namespace inside the bucket:**

```
{customer-slug}/drafts/{draft-id}.md                    -- agent draft (markdown)
{customer-slug}/drafts/{draft-id}.sent.md               -- post-approval canonical sent version
{customer-slug}/drafts/{draft-id}.diff.json             -- structural delta when sent-folder watching opted in
{customer-slug}/voice/samples/{sample-id}.md            -- voice anchor sample
{customer-slug}/voice/bootstrap/{sample-id}.md          -- pre-demo scraped sample
{customer-slug}/voice/cohort/{cohort-id}/{sample-id}.md -- per-cohort grouped sample
{customer-slug}/vault/process/{document-id}.md          -- process knowledge
{customer-slug}/vault/corrections/{correction-id}.md    -- edit-diff exemplars
{customer-slug}/vault/narrative/{doc-id}.md             -- customer-curated narrative knowledge
{customer-slug}/exports/{export-id}.zip                 -- memory exports
{customer-slug}/audit-exports/{export-id}.json          -- audit log exports
{customer-slug}/decommission-archive/final-{ts}.zip     -- 30-day post-decommission retention
{customer-slug}/escalation-payloads/{event-id}.json     -- escalation_events.r2_payload_key
```

The `customer-slug/` prefix is mandatory on every object. Adapters that write to R2 use a shared helper `r2_key(customer_slug, segment, object_id)` that enforces the prefix — no raw bucket writes from skill code.

### Vectorize indexes

**Two indexes per customer:**

```
hermes-{customer-slug}-vault         -- semantic recall over R2 vault (process, narrative, corrections)
hermes-{customer-slug}-corrections   -- finer-grained recall over correction exemplars only
```

No shared indexes with metadata filtering. Filter-based isolation is one bypass away from cross-customer leakage; per-index isolation is one missing binding away from a failed health check.

### Per-customer Cloudflare bindings

In `config/fly/hermes-template.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "hermes-{customer-slug}-d1"

[[r2_buckets]]
binding = "VAULT"
bucket_name = "hermes-{customer-slug}-r2"

[[vectorize]]
binding = "VEC_VAULT"
index_name = "hermes-{customer-slug}-vault"

[[vectorize]]
binding = "VEC_CORRECTIONS"
index_name = "hermes-{customer-slug}-corrections"
```

`provision-customer.sh` substitutes `{customer-slug}` before deploy.

## Invariant #7 boot-check

At Machine boot, the runtime verifies every binding's name matches `customer.yaml.customer_id`:

```python
def verify_invariant_7():
    slug = customer_yaml["customer_id"]
    expected = {
        "DB":              f"hermes-{slug}-d1",
        "VAULT":           f"hermes-{slug}-r2",
        "VEC_VAULT":       f"hermes-{slug}-vault",
        "VEC_CORRECTIONS": f"hermes-{slug}-corrections",
    }
    for binding, name in env.list_bindings():
        if expected.get(binding) != name:
            sys.stdout.write(f"INVARIANT_7_VIOLATION: {binding} bound to {name}, expected {expected.get(binding)}\n")
            sys.exit(3)
```

Failure → exit 3 before any request is served. Boot-check result written to `invariant_boot_checks` (D1) only after the binding verification passes; the row itself can't be written until DB binding is verified clean.

## Decommissioning enumeration

`bin/decommission-customer.sh` per decommission-drain.md uses the prefix to enumerate and delete:

```bash
# R2 objects
wrangler r2 object list hermes-${SLUG}-r2 --prefix "${SLUG}/" --json \
  | jq -r '.[].key' \
  | xargs -P 4 -I {} wrangler r2 object delete "hermes-${SLUG}-r2/{}"

# Vectorize indexes
wrangler vectorize delete hermes-${SLUG}-vault
wrangler vectorize delete hermes-${SLUG}-corrections

# R2 bucket itself (after empty)
wrangler r2 bucket delete hermes-${SLUG}-r2

# D1
wrangler d1 delete hermes-${SLUG}-d1
```

The decommission-archive at `{slug}/decommission-archive/final-{ts}.zip` is moved to a separate retention bucket `smd-decommission-archive` before bucket deletion, kept 30 days, deleted by a scheduled cleanup Worker.

## Failure modes

- **Vectorize per-account index limit** (100 indexes on standard paid plan): at 50 customers × 2 indexes/customer = 100 indexes. Phase 4 constraint, not Phase 1. Validator warns when customer count × 2 ≥ 80.
- **R2 bucket per-account limit** (1000 buckets default): not a near-term concern at the scale Phase 1-4 contemplates.
- **R2 prefix scan slowness** (decommission of a customer with 1M+ objects): batched delete with `-P 8` parallel `xargs`; at 100 obj/sec/worker × 8 = 800/sec; 1M objects in ~20 min. Acceptable for compliance window.
- **Skill writes to wrong customer's prefix** (bug): runtime helper `r2_key()` enforces; a skill that bypasses by writing directly to R2 SDK is a code review failure. CI grep at `tests/ai-employee/no-raw-r2-writes.test.ts` blocks PRs that import R2 SDK outside the helper module.
- **Decommission archive bucket itself ungoverned**: a separate retention policy at `smd-decommission-archive/{slug}/{ts}/` with a 30-day TTL Worker enforces deletion; Captain alerted if any archive object exceeds 35 days.

## Verification

1. **Boot-check test** (`tests/ai-employee/invariant-7-boot.test.ts`): provision a fixture customer, then swap one binding to a different slug's name, restart the Machine, assert exit 3 with the documented stdout.
2. **Decommission enumeration test**: seed an R2 bucket with 100 objects under `{slug}/`, plus 5 objects under `other-{slug}/` (simulating mistaken cross-namespace writes), run decommission; assert only `{slug}/`-prefixed objects deleted, the 5 stray objects flagged in stderr.
3. **CI guardrail**: grep at `tests/ai-employee/no-raw-r2-writes.test.ts` ensures only `ai-employee/adapter/r2_helper.py` (or its TS twin) imports the R2 SDK.
4. **Per-customer Vectorize index count probe** (Captain dashboard daily): emits `VECTORIZE_QUOTA_HIGH` alert at ≥80 indexes.

## Implementation notes

- New module: `ai-employee/adapter/r2_helper.py` (Python) and `src/lib/ai-employee/r2-helper.ts` (TS) — only files allowed to import the R2 SDK directly. Exports `r2_key(slug, segment, object_id)` + `r2_put`, `r2_get`, `r2_list_prefix`, `r2_delete_prefix`.
- `provision-customer.sh` step 4 creates the bucket and writes a `.healthcheck` object at `{slug}/.healthcheck` containing the provisioning timestamp; boot-check reads this to confirm the bucket binding is live.
- Vectorize index naming aligned with binding name (1:1) to make the boot check trivial.
- Retention bucket `smd-decommission-archive` provisioned at platform setup, not per-customer. Captain-only access via wrangler creds.

[AMBIGUITY: Wrangler/Cloudflare API throttling on bulk delete (decommissioning a heavy customer with hundreds of thousands of R2 objects) may exceed account rate limits and stretch decommissioning beyond the 60-second drain window in decommission-drain.md. Validate against a synthetic heavy customer fixture before launch.]
