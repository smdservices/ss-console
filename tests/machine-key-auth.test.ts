/**
 * Tests for the Machine→control-plane auth verifier (ADR 0023 Wave 1).
 *
 * Wave 1 uses a single shared MACHINE_HEARTBEAT_KEY and identifies the
 * tenant via the X-Tenant-Slug header. The verifier MUST:
 *   - Return 401 (never 404) on a missing/wrong key — uniform response
 *     shape so a probing attacker can't enumerate valid keys.
 *   - Return 401 on missing X-Tenant-Slug.
 *   - Return 401 on a slug that's not in customer_configs.
 *   - Return ok + entity_id on the happy path.
 *
 * The DB lookup is mocked so these are unit tests, not integration.
 */

import { describe, it, expect, vi } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { verifyMachineRequest } from '../src/lib/auth/machine-key'

const KEY = '0'.repeat(64)

function mockDb(slugToEntity: Record<string, string>): D1Database {
  const prepare = vi.fn((_sql: string) => ({
    bind: (slug: string) => ({
      first: async <T>(): Promise<T | null> => {
        const entityId = slugToEntity[slug]
        return entityId ? ({ entity_id: entityId } as unknown as T) : null
      },
    }),
  }))
  return { prepare } as unknown as D1Database
}

function req(headers: Record<string, string>): Request {
  return new Request('https://example/api/internal/heartbeat', { method: 'POST', headers })
}

describe('verifyMachineRequest', () => {
  it('returns ok + entity_id on valid key + known slug', async () => {
    const db = mockDb({ smd: 'ent-smd' })
    const r = await verifyMachineRequest(
      req({ Authorization: `Bearer ${KEY}`, 'X-Tenant-Slug': 'smd' }),
      KEY,
      db
    )
    expect(r).toEqual({ ok: true, entityId: 'ent-smd', slug: 'smd' })
  })

  it('rejects when expected key is unset (server misconfigured fails closed)', async () => {
    const db = mockDb({ smd: 'ent-smd' })
    const r = await verifyMachineRequest(
      req({ Authorization: `Bearer ${KEY}`, 'X-Tenant-Slug': 'smd' }),
      undefined,
      db
    )
    expect(r).toEqual({ ok: false, status: 401 })
  })

  it('rejects on missing Authorization header', async () => {
    const db = mockDb({ smd: 'ent-smd' })
    const r = await verifyMachineRequest(req({ 'X-Tenant-Slug': 'smd' }), KEY, db)
    expect(r).toEqual({ ok: false, status: 401 })
  })

  it('rejects on Authorization that is not Bearer-shaped', async () => {
    const db = mockDb({ smd: 'ent-smd' })
    const r = await verifyMachineRequest(
      req({ Authorization: `Basic ${KEY}`, 'X-Tenant-Slug': 'smd' }),
      KEY,
      db
    )
    expect(r).toEqual({ ok: false, status: 401 })
  })

  it('rejects on wrong bearer (constant-length mismatch)', async () => {
    const db = mockDb({ smd: 'ent-smd' })
    const r = await verifyMachineRequest(
      req({ Authorization: 'Bearer wrong', 'X-Tenant-Slug': 'smd' }),
      KEY,
      db
    )
    expect(r).toEqual({ ok: false, status: 401 })
  })

  it('rejects on wrong bearer of same length (constant-time path)', async () => {
    const db = mockDb({ smd: 'ent-smd' })
    const wrong = '1'.repeat(64)
    const r = await verifyMachineRequest(
      req({ Authorization: `Bearer ${wrong}`, 'X-Tenant-Slug': 'smd' }),
      KEY,
      db
    )
    expect(r).toEqual({ ok: false, status: 401 })
  })

  it('rejects on missing X-Tenant-Slug', async () => {
    const db = mockDb({ smd: 'ent-smd' })
    const r = await verifyMachineRequest(req({ Authorization: `Bearer ${KEY}` }), KEY, db)
    expect(r).toEqual({ ok: false, status: 401 })
  })

  it('rejects on empty X-Tenant-Slug', async () => {
    const db = mockDb({ smd: 'ent-smd' })
    const r = await verifyMachineRequest(
      req({ Authorization: `Bearer ${KEY}`, 'X-Tenant-Slug': '' }),
      KEY,
      db
    )
    expect(r).toEqual({ ok: false, status: 401 })
  })

  it('rejects on unknown slug — uniform 401, NOT 404 (tenant-enumeration defense)', async () => {
    const db = mockDb({ smd: 'ent-smd' })
    const r = await verifyMachineRequest(
      req({ Authorization: `Bearer ${KEY}`, 'X-Tenant-Slug': 'who-dis' }),
      KEY,
      db
    )
    expect(r).toEqual({ ok: false, status: 401 })
  })
})
