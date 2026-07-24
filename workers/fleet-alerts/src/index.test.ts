/**
 * Tests for the fleet-alerts Worker (#1709): pure condition evaluation and the
 * edge-triggered transition machinery (one alert per open, one recovery per
 * close, silence otherwise), exercised through runOnce with a fake D1 and a
 * stubbed Resend.
 *
 * WP-1 adds the two scheduler conditions (scheduler_error, work_overdue) with
 * per-field NULL-hold, the send-only-marks-on-success delivery fix, per-seat
 * isolation, the watcher self-ping, and the stale_holds surface.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { evaluateConditions, runOnce, type Env, type FleetStatusRow, type StaleHold } from './index'

const NOW = Date.parse('2026-07-04T12:00:00.000Z')
const RED = 300
const OVERDUE = 900

function row(overrides: Partial<FleetStatusRow>): FleetStatusRow {
  return {
    customer_slug: 'smd',
    last_heartbeat_ts: '2026-07-04T11:59:00.000Z', // 60s ago = green
    sticky_stop_level: 'OK',
    scheduler_ok: null,
    scheduler_max_overdue_seconds: null,
    ...overrides,
  }
}

describe('evaluateConditions', () => {
  it('fresh heartbeat + OK breaker: both base conditions inactive', () => {
    const out = evaluateConditions([row({})], NOW, RED, OVERDUE)
    expect(out.find((c) => c.condition === 'heartbeat_red')?.active).toBe(false)
    expect(out.find((c) => c.condition === 'hard_stop')?.active).toBe(false)
  })

  it('stale heartbeat past threshold is red', () => {
    const out = evaluateConditions(
      [row({ last_heartbeat_ts: '2026-07-04T11:50:00.000Z' })], // 600s ago
      NOW,
      RED,
      OVERDUE
    )
    expect(out.find((c) => c.condition === 'heartbeat_red')?.active).toBe(true)
  })

  it('NULL heartbeat is provisioning-gray, never red (no false pages)', () => {
    const out = evaluateConditions([row({ last_heartbeat_ts: null })], NOW, RED, OVERDUE)
    expect(out.find((c) => c.condition === 'heartbeat_red')?.active).toBe(false)
  })

  it('unparseable heartbeat timestamp IS a fault (red)', () => {
    const out = evaluateConditions([row({ last_heartbeat_ts: 'garbage' })], NOW, RED, OVERDUE)
    expect(out.find((c) => c.condition === 'heartbeat_red')?.active).toBe(true)
  })

  it('HARD_STOP is active; WARN/SOFT_STOP/null are not', () => {
    for (const [level, want] of [
      ['HARD_STOP', true],
      ['WARN', false],
      ['SOFT_STOP', false],
      [null, false],
    ] as const) {
      const out = evaluateConditions([row({ sticky_stop_level: level })], NOW, RED, OVERDUE)
      expect(out.find((c) => c.condition === 'hard_stop')?.active).toBe(want)
    }
  })

  // --- scheduler conditions + per-field NULL-hold ---------------------------

  it('scheduler_ok=0 makes scheduler_error active', () => {
    const out = evaluateConditions([row({ scheduler_ok: 0 })], NOW, RED, OVERDUE)
    expect(out.find((c) => c.condition === 'scheduler_error')?.active).toBe(true)
  })

  it('scheduler_ok=1 makes scheduler_error inactive', () => {
    const out = evaluateConditions([row({ scheduler_ok: 1 })], NOW, RED, OVERDUE)
    expect(out.find((c) => c.condition === 'scheduler_error')?.active).toBe(false)
  })

  it('scheduler_ok=NULL pushes NO scheduler_error ConditionState (hold, never resolve)', () => {
    const out = evaluateConditions([row({ scheduler_ok: null })], NOW, RED, OVERDUE)
    expect(out.find((c) => c.condition === 'scheduler_error')).toBeUndefined()
  })

  it('overdue 901 > threshold 900 opens work_overdue; 899 does not', () => {
    const overdue = evaluateConditions(
      [row({ scheduler_max_overdue_seconds: 901 })],
      NOW,
      RED,
      OVERDUE
    )
    expect(overdue.find((c) => c.condition === 'work_overdue')?.active).toBe(true)
    const notOverdue = evaluateConditions(
      [row({ scheduler_max_overdue_seconds: 899 })],
      NOW,
      RED,
      OVERDUE
    )
    expect(notOverdue.find((c) => c.condition === 'work_overdue')?.active).toBe(false)
  })

  it('overdue=NULL pushes NO work_overdue ConditionState even when scheduler_ok=1', () => {
    const out = evaluateConditions(
      [row({ scheduler_ok: 1, scheduler_max_overdue_seconds: null })],
      NOW,
      RED,
      OVERDUE
    )
    expect(out.find((c) => c.condition === 'scheduler_error')?.active).toBe(false)
    expect(out.find((c) => c.condition === 'work_overdue')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// runOnce edge-trigger behavior with a fake D1 + stubbed Resend
// ---------------------------------------------------------------------------

interface FakeState {
  fleet: FleetStatusRow[]
  alertState: Map<string, 'open' | 'resolved'>
  writes: string[]
  /** Slugs for which any DB op should throw, to exercise per-seat isolation. */
  throwForSlug?: Set<string>
}

function computeStaleHolds(state: FakeState): StaleHold[] {
  const fleetBySlug = new Map(state.fleet.map((r) => [r.customer_slug, r]))
  const out: StaleHold[] = []
  for (const [key, status] of state.alertState) {
    if (status !== 'open') continue
    const [slug, condition] = key.split(':')
    const f = fleetBySlug.get(slug)
    const held =
      !f ||
      (condition === 'scheduler_error' && f.scheduler_ok === null) ||
      (condition === 'work_overdue' && f.scheduler_max_overdue_seconds === null) ||
      (condition === 'heartbeat_red' && f.last_heartbeat_ts === null) ||
      (condition === 'hard_stop' && f.sticky_stop_level === null)
    if (held) out.push({ customer_slug: slug, condition: condition as StaleHold['condition'] })
  }
  return out.sort(
    (a, b) =>
      a.customer_slug.localeCompare(b.customer_slug) || a.condition.localeCompare(b.condition)
  )
}

function makeEnv(state: FakeState, withResend = true, extra: Partial<Env> = {}): Env {
  const db = {
    prepare(sql: string) {
      return {
        all() {
          if (sql.includes('LEFT JOIN fleet_status')) {
            return Promise.resolve({ results: computeStaleHolds(state) })
          }
          if (sql.includes('FROM fleet_status')) {
            return Promise.resolve({ results: state.fleet })
          }
          throw new Error(`unexpected all(): ${sql}`)
        },
        bind(...args: unknown[]) {
          const key = `${args[0]}:${args[1]}`
          const slug = String(args[0])
          if (state.throwForSlug?.has(slug)) {
            const boom = () => {
              throw new Error(`boom for ${slug}`)
            }
            return { first: boom, run: boom }
          }
          return {
            first() {
              if (!sql.includes('FROM fleet_alert_state')) {
                throw new Error(`unexpected first(): ${sql}`)
              }
              const status = state.alertState.get(key)
              return Promise.resolve(status ? { status } : null)
            },
            run() {
              if (sql.includes('INSERT INTO fleet_alert_state')) {
                state.alertState.set(key, 'open')
                state.writes.push(`open:${key}`)
              } else if (sql.includes("SET status = 'resolved'")) {
                state.alertState.set(key, 'resolved')
                state.writes.push(`resolve:${key}`)
              } else {
                throw new Error(`unexpected run(): ${sql}`)
              }
              return Promise.resolve({})
            },
          }
        },
      }
    },
  }
  return {
    DB: db as unknown as D1Database,
    RESEND_API_KEY: withResend ? 'rk_test' : undefined,
    HEARTBEAT_RED_SECONDS: String(RED),
    WORK_OVERDUE_RED_SECONDS: String(OVERDUE),
    ...extra,
  }
}

function stubResend(): ReturnType<typeof vi.fn> {
  const mock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ id: 'resend-alert-1' }), { status: 200 }))
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runOnce edge triggering', () => {
  it('red seat with no prior state: opens once, emails once', async () => {
    const fetchMock = stubResend()
    const state: FakeState = {
      fleet: [row({ last_heartbeat_ts: '2026-07-04T11:00:00.000Z' })],
      alertState: new Map(),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toHaveLength(1)
    expect(summary.transitions[0]).toMatchObject({
      condition: 'heartbeat_red',
      kind: 'opened',
      emailed: true,
      resendId: 'resend-alert-1',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.to).toBe('team@smd.services')
    expect(body.subject).toContain('ALERT smd')
  })

  it('still-red seat with an open alert: SILENT (no storm)', async () => {
    const fetchMock = stubResend()
    const state: FakeState = {
      fleet: [row({ last_heartbeat_ts: '2026-07-04T11:00:00.000Z' })],
      alertState: new Map([['smd:heartbeat_red', 'open']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.writes).toHaveLength(0)
  })

  it('green seat with an open alert: resolves once with a recovery email', async () => {
    const fetchMock = stubResend()
    const state: FakeState = {
      fleet: [row({})], // fresh heartbeat
      alertState: new Map([['smd:heartbeat_red', 'open']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toHaveLength(1)
    expect(summary.transitions[0].kind).toBe('resolved')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.subject).toContain('RECOVERED smd')
    expect(state.alertState.get('smd:heartbeat_red')).toBe('resolved')
  })

  it('HARD_STOP opens its own condition independently of the heartbeat', async () => {
    stubResend()
    const state: FakeState = {
      fleet: [row({ sticky_stop_level: 'HARD_STOP' })], // heartbeat fresh
      alertState: new Map(),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toHaveLength(1)
    expect(summary.transitions[0]).toMatchObject({ condition: 'hard_stop', kind: 'opened' })
  })
})

describe('runOnce scheduler conditions', () => {
  it('scheduler_ok=0 opens scheduler_error + emails', async () => {
    const fetchMock = stubResend()
    const state: FakeState = {
      fleet: [row({ scheduler_ok: 0 })],
      alertState: new Map(),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toEqual([
      expect.objectContaining({ condition: 'scheduler_error', kind: 'opened', emailed: true }),
    ])
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.subject).toContain('ALERT smd: Cron scheduler broken/unreadable')
    expect(state.alertState.get('smd:scheduler_error')).toBe('open')
  })

  it('scheduler_ok 0 -> 1 resolves scheduler_error + RECOVERED email', async () => {
    const fetchMock = stubResend()
    const state: FakeState = {
      fleet: [row({ scheduler_ok: 1 })],
      alertState: new Map([['smd:scheduler_error', 'open']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toEqual([
      expect.objectContaining({ condition: 'scheduler_error', kind: 'resolved' }),
    ])
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.subject).toContain('RECOVERED smd: Cron scheduler broken/unreadable')
    expect(state.alertState.get('smd:scheduler_error')).toBe('resolved')
  })

  it('scheduler_ok=NULL does NOT resolve a pre-seeded open scheduler_error (hold)', async () => {
    const fetchMock = stubResend()
    const state: FakeState = {
      fleet: [row({ scheduler_ok: null })],
      alertState: new Map([['smd:scheduler_error', 'open']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.alertState.get('smd:scheduler_error')).toBe('open')
  })

  it('overdue 901 opens work_overdue', async () => {
    stubResend()
    const state: FakeState = {
      fleet: [row({ scheduler_ok: 1, scheduler_max_overdue_seconds: 901 })],
      alertState: new Map(),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toEqual([
      expect.objectContaining({ condition: 'work_overdue', kind: 'opened' }),
    ])
  })

  it('overdue 899 does NOT open work_overdue', async () => {
    stubResend()
    const state: FakeState = {
      fleet: [row({ scheduler_ok: 1, scheduler_max_overdue_seconds: 899 })],
      alertState: new Map(),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toHaveLength(0)
  })

  it('overdue NULL + scheduler_ok=1 → scheduler_error only (no work_overdue state at all)', async () => {
    stubResend()
    const state: FakeState = {
      fleet: [row({ scheduler_ok: 1, scheduler_max_overdue_seconds: null })],
      alertState: new Map([['smd:work_overdue', 'open']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    // No false RECOVERED for the held work_overdue, and scheduler_error stays quiet.
    expect(summary.transitions).toHaveLength(0)
    expect(state.alertState.get('smd:work_overdue')).toBe('open')
  })
})

describe('runOnce delivery + resilience', () => {
  it('send-failure leaves state UNMARKED so the next run retries and sends', async () => {
    // Run 1: Resend returns 500 → no state change, no transition recorded.
    const failMock = vi.fn().mockResolvedValue(new Response('resend down', { status: 500 }))
    vi.stubGlobal('fetch', failMock)
    const state: FakeState = {
      fleet: [row({ last_heartbeat_ts: '2026-07-04T11:00:00.000Z' })],
      alertState: new Map(),
      writes: [],
    }
    const first = await runOnce(makeEnv(state), NOW)
    expect(first.transitions).toHaveLength(0)
    expect(state.alertState.get('smd:heartbeat_red')).toBeUndefined()
    expect(state.writes).toHaveLength(0)

    // Run 2: Resend recovers → the alert opens and emails (natural retry).
    vi.unstubAllGlobals()
    const okMock = stubResend()
    const second = await runOnce(makeEnv(state), NOW)
    expect(second.transitions).toEqual([
      expect.objectContaining({ condition: 'heartbeat_red', kind: 'opened', emailed: true }),
    ])
    expect(okMock).toHaveBeenCalledTimes(1)
    expect(state.alertState.get('smd:heartbeat_red')).toBe('open')
  })

  it('no RESEND_API_KEY: state is NOT marked (would-be email never sent)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const state: FakeState = {
      fleet: [row({ last_heartbeat_ts: '2026-07-04T11:00:00.000Z' })],
      alertState: new Map(),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state, false), NOW)
    expect(summary.transitions).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.alertState.get('smd:heartbeat_red')).toBeUndefined()
  })

  it('one throwing seat does not abort evaluation of the others', async () => {
    const fetchMock = stubResend()
    const state: FakeState = {
      fleet: [
        row({ customer_slug: 'bad', last_heartbeat_ts: '2026-07-04T11:00:00.000Z' }),
        row({ customer_slug: 'good', last_heartbeat_ts: '2026-07-04T11:00:00.000Z' }),
      ],
      alertState: new Map(),
      writes: [],
      throwForSlug: new Set(['bad']),
    }
    const summary = await runOnce(makeEnv(state), NOW)
    // 'good' still opened + emailed despite 'bad' throwing.
    expect(summary.transitions).toEqual([
      expect.objectContaining({ customer_slug: 'good', condition: 'heartbeat_red' }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.alertState.get('good:heartbeat_red')).toBe('open')
  })

  it('fires the watcher self-ping when ALERTER_HEALTHCHECKS_PING_URL is set', async () => {
    const fetchMock = stubResend()
    const state: FakeState = {
      fleet: [row({})], // nothing to alert on
      alertState: new Map(),
      writes: [],
    }
    await runOnce(
      makeEnv(state, true, { ALERTER_HEALTHCHECKS_PING_URL: 'https://hc.example/ping' }),
      NOW
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://hc.example/ping')
  })
})

describe('runOnce stale_holds surface', () => {
  it('lists an open alert whose seat has no fleet_status row (the orphan case)', async () => {
    stubResend()
    const state: FakeState = {
      fleet: [], // pilot-smokeball has no row post-rekey
      alertState: new Map([['pilot-smokeball:heartbeat_red', 'open']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.stale_holds).toEqual([
      { customer_slug: 'pilot-smokeball', condition: 'heartbeat_red' },
    ])
  })

  it('lists a scheduler_error open row whose seat now reports scheduler_ok=NULL', async () => {
    stubResend()
    const state: FakeState = {
      fleet: [row({ scheduler_ok: null })],
      alertState: new Map([['smd:scheduler_error', 'open']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.stale_holds).toEqual([{ customer_slug: 'smd', condition: 'scheduler_error' }])
  })

  it('does not list an open alert whose field is populated', async () => {
    stubResend()
    const state: FakeState = {
      fleet: [row({ scheduler_ok: 0 })],
      alertState: new Map([['smd:scheduler_error', 'open']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.stale_holds).toHaveLength(0)
  })
})
