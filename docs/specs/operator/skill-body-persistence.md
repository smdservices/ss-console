# Skill Body Persistence

**Status:** Active — landed by ADR 0022 Stream 2.
**Governing ADR:** [`docs/adr/0022-vertical-pack-architecture.md`](../../adr/0022-vertical-pack-architecture.md) §"Time-machine substrate commitment".
**Related issues:** [#1091](https://github.com/venturecrane/ss-console/issues/1091) (parent), [#1112](https://github.com/venturecrane/ss-console/issues/1112) (PR 2 child).

## Purpose

Close the substrate gap that ADR 0022 flagged as production-blocking: when the Hermes `skill_manage` tool creates an agent-authored skill at runtime, the SS-side audit emits an `AGENT_SKILL_CREATED` event but the actual SKILL.md body bytes are not persisted anywhere durable. After this spec lands, every body lives in R2 and is recoverable by the admin portal indefinitely.

Skipping this is unrecoverable: agent-evolution history is lost retroactively if any customer Machine boots before the substrate is in place.

## Architecture

### Isolation model

**One R2 bucket per customer.** Bucket name: `ss-operator-<customer_slug>-skills`. Per-Machine R2 credentials are scoped to that bucket. The bucket is the trust boundary; a misconfigured token in one Machine cannot reach another customer's content.

This is Captain's reconfirmed decision (2026-05-27) after a critique surfaced Cloudflare account-level bucket cap (~1000 on Standard plan), Fly's S3-compatible-only access (no native R2 binding), and the provisioning ops cost. For the SS venture's realistic growth path (consulting firm, not SaaS), the isolation strength wins; the alternative (shared bucket + prefix isolation) stays available behind the same key shape if a future scaling event forces the swap.

### Key shape

```
skills/<persona_slug>/<skill_name>/<skill_content_hash>.md
```

Content-addressed: identical bodies dedupe (`r2.put` is idempotent on identical key). Skill rename leaves the prior hash intact — skills can be re-discovered by joining `agent_skills_inventory` rows on `skill_content_hash`.

### D1 columns (added in migration 0009)

| Column           | Type                            | Notes                                                                                                                                                                           |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `r2_key`         | TEXT                            | The full R2 key, computed before R2 PUT. NULL only for legacy rows from before this migration.                                                                                  |
| `r2_status`      | TEXT NOT NULL DEFAULT 'unknown' | One of: `unknown` (legacy backfill), `pending` (D1 row written, R2 PUT not yet attempted or in-flight), `persisted` (R2 PUT succeeded), `failed` (R2 PUT attempted and failed). |
| `r2_write_error` | TEXT                            | Populated when `r2_status='failed'`. Reason string (e.g. "AccessDenied", "BucketNotFound").                                                                                     |

### Write contract (write-ahead pattern)

```
[skill_manage fires]
       │
       ▼
[overlay plugin: compute content hash + r2_key]
       │
       ▼
[INSERT D1 row: r2_status='pending', r2_key=<key>, r2_write_error=NULL]   ← (1)
       │
       ▼
[R2 PUT body bytes at r2_key]                                              ← (2)
       │
       ├─ success ─▶ [UPDATE r2_status='persisted']                        ← (3a)
       │
       └─ failure ─▶ [UPDATE r2_status='failed', r2_write_error=<reason>]  ← (3b)
       │
       ▼
[overlay plugin emits AGENT_SKILL_CREATED audit row referencing r2_key]   ← (4)
```

Step (1) commits before step (2), so the row is always visible to the admin portal even when R2 is unreachable — the operator sees the gap and can investigate. Step (3a/3b) is best-effort; if the Machine crashes between (1) and (3), the row stays `pending` and the boot-time reconciler picks it up.

### Boot-time reconciler

On Machine boot the audit plugin runs a reconciler pass:

```sql
SELECT customer_slug, persona_slug, skill_name, skill_content_hash, r2_key
FROM agent_skills_inventory
WHERE r2_status IN ('pending', 'failed')
ORDER BY created_at ASC
```

For each row, the plugin reads the SKILL.md body from the Fly volume's per-profile skills directory (the path Hermes wrote during `skill_manage`), recomputes the hash to verify, and re-attempts the R2 PUT. On success, the row moves to `persisted`; on persistent failure (e.g. the skill was deleted from the volume), the row stays `failed` with the latest `r2_write_error` and surfaces as a P1 admin alert.

### Audit-log boundary

**Skill body bytes never land in `audit_log.metadata`.** The audit row references the R2 key, not the content. D1 row size pressure is real (skill bodies are 2–10 KB; metadata is intended for a few hundred bytes per event). The `consumer-side contract` guardrail test in `tests/forbidden-strings.test.ts` (PR 2 follow-on) asserts no SS-side code path violates this — the overlay producer-side test is in the overlay repo.

### Read path (admin portal)

`GET /admin/operator/<customer_slug>/skills/<skill_content_hash>/body`

1. Look up the row by `(customer_slug, skill_content_hash)` in the per-customer D1.
2. If `r2_status != 'persisted'`, return 404 — the body either has not been written yet or failed to persist. The admin portal surfaces the gap separately via the `r2_status` indicator on the skill list view.
3. Resolve the customer's R2 bucket name + credentials from the SS Worker's secrets store.
4. Generate a short-lived (15 min) presigned GET via the S3-compatible R2 API.
5. Return `302` to the presigned URL.

Admin auth is required (per host-scoped cookie boundary at `admin.smd.services`, see CLAUDE.md §"Cookie boundaries"). The endpoint never streams body bytes through the Worker — presigned URL only — to keep Worker CPU bounded.

The admin endpoint and the Worker-side R2 credential lookup ship in a follow-on PR — PR 2's scope is the substrate (D1 + R2 + write contract) so customer-zero can onboard without losing data. The view-body affordance is a UX nicety that can land after.

## Repo split

| Layer                        | Repo                            | Components                                                                                                                                           |
| ---------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 schema**                | ss-console                      | Migration 0009 (this spec)                                                                                                                           |
| **customer.yaml fields**     | ss-console                      | `memory.r2_skill_bodies_bucket` (declared optional in PR 1)                                                                                          |
| **Bootstrap + provisioning** | ss-console                      | `provision-customer.sh` creates bucket + scoped creds; `bootstrap.sh` validates R2*SKILL_BODIES*\* env; `fly.toml.template` declares the bucket name |
| **Audit plugin (writer)**    | venturecrane/hermes-smd-overlay | `hermes-smd-audit` post-tool-call hook on `skill_manage` events; boot-time reconciler                                                                |
| **Contract**                 | both                            | `operator/contracts/skill_capture_v1.json` mirrored in both repos for contract test                                                                  |
| **Admin endpoint**           | ss-console                      | `src/pages/api/admin/operator/[slug]/skills/[hash]/body.ts` (follow-on)                                                                              |

The ss-console and overlay PRs file and merge in lockstep so the contract is exercised end-to-end before either lands.

## Failure modes

| Failure                                                  | Detection                                                                                                                           | Recovery                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| R2 PUT fails (network, throttle)                         | `r2_status='failed'` + `r2_write_error` populated                                                                                   | Boot-time reconciler retries. Admin alert surfaces persistent failures.                              |
| Machine crashes between D1 INSERT and R2 PUT             | `r2_status='pending'` row exists                                                                                                    | Boot-time reconciler retries by re-reading body from volume.                                         |
| Skill body deleted from volume before reconciler runs    | Reconciler logs "body bytes missing" + leaves row `failed`                                                                          | Captain decision per-case. Hash is in D1; body is lost. Surfaced as a P1 alert.                      |
| Bucket credentials revoked / wrong                       | All writes fail; reconciler keeps trying                                                                                            | Provisioning script re-runs (rotates scoped token, no data loss since hash + key are deterministic). |
| Bucket exists but is wrong customer's (provisioning bug) | Defensive check: object key includes no customer slug, but the BUCKET enforces tenancy. Cross-tenant write structurally impossible. | N/A — caught at provisioning time.                                                                   |

## Out of scope (PR 2)

- Admin portal "view body" endpoint and signed-URL plumbing (follow-on; D1 substrate first so customer-zero can onboard).
- Admin sidebar "skills missing R2 body" indicator (follow-on; just a D1 read).
- Backfill of legacy `AGENT_SKILL_CREATED` rows whose bodies were never persisted — those bodies are unrecoverable. Future agent-authored skills are captured from this point forward.
- Cross-bucket migration tooling. If the per-customer-bucket model ever needs to consolidate into shared-bucket-plus-prefix, the migration is mechanical (same key shape) but the tooling ships when the need exists.

## References

- ADR 0022 — Vertical Pack Architecture and Time-Machine Substrate (§"Time-machine substrate commitment")
- ADR 0007 — Per-customer Machine isolation
- ADR 0016 — Honcho disposition (mirror-don't-gate principle)
- ADR 0017 — Skill Curator disposition (the `agent_skills_inventory` table)
- [Approved plan](../../../.claude/plans/write-a-plan-to-valiant-plum.md) §Stream 2
- `operator/contracts/skill_capture_v1.json` — JSON contract shared with overlay repo
