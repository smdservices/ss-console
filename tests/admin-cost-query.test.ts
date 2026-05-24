/**
 * Unit tests for the Captain cost dashboard query layer (#885).
 *
 * Covers the pure-function pieces — aggregation, date enumeration,
 * COGS/MRR ratio thresholds, rolling-avg fewer-than-7-days handling,
 * and CSV serialization. The D1 HTTP fetch path is exercised by
 * stubbing global fetch in a separate block.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  cogsRatio,
  categoryForDriver,
  defaultWindow,
  enumerateDates,
  fetchCustomerCostRows,
  rowsToCsv,
  summarizeCostRows,
  thirtyDayCogsToMonthlyEstimateCents,
  type CostTelemetryRow,
} from '../src/lib/admin/cost-query'

describe('categoryForDriver', () => {
  it('maps Anthropic input/output tokens to anthropic_llm', () => {
    expect(categoryForDriver('claude_api_input_tokens')).toBe('anthropic_llm')
    expect(categoryForDriver('claude_api_output_tokens')).toBe('anthropic_llm')
  })

  it('maps composio_actions to composio_action', () => {
    expect(categoryForDriver('composio_actions')).toBe('composio_action')
  })

  it('maps unknown drivers to other (no silent drop)', () => {
    expect(categoryForDriver('mystery_driver')).toBe('other')
  })

  it('maps captain_time to captain_time', () => {
    expect(categoryForDriver('captain_time')).toBe('captain_time')
  })
})

describe('enumerateDates', () => {
  it('returns every date in a half-open window', () => {
    expect(enumerateDates('2026-01-01', '2026-01-04')).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ])
  })

  it('returns empty when start >= end', () => {
    expect(enumerateDates('2026-01-04', '2026-01-04')).toEqual([])
    expect(enumerateDates('2026-01-05', '2026-01-04')).toEqual([])
  })

  it('crosses month boundaries', () => {
    expect(enumerateDates('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
    ])
  })
})

describe('defaultWindow', () => {
  it('returns a 30-day window ending tomorrow (UTC)', () => {
    const today = new Date('2026-05-23T12:00:00Z')
    const w = defaultWindow(today)
    expect(w.end).toBe('2026-05-24')
    expect(w.start).toBe('2026-04-24')
    expect(enumerateDates(w.start, w.end).length).toBe(30)
  })
})

describe('summarizeCostRows', () => {
  const window = { start: '2026-05-01', end: '2026-05-08' } // 7 days

  it('returns zeroed summary for empty rows but preserves dense byDay timeline', () => {
    const s = summarizeCostRows('acme', window.start, window.end, [])
    expect(s.totalCents).toBe(0)
    expect(s.byCategory.anthropic_llm).toBe(0)
    expect(s.byDriver).toEqual([])
    expect(s.byDay).toHaveLength(7)
    expect(s.byDay.every((d) => d.total_cents === 0)).toBe(true)
  })

  it('aggregates rows by driver, category, and day', () => {
    const rows: CostTelemetryRow[] = [
      {
        date: '2026-05-01',
        driver: 'claude_api_input_tokens',
        amount_cents: 100,
        units: 1000,
        unit_type: 'input_tokens',
      },
      {
        date: '2026-05-01',
        driver: 'claude_api_output_tokens',
        amount_cents: 250,
        units: 500,
        unit_type: 'output_tokens',
      },
      {
        date: '2026-05-02',
        driver: 'composio_actions',
        amount_cents: 30,
        units: 30,
        unit_type: 'api_calls',
      },
    ]
    const s = summarizeCostRows('acme', window.start, window.end, rows)
    expect(s.totalCents).toBe(380)
    expect(s.byCategory.anthropic_llm).toBe(350)
    expect(s.byCategory.composio_action).toBe(30)
    expect(s.byDriver).toHaveLength(3)
    const inputDriver = s.byDriver.find((d) => d.driver === 'claude_api_input_tokens')
    expect(inputDriver?.units).toBe(1000)
    expect(s.byDay.find((d) => d.date === '2026-05-01')?.total_cents).toBe(350)
    expect(s.byDay.find((d) => d.date === '2026-05-02')?.total_cents).toBe(30)
  })

  it('skips negative amount_cents rows (defensive)', () => {
    const rows: CostTelemetryRow[] = [
      {
        date: '2026-05-01',
        driver: 'claude_api_input_tokens',
        amount_cents: -50,
        units: 100,
        unit_type: 'input_tokens',
      },
    ]
    const s = summarizeCostRows('acme', window.start, window.end, rows)
    expect(s.totalCents).toBe(0)
    expect(s.byCategory.anthropic_llm).toBe(0)
  })

  it('rolling avg returns null when window has fewer than 7 days at the position', () => {
    const rows: CostTelemetryRow[] = []
    for (let i = 0; i < 7; i++) {
      rows.push({
        date: `2026-05-0${i + 1}`,
        driver: 'composio_actions',
        amount_cents: 70,
        units: 70,
        unit_type: 'api_calls',
      })
    }
    const s = summarizeCostRows('acme', window.start, window.end, rows)
    expect(s.rolling7dCents).toHaveLength(7)
    for (let i = 0; i < 6; i++) {
      expect(s.rolling7dCents[i].avg_cents).toBeNull()
    }
    expect(s.rolling7dCents[6].avg_cents).toBe(70)
  })

  it('rolling avg uses 7-day window when sufficient data exists', () => {
    const rows: CostTelemetryRow[] = []
    // 8 days: 100 cents/day for 7 days, then 800 cents on day 8
    const window8 = { start: '2026-05-01', end: '2026-05-09' }
    for (let i = 0; i < 7; i++) {
      rows.push({
        date: `2026-05-0${i + 1}`,
        driver: 'composio_actions',
        amount_cents: 100,
        units: 100,
        unit_type: 'api_calls',
      })
    }
    rows.push({
      date: '2026-05-08',
      driver: 'composio_actions',
      amount_cents: 800,
      units: 800,
      unit_type: 'api_calls',
    })
    const s = summarizeCostRows('acme', window8.start, window8.end, rows)
    // index 6 (day 7) = avg of days 1-7 = 100
    expect(s.rolling7dCents[6].avg_cents).toBe(100)
    // index 7 (day 8) = avg of days 2-8 = (100*6 + 800)/7 = 1400/7 = 200
    expect(s.rolling7dCents[7].avg_cents).toBe(200)
  })

  it('groups unknown drivers into the other bucket without losing them', () => {
    const rows: CostTelemetryRow[] = [
      {
        date: '2026-05-01',
        driver: 'futuredriver_xyz',
        amount_cents: 42,
        units: 1,
        unit_type: 'widgets',
      },
    ]
    const s = summarizeCostRows('acme', window.start, window.end, rows)
    expect(s.byCategory.other).toBe(42)
    expect(s.byDriver[0]?.driver).toBe('futuredriver_xyz')
    expect(s.byDriver[0]?.category).toBe('other')
  })
})

describe('cogsRatio', () => {
  it('returns unpriced when MRR is null or 0', () => {
    expect(cogsRatio(10_000, null)).toEqual({ basis_points: null, status: 'unpriced' })
    expect(cogsRatio(10_000, 0)).toEqual({ basis_points: null, status: 'unpriced' })
  })

  it('returns healthy below 30%', () => {
    const r = cogsRatio(2_900, 10_000)
    expect(r.status).toBe('healthy')
    expect(r.basis_points).toBe(2900)
  })

  it('returns watch between 30-40%', () => {
    const r = cogsRatio(3_500, 10_000)
    expect(r.status).toBe('watch')
    expect(r.basis_points).toBe(3500)
  })

  it('returns kill at 40% or above (platform-prd §17.1 threshold)', () => {
    const r = cogsRatio(4_000, 10_000)
    expect(r.status).toBe('kill')
    expect(r.basis_points).toBe(4000)
  })

  it('returns kill above 40%', () => {
    const r = cogsRatio(5_000, 10_000)
    expect(r.status).toBe('kill')
    expect(r.basis_points).toBe(5000)
  })
})

describe('thirtyDayCogsToMonthlyEstimateCents', () => {
  it('scales 30-day COGS up to a 30.4375-day month equivalent', () => {
    expect(thirtyDayCogsToMonthlyEstimateCents(30_000)).toBe(30_438)
  })

  it('zero in => zero out', () => {
    expect(thirtyDayCogsToMonthlyEstimateCents(0)).toBe(0)
  })
})

describe('rowsToCsv', () => {
  it('produces a header row and one line per cost row', () => {
    const rows: CostTelemetryRow[] = [
      {
        date: '2026-05-01',
        driver: 'claude_api_input_tokens',
        amount_cents: 100,
        units: 1000,
        unit_type: 'input_tokens',
      },
      {
        date: '2026-05-02',
        driver: 'composio_actions',
        amount_cents: 30,
        units: 30,
        unit_type: 'api_calls',
      },
    ]
    const csv = rowsToCsv('acme', rows)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('customer_slug,date,driver,amount_cents,units,unit_type')
    expect(lines[1]).toBe('acme,2026-05-01,claude_api_input_tokens,100,1000,input_tokens')
    expect(lines[2]).toBe('acme,2026-05-02,composio_actions,30,30,api_calls')
  })

  it('escapes values containing commas or quotes', () => {
    const rows: CostTelemetryRow[] = [
      {
        date: '2026-05-01',
        driver: 'weird,"driver"',
        amount_cents: 1,
        units: null,
        unit_type: null,
      },
    ]
    const csv = rowsToCsv('acme,inc', rows)
    expect(csv).toContain('"acme,inc"')
    expect(csv).toContain('"weird,""driver"""')
  })

  it('renders null units as empty field', () => {
    const rows: CostTelemetryRow[] = [
      {
        date: '2026-05-01',
        driver: 'claude_api_input_tokens',
        amount_cents: 0,
        units: null,
        unit_type: 'input_tokens',
      },
    ]
    const csv = rowsToCsv('acme', rows)
    const dataLine = csv.trim().split('\n')[1]
    expect(dataLine).toBe('acme,2026-05-01,claude_api_input_tokens,0,,input_tokens')
  })
})

describe('fetchCustomerCostRows (D1 HTTP API)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('parses the D1 HTTP response into typed rows', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              results: [
                {
                  date: '2026-05-01',
                  driver: 'claude_api_input_tokens',
                  amount_cents: 100,
                  units: 1000,
                  unit_type: 'input_tokens',
                },
                {
                  date: '2026-05-01',
                  driver: 'composio_actions',
                  amount_cents: 30,
                  units: 30,
                  unit_type: 'api_calls',
                },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    const result = await fetchCustomerCostRows(
      { CF_ACCOUNT_ID: 'acct', CF_D1_API_TOKEN: 'tok' },
      'db-id',
      '2026-05-01',
      '2026-06-01'
    )
    expect(result.error).toBeNull()
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].driver).toBe('claude_api_input_tokens')
  })

  it('returns an error string on non-2xx', async () => {
    globalThis.fetch = async () => new Response('boom', { status: 500 })
    const result = await fetchCustomerCostRows(
      { CF_ACCOUNT_ID: 'acct', CF_D1_API_TOKEN: 'tok' },
      'db-id',
      '2026-05-01',
      '2026-06-01'
    )
    expect(result.rows).toEqual([])
    expect(result.error).toContain('D1 HTTP 500')
  })

  it('returns an error string on payload.success = false', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ success: false, errors: [{ code: 1, message: 'no such table' }] }),
        {
          status: 200,
        }
      )
    const result = await fetchCustomerCostRows(
      { CF_ACCOUNT_ID: 'acct', CF_D1_API_TOKEN: 'tok' },
      'db-id',
      '2026-05-01',
      '2026-06-01'
    )
    expect(result.rows).toEqual([])
    expect(result.error).toContain('D1 query failed')
  })

  it('drops malformed rows without crashing', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              results: [
                { date: 'good', driver: 'composio_actions', amount_cents: 1 },
                { driver: 'missing_date', amount_cents: 1 },
                { date: '2026-05-01', amount_cents: 1 },
                { date: '2026-05-01', driver: 'composio_actions' },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    const result = await fetchCustomerCostRows(
      { CF_ACCOUNT_ID: 'acct', CF_D1_API_TOKEN: 'tok' },
      'db-id',
      '2026-05-01',
      '2026-06-01'
    )
    expect(result.error).toBeNull()
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].driver).toBe('composio_actions')
  })
})
