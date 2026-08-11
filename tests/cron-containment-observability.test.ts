/**
 * ss#2276 — cron containment visibility, console side.
 *
 * The overlay's CRON_CONTAINMENT volume sentinel durably disables all managed
 * cron jobs across boots (the #2258-incident lever) and reports the state on
 * every heartbeat as `cron_containment` 1/0. This file covers the two console
 * seams:
 *
 *   1. Ingest (migration 0105 + heartbeat.ts): stored 1/0, junk → NULL, and
 *      the overwrite-including-NULL discipline (a rollback that drops the
 *      field must not pin a stale "contained" verdict).
 *   2. Roster (fleet-roster.ts): a contained seat paints attention-yellow with
 *      the note naming the state as deliberate — visible, never mistaken for
 *      quiet, and never calming a worse color (Law 12).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
  installWorkerdPolyfills,
} from '@venturecrane/crane-test-harness'
import path from 'node:path'
import { POST } from '../src/pages/api/internal/heartbeat'
import { rosterHealth } from '../src/lib/admin/fleet-roster'
import { env as testEnv } from 'cloudflare:workers'

installWorkerdPolyfills()

const migrationsDir = path.resolve(__dirname, '../migrations')
const MACHINE_KEY = 'test-machine-heartbeat-key-32-chars'
const ORG_ID = 'org-contain'
const ENTITY = 'ent-contain'
const SLUG = 'contain-co'

async function seed(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES (?, 'Contain Org', 'contain-org', datetime('now'), datetime('now'))`
    )
    .bind(ORG_ID)
    .run()
  await db
    .prepare(
      `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ongoing', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(ENTITY, ORG_ID, SLUG, SLUG)
    .run()
  await db
    .prepare(
      `INSERT INTO customer_configs
         (entity_id, org_id, customer_slug, schema_version, personas_json, git_sha, synced_at)
       VALUES (?, ?, ?, '1.0.0', '[]', 'sha', '2026-07-24T00:00:00Z')`
    )
    .bind(ENTITY, ORG_ID, SLUG)
    .run()
}

function heartbeatRequest(body: Record<string, unknown>): Parameters<typeof POST>[0] {
  const request = new Request('http://test.local/api/internal/heartbeat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MACHINE_KEY}`,
      'X-Tenant-Slug': SLUG,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { request, params: {}, locals: {} } as unknown as Parameters<typeof POST>[0]
}

async function readContainment(db: D1Database): Promise<unknown> {
  const row = await db
    .prepare('SELECT cron_containment FROM fleet_status WHERE customer_slug = ?')
    .bind(SLUG)
    .first<{ cron_containment: unknown }>()
  return row?.cron_containment
}

describe('POST /api/internal/heartbeat — cron_containment (ss#2276)', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seed(db)
    for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
    Object.assign(testEnv, { DB: db, MACHINE_HEARTBEAT_KEY: MACHINE_KEY })
  })

  it('stores 1 and 0, coercing booleans', async () => {
    await POST(heartbeatRequest({ heartbeat_ts: new Date().toISOString(), cron_containment: 1 }))
    expect(await readContainment(db)).toBe(1)
    await POST(
      heartbeatRequest({ heartbeat_ts: new Date().toISOString(), cron_containment: false })
    )
    expect(await readContainment(db)).toBe(0)
    await POST(heartbeatRequest({ heartbeat_ts: new Date().toISOString(), cron_containment: true }))
    expect(await readContainment(db)).toBe(1)
  })

  it('stores NULL for junk — never manufactures a containment verdict', async () => {
    await POST(
      heartbeatRequest({ heartbeat_ts: new Date().toISOString(), cron_containment: 'yes' })
    )
    expect(await readContainment(db)).toBeNull()
  })

  it('a beat WITHOUT the field overwrites a stored 1 back to NULL', async () => {
    // Overwrite-including-NULL: after an overlay rollback drops the field, a
    // stale pinned "contained" must not outlive the signal that produced it.
    await POST(heartbeatRequest({ heartbeat_ts: new Date().toISOString(), cron_containment: 1 }))
    expect(await readContainment(db)).toBe(1)
    await POST(heartbeatRequest({ heartbeat_ts: new Date().toISOString() }))
    expect(await readContainment(db)).toBeNull()
  })
})

describe('rosterHealth — contained seat is visible, never calming (ss#2276)', () => {
  const scheduler = (cronContainment: number | null) => ({
    ok: 1,
    maxOverdueSeconds: 0,
    connectorCheckOk: 1,
    connectorsJson: '{}',
    cronContainment,
  })

  it('paints attention-yellow with the deliberate-containment note', () => {
    const health = rosterHealth('green', 'just now', null, null, scheduler(1))
    expect(health.color).toBe('yellow')
    expect(health.note).toBe('crons contained (deliberate)')
  })

  it('never calms a red seat', () => {
    const health = rosterHealth('red', 'stale 47m', null, null, scheduler(1))
    expect(health.color).toBe('red')
  })

  it('containment note outranks the overdue note it explains', () => {
    const health = rosterHealth('green', 'just now', null, null, {
      ...scheduler(1),
      maxOverdueSeconds: 100000,
    })
    expect(health.note).toBe('crons contained (deliberate)')
  })

  it('NULL and 0 participate in nothing', () => {
    expect(rosterHealth('green', 'just now', null, null, scheduler(null)).color).toBe('green')
    expect(rosterHealth('green', 'just now', null, null, scheduler(0)).color).toBe('green')
    expect(rosterHealth('green', 'just now', null, null, scheduler(0)).note).toBeNull()
  })
})
