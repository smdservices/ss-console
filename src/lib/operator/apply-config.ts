/**
 * Operator live-reconfig — console apply path (ADR 0044, R2-authoritative).
 *
 * R2 is the source of truth for a running Operator's live config. The admin
 * console validates an edited `customer.yaml`, writes it to R2, and records a
 * reversible history row; the on-Machine root applier pulls the live key from
 * R2 and applies it (a separate stream owns the Machine side).
 *
 * This module owns ONLY the console-side write. It does three things on a
 * valid edit:
 *
 *   1. Validate the edited config with the shared TS validator
 *      (`src/lib/operator/customer-yaml`). Rejection returns the errors and
 *      writes nothing — fail-closed, no partial R2 state.
 *   2. Write TWO R2 objects via the existing R2 binding:
 *        - live config   → `vaults/<slug>/customer.yaml`
 *        - byte snapshot → `customers/<slug>/history/<digest>.yaml`
 *      The snapshot is the reversible record (ADR 0022 Stream 3): a content
 *      digest of the exact bytes applied, so any prior version can be restored
 *      byte-for-byte without trusting git reachability.
 *   3. Record a `customer_config_history` row (via `recordCustomerConfigSync`
 *      from `src/lib/portal/customer-config.ts`) carrying the snapshot key in
 *      `r2_shadow_key`. This is the first production caller of that helper.
 *
 * Posture notes:
 *   - The input is the raw YAML TEXT the editor produced plus its PARSED form.
 *     The repo has no YAML serializer (the validator takes a parsed object;
 *     ADR 0012 §4 has portal + Hermes parse independently). We write the raw
 *     bytes verbatim so the on-Machine parse sees exactly what the author
 *     authored — we never round-trip through a re-serializer that could drift.
 *   - I/O is injected (R2 bucket + D1 handle passed in), so the orchestration
 *     unit-tests without a live Worker.
 *   - The git_sha recorded here is the SYNTHETIC apply digest, prefixed so it
 *     is never mistaken for a real commit SHA. The named reconciler
 *     (`reconcile-config.ts`) is what commits the reconciled R2 version back to
 *     the customer.yaml git repo as the reviewed record; until that lands, the
 *     digest is the durable pointer and the R2 snapshot is the recoverable
 *     bytes.
 */

import { validate, type ValidationError } from './customer-yaml'
import {
  recordCustomerConfigSync,
  type RecordSyncResult,
  type SyncSource,
} from '../portal/customer-config'

/**
 * R2 key for the live config the on-Machine applier pulls. Matches the
 * provisioning convention (`operator/bin/provision-customer.sh`:
 * `R2_CONFIG_KEY="vaults/${SLUG}/customer.yaml"`).
 */
export function liveConfigKey(slug: string): string {
  return `vaults/${slug}/customer.yaml`
}

/**
 * R2 key for the immutable byte snapshot of a single applied version. The
 * digest is the SHA-256 of the exact bytes written, so the same content
 * always lands at the same key (idempotent re-apply) and a prior version is
 * addressable by its digest. Matches the ADR 0022 Stream 3 shadow convention
 * (`customers/<slug>/history/<digest>.yaml`).
 */
export function snapshotKey(slug: string, digest: string): string {
  return `customers/${slug}/history/${digest}.yaml`
}

/**
 * The minimal R2 surface this module needs. Narrower than the full `R2Bucket`
 * type so tests can pass a tiny in-memory fake. The real `CUSTOMER_CONFIG`
 * binding satisfies it structurally.
 */
export interface ConfigBucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }
  ): Promise<unknown>
}

export interface ApplyConfigInput {
  /** Customer slug. Must equal the parsed `customer_id`; mismatch is rejected. */
  slug: string
  /** Raw YAML bytes the editor produced — written to R2 verbatim. */
  rawYaml: string
  /**
   * Parsed form of `rawYaml`. The caller parses (portal-side, with its own
   * YAML library per ADR 0012 §4); we validate the parsed object and scan the
   * raw text for leaked secrets in one pass.
   */
  parsed: unknown
  /** Who applied the edit. `null` for automated callers; an email for manual. */
  actor: string | null
  /** Sync source for the history row. Console apply is `'manual'`. */
  source?: SyncSource
  /** Override for the synced_at timestamp (tests inject a fixed clock). */
  now?: () => Date
}

export type ApplyConfigResult =
  | {
      ok: true
      digest: string
      liveKey: string
      snapshotKey: string
      history: RecordSyncResult
    }
  | {
      ok: false
      errors: ValidationError[]
    }

/** Prefix marking the history `git_sha` as a synthetic apply digest, not a
 * real commit. The reconciler replaces this pointer with the true commit SHA
 * once it commits the reconciled version back to git. */
const APPLY_SHA_PREFIX = 'r2apply:'

/**
 * Compute a lowercase-hex SHA-256 digest of the raw YAML bytes. Mirrors the
 * digest helper in `send-approved.ts` — Web Crypto, available on Workers and
 * in the vitest (Node) environment.
 */
export async function digestYaml(rawYaml: string): Promise<string> {
  const enc = new TextEncoder().encode(rawYaml)
  const digest = await crypto.subtle.digest('SHA-256', enc)
  const bytes = new Uint8Array(digest)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Validate and apply an edited customer.yaml to R2 + history.
 *
 * On invalid input: returns `{ ok: false, errors }` and writes NOTHING — no
 * R2 object, no history row. The validator runs the raw-text secret scan
 * first (fail-closed even on a structurally-broken shape).
 *
 * On valid input: writes the snapshot first (the recoverable record), then the
 * live config (what the applier reads), then records history. Ordering matters
 * — the live key must never point at bytes with no recoverable snapshot.
 */
export async function applyConfig(
  bucket: ConfigBucket,
  db: D1Database,
  input: ApplyConfigInput
): Promise<ApplyConfigResult> {
  const result = validate(input.parsed, { rawText: input.rawYaml })
  if (!result.ok) {
    return { ok: false, errors: result.errors }
  }

  // Defense in depth: the live key embeds the slug, so a slug/customer_id
  // mismatch would write one customer's config under another's vault path.
  if (result.value.customer_id !== input.slug) {
    return {
      ok: false,
      errors: [
        {
          code: 'IsolationViolation',
          path: 'customer_id',
          message:
            'customer_id does not match the apply slug; refusing to write config under a ' +
            'mismatched vault path.',
        },
      ],
    }
  }

  const digest = await digestYaml(input.rawYaml)
  const snapKey = snapshotKey(input.slug, digest)
  const liveKey = liveConfigKey(input.slug)
  const now = input.now ? input.now() : new Date()
  const syncedAt = now.toISOString()

  const metadata: Record<string, string> = {
    customerSlug: input.slug,
    digest,
    appliedAt: syncedAt,
  }

  // Snapshot first: the recoverable bytes must exist before the live pointer
  // references this version. customer.yaml is text/yaml.
  await bucket.put(snapKey, input.rawYaml, {
    httpMetadata: { contentType: 'application/yaml' },
    customMetadata: metadata,
  })

  // Live config the on-Machine applier pulls.
  await bucket.put(liveKey, input.rawYaml, {
    httpMetadata: { contentType: 'application/yaml' },
    customMetadata: metadata,
  })

  // History row carrying the recoverable snapshot key. recordCustomerConfigSync
  // no-ops cleanly when an identical digest was already recorded for a non
  // drift-repair source, so re-applying unchanged bytes does not pollute the
  // audit trail.
  const history = await recordCustomerConfigSync(db, {
    customer_slug: input.slug,
    git_sha: `${APPLY_SHA_PREFIX}${digest}`,
    synced_at: syncedAt,
    synced_by: input.source ?? 'manual',
    actor: input.actor,
    r2_shadow_key: snapKey,
  })

  return { ok: true, digest, liveKey, snapshotKey: snapKey, history }
}
