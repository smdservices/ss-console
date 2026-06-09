/**
 * Team surface (client-portal §5.7) — roster projection + the people_access
 * authority gate.
 *
 * The pure aggregation (one member per person, roles ordered, name→email
 * fallback) and the fail-closed gate are the load-bearing pieces: at launch the
 * surface is Read + Request, so the roster projection IS the view, and the gate
 * is what stops a hand-crafted POST from mutating a managed roster.
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
import { aggregateMembers, formatLastLogin } from '../src/lib/portal/operator/team-read'
import { isPeopleAccessOperable } from '../src/lib/portal/operator/people-access-gate'

const migrationsDir = resolve(process.cwd(), 'migrations')

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    email: 'pat@firm.com',
    name: 'Pat Paralegal',
    last_login_at: '2026-06-01T00:00:00.000Z',
    role: 'staff',
    granted_at: '2026-05-01T00:00:00.000Z',
    ...over,
  } as Parameters<typeof aggregateMembers>[0][number]
}

describe('aggregateMembers', () => {
  it('collapses per-role rows into one member with roles ordered principal→staff→compliance', () => {
    const members = aggregateMembers([
      row({ id: 'u-1', role: 'compliance' }),
      row({ id: 'u-1', role: 'principal' }),
      row({ id: 'u-1', role: 'staff' }),
    ])
    expect(members).toHaveLength(1)
    expect(members[0].roles).toEqual(['principal', 'staff', 'compliance'])
  })

  it('falls back to email when name is empty — never a blank member', () => {
    const members = aggregateMembers([row({ name: '' })])
    expect(members[0].name).toBe('pat@firm.com')
  })

  it('drops rows missing id or email (never a fabricated person)', () => {
    expect(aggregateMembers([row({ id: '' })])).toHaveLength(0)
    expect(aggregateMembers([row({ email: '' })])).toHaveLength(0)
  })

  it('keeps distinct people separate', () => {
    const members = aggregateMembers([
      row({ id: 'u-1', email: 'a@firm.com', name: 'A' }),
      row({ id: 'u-2', email: 'b@firm.com', name: 'B' }),
    ])
    expect(members.map((m) => m.id).sort()).toEqual(['u-1', 'u-2'])
  })
})

describe('formatLastLogin', () => {
  it('renders Never for null/invalid and a date otherwise', () => {
    expect(formatLastLogin(null)).toBe('Never')
    expect(formatLastLogin('not-a-date')).toBe('Never')
    expect(formatLastLogin('2026-06-01T00:00:00.000Z')).toContain('2026')
  })
})

describe('isPeopleAccessOperable: fail-closed authority gate', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
  })

  async function seedConfig(authorityJson: string | null): Promise<void> {
    await db
      .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
      .bind('ent-1', ORG_ID, 'Acme Law', 'acme-law')
      .run()
    await db
      .prepare(
        `INSERT INTO customer_configs
          (entity_id, org_id, customer_slug, schema_version, personas_json, authority_json, git_sha, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'ent-1',
        ORG_ID,
        'acme-law',
        '1.0.0',
        '[]',
        authorityJson,
        'sha',
        '2026-06-08T00:00:00Z'
      )
      .run()
  }

  it('is false when no config row exists (fail-closed)', async () => {
    expect(await isPeopleAccessOperable(db, 'ent-missing')).toBe(false)
  })

  it('is false under the launch-default (managed) posture', async () => {
    await seedConfig(null)
    expect(await isPeopleAccessOperable(db, 'ent-1')).toBe(false)
  })

  it('is false when another domain is client-operable but people_access is not', async () => {
    await seedConfig(JSON.stringify({ default: 'managed', overrides: { runtime: 'client' } }))
    expect(await isPeopleAccessOperable(db, 'ent-1')).toBe(false)
  })

  it('is true only when people_access is explicitly client-operable', async () => {
    await seedConfig(JSON.stringify({ default: 'managed', overrides: { people_access: 'client' } }))
    expect(await isPeopleAccessOperable(db, 'ent-1')).toBe(true)
  })
})
