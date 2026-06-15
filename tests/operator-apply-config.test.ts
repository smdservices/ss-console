/**
 * Tests for the console-side Operator live-reconfig apply path
 * (src/lib/operator/apply-config.ts) and the R2→git reconciler planner
 * (src/lib/operator/reconcile-config.ts).
 *
 * Strategy:
 *   - applyConfig is I/O-injectable: it takes an R2-bucket-shaped object and a
 *     D1 handle. We pass a tiny in-memory R2 fake (records every put) and a
 *     real SQLite-backed D1 from the crane test harness (so the
 *     customer_config_history row genuinely lands and round-trips through the
 *     real migration 0045 schema).
 *   - The valid fixture mirrors the validator's known-good shape
 *     (tests/customer-yaml-validator.test.ts). rawYaml is a benign text blob:
 *     apply writes it verbatim and the secret scanner must not trip on it.
 *   - Invalid input must reject AND write nothing — asserted by an R2 fake that
 *     fails the test if put() is ever called on the reject path.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
  installWorkerdPolyfills,
} from '@venturecrane/crane-test-harness'
import path from 'node:path'
import {
  applyConfig,
  digestYaml,
  liveConfigKey,
  snapshotKey,
  type ConfigBucket,
} from '../src/lib/operator/apply-config'
import { listCustomerConfigHistory } from '../src/lib/portal/customer-config'
import { planReconciliation, runReconciliation } from '../src/lib/operator/reconcile-config'

installWorkerdPolyfills()

const migrationsDir = path.resolve(__dirname, '../migrations')

const SLUG = 'smith-pi-firm'

/** Valid parsed customer.yaml — the validator's known-good minimal fixture. */
function validParsed(): Record<string, unknown> {
  return {
    schema_version: 1,
    customer_id: SLUG,
    customer_name: 'Smith PI Firm',
    vertical: 'law-firm',
    practice_areas: ['personal-injury', 'workers-comp'],
    fly_region: 'lax',
    model: 'claude-opus-4-7',
    hermes_ref: 'v2026.5.7@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0',
    machine: { size: 'performance-1x', memory_mb: 1024 },
    users: [{ email: 'partner@firm.com', role: 'principal', full_name: 'Jane Smith' }],
    personas: [
      {
        slug: 'marcus',
        status: 'active',
        name: 'Marcus',
        title: 'AI Associate',
        tone: ['concise'],
        send_as: { agentmail_identity: 'marcus@smith-pi-firm.agents.smd.services' },
        skills: [{ name: 'conflict-check', trust_ceiling: 'autonomous' }],
        channel_bindings: [{ integration: 'ms-graph', channels: ['primary-inbox'] }],
      },
    ],
    connectors: {
      Email: {
        adapter: 'microsoft-graph',
        backend: 'mcp:softeria/ms-365-mcp-server',
        token_ref: 'infisical:/operator/smith-pi-firm/email/refresh',
      },
    },
    scope: {
      email_folders_visible: ['Inbox'],
      email_folders_blind: [],
      email_keyword_blocks: [],
      domain_blocks: [],
    },
    escalation: {
      red_flag_recipients: ['partner@firm.com'],
      failure_recipients: ['partner@firm.com'],
    },
    memory: {
      d1_namespace: SLUG,
      r2_vault_path: `vaults/${SLUG}/`,
      vectorize_index: `hermes-${SLUG}-vault`,
    },
  }
}

/** A benign YAML text blob written verbatim to R2. Content is decoupled from
 * the parsed object in these tests — apply validates `parsed` and stores
 * `rawYaml` bytes. Must not contain any banned/secret-shaped token. */
function rawYamlText(marker = 'v1'): string {
  return `customer_id: ${SLUG}\ncustomer_name: Smith PI Firm\nmarker: ${marker}\n`
}

/** In-memory R2 fake recording every put. */
interface PutCall {
  key: string
  value: string
  contentType: string | undefined
  customMetadata: Record<string, string> | undefined
}
function makeBucket(): { bucket: ConfigBucket; puts: PutCall[] } {
  const puts: PutCall[] = []
  const bucket: ConfigBucket = {
    async put(key, value, options) {
      puts.push({
        key,
        value: typeof value === 'string' ? value : '[binary]',
        contentType: options?.httpMetadata?.contentType,
        customMetadata: options?.customMetadata,
      })
      return {}
    },
  }
  return { bucket, puts }
}

/** R2 fake that fails the test if put() is ever called (reject path). */
function noWriteBucket(): ConfigBucket {
  return {
    async put() {
      throw new Error('put() must not be called on the reject path')
    },
  }
}

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

describe('applyConfig — valid edit', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await freshDb()
  })

  it('writes both R2 keys (snapshot + live) and records a history row', async () => {
    const { bucket, puts } = makeBucket()
    const raw = rawYamlText()
    const res = await applyConfig(bucket, db, {
      slug: SLUG,
      rawYaml: raw,
      parsed: validParsed(),
      actor: 'captain@smd.services',
      now: () => new Date('2026-06-15T12:00:00.000Z'),
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return

    const expectedDigest = await digestYaml(raw)
    expect(res.digest).toBe(expectedDigest)
    expect(res.liveKey).toBe(liveConfigKey(SLUG))
    expect(res.snapshotKey).toBe(snapshotKey(SLUG, expectedDigest))

    // Two puts: snapshot first, then live.
    expect(puts).toHaveLength(2)
    expect(puts[0].key).toBe(`customers/${SLUG}/history/${expectedDigest}.yaml`)
    expect(puts[1].key).toBe(`vaults/${SLUG}/customer.yaml`)
    // Bytes written verbatim, not re-serialized.
    expect(puts[0].value).toBe(raw)
    expect(puts[1].value).toBe(raw)
    expect(puts[0].contentType).toBe('application/yaml')

    // History row landed with the snapshot key in r2_shadow_key.
    expect(res.history.recorded).toBe(true)
    const history = await listCustomerConfigHistory(db, SLUG)
    expect(history).toHaveLength(1)
    expect(history[0].r2_shadow_key).toBe(res.snapshotKey)
    expect(history[0].r2_shadow_key).not.toBeNull()
    expect(history[0].synced_by).toBe('manual')
    expect(history[0].actor).toBe('captain@smd.services')
    expect(history[0].git_sha).toBe(`r2apply:${expectedDigest}`)
  })

  it('is idempotent: re-applying identical bytes does not duplicate the history row', async () => {
    const { bucket } = makeBucket()
    const input = {
      slug: SLUG,
      rawYaml: rawYamlText(),
      parsed: validParsed(),
      actor: 'captain@smd.services',
    }
    const first = await applyConfig(bucket, db, input)
    const second = await applyConfig(bucket, db, input)

    expect(first.ok && second.ok).toBe(true)
    if (!second.ok) return
    // Same digest, identical SHA → recordCustomerConfigSync no-ops on the second.
    expect(second.history.recorded).toBe(false)
    const history = await listCustomerConfigHistory(db, SLUG)
    expect(history).toHaveLength(1)
  })

  it('records a second history row when the bytes change', async () => {
    const { bucket } = makeBucket()
    const rawV1 = rawYamlText('v1')
    const rawV2 = rawYamlText('v2')
    await applyConfig(bucket, db, {
      slug: SLUG,
      rawYaml: rawV1,
      parsed: validParsed(),
      actor: 'a@smd.services',
      now: () => new Date('2026-06-15T12:00:00.000Z'),
    })
    await applyConfig(bucket, db, {
      slug: SLUG,
      rawYaml: rawV2,
      parsed: validParsed(),
      actor: 'a@smd.services',
      now: () => new Date('2026-06-15T12:05:00.000Z'),
    })
    const history = await listCustomerConfigHistory(db, SLUG)
    expect(history).toHaveLength(2)
    // Rows come back synced_at DESC; the most-recent (v2) chains to the first.
    const v1Digest = await digestYaml(rawV1)
    expect(history[0].prev_git_sha).toBe(`r2apply:${v1Digest}`)
    expect(history[1].prev_git_sha).toBeNull()
  })
})

describe('applyConfig — invalid edit rejects and writes nothing', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await freshDb()
  })

  it('rejects a structurally invalid config and never calls R2.put', async () => {
    const parsed = validParsed()
    delete parsed['customer_name'] // MissingField
    const res = await applyConfig(noWriteBucket(), db, {
      slug: SLUG,
      rawYaml: rawYamlText(),
      parsed,
      actor: null,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors.some((e) => e.code === 'MissingField')).toBe(true)
    // No history row written.
    const history = await listCustomerConfigHistory(db, SLUG)
    expect(history).toHaveLength(0)
  })

  it('rejects when customer_id does not match the apply slug', async () => {
    const parsed = validParsed()
    parsed['customer_id'] = 'someone-else'
    // memory isolation fields also key off customer_id; align them so the only
    // failure surfaced is the slug mismatch guard (not an IsolationViolation in
    // the validator before our guard runs). Use a fully-consistent other slug.
    parsed['memory'] = {
      d1_namespace: 'someone-else',
      r2_vault_path: 'vaults/someone-else/',
      vectorize_index: 'hermes-someone-else-vault',
    }
    const res = await applyConfig(noWriteBucket(), db, {
      slug: SLUG,
      rawYaml: rawYamlText(),
      parsed,
      actor: null,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors.some((e) => e.path === 'customer_id')).toBe(true)
    const history = await listCustomerConfigHistory(db, SLUG)
    expect(history).toHaveLength(0)
  })

  it('rejects a leaked secret in the raw YAML text (fail-closed scan)', async () => {
    const leaked = `api_key: ${['sk', 'live', 'abcdefghijklmnopqrstuvwxyz12345678'].join('_')}\n`
    const res = await applyConfig(noWriteBucket(), db, {
      slug: SLUG,
      rawYaml: leaked,
      parsed: validParsed(),
      actor: null,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    // Secret detector fires on the raw-text pass.
    expect(res.errors.length).toBeGreaterThan(0)
    const history = await listCustomerConfigHistory(db, SLUG)
    expect(history).toHaveLength(0)
  })
})

describe('planReconciliation', () => {
  it('flags never-committed and drifted customers, skips in-sync', () => {
    const plan = planReconciliation([
      { customer_slug: 'a', live_digest: 'd1', committed_digest: null },
      { customer_slug: 'b', live_digest: 'd2', committed_digest: 'd-old' },
      { customer_slug: 'c', live_digest: 'd3', committed_digest: 'd3' },
    ])
    expect(plan.to_commit).toEqual([
      { customer_slug: 'a', live_digest: 'd1', reason: 'never-committed' },
      { customer_slug: 'b', live_digest: 'd2', reason: 'digest-drift' },
    ])
    expect(plan.in_sync).toEqual(['c'])
  })

  it('returns empty plan for no candidates', () => {
    expect(planReconciliation([])).toEqual({ to_commit: [], in_sync: [] })
  })
})

describe('runReconciliation', () => {
  it('throws (v1 stub) rather than silently no-op', () => {
    expect(() => runReconciliation()).toThrow(/deferred/)
  })
})
