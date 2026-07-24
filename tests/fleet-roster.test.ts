/**
 * Tests for the fleet-roster reader + pure derivations
 * (src/lib/admin/fleet-roster.ts) — admin Operator console §4.1.
 *
 * Two properties matter most and are exercised here:
 *
 *   1. Fleet-view resilience (ADR 0043, foundations §7): one corrupt
 *      `customer_configs` row degrades to a flagged `config_error` row — it
 *      never throws and blanks the whole fleet view.
 *   2. Posture + health derivations never read calmer than reality: posture
 *      labels follow the switch pattern (foundations §4.1) and `rosterHealth`
 *      takes the more alarming of heartbeat vs summary rollup.
 *
 * DB-touching tests seed `customer_configs` + `entities` directly via the test
 * D1 (same posture as customer-config.test.ts — CI sync lands separately).
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
  listFleetRoster,
  derivePostureLabel,
  posturePill,
  rosterHealth,
  rosterHealthDotClass,
  personaSummary,
  type RosterPersona,
} from '../src/lib/admin/fleet-roster'
import { DEFAULT_AUTHORITY_POSTURE, type AuthorityPosture } from '../src/lib/operator/authority'

const migrationsDir = resolve(process.cwd(), 'migrations')

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

async function seedEntity(db: D1Database, id: string, name: string, slug: string): Promise<void> {
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(id, ORG_ID, name, slug)
    .run()
}

function persona(overrides: Partial<RosterPersona> = {}): RosterPersona {
  return { slug: 'marcus', name: 'Marcus', status: 'active', ...overrides }
}

interface SeedConfig {
  entity_id: string
  customer_slug: string
  personas_json?: string
  authority_json?: string | null
  vertical?: string | null
}

async function seedConfig(db: D1Database, c: SeedConfig): Promise<void> {
  await db
    .prepare(
      `INSERT INTO customer_configs
        (entity_id, org_id, customer_slug, schema_version, personas_json,
         authority_json, vertical, git_sha, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      c.entity_id,
      ORG_ID,
      c.customer_slug,
      '1.0.0',
      c.personas_json ?? JSON.stringify([persona()]),
      c.authority_json === undefined ? null : c.authority_json,
      c.vertical ?? null,
      'a1b2c3d4',
      '2026-06-08T12:00:00Z'
    )
    .run()
}

describe('listFleetRoster', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
  })

  it('returns [] for an empty fleet', async () => {
    expect(await listFleetRoster(db)).toEqual([])
  })

  it('lists customers ordered by slug with entity name joined and personas parsed', async () => {
    await seedEntity(db, 'ent-b', 'Beta Firm', 'beta-firm')
    await seedEntity(db, 'ent-a', 'Alpha Firm', 'alpha-firm')
    await seedConfig(db, { entity_id: 'ent-b', customer_slug: 'beta-firm', vertical: 'law' })
    await seedConfig(db, {
      entity_id: 'ent-a',
      customer_slug: 'alpha-firm',
      personas_json: JSON.stringify([persona(), persona({ slug: 'nova', name: 'Nova' })]),
    })

    const roster = await listFleetRoster(db)
    expect(roster.map((r) => r.customer_slug)).toEqual(['alpha-firm', 'beta-firm'])

    const alpha = roster[0]
    expect(alpha.entity_name).toBe('Alpha Firm')
    expect(alpha.personas).toHaveLength(2)
    expect(alpha.personas[1]).toEqual({ slug: 'nova', name: 'Nova', status: 'active' })
    expect(alpha.config_error).toBeNull()

    const beta = roster[1]
    expect(beta.vertical).toBe('law')
    expect(beta.authority).toEqual(DEFAULT_AUTHORITY_POSTURE)
  })

  it('resolves an authored authority posture from authority_json', async () => {
    await seedEntity(db, 'ent-1', 'Gamma Firm', 'gamma-firm')
    await seedConfig(db, {
      entity_id: 'ent-1',
      customer_slug: 'gamma-firm',
      authority_json: JSON.stringify({
        default: 'managed',
        overrides: { people_access: 'client' },
      }),
    })
    const [row] = await listFleetRoster(db)
    expect(row.authority.overrides.people_access).toBe('client')
  })

  it('degrades a malformed personas_json row to a flagged config_error, never throwing', async () => {
    await seedEntity(db, 'ent-ok', 'OK Firm', 'ok-firm')
    await seedEntity(db, 'ent-bad', 'Bad Firm', 'bad-firm')
    await seedConfig(db, { entity_id: 'ent-ok', customer_slug: 'ok-firm' })
    await seedConfig(db, {
      entity_id: 'ent-bad',
      customer_slug: 'bad-firm',
      personas_json: '{not valid json',
    })

    const roster = await listFleetRoster(db)
    expect(roster).toHaveLength(2)
    const bad = roster.find((r) => r.customer_slug === 'bad-firm')!
    expect(bad.config_error).not.toBeNull()
    expect(bad.personas).toEqual([])
    expect(bad.authority).toEqual(DEFAULT_AUTHORITY_POSTURE)
    // The healthy row is unaffected.
    const ok = roster.find((r) => r.customer_slug === 'ok-firm')!
    expect(ok.config_error).toBeNull()
    expect(ok.personas).toHaveLength(1)
  })

  it('flags a personas_json that is valid JSON but not an array', async () => {
    await seedEntity(db, 'ent-x', 'X Firm', 'x-firm')
    await seedConfig(db, {
      entity_id: 'ent-x',
      customer_slug: 'x-firm',
      personas_json: JSON.stringify({ slug: 'oops' }),
    })
    const [row] = await listFleetRoster(db)
    expect(row.config_error).toMatch(/not an array/)
  })
})

describe('derivePostureLabel', () => {
  it('null / launch-default posture is Managed (every client switch off)', () => {
    expect(derivePostureLabel(null)).toBe('Managed')
    expect(derivePostureLabel(DEFAULT_AUTHORITY_POSTURE)).toBe('Managed')
  })

  it('a self_managed default with no overrides is Self-Managed', () => {
    const posture: AuthorityPosture = { default: 'self_managed', overrides: {} }
    expect(derivePostureLabel(posture)).toBe('Self-Managed')
  })

  it('a managed default with at least one client override is Co-Managed', () => {
    const posture: AuthorityPosture = { default: 'managed', overrides: { connectors: 'client' } }
    expect(derivePostureLabel(posture)).toBe('Co-Managed')
  })

  it('a self_managed default with one domain pinned back to managed is Co-Managed', () => {
    const posture: AuthorityPosture = { default: 'self_managed', overrides: { trust: 'managed' } }
    expect(derivePostureLabel(posture)).toBe('Co-Managed')
  })
})

describe('posturePill', () => {
  it('carries the label and a non-empty class string', () => {
    const pill = posturePill(DEFAULT_AUTHORITY_POSTURE)
    expect(pill.label).toBe('Managed')
    expect(pill.classes).toContain('rounded-[var(--ss-radius-badge)]')
  })
})

describe('rosterHealth', () => {
  it('takes the more alarming of heartbeat vs summary rollup', () => {
    // Heartbeat green but summary red → red.
    expect(rosterHealth('green', '20s ago', 'red').color).toBe('red')
    // Heartbeat red but summary green → red (heartbeat is worse).
    expect(rosterHealth('red', 'stale 9m', 'green').color).toBe('red')
    // Both benign → green.
    expect(rosterHealth('green', '5s ago', 'green').color).toBe('green')
  })

  it('keeps the heartbeat label and adds a note only for non-green summaries', () => {
    expect(rosterHealth('green', '20s ago', null).note).toBeNull()
    expect(rosterHealth('green', '20s ago', 'red').note).toMatch(/problem/)
    expect(rosterHealth('green', '20s ago', 'yellow').note).toMatch(/warning/)
    expect(rosterHealth('green', '20s ago', 'yellow').label).toBe('20s ago')
  })

  it('a missing summary (null) leaves the heartbeat color unchanged', () => {
    expect(rosterHealth('yellow', '3m ago', null).color).toBe('yellow')
    expect(rosterHealth('gray', 'no signal yet', null).color).toBe('gray')
  })

  it('a green summary never paints an un-heartbeating (gray) Machine green', () => {
    // The regression: no liveness signal must not read calmer than reality.
    // A stale/green summary can only leave the gray verdict standing, never
    // upgrade it — only a yellow/red summary escalates.
    expect(rosterHealth('gray', 'no signal yet', 'green').color).toBe('gray')
    expect(rosterHealth('gray', 'no signal yet', 'red').color).toBe('red')
    expect(rosterHealth('gray', 'no signal yet', 'yellow').color).toBe('yellow')
  })

  it('the cost breaker escalates: SOFT_STOP → yellow, HARD_STOP → red (ADR 0062)', () => {
    expect(rosterHealth('green', '5s ago', null, 'HARD_STOP').color).toBe('red')
    expect(rosterHealth('green', '5s ago', null, 'HARD_STOP').note).toMatch(/hard stop/)
    expect(rosterHealth('green', '5s ago', null, 'SOFT_STOP').color).toBe('yellow')
    expect(rosterHealth('green', '5s ago', null, 'SOFT_STOP').note).toMatch(/soft stop/)
    // OK / WARN / unknown / absent never change the dot.
    expect(rosterHealth('green', '5s ago', null, 'OK').color).toBe('green')
    expect(rosterHealth('green', '5s ago', null, 'WARN').color).toBe('green')
    expect(rosterHealth('green', '5s ago', null, 'unknown').color).toBe('green')
    // The breaker can never CALM a dot (a red heartbeat stays red at OK).
    expect(rosterHealth('red', 'stale 9m', null, 'OK').color).toBe('red')
    // Breaker note wins over the summary note when both fire.
    expect(rosterHealth('green', '5s ago', 'yellow', 'HARD_STOP').note).toMatch(/hard stop/)
  })
})

describe('rosterHealthDotClass', () => {
  it('maps every color to a token-based background class', () => {
    expect(rosterHealthDotClass('green')).toContain('--ss-color-complete')
    expect(rosterHealthDotClass('yellow')).toContain('--ss-color-attention')
    expect(rosterHealthDotClass('red')).toContain('--ss-color-error')
    expect(rosterHealthDotClass('gray')).toContain('--ss-color-border')
  })
})

describe('personaSummary', () => {
  it('renders count with archived suffix and an honest zero state', () => {
    expect(personaSummary([])).toBe('no personas')
    expect(personaSummary([persona()])).toBe('1 persona')
    expect(personaSummary([persona(), persona({ slug: 'n', name: 'N' })])).toBe('2 personas')
    expect(personaSummary([persona(), persona({ slug: 'a', status: 'archived' })])).toBe(
      '2 personas (1 archived)'
    )
  })
})
