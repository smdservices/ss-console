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
import { resolveCustomerFromClaims } from '../src/lib/operator/mcp/customer-resolution'
import { dispatchMcpRequest, parseMcpBody } from '../src/lib/operator/mcp/mcp-handler'
import type { McpToolContext } from '../src/lib/operator/mcp/tools'

const CTX: McpToolContext = {
  customerId: 'smd',
  subject: 'user_123',
  email: 'pilot@example.com',
  profile: 'marcus',
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

describe('validateMcpToken — token gates (no live Clerk app)', () => {
  it('rejects when no token is present', async () => {
    const r = await validateMcpToken(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('missing_token')
  })

  it('rejects an unverifiable token at the signature gate (FIRST gate)', async () => {
    // A garbage token cannot pass @clerk/backend verifyToken (no real JWKS).
    // Signature is verified BEFORE any customer resolution or data access, so a
    // forged token never reaches the aud/customer logic. Exercises the
    // security-ordered fail-closed branch end to end.
    const r = await validateMcpToken('not.a.real.jwt')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('signature_invalid')
  })
})

/**
 * SECURITY INVARIANTS (console-hosting review). The customer is DERIVED from the
 * verified token's aud/iss — never a path/body. resolveCustomerFromClaims is the
 * cross-tenant gate; these test it directly with already-"verified" claim shapes
 * (the function is only ever called post-signature-verification in production).
 */
describe('resolveCustomerFromClaims — customer derives from verified claims', () => {
  it('returns null when claims match no registered customer (wrong-aud rejection)', () => {
    // The spike pilot ships with empty issuer/audience, so NOTHING resolves —
    // the fail-closed posture until the Captain provisions the Clerk binding.
    expect(resolveCustomerFromClaims({ aud: 'https://evil.example/api/mcp' })).toBeNull()
    expect(resolveCustomerFromClaims({ iss: 'https://attacker.clerk.dev' })).toBeNull()
    expect(resolveCustomerFromClaims({})).toBeNull()
  })

  it('does not resolve a customer from an empty/unprovisioned issuer', () => {
    // Guards against an empty-string issuer matching an empty claim.
    expect(resolveCustomerFromClaims({ iss: '' })).toBeNull()
  })
})

describe('validateMcpToken — wrong-aud rejection ordering', () => {
  it('a syntactically-valid but unverifiable token never selects a customer', async () => {
    // Even if an attacker crafts a token whose aud names our resource, it fails
    // at the signature gate first (no valid JWKS signature). The customer is only
    // derived AFTER verification, so a wrong/forged aud can never reach data.
    const r = await validateMcpToken('eyJ.forged.aud')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('signature_invalid')
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
