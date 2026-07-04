/**
 * Tests for the fleet-alerts Worker (#1709): pure condition evaluation and
 * the edge-triggered transition machinery (one alert per open, one recovery
 * per close, silence otherwise), exercised through runOnce with a fake D1
 * and a stubbed Resend.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { evaluateConditions, runOnce, type Env, type FleetStatusRow } from './index'

const NOW = Date.parse('2026-07-04T12:00:00.000Z')
const RED = 300

function row(overrides: Partial<FleetStatusRow>): FleetStatusRow {
  return {
    customer_slug: 'smd',
    last_heartbeat_ts: '2026-07-04T11:59:00.000Z', // 60s ago = green
    sticky_stop_level: 'OK',
    ...overrides,
  }
}

describe('evaluateConditions', () => {
  it('fresh heartbeat + OK breaker: both conditions inactive', () => {
    const out = evaluateConditions([row({})], NOW, RED)
    expect(out.find((c) => c.condition === 'heartbeat_red')?.active).toBe(false)
    expect(out.find((c) => c.condition === 'hard_stop')?.active).toBe(false)
  })

  it('stale heartbeat past threshold is red', () => {
    const out = evaluateConditions(
      [row({ last_heartbeat_ts: '2026-07-04T11:50:00.000Z' })], // 600s ago
      NOW,
      RED
    )
    expect(out.find((c) => c.condition === 'heartbeat_red')?.active).toBe(true)
  })

  it('NULL heartbeat is provisioning-gray, never red (no false pages)', () => {
    const out = evaluateConditions([row({ last_heartbeat_ts: null })], NOW, RED)
    expect(out.find((c) => c.condition === 'heartbeat_red')?.active).toBe(false)
  })

  it('unparseable heartbeat timestamp IS a fault (red)', () => {
    const out = evaluateConditions([row({ last_heartbeat_ts: 'garbage' })], NOW, RED)
    expect(out.find((c) => c.condition === 'heartbeat_red')?.active).toBe(true)
  })

  it('HARD_STOP is active; WARN/SOFT_STOP/null are not', () => {
    for (const [level, want] of [
      ['HARD_STOP', true],
      ['WARN', false],
      ['SOFT_STOP', false],
      [null, false],
    ] as const) {
      const out = evaluateConditions([row({ sticky_stop_level: level })], NOW, RED)
      expect(out.find((c) => c.condition === 'hard_stop')?.active).toBe(want)
    }
  })
})

// ---------------------------------------------------------------------------
// runOnce edge-trigger behavior with a fake D1 + stubbed Resend
// ---------------------------------------------------------------------------

interface FakeState {
  fleet: FleetStatusRow[]
  alertState: Map<string, 'open' | 'resolved'>
  writes: string[]
}

function makeEnv(state: FakeState, withResend = true): Env {
  const db = {
    prepare(sql: string) {
      return {
        all() {
          if (!sql.includes('FROM fleet_status')) throw new Error(`unexpected all(): ${sql}`)
          return Promise.resolve({ results: state.fleet })
        },
        bind(...args: unknown[]) {
          const key = `${args[0]}:${args[1]}`
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

  it('green seat with resolved/no state: silent', async () => {
    const fetchMock = stubResend()
    const state: FakeState = {
      fleet: [row({})],
      alertState: new Map([['smd:heartbeat_red', 'resolved']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-red after recovery: opens again (new incident, new email)', async () => {
    stubResend()
    const state: FakeState = {
      fleet: [row({ last_heartbeat_ts: '2026-07-04T11:00:00.000Z' })],
      alertState: new Map([['smd:heartbeat_red', 'resolved']]),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state), NOW)
    expect(summary.transitions).toHaveLength(1)
    expect(summary.transitions[0].kind).toBe('opened')
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

  it('without RESEND_API_KEY the state still transitions (emailed=false, no fetch)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const state: FakeState = {
      fleet: [row({ last_heartbeat_ts: '2026-07-04T11:00:00.000Z' })],
      alertState: new Map(),
      writes: [],
    }
    const summary = await runOnce(makeEnv(state, false), NOW)
    expect(summary.transitions[0].emailed).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.alertState.get('smd:heartbeat_red')).toBe('open')
  })
})
