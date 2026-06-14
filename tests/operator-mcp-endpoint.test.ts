/**
 * SPIKE SCAFFOLD (A0) tests for the Operator ⇄ Claude MCP endpoint.
 *
 * These cover the parts that do NOT need a live Clerk app: the fail-closed auth
 * gates that run BEFORE signature verification, the identity → access[] mapping,
 * and the stateless JSON-RPC dispatcher (initialize / tools.list / tools.call /
 * method-not-found). The signature-verification path (`@clerk/backend`
 * verifyToken against a real JWKS) is exercised end-to-end by the Captain's A0
 * step with a real `claude.ai` connector add — it cannot be unit-tested without
 * a live Clerk instance, which is called out in the deliverable notes.
 */

import { describe, it, expect } from 'vitest'
import { extractBearerToken, validateMcpToken } from '../src/lib/operator/mcp/token-validation'
import type { ResolvedMcpCustomer } from '../src/lib/operator/mcp/customer-resolution'
import { dispatchMcpRequest, parseMcpBody } from '../src/lib/operator/mcp/mcp-handler'
import type { McpToolContext } from '../src/lib/operator/mcp/tools'

const CTX: McpToolContext = {
  customerId: 'smd',
  subject: 'user_123',
  email: 'pilot@example.com',
  profile: 'marcus',
}

function customer(overrides: Partial<ResolvedMcpCustomer> = {}): ResolvedMcpCustomer {
  return {
    customerId: 'smd',
    connector: { enabled: true, data_posture: 'open', access: [] },
    clerk: { issuer: 'https://clerk.example.com', audience: null, authorizedParties: [] },
    ...overrides,
  }
}

describe('extractBearerToken', () => {
  it('returns the token for a well-formed header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })
  it('is case-insensitive on the scheme', () => {
    expect(extractBearerToken('bearer xyz')).toBe('xyz')
  })
  it('returns null for missing/malformed headers', () => {
    expect(extractBearerToken(null)).toBeNull()
    expect(extractBearerToken('')).toBeNull()
    expect(extractBearerToken('Basic abc')).toBeNull()
    expect(extractBearerToken('Bearer ')).toBeNull()
  })
})

describe('validateMcpToken — fail-closed pre-signature gates', () => {
  it('rejects when no token is present', async () => {
    const r = await validateMcpToken(null, customer())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('missing_token')
  })

  it('rejects when the customer is unknown', async () => {
    const r = await validateMcpToken('tok', null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('customer_not_configured')
  })

  it('rejects when the connector is disabled (fail-closed default)', async () => {
    const r = await validateMcpToken(
      'tok',
      customer({ connector: { enabled: false, data_posture: 'open', access: [] } })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('connector_disabled')
  })

  it('rejects when the Clerk issuer is not provisioned (spike stub posture)', async () => {
    const r = await validateMcpToken(
      'tok',
      customer({ clerk: { issuer: '', audience: null, authorizedParties: [] } })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('customer_not_configured')
  })

  it('rejects an invalid token signature once the issuer is set', async () => {
    // A garbage token cannot pass @clerk/backend verifyToken (no real JWKS) —
    // exercises the signature_or_claims_invalid fail-closed branch end to end.
    const r = await validateMcpToken('not.a.real.jwt', customer())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('signature_or_claims_invalid')
  })
})

describe('JSON-RPC dispatcher', () => {
  it('initialize returns protocolVersion + serverInfo', async () => {
    const resp = await dispatchMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, CTX)
    expect(resp.status).toBe(200)
    const body: { result: { protocolVersion: string; serverInfo: { name: string } } } =
      await resp.json()
    expect(body.result.protocolVersion).toBeTruthy()
    expect(body.result.serverInfo.name).toBe('smd-operator-connector')
  })

  it('tools/list returns the operator_status stub', async () => {
    const resp = await dispatchMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, CTX)
    const body: { result: { tools: { name: string }[] } } = await resp.json()
    const names = body.result.tools.map((t) => t.name)
    expect(names).toContain('operator_status')
  })

  it('tools/call operator_status echoes the authenticated identity', async () => {
    const resp = await dispatchMcpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'operator_status', arguments: {} },
      },
      CTX
    )
    const body: { result: { content: { text: string }[] } } = await resp.json()
    const payload: { stub: boolean; authenticated_as: { email: string } } = JSON.parse(
      body.result.content[0].text
    )
    expect(payload.stub).toBe(true)
    expect(payload.authenticated_as.email).toBe('pilot@example.com')
  })

  it('tools/call on an unknown tool is method-not-found', async () => {
    const resp = await dispatchMcpRequest(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      CTX
    )
    const body: { error?: { code: number } } = await resp.json()
    expect(body.error?.code).toBe(-32601)
  })

  it('an unknown method is method-not-found', async () => {
    const resp = await dispatchMcpRequest({ jsonrpc: '2.0', id: 5, method: 'frobnicate' }, CTX)
    const body: { error?: { code: number } } = await resp.json()
    expect(body.error?.code).toBe(-32601)
  })
})

describe('parseMcpBody', () => {
  it('parses a valid JSON-RPC request', () => {
    const out = parseMcpBody('{"jsonrpc":"2.0","id":1,"method":"ping"}')
    expect('req' in out).toBe(true)
  })
  it('rejects invalid JSON with a parse error', async () => {
    const out = parseMcpBody('{not json')
    expect('error' in out).toBe(true)
    if ('error' in out) {
      const body: { error: { code: number } } = await out.error.json()
      expect(body.error.code).toBe(-32700)
    }
  })
  it('rejects a non-JSON-RPC object', async () => {
    const out = parseMcpBody('{"foo":"bar"}')
    expect('error' in out).toBe(true)
    if ('error' in out) {
      const body: { error: { code: number } } = await out.error.json()
      expect(body.error.code).toBe(-32600)
    }
  })
})
