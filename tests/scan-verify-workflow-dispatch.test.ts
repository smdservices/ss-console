/**
 * Tests for the /api/scan/verify endpoint's Cloudflare Workflows dispatch
 * (#614).
 *
 * Asserts:
 *
 *   - When SCAN_WORKFLOW is bound, verify creates a Workflow instance and
 *     persists the returned instance id to scan_requests.workflow_run_id
 *   - When SCAN_WORKFLOW is not bound (dev / test), verify falls back to
 *     the legacy ctx.waitUntil path so local development still works
 *   - The public response shape is unchanged (uniform { ok, status })
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'

// The legacy fallback path imports runDiagnosticScan; mock it so the
// fallback short-circuits without touching enrichment modules.
vi.mock('../src/lib/diagnostic', async () => {
  const actual =
    await vi.importActual<typeof import('../src/lib/diagnostic')>('../src/lib/diagnostic')
  return {
    ...actual,
    runDiagnosticScan: vi.fn().mockResolvedValue({
      scan_request_id: 'fallback',
      status: 'completed',
      entity_id: null,
      thin_footprint_skipped: false,
      modules_ran: [],
      email_sent: false,
    }),
  }
})

import { env as testEnv } from 'cloudflare:workers'
import { GET, POST } from '../src/pages/api/scan/verify'
import { createScanRequest, getScanRequest } from '../src/lib/db/scan-requests'
import { generateScanToken } from '../src/lib/scan/tokens'
import { runDiagnosticScan } from '../src/lib/diagnostic'

const migrationsDir = resolve(process.cwd(), 'migrations')

async function freshDb(): Promise<D1Database> {
  const db = createTestD1() as unknown as D1Database
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

function resetEnv() {
  const e = testEnv as unknown as Record<string, unknown>
  for (const k of Object.keys(e)) delete e[k]
}

describe('/api/scan/verify — Workflows dispatch (#614)', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await freshDb()
    resetEnv()
    Object.assign(testEnv, { DB: db })
    vi.clearAllMocks()
  })

  it('creates a Workflow instance and persists workflow_run_id when bound', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'wf-12345' })
    Object.assign(testEnv, { SCAN_WORKFLOW: { create } })

    const { token, hash } = await generateScanToken()
    const row = await createScanRequest(db, {
      email: 'a@b.com',
      domain: 'example.com',
      verification_token_hash: hash,
      request_ip: '1.1.1.1',
    })

    const url = new URL(`https://smd.services/api/scan/verify?token=${token}`)
    const response = await GET({
      url,
      locals: { session: null },
    } as never)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; status: string; domain: string }
    expect(body.ok).toBe(true)
    expect(body.status).toBe('verified')
    expect(body.domain).toBe('example.com')

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ params: { scanRequestId: row.id } })

    // Workflow id was persisted.
    const updated = await getScanRequest(db, row.id)
    expect(updated?.workflow_run_id).toBe('wf-12345')
    expect(updated?.scan_status).toBe('verified')

    // Fallback path was NOT invoked.
    expect(vi.mocked(runDiagnosticScan)).not.toHaveBeenCalled()
  })

  it('falls back to ctx.waitUntil when SCAN_WORKFLOW is not bound', async () => {
    // No SCAN_WORKFLOW in env.
    const { token, hash } = await generateScanToken()
    await createScanRequest(db, {
      email: 'a@b.com',
      domain: 'example.com',
      verification_token_hash: hash,
      request_ip: '1.1.1.1',
    })

    const waitUntil = vi.fn()
    const response = await POST({
      request: new Request('https://smd.services/api/scan/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
      locals: { session: null, cfContext: { waitUntil } as never },
    } as never)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; status: string }
    expect(body.ok).toBe(true)
    expect(body.status).toBe('verified')

    // ctx.waitUntil received the fallback promise.
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runDiagnosticScan)).toHaveBeenCalledTimes(1)
  })

  it('falls back when SCAN_WORKFLOW.create throws (does not lose the scan)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('quota exceeded'))
    Object.assign(testEnv, { SCAN_WORKFLOW: { create } })

    const { token, hash } = await generateScanToken()
    await createScanRequest(db, {
      email: 'a@b.com',
      domain: 'example.com',
      verification_token_hash: hash,
      request_ip: '1.1.1.1',
    })

    const waitUntil = vi.fn()
    const url = new URL(`https://smd.services/api/scan/verify?token=${token}`)
    const response = await GET({
      url,
      locals: { session: null, cfContext: { waitUntil } as never },
    } as never)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; status: string }
    expect(body.status).toBe('verified')

    // create() was attempted; fallback was invoked when it threw.
    expect(create).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runDiagnosticScan)).toHaveBeenCalledTimes(1)
  })

  it('returns invalid_token without invoking the workflow on a bad token', async () => {
    const create = vi.fn()
    Object.assign(testEnv, { SCAN_WORKFLOW: { create } })

    const url = new URL('https://smd.services/api/scan/verify?token=not-a-real-token')
    const response = await GET({
      url,
      locals: { session: null },
    } as never)
    expect(response.status).toBe(400)
    const body = (await response.json()) as { ok: boolean; status: string }
    expect(body.ok).toBe(false)
    expect(body.status).toBe('invalid_token')
    expect(body).not.toHaveProperty('domain')
    expect(create).not.toHaveBeenCalled()
  })
})
