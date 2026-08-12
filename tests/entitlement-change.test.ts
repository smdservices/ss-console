/**
 * Entitlement tier-change orchestration + governance ledger (#2003 Q7 —
 * the runtime model, Captain ruling 2026-07-28).
 *
 * The invariants that matter:
 *  - a rejected or no-op request reaches NO Machine and writes NO row
 *  - a gate failure (non-200, unreachable, transport unconfigured) records
 *    NOTHING — never "applied" for a change the Machine did not acknowledge
 *  - an applied change writes exactly one row carrying the compiled delta,
 *    status `applied`, no PR fields
 *  - the gate body carries the compiled per-action-class ceilings, with the
 *    flag-only target expressed as `refused` (deauthorize == fail-closed)
 *  - both directions compile and apply: raise within ceiling, lower back
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import { readFileSync } from 'fs'
import path, { resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import type { D1Database } from '@cloudflare/workers-types'
import { validate } from '../src/lib/operator/customer-yaml'
import { validateRoutineGrid, type RoutineGrid } from '../src/lib/operator/routine-grid'
import { sendActionClassOf, type LiveExposure } from '../src/lib/operator/entitlement-compiler'
import {
  applyTierChange,
  gateChangesOf,
  listEntitlementChanges,
} from '../src/lib/portal/operator/entitlement-change'

const migrationsDir = path.resolve(__dirname, '../migrations')
const AP = resolve('operator/customers/ashton-price')

function grid(): RoutineGrid {
  const r = validateRoutineGrid(parseYaml(readFileSync(resolve(AP, 'routine-grid.yaml'), 'utf-8')))
  if (!r.ok) throw new Error('grid invalid')
  return r.value
}
function live(): LiveExposure {
  const r = validate(
    parseYaml(readFileSync(resolve(AP, 'customer.yaml'), 'utf-8')) as Record<string, unknown>
  )
  if (!r.ok) throw new Error('yaml invalid')
  const p = r.value.personas.find((x) => x.slug === 'operator')!
  return { personaSlug: p.slug, exposure: p.entitlements.exposure }
}
/** A routine that can legally graduate on this seat. */
function graduatingRow() {
  return grid().rows.find((r) => r.ceiling_tier === 'auto-handle' && sendActionClassOf(r))!
}

// The pause-transport env shape: gate secret + host template. The fly-app
// registry must know the slug, so tests run against ashton-price (registered).
const ENV = {
  OPERATOR_MCP_WEBHOOK_SECRET: 'test-master-secret',
  OPERATOR_RUNTIME_READ_URL: 'https://{app}.fly.test',
}
const ACTOR = { userId: 'u1', email: 'admin@firm.example', role: 'principal' }

function inputFor(routine: string, targetTier: string) {
  return {
    entityId: 'e1',
    customerSlug: 'ashton-price',
    routine,
    targetTier,
    reason: 'firm is comfortable after clean cycles',
    vertical: 'law-firm',
    actor: ACTOR,
    source: 'portal' as const,
  }
}

function deps() {
  return { grid: grid(), live: live() }
}

/**
 * A Machine that acknowledges exactly the batch it was sent — the behaviour of
 * the real gate on success (`shared.exposure_override.set_overrides` returns
 * `applied` built from the normalized changes it just wrote).
 *
 * The default echo used to be a fixed `[{action_class:'x', ceiling:'y'}]`,
 * which acknowledged NOTHING the console sent and was accepted as `applied`
 * anyway. That made this suite unable to observe the layer it claimed to check
 * (ss#2314): the "gate first, one applied row second" assertions passed
 * whether or not the seat took the change. Echoing the request is what lets
 * the new acknowledgement check be exercised by the happy path at all.
 */
function mockGate(status = 200, body?: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url)
    if (u.endsWith('/entitlement/set')) {
      const sent = JSON.parse(String(init?.body ?? '{}')) as {
        persona?: string
        changes?: { action_class: string; ceiling: string }[]
      }
      return new Response(
        JSON.stringify(
          body ?? { applied: sent.changes ?? [], persona: sent.persona ?? 'operator' }
        ),
        { status }
      )
    }
    throw new Error(`unexpected fetch: ${u}`)
  })
}

let db: D1Database

beforeEach(async () => {
  db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('gateChangesOf', () => {
  it('maps a deauthorize (flag-only target) to refused', () => {
    expect(
      gateChangesOf({
        routine: 'r',
        skills: [],
        fromTier: 'prepare-and-route',
        toTier: 'flag-only',
        exposureChanges: [
          {
            personaSlug: 'operator',
            actionClass: 'external_send_client',
            from: 'draft_for_review',
            to: null,
            direction: 'deauthorize',
          },
        ],
        noop: false,
      })
    ).toEqual([{ action_class: 'external_send_client', ceiling: 'refused' }])
  })
})

describe('applyTierChange', () => {
  it('applies a within-ceiling raise: gate first, one applied row second', async () => {
    const row = graduatingRow()
    const fetchSpy = mockGate()
    const outcome = await applyTierChange(db, ENV, deps(), inputFor(row.routine, 'auto-handle'))
    expect(outcome.kind).toBe('applied')

    // Gate saw the compiled ceilings for this routine's send class.
    const call = fetchSpy.mock.calls[0]
    expect(String(call[0])).toContain('/entitlement/set')
    const sent = JSON.parse(String(call[1]?.body)) as {
      persona: string
      changes: { action_class: string; ceiling: string }[]
      actor_id: string
      reason: string
    }
    expect(sent.persona).toBe('operator')
    expect(sent.changes).toEqual([{ action_class: sendActionClassOf(row)!, ceiling: 'autonomous' }])
    expect(sent.actor_id).toBe(ACTOR.email)

    const rows = await listEntitlementChanges(db, 'ashton-price')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('applied')
    expect(rows[0].to_tier).toBe('auto-handle')
    expect(rows[0].pr_url).toBeNull()
  })

  it('applies the lowering direction (raise then back down)', async () => {
    const row = graduatingRow()
    mockGate()
    // The live exposure already sits at prepare-and-route; lower to flag-only.
    const outcome = await applyTierChange(db, ENV, deps(), inputFor(row.routine, 'flag-only'))
    expect(outcome.kind).toBe('applied')
    const rows = await listEntitlementChanges(db, 'ashton-price')
    expect(rows[0].to_tier).toBe('flag-only')
    expect(rows[0].status).toBe('applied')
  })

  it('a rejected request (above letter ceiling) reaches no Machine, writes no row', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const capped = grid().rows.find((r) => r.ceiling_tier === 'prepare-and-route')!
    const outcome = await applyTierChange(db, ENV, deps(), inputFor(capped.routine, 'auto-handle'))
    expect(outcome.kind).toBe('rejected')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await listEntitlementChanges(db, 'ashton-price')).toHaveLength(0)
  })

  it('a noop request reaches no Machine, writes no row', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const row = graduatingRow()
    // Live exposure has this at draft_for_review == prepare-and-route already.
    const outcome = await applyTierChange(
      db,
      ENV,
      deps(),
      inputFor(row.routine, 'prepare-and-route')
    )
    expect(outcome.kind).toBe('noop')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await listEntitlementChanges(db, 'ashton-price')).toHaveLength(0)
  })

  it('a gate non-200 records NOTHING (never applied for an unacknowledged change)', async () => {
    mockGate(409, { error: 'rejected', detail: 'exceeds the authored ceiling' })
    const row = graduatingRow()
    const outcome = await applyTierChange(db, ENV, deps(), inputFor(row.routine, 'auto-handle'))
    expect(outcome.kind).toBe('failed')
    expect(await listEntitlementChanges(db, 'ashton-price')).toHaveLength(0)
  })

  it('an unconfigured transport fails closed with no row', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const row = graduatingRow()
    const outcome = await applyTierChange(db, {}, deps(), inputFor(row.routine, 'auto-handle'))
    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') {
      expect(outcome.error).toContain('not configured')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await listEntitlementChanges(db, 'ashton-price')).toHaveLength(0)
  })

  it('an unreachable gate records nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const row = graduatingRow()
    const outcome = await applyTierChange(db, ENV, deps(), inputFor(row.routine, 'auto-handle'))
    expect(outcome.kind).toBe('failed')
    expect(await listEntitlementChanges(db, 'ashton-price')).toHaveLength(0)
  })
})
