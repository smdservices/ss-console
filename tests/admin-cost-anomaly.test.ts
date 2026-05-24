/**
 * Unit tests for the cost-anomaly pure-function core (#886).
 *
 * Covers detectAnomaly threshold semantics, insufficient-history handling,
 * the top-driver-by-delta picker, the dense-series builder, and the
 * central-D1 alert read/write helpers via a real D1 in the
 * crane-test-harness.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
  installWorkerdPolyfills,
} from '@venturecrane/crane-test-harness'
import type { D1Database } from '@cloudflare/workers-types'
import path from 'node:path'
import {
  AGGREGATE_DRIVER_SENTINEL,
  DEFAULT_THRESHOLD_BPS,
  acknowledgeAlert,
  buildDailySeries,
  buildPerDriverSeries,
  detectAnomaly,
  listOpenAlerts,
  pickTopDriverByDelta,
  snoozeAlert,
  upsertAlert,
} from '../src/lib/admin/cost-anomaly'
import type { CostTelemetryRow } from '../src/lib/admin/cost-query'

installWorkerdPolyfills()

const migrationsDir = path.resolve(__dirname, '../migrations')

describe('detectAnomaly', () => {
  function flatSeries(cents: number, n: number) {
    return Array.from({ length: n }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      total_cents: cents,
    }))
  }

  it('returns insufficient-history when fewer than 8 days', () => {
    const r = detectAnomaly(flatSeries(100, 7))
    expect(r.kind).toBe('insufficient-history')
  })

  it('returns insufficient-history when prior 7-day avg is zero', () => {
    const series = [...flatSeries(0, 7), { date: '2026-05-08', total_cents: 500 }]
    const r = detectAnomaly(series)
    expect(r.kind).toBe('insufficient-history')
  })

  it('flags a 200% candidate as anomaly at default threshold (150%)', () => {
    const series = [...flatSeries(100, 7), { date: '2026-05-08', total_cents: 200 }]
    const r = detectAnomaly(series)
    expect(r.kind).toBe('anomaly')
    if (r.kind === 'anomaly') {
      expect(r.daily_cents).toBe(200)
      expect(r.rolling_avg_cents).toBe(100)
      expect(r.ratio_bps).toBe(20000)
      expect(r.threshold_bps).toBe(DEFAULT_THRESHOLD_BPS)
    }
  })

  it('does NOT flag a 149% candidate at default threshold', () => {
    const series = [...flatSeries(100, 7), { date: '2026-05-08', total_cents: 149 }]
    const r = detectAnomaly(series)
    expect(r.kind).toBe('no-anomaly')
    if (r.kind === 'no-anomaly') {
      expect(r.ratio_bps).toBe(14900)
    }
  })

  it('exactly-at-threshold is anomaly (inclusive)', () => {
    const series = [...flatSeries(100, 7), { date: '2026-05-08', total_cents: 150 }]
    const r = detectAnomaly(series)
    expect(r.kind).toBe('anomaly')
  })

  it('respects a custom threshold', () => {
    const series = [...flatSeries(100, 7), { date: '2026-05-08', total_cents: 175 }]
    expect(detectAnomaly(series, 20000).kind).toBe('no-anomaly')
    expect(detectAnomaly(series, 15000).kind).toBe('anomaly')
  })

  it('does not include the candidate day in the rolling average', () => {
    // 7 days at 100 + candidate at 700 → avg=100, ratio=700%. If the
    // implementation incorrectly included candidate in the average, the
    // avg would be (700 + 7*100) / 8 = 175 and ratio would only be 400%.
    const series = [...flatSeries(100, 7), { date: '2026-05-08', total_cents: 700 }]
    const r = detectAnomaly(series)
    expect(r.kind).toBe('anomaly')
    if (r.kind === 'anomaly') {
      expect(r.rolling_avg_cents).toBe(100)
      expect(r.ratio_bps).toBe(70000)
    }
  })
})

describe('buildDailySeries', () => {
  it('zero-fills missing days against the dates axis', () => {
    const rows: CostTelemetryRow[] = [
      { date: '2026-05-02', driver: 'd1', amount_cents: 100, units: 1, unit_type: null },
      { date: '2026-05-04', driver: 'd1', amount_cents: 200, units: 1, unit_type: null },
    ]
    const series = buildDailySeries(rows, ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04'])
    expect(series).toEqual([
      { date: '2026-05-01', total_cents: 0 },
      { date: '2026-05-02', total_cents: 100 },
      { date: '2026-05-03', total_cents: 0 },
      { date: '2026-05-04', total_cents: 200 },
    ])
  })

  it('sums across drivers on the same day', () => {
    const rows: CostTelemetryRow[] = [
      { date: '2026-05-01', driver: 'a', amount_cents: 100, units: 1, unit_type: null },
      { date: '2026-05-01', driver: 'b', amount_cents: 50, units: 1, unit_type: null },
    ]
    const series = buildDailySeries(rows, ['2026-05-01'])
    expect(series[0].total_cents).toBe(150)
  })

  it('drops negative amounts as defensive', () => {
    const rows: CostTelemetryRow[] = [
      { date: '2026-05-01', driver: 'a', amount_cents: 100, units: 1, unit_type: null },
      { date: '2026-05-01', driver: 'b', amount_cents: -50, units: 1, unit_type: null },
    ]
    const series = buildDailySeries(rows, ['2026-05-01'])
    expect(series[0].total_cents).toBe(100)
  })
})

describe('buildPerDriverSeries', () => {
  it('yields one series per driver with zeros for missing days', () => {
    const rows: CostTelemetryRow[] = [
      { date: '2026-05-01', driver: 'a', amount_cents: 100, units: 1, unit_type: null },
      { date: '2026-05-02', driver: 'b', amount_cents: 200, units: 1, unit_type: null },
    ]
    const map = buildPerDriverSeries(rows, ['2026-05-01', '2026-05-02'])
    expect(map.size).toBe(2)
    expect(map.get('a')).toEqual([
      { date: '2026-05-01', total_cents: 100 },
      { date: '2026-05-02', total_cents: 0 },
    ])
    expect(map.get('b')).toEqual([
      { date: '2026-05-01', total_cents: 0 },
      { date: '2026-05-02', total_cents: 200 },
    ])
  })
})

describe('pickTopDriverByDelta', () => {
  function rowsFor(driver: string, dailyByDate: Record<string, number>): CostTelemetryRow[] {
    return Object.entries(dailyByDate).map(([date, amount_cents]) => ({
      date,
      driver,
      amount_cents,
      units: 1,
      unit_type: null,
    }))
  }

  it('returns null when fewer than 8 dates', () => {
    const rows: CostTelemetryRow[] = rowsFor('a', { '2026-05-01': 100 })
    expect(pickTopDriverByDelta(rows, ['2026-05-01'])).toBeNull()
  })

  it('returns the driver with the largest positive delta', () => {
    const dates = Array.from({ length: 8 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`)
    // Driver A: 100/day prior, 500 on candidate → delta=400
    // Driver B: 50/day prior, 200 on candidate → delta=150
    const rowsA: CostTelemetryRow[] = dates.map((d, i) => ({
      date: d,
      driver: 'a',
      amount_cents: i === 7 ? 500 : 100,
      units: 1,
      unit_type: null,
    }))
    const rowsB: CostTelemetryRow[] = dates.map((d, i) => ({
      date: d,
      driver: 'b',
      amount_cents: i === 7 ? 200 : 50,
      units: 1,
      unit_type: null,
    }))
    const winner = pickTopDriverByDelta([...rowsA, ...rowsB], dates)
    expect(winner).not.toBeNull()
    expect(winner!.driver).toBe('a')
    expect(winner!.delta_cents).toBe(400)
  })

  it('returns null when no driver shows a positive delta', () => {
    const dates = Array.from({ length: 8 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`)
    const rows: CostTelemetryRow[] = dates.map((d) => ({
      date: d,
      driver: 'a',
      amount_cents: 100,
      units: 1,
      unit_type: null,
    }))
    expect(pickTopDriverByDelta(rows, dates)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Storage layer
// ---------------------------------------------------------------------------

const ORG_ID = 'org-cost-anom'
const ENTITY_ID = 'ent-cost-anom'
const USER_ID = 'usr-captain'

describe('cost_anomaly_alerts storage', () => {
  let db: D1Database

  beforeAll(() => {
    const files = discoverNumericMigrations(migrationsDir)
    expect(files.length).toBeGreaterThan(0)
  })

  beforeEach(async () => {
    db = createTestD1()
    const files = discoverNumericMigrations(migrationsDir)
    await runMigrations(db, { files })

    await db
      .prepare(
        `INSERT INTO organizations (id, name, slug, created_at, updated_at)
         VALUES (?, 'Test Org', 'test-org', datetime('now'), datetime('now'))`
      )
      .bind(ORG_ID)
      .run()
    await db
      .prepare(
        `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at, created_at, updated_at)
         VALUES (?, ?, 'Biz', 'biz', 'ongoing', datetime('now'), datetime('now'), datetime('now'))`
      )
      .bind(ENTITY_ID, ORG_ID)
      .run()
    await db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, created_at)
         VALUES (?, ?, 'captain@example.com', 'Captain', 'admin', datetime('now'))`
      )
      .bind(USER_ID, ORG_ID)
      .run()
  })

  it('upsertAlert inserts a new row', async () => {
    await upsertAlert(db, {
      entity_id: ENTITY_ID,
      customer_slug: 'biz',
      alert_date: '2026-05-20',
      driver: 'claude_api_input_tokens',
      daily_cents: 500,
      rolling_avg_cents: 200,
      ratio_bps: 25000,
      threshold_bps: 15000,
    })
    const open = await listOpenAlerts(db)
    expect(open.length).toBe(1)
    expect(open[0].entity_id).toBe(ENTITY_ID)
    expect(open[0].driver).toBe('claude_api_input_tokens')
    expect(open[0].daily_cents).toBe(500)
    expect(open[0].ratio_bps).toBe(25000)
  })

  it('upsertAlert preserves snooze/ack when refreshing the same row', async () => {
    await upsertAlert(db, {
      entity_id: ENTITY_ID,
      customer_slug: 'biz',
      alert_date: '2026-05-20',
      driver: 'd1',
      daily_cents: 500,
      rolling_avg_cents: 200,
      ratio_bps: 25000,
      threshold_bps: 15000,
    })
    await snoozeAlert(
      db,
      { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1' },
      '2099-01-01T00:00:00Z'
    )

    // Re-detect with a refreshed daily value
    await upsertAlert(db, {
      entity_id: ENTITY_ID,
      customer_slug: 'biz',
      alert_date: '2026-05-20',
      driver: 'd1',
      daily_cents: 600,
      rolling_avg_cents: 200,
      ratio_bps: 30000,
      threshold_bps: 15000,
    })

    const all = await db
      .prepare(`SELECT * FROM cost_anomaly_alerts WHERE entity_id = ? AND alert_date = ?`)
      .bind(ENTITY_ID, '2026-05-20')
      .all<{ daily_cents: number; ratio_bps: number; snoozed_until: string | null }>()
    expect(all.results?.length).toBe(1)
    expect(all.results[0].daily_cents).toBe(600)
    expect(all.results[0].ratio_bps).toBe(30000)
    expect(all.results[0].snoozed_until).toBe('2099-01-01T00:00:00Z')
  })

  it('listOpenAlerts hides acknowledged alerts', async () => {
    await upsertAlert(db, {
      entity_id: ENTITY_ID,
      customer_slug: 'biz',
      alert_date: '2026-05-20',
      driver: 'd1',
      daily_cents: 500,
      rolling_avg_cents: 200,
      ratio_bps: 25000,
      threshold_bps: 15000,
    })
    await acknowledgeAlert(
      db,
      { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1' },
      USER_ID
    )
    const open = await listOpenAlerts(db)
    expect(open.length).toBe(0)
  })

  it('listOpenAlerts hides snoozed alerts but re-surfaces them after snooze expires', async () => {
    await upsertAlert(db, {
      entity_id: ENTITY_ID,
      customer_slug: 'biz',
      alert_date: '2026-05-20',
      driver: 'd1',
      daily_cents: 500,
      rolling_avg_cents: 200,
      ratio_bps: 25000,
      threshold_bps: 15000,
    })
    const future = '2099-01-01T00:00:00Z'
    const past = '2000-01-01T00:00:00Z'

    await snoozeAlert(db, { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1' }, future)
    expect((await listOpenAlerts(db)).length).toBe(0)

    await snoozeAlert(db, { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1' }, past)
    expect((await listOpenAlerts(db)).length).toBe(1)

    await snoozeAlert(db, { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1' }, null)
    expect((await listOpenAlerts(db)).length).toBe(1)
  })

  it('AGGREGATE_DRIVER_SENTINEL is the empty string and stores correctly', async () => {
    expect(AGGREGATE_DRIVER_SENTINEL).toBe('')
    await upsertAlert(db, {
      entity_id: ENTITY_ID,
      customer_slug: 'biz',
      alert_date: '2026-05-20',
      driver: AGGREGATE_DRIVER_SENTINEL,
      daily_cents: 500,
      rolling_avg_cents: 200,
      ratio_bps: 25000,
      threshold_bps: 15000,
    })
    const open = await listOpenAlerts(db)
    expect(open.length).toBe(1)
    expect(open[0].driver).toBe('')
  })
})
