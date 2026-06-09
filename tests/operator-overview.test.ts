/**
 * Tests for the per-operator overview reader + derivations
 * (src/lib/admin/operator-overview.ts) — admin Operator console §5.1.
 *
 * Covers the slug→entity_id resolution against a seeded customer_configs row,
 * and the pure derivations the overview renders: the per-domain authority
 * summary (every switchable domain + holder), the holder badge wording (never
 * implying SMD lost control), subscription-state prose, and persona cell
 * helpers.
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
  resolveEntityIdBySlug,
  domainAuthoritySummary,
  smdOnlyDomains,
  authorityHolderBadge,
  subscriptionState,
  personaStatusDisplay,
  skillCountLabel,
  AUTHORITY_DOMAIN_LABELS,
} from '../src/lib/admin/operator-overview'
import {
  DEFAULT_AUTHORITY_POSTURE,
  SWITCHABLE_AUTHORITY_DOMAINS,
  type AuthorityPosture,
} from '../src/lib/operator/authority'

const migrationsDir = resolve(process.cwd(), 'migrations')

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

describe('resolveEntityIdBySlug', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
  })

  it('returns the entity_id for a known slug and null otherwise', async () => {
    await db
      .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
      .bind('ent-1', ORG_ID, 'Acme Law', 'acme-law')
      .run()
    await db
      .prepare(
        `INSERT INTO customer_configs
          (entity_id, org_id, customer_slug, schema_version, personas_json, git_sha, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind('ent-1', ORG_ID, 'acme-law', '1.0.0', '[]', 'sha', '2026-06-08T00:00:00Z')
      .run()

    expect(await resolveEntityIdBySlug(db, 'acme-law')).toBe('ent-1')
    expect(await resolveEntityIdBySlug(db, 'nope')).toBeNull()
  })
})

describe('domainAuthoritySummary', () => {
  it('covers every switchable domain with a label', () => {
    const rows = domainAuthoritySummary(DEFAULT_AUTHORITY_POSTURE)
    expect(rows).toHaveLength(SWITCHABLE_AUTHORITY_DOMAINS.length)
    for (const row of rows) {
      expect(row.label).toBe(AUTHORITY_DOMAIN_LABELS[row.domain])
      expect(typeof row.label).toBe('string')
    }
  })

  it('launch-default posture marks every domain SMD-operated (not client-operable)', () => {
    const rows = domainAuthoritySummary(DEFAULT_AUTHORITY_POSTURE)
    expect(rows.every((r) => r.holder === 'managed')).toBe(true)
    expect(rows.every((r) => r.clientOperable === false)).toBe(true)
  })

  it('reflects an authored client override as client-operable', () => {
    const posture: AuthorityPosture = {
      default: 'managed',
      overrides: { people_access: 'client' },
    }
    const rows = domainAuthoritySummary(posture)
    const people = rows.find((r) => r.domain === 'people_access')!
    expect(people.holder).toBe('client')
    expect(people.clientOperable).toBe(true)
    // Other domains stay SMD-operated.
    expect(rows.filter((r) => r.clientOperable)).toHaveLength(1)
  })

  it('a null posture resolves to the launch default', () => {
    const rows = domainAuthoritySummary(null)
    expect(rows.every((r) => r.holder === 'managed')).toBe(true)
  })
})

describe('smdOnlyDomains', () => {
  it('lists provisioning and cost with labels', () => {
    const rows = smdOnlyDomains()
    expect(rows.map((r) => r.domain).sort()).toEqual(['cost', 'provisioning'])
    expect(rows.every((r) => r.label.length > 0)).toBe(true)
  })
})

describe('authorityHolderBadge', () => {
  it('client holder reads as additive ("Client + SMD"), never replacing SMD', () => {
    const badge = authorityHolderBadge('client')
    expect(badge.label).toBe('Client + SMD')
    expect(badge.classes).toContain('rounded-[var(--ss-radius-badge)]')
  })

  it('managed holder reads as SMD', () => {
    expect(authorityHolderBadge('managed').label).toBe('SMD')
  })
})

describe('subscriptionState', () => {
  it('maps known statuses and treats null as a real pre-activation state', () => {
    expect(subscriptionState('active').label).toBe('Active')
    expect(subscriptionState('provisioning').label).toBe('Provisioning')
    expect(subscriptionState('paused').label).toBe('Paused')
    expect(subscriptionState(null).label).toBe('No subscription yet')
    expect(subscriptionState('weird').label).toBe('weird')
  })

  it('every state carries a token-based color class', () => {
    for (const s of ['active', 'provisioning', 'paused', null, 'weird'] as const) {
      expect(subscriptionState(s).colorClass).toContain('var(--ss-color-')
    }
  })
})

describe('persona cell helpers', () => {
  it('personaStatusDisplay maps status to label + dot', () => {
    expect(personaStatusDisplay('active').label).toBe('Active')
    expect(personaStatusDisplay('archived').label).toBe('Archived')
    expect(personaStatusDisplay('draft').label).toBe('draft')
    expect(personaStatusDisplay('active').dotClass).toContain('--ss-color-complete')
  })

  it('skillCountLabel pluralizes and has an honest zero state', () => {
    expect(skillCountLabel(0)).toBe('no skills')
    expect(skillCountLabel(1)).toBe('1 skill')
    expect(skillCountLabel(4)).toBe('4 skills')
  })
})
