/**
 * Tests for the production console→Machine runtime read transport
 * (src/lib/operator/runtime-read-transport.ts) — ADR 0043 path A.
 *
 * Covers: the configured-gate truth table; the per-customer HMAC key derivation
 * (incl. a CROSS-SIDE match against the shell derivation the provision script
 * uses — the single most likely silent fail-closed cause); and the transport's
 * success / unauthorized / unreachable / not-configured / unknown-customer
 * behaviour, both directly and end-to-end through readMachineRuntime.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  createMachineRuntimeTransport,
  deriveRuntimeReadKey,
  isRuntimeReadConfigured,
  RuntimeReadNotConfiguredError,
  type RuntimeReadEnv,
} from '../src/lib/operator/runtime-read-transport'
import { readMachineRuntime, RuntimeReadUnauthorizedError } from '../src/lib/operator/runtime-read'

const ENV: RuntimeReadEnv = {
  OPERATOR_RUNTIME_READ_URL: 'https://{app}.fly.dev',
  OPERATOR_RUNTIME_READ_SECRET: 'test-master-key-1234567890',
}
const ACTOR = { actor: 'captain@example.com', actorRole: 'admin' }
const noopAudit = { record: () => Promise.resolve() }

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response): void {
  vi.stubGlobal('fetch', vi.fn(impl as unknown as typeof fetch))
}

// ---------------------------------------------------------------------------
// Config gate
// ---------------------------------------------------------------------------

describe('isRuntimeReadConfigured', () => {
  it('requires BOTH url and secret', () => {
    expect(isRuntimeReadConfigured(ENV)).toBe(true)
    expect(isRuntimeReadConfigured({ OPERATOR_RUNTIME_READ_URL: 'x' })).toBe(false)
    expect(isRuntimeReadConfigured({ OPERATOR_RUNTIME_READ_SECRET: 'x' })).toBe(false)
    expect(isRuntimeReadConfigured({})).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Key derivation + cross-side match
// ---------------------------------------------------------------------------

describe('deriveRuntimeReadKey', () => {
  it('is deterministic and produces a 64-hex key', async () => {
    const a = await deriveRuntimeReadKey('master', 'smd')
    const b = await deriveRuntimeReadKey('master', 'smd')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await deriveRuntimeReadKey('master', 'other')).not.toBe(a)
  })

  it('matches the shell derivation the provision script uses (cross-side)', () => {
    // This is the byte-identity check Captain flagged: the console derives over
    // the slug via WebCrypto; provision derives over customer_id via openssl.
    // They MUST agree or every read silently 401s. Canonical input: the slug
    // string with NO trailing newline (printf %s).
    const master = 'test-master-key-1234567890'
    const slug = 'smith-pi-firm'
    const shell = execFileSync('bash', [
      '-c',
      `printf '%s' "${slug}" | openssl dgst -sha256 -hmac "${master}" | sed 's/^.*= //'`,
    ])
      .toString()
      .trim()
    return expect(deriveRuntimeReadKey(master, slug)).resolves.toBe(shell)
  })
})

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

describe('createMachineRuntimeTransport.read', () => {
  it('GETs the registry-resolved Machine with the derived bearer + tenant slug', async () => {
    let seenUrl = ''
    let seenHeaders: Record<string, string> = {}
    stubFetch((url, init) => {
      seenUrl = url
      seenHeaders = (init.headers as Record<string, string>) ?? {}
      return new Response(JSON.stringify({ entries: [], cursor: null }), { status: 200 })
    })
    const t = createMachineRuntimeTransport(ENV)
    const { data } = await t.read('smd', { kind: 'audit_log', limit: 25 })
    expect(seenUrl).toBe('https://hermes-smd.fly.dev/runtime/audit_log?limit=25')
    expect(seenHeaders['X-Tenant-Slug']).toBe('smd')
    expect(seenHeaders['Authorization']).toBe(
      `Bearer ${await deriveRuntimeReadKey(ENV.OPERATOR_RUNTIME_READ_SECRET!, 'smd')}`
    )
    expect(data).toEqual({ entries: [], cursor: null })
  })

  it('throws RuntimeReadUnauthorizedError on 401/403 (→ unauthorized e2e)', async () => {
    stubFetch(() => new Response('', { status: 401 }))
    const t = createMachineRuntimeTransport(ENV)
    await expect(t.read('smd', { kind: 'audit_log' })).rejects.toBeInstanceOf(
      RuntimeReadUnauthorizedError
    )
    // End-to-end: readMachineRuntime maps it to reason 'unauthorized', not 'unreachable'.
    const res = await readMachineRuntime(
      { transport: t, audit: noopAudit },
      'smd',
      { kind: 'audit_log' },
      ACTOR
    )
    expect(res).toEqual({ ok: false, kind: 'audit_log', reason: 'unauthorized' })
  })

  it('throws on a non-2xx (→ unreachable e2e, fail-closed)', async () => {
    stubFetch(() => new Response('', { status: 500 }))
    const t = createMachineRuntimeTransport(ENV)
    const res = await readMachineRuntime(
      { transport: t, audit: noopAudit },
      'smd',
      { kind: 'audit_log' },
      ACTOR
    )
    expect(res).toEqual({ ok: false, kind: 'audit_log', reason: 'unreachable' })
  })

  it('throws on a network failure (→ unreachable)', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')))
    const t = createMachineRuntimeTransport(ENV)
    await expect(t.read('smd', { kind: 'audit_log' })).rejects.toThrow()
  })

  it('throws RuntimeReadNotConfiguredError when not configured', async () => {
    const t = createMachineRuntimeTransport({})
    await expect(t.read('smd', { kind: 'audit_log' })).rejects.toBeInstanceOf(
      RuntimeReadNotConfiguredError
    )
  })

  it('throws (→ unreachable) for a customer absent from the registry', async () => {
    stubFetch(() => new Response('{}', { status: 200 }))
    const t = createMachineRuntimeTransport(ENV)
    await expect(t.read('ghost-firm', { kind: 'audit_log' })).rejects.toThrow(/unknown customer/)
    // A registry miss is a per-call failure, NOT a config failure.
    expect(isRuntimeReadConfigured(ENV)).toBe(true)
  })

  it('honors a host template without {app} by falling back to <app>.fly.dev', async () => {
    let seenUrl = ''
    stubFetch((url) => {
      seenUrl = url
      return new Response(JSON.stringify({ entries: [] }), { status: 200 })
    })
    const t = createMachineRuntimeTransport({
      OPERATOR_RUNTIME_READ_URL: 'enabled',
      OPERATOR_RUNTIME_READ_SECRET: 'm',
    })
    await t.read('smd', { kind: 'audit_log' })
    expect(seenUrl).toBe('https://hermes-smd.fly.dev/runtime/audit_log')
  })
})
