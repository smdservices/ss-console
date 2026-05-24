/**
 * Tests for the customer_configs projection helpers
 * (src/lib/portal/customer-config.ts).
 *
 * Per ADR 0012, customer_configs is a read replica of `customer.yaml` (which
 * lives in a canonical git repo). The helpers under test parse projected JSON
 * columns into typed shapes and resolve the active persona per ADR 0011 §1.
 *
 * Each test seeds a customer_configs row directly via the test D1 — emulating
 * what CI will do post-merge, since the CI sync path lands in a follow-on
 * PR. The schema constraints (FK to entities, UNIQUE customer_slug, NOT NULL
 * on personas_json) are exercised through real seeds.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { ORG_ID } from '../src/lib/constants'
import {
  getCustomerConfig,
  getActivePersona,
  type PersonaConfig,
} from '../src/lib/portal/customer-config'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ENTITY_ID = 'entity-config-test'
const CUSTOMER_SLUG = 'smith-pi-firm'

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

async function seedEntity(db: D1Database): Promise<void> {
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(ENTITY_ID, ORG_ID, 'Smith PI Firm', 'smith-pi-firm')
    .run()
}

interface SeedOptions {
  entity_id?: string
  customer_slug?: string
  schema_version?: string
  personas?: PersonaConfig[]
  voice_library?: unknown
  escalation?: unknown
  business_hours?: unknown
  connectors?: unknown
  scope?: unknown
  git_sha?: string
  synced_at?: string
}

async function seedConfig(db: D1Database, opts: SeedOptions = {}): Promise<void> {
  const personas = opts.personas ?? [makePersona({ slug: 'marcus' })]
  await db
    .prepare(
      `INSERT INTO customer_configs
        (entity_id, org_id, customer_slug, schema_version,
         personas_json, voice_library_json, escalation_json, business_hours_json,
         connectors_json, scope_json, git_sha, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      opts.entity_id ?? ENTITY_ID,
      ORG_ID,
      opts.customer_slug ?? CUSTOMER_SLUG,
      opts.schema_version ?? '1.0.0',
      JSON.stringify(personas),
      opts.voice_library === undefined ? null : JSON.stringify(opts.voice_library),
      opts.escalation === undefined ? null : JSON.stringify(opts.escalation),
      opts.business_hours === undefined ? null : JSON.stringify(opts.business_hours),
      opts.connectors === undefined ? null : JSON.stringify(opts.connectors),
      opts.scope === undefined ? null : JSON.stringify(opts.scope),
      opts.git_sha ?? 'a1b2c3d4e5f6',
      opts.synced_at ?? '2026-05-21T12:00:00Z'
    )
    .run()
}

function makePersona(overrides: Partial<PersonaConfig> = {}): PersonaConfig {
  return {
    slug: 'marcus',
    status: 'active',
    name: 'Marcus',
    title: 'AI Associate',
    signature_html: '<p>Marcus<br/>AI Associate</p>',
    tone: ['warm-but-professional'],
    send_as: { agentmail_identity: 'marcus@smith-pi-firm.agents.smd.services' },
    skills: [{ name: 'inbox-triage-and-draft', trust_ceiling: 'draft_for_review' }],
    channel_bindings: [{ integration: 'ms-graph', channels: ['primary-inbox'] }],
    ...overrides,
  }
}

describe('getCustomerConfig', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await freshDb()
  })

  it('returns null when no config row exists for the entity', async () => {
    await seedEntity(db)
    const result = await getCustomerConfig(db, ENTITY_ID)
    expect(result).toBeNull()
  })

  it('parses personas_json and other JSON columns into typed shape', async () => {
    await seedEntity(db)
    await seedConfig(db, {
      personas: [makePersona()],
      escalation: { red_flag_recipients: ['partner@firm.com'] },
      business_hours: { start: '08:00', end: '18:00', tz: 'America/Phoenix' },
    })
    const result = await getCustomerConfig(db, ENTITY_ID)
    expect(result).not.toBeNull()
    expect(result?.personas).toHaveLength(1)
    expect(result?.personas[0].name).toBe('Marcus')
    expect(result?.personas[0].skills[0].name).toBe('inbox-triage-and-draft')
    expect(result?.escalation).toEqual({ red_flag_recipients: ['partner@firm.com'] })
    expect(result?.business_hours).toEqual({ start: '08:00', end: '18:00', tz: 'America/Phoenix' })
  })

  it('returns the row’s schema_version and git_sha verbatim for drift detection', async () => {
    await seedEntity(db)
    await seedConfig(db, { schema_version: '2.3.1', git_sha: 'deadbeef1234' })
    const result = await getCustomerConfig(db, ENTITY_ID)
    expect(result?.schema_version).toBe('2.3.1')
    expect(result?.git_sha).toBe('deadbeef1234')
  })

  it('returns null for nullable columns that were not populated', async () => {
    await seedEntity(db)
    await seedConfig(db, {
      personas: [makePersona()],
      // voice_library, escalation, business_hours, connectors, scope all omitted
    })
    const result = await getCustomerConfig(db, ENTITY_ID)
    expect(result?.voice_library).toBeNull()
    expect(result?.escalation).toBeNull()
    expect(result?.business_hours).toBeNull()
    expect(result?.connectors).toBeNull()
    expect(result?.scope).toBeNull()
  })

  it('defaults compliance_enabled to false when the projection column was not populated', async () => {
    await seedEntity(db)
    await seedConfig(db, { personas: [makePersona()] })
    const result = await getCustomerConfig(db, ENTITY_ID)
    expect(result?.compliance_enabled).toBe(false)
  })

  it('projects compliance_enabled=true and vertical when explicitly set (#895)', async () => {
    await seedEntity(db)
    await seedConfig(db, { personas: [makePersona()] })
    // Update directly — the seed helper doesn't accept the new columns
    // because they default; the row is freshly written without them.
    await db
      .prepare(
        `UPDATE customer_configs
            SET compliance_enabled = 1, vertical = 'law-firm'
          WHERE entity_id = ?`
      )
      .bind(ENTITY_ID)
      .run()
    const result = await getCustomerConfig(db, ENTITY_ID)
    expect(result?.compliance_enabled).toBe(true)
    expect(result?.vertical).toBe('law-firm')
  })

  it('keeps vertical null when not yet projected', async () => {
    await seedEntity(db)
    await seedConfig(db, { personas: [makePersona()] })
    const result = await getCustomerConfig(db, ENTITY_ID)
    expect(result?.vertical).toBeNull()
  })
})

describe('getActivePersona', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await freshDb()
  })

  it('returns null when no config row exists', async () => {
    await seedEntity(db)
    const result = await getActivePersona(db, ENTITY_ID)
    expect(result).toBeNull()
  })

  it('returns null when personas array is empty (degenerate but well-formed)', async () => {
    await seedEntity(db)
    await seedConfig(db, { personas: [] })
    const result = await getActivePersona(db, ENTITY_ID)
    expect(result).toBeNull()
  })

  it('returns null when every persona is archived', async () => {
    await seedEntity(db)
    await seedConfig(db, {
      personas: [
        makePersona({ slug: 'marcus', status: 'archived' }),
        makePersona({ slug: 'casey', status: 'archived', name: 'Casey' }),
      ],
    })
    const result = await getActivePersona(db, ENTITY_ID)
    expect(result).toBeNull()
  })

  it('returns the single active persona at v1 (length-1 array)', async () => {
    await seedEntity(db)
    await seedConfig(db, { personas: [makePersona({ slug: 'marcus' })] })
    const result = await getActivePersona(db, ENTITY_ID)
    expect(result?.slug).toBe('marcus')
    expect(result?.name).toBe('Marcus')
  })

  it('skips archived personas even when they appear before an active one', async () => {
    await seedEntity(db)
    await seedConfig(db, {
      personas: [
        makePersona({ slug: 'marcus-old', status: 'archived', name: 'Marcus Old' }),
        makePersona({ slug: 'casey', status: 'active', name: 'Casey' }),
      ],
    })
    const result = await getActivePersona(db, ENTITY_ID)
    expect(result?.slug).toBe('casey')
    expect(result?.name).toBe('Casey')
  })
})

describe('customer_configs schema integrity', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await freshDb()
  })

  it('FK from entity_id to entities.id rejects an orphan insert', async () => {
    // Insert with a non-existent entity_id should fail
    await expect(seedConfig(db, { entity_id: 'no-such-entity' })).rejects.toThrow()
  })

  it('UNIQUE(customer_slug) rejects duplicate-slug insert across different entities', async () => {
    await seedEntity(db)
    await db
      .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
      .bind('entity-other', ORG_ID, 'Other Firm', 'other-firm')
      .run()

    await seedConfig(db, { entity_id: ENTITY_ID, customer_slug: 'same-slug' })
    await expect(
      seedConfig(db, { entity_id: 'entity-other', customer_slug: 'same-slug' })
    ).rejects.toThrow()
  })
})
