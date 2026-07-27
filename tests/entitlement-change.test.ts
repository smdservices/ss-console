/**
 * Entitlement tier-change orchestration + governance ledger (#2003 slice 2).
 *
 * The invariants that matter:
 *  - a rejected or no-op request opens NO pull request and writes NO row
 *  - a PR failure records NOTHING (never "submitted" for a change that isn't)
 *  - a submitted change writes exactly one row carrying the compiled delta
 *  - status is `submitted`, never `applied` — merging + reprovision is what
 *    applies it, and nothing here may claim otherwise
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
  changeBranchName,
  customerYamlPath,
  listEntitlementChanges,
  submitTierChange,
} from '../src/lib/portal/operator/entitlement-change'

const migrationsDir = path.resolve(__dirname, '../migrations')
const AP = resolve('operator/customers/ashton-price')
const yamlText = () => readFileSync(resolve(AP, 'customer.yaml'), 'utf-8')

function grid(): RoutineGrid {
  const r = validateRoutineGrid(parseYaml(readFileSync(resolve(AP, 'routine-grid.yaml'), 'utf-8')))
  if (!r.ok) throw new Error('grid invalid')
  return r.value
}
function live(): LiveExposure {
  const r = validate(parseYaml(yamlText()) as Record<string, unknown>)
  if (!r.ok) throw new Error('yaml invalid')
  const p = r.value.personas.find((x) => x.slug === 'operator')!
  return { personaSlug: p.slug, exposure: p.entitlements.exposure }
}
/** A routine that can legally graduate on this seat. */
function graduatingRoutine(): string {
  return grid().rows.find((r) => r.ceiling_tier === 'auto-handle' && sendActionClassOf(r))!.routine
}

const ENV = { OPERATOR_CONFIG_PR_TOKEN: 'test-token' }
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

function deps(nonce = 'abc123') {
  return { grid: grid(), live: live(), readYaml: async () => yamlText(), nonce }
}

/** Mock the four GitHub calls openConfigPr makes, in order. */
function mockGitHubOk() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    if (u.includes('/git/ref/heads/main')) {
      return new Response(JSON.stringify({ object: { sha: 'basesha' } }), { status: 200 })
    }
    if (u.includes('/contents/') && method === 'GET') {
      return new Response(JSON.stringify({ sha: 'filesha' }), { status: 200 })
    }
    if (u.includes('/git/refs') && method === 'POST') {
      return new Response(JSON.stringify({}), { status: 201 })
    }
    if (u.includes('/contents/') && method === 'PUT') {
      return new Response(JSON.stringify({}), { status: 200 })
    }
    if (u.includes('/pulls') && method === 'POST') {
      return new Response(JSON.stringify({ html_url: 'https://github.com/pr/1', number: 1 }), {
        status: 201,
      })
    }
    return new Response('unexpected', { status: 500 })
  })
}

describe('tier-change orchestration', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  })
  afterEach(() => vi.restoreAllMocks())

  it('submits a legal graduation: one PR, one row, status submitted', async () => {
    const fetchSpy = mockGitHubOk()
    const routine = graduatingRoutine()
    const outcome = await submitTierChange(db, ENV, deps(), inputFor(routine, 'auto-handle'))

    expect(outcome.kind).toBe('submitted')
    if (outcome.kind !== 'submitted') return
    expect(outcome.prUrl).toBe('https://github.com/pr/1')

    const rows = await listEntitlementChanges(db, 'ashton-price')
    expect(rows).toHaveLength(1)
    expect(rows[0].routine).toBe(routine)
    expect(rows[0].to_tier).toBe('auto-handle')
    expect(rows[0].status).toBe('submitted')
    expect(rows[0].pr_url).toBe('https://github.com/pr/1')
    expect(rows[0].actor_email).toBe('admin@firm.example')

    // The committed content carries the compiled one-line edit.
    const put = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PUT')
    const body = JSON.parse(put![1]!.body as string) as { content: string }
    const committed = atob(body.content)
    expect(committed).toContain('autonomous')
    const parsed = validate(parseYaml(committed) as Record<string, unknown>)
    expect(parsed.ok, 'committed yaml must still validate').toBe(true)
  })

  it('a raise above the letter ceiling opens no PR and writes no row', async () => {
    const fetchSpy = mockGitHubOk()
    const capped = grid().rows.find(
      (r) => r.ceiling_tier === 'prepare-and-route' && sendActionClassOf(r)
    )!
    const outcome = await submitTierChange(db, ENV, deps(), inputFor(capped.routine, 'auto-handle'))
    expect(outcome.kind).toBe('rejected')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await listEntitlementChanges(db, 'ashton-price')).toEqual([])
  })

  it('a no-op opens no PR and writes no row', async () => {
    const fetchSpy = mockGitHubOk()
    const outcome = await submitTierChange(
      db,
      ENV,
      deps(),
      inputFor(graduatingRoutine(), 'prepare-and-route')
    )
    expect(outcome.kind).toBe('noop')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await listEntitlementChanges(db, 'ashton-price')).toEqual([])
  })

  it('a PR failure records NOTHING (never "submitted" for a change that is not)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 403 }))
    const outcome = await submitTierChange(
      db,
      ENV,
      deps(),
      inputFor(graduatingRoutine(), 'auto-handle')
    )
    expect(outcome.kind).toBe('failed')
    expect(await listEntitlementChanges(db, 'ashton-price')).toEqual([])
  })

  it('an unconfigured token fails closed, opening nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const outcome = await submitTierChange(
      db,
      {},
      deps(),
      inputFor(graduatingRoutine(), 'auto-handle')
    )
    expect(outcome.kind).toBe('failed')
    if (outcome.kind !== 'failed') return
    expect(outcome.error).toContain('not configured')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('naming helpers', () => {
  it('branch names are namespaced, slugified, and bounded', () => {
    const b = changeBranchName('ashton-price', 'Client verification & records (chase)', 'n1')
    expect(b.startsWith('operator-entitlement/ashton-price/')).toBe(true)
    expect(b).toMatch(/^[a-z0-9/_-]+$/)
    expect(b.endsWith('-n1')).toBe(true)
  })

  it('the config path targets the seat the change belongs to', () => {
    expect(customerYamlPath('ashton-price')).toBe('operator/customers/ashton-price/customer.yaml')
  })
})
