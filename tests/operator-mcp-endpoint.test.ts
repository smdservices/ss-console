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
import type { D1Database } from '@cloudflare/workers-types'
import { extractBearerToken, validateMcpToken } from '../src/lib/operator/mcp/token-validation'
import {
  resolveCustomerFromClaims,
  loadMcpCustomers,
  discoveryAuthorizationServers,
  type ResolvedMcpCustomer,
} from '../src/lib/operator/mcp/customer-resolution'
import { dispatchMcpRequest, parseMcpBody } from '../src/lib/operator/mcp/mcp-handler'
import type { McpToolContext } from '../src/lib/operator/mcp/tools'

const CTX: McpToolContext = {
  customerId: 'smd',
  subject: 'user_123',
  email: 'pilot@example.com',
  profile: 'marcus',
}

/** Build a provisioned-customer fixture for the pure resolver tests. */
function customerFixture(
  over: Partial<{
    customerId: string
    issuer: string
    audience: string | null
    clientId: string
    enabled: boolean
    access: { email: string; profile: string }[]
  }> = {}
): ResolvedMcpCustomer {
  return {
    customerId: over.customerId ?? 'smd',
    connector: {
      enabled: over.enabled ?? true,
      data_posture: 'open',
      access: over.access ?? [{ email: 'pilot@example.com', profile: 'marcus' }],
    },
    clerk: {
      issuer: over.issuer ?? 'https://clerk.smd.services',
      audience: over.audience ?? null,
      authorizedParties: over.clientId ? [over.clientId] : [],
    },
  }
}

/** Minimal D1 stub: every prepare().all() returns the same fixed rows. */
function fakeDb(rows: unknown[]): D1Database {
  return {
    prepare: () => ({ all: async () => ({ results: rows }) }),
  } as unknown as D1Database
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
    const r = await validateMcpToken(null, [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('missing_token')
  })

  it('rejects an unverifiable token at the signature gate (FIRST gate)', async () => {
    // A garbage token cannot pass @clerk/backend verifyToken (no real JWKS).
    // Signature is verified BEFORE any customer resolution or data access, so a
    // forged token never reaches the aud/customer logic — the registry passed in
    // is irrelevant here. Exercises the security-ordered fail-closed branch.
    const r = await validateMcpToken('not.a.real.jwt', [customerFixture()])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('signature_invalid')
  })
})

/**
 * SECURITY INVARIANTS (console-hosting review). The customer is DERIVED from the
 * verified token's aud/iss — never a path/body. resolveCustomerFromClaims is the
 * cross-tenant gate; these test it directly with already-"verified" claim shapes
 * (the function is only ever called post-signature-verification in production)
 * against an explicit provisioned registry.
 */
describe('resolveCustomerFromClaims — customer derives from verified claims', () => {
  it('returns null when the registry is empty (dark default)', () => {
    // Nothing provisioned ⇒ no token resolves, regardless of its claims.
    expect(resolveCustomerFromClaims({ aud: 'https://smd.services/api/mcp' }, [])).toBeNull()
    expect(resolveCustomerFromClaims({ iss: 'https://clerk.smd.services' }, [])).toBeNull()
    expect(resolveCustomerFromClaims({}, [])).toBeNull()
  })

  it('matches an issuer-keyed customer by iss when audience is unbound', () => {
    const c = customerFixture({ issuer: 'https://clerk.smd.services', audience: null })
    expect(resolveCustomerFromClaims({ iss: 'https://clerk.smd.services' }, [c])).toBe(c)
    expect(resolveCustomerFromClaims({ iss: 'https://other.clerk.dev' }, [c])).toBeNull()
  })

  it('does not match an issuer-keyed customer from an empty issuer claim', () => {
    const c = customerFixture({ issuer: 'https://clerk.smd.services', audience: null })
    expect(resolveCustomerFromClaims({ iss: '' }, [c])).toBeNull()
  })

  it('matches an audience-bound customer by aud (string or array)', () => {
    const aud = 'https://smd.services/api/mcp'
    const c = customerFixture({ audience: aud })
    expect(resolveCustomerFromClaims({ aud }, [c])).toBe(c)
    expect(resolveCustomerFromClaims({ aud: [aud, 'urn:x'] }, [c])).toBe(c)
    expect(resolveCustomerFromClaims({ aud: 'https://evil.example/api/mcp' }, [c])).toBeNull()
  })

  it('an audience-bound customer is NEVER matched by issuer alone (no aud sidestep)', () => {
    // A token issued by the same instance but WITHOUT the bound aud must not
    // resolve an aud-bound customer via the issuer fallback.
    const c = customerFixture({
      issuer: 'https://clerk.smd.services',
      audience: 'https://smd.services/api/mcp',
    })
    expect(resolveCustomerFromClaims({ iss: 'https://clerk.smd.services' }, [c])).toBeNull()
  })

  it('refuses (null) when more than one customer matches — ambiguous', () => {
    // Two issuer-keyed customers sharing an issuer ⇒ refuse rather than guess.
    const a = customerFixture({
      customerId: 'a',
      issuer: 'https://shared.clerk.dev',
      audience: null,
    })
    const b = customerFixture({
      customerId: 'b',
      issuer: 'https://shared.clerk.dev',
      audience: null,
    })
    expect(resolveCustomerFromClaims({ iss: 'https://shared.clerk.dev' }, [a, b])).toBeNull()
    // Two customers sharing an audience ⇒ likewise refuse.
    const aud = 'https://smd.services/api/mcp'
    const c = customerFixture({ customerId: 'c', audience: aud })
    const d = customerFixture({ customerId: 'd', audience: aud })
    expect(resolveCustomerFromClaims({ aud }, [c, d])).toBeNull()
  })
})

describe('validateMcpToken — wrong-aud rejection ordering', () => {
  it('a syntactically-valid but unverifiable token never selects a customer', async () => {
    // Even if an attacker crafts a token whose aud names our resource, it fails
    // at the signature gate first (no valid JWKS signature). The customer is only
    // derived AFTER verification, so a wrong/forged aud can never reach data —
    // even with a real customer provisioned in the registry.
    const r = await validateMcpToken('eyJ.forged.aud', [
      customerFixture({ audience: 'https://smd.services/api/mcp' }),
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('signature_invalid')
  })
})

describe('loadMcpCustomers — D1 → registry mapping', () => {
  it('maps a binding+config row into a ResolvedMcpCustomer', async () => {
    const db = fakeDb([
      {
        customer_slug: 'smd',
        issuer: 'https://clerk.smd.services',
        client_id: 'client_abc',
        audience: null,
        mcp_connector_json: JSON.stringify({
          enabled: true,
          data_posture: 'open',
          access: [{ email: 'pilot@example.com', profile: 'marcus' }],
        }),
      },
    ])
    const [c] = await loadMcpCustomers(db)
    expect(c.customerId).toBe('smd')
    expect(c.clerk.issuer).toBe('https://clerk.smd.services')
    expect(c.clerk.authorizedParties).toEqual(['client_abc'])
    expect(c.connector.enabled).toBe(true)
    expect(c.connector.access).toEqual([{ email: 'pilot@example.com', profile: 'marcus' }])
  })

  it('fail-closes the connector when the config row is absent (null json)', async () => {
    const db = fakeDb([
      {
        customer_slug: 'smd',
        issuer: 'https://clerk.smd.services',
        client_id: 'client_abc',
        audience: null,
        mcp_connector_json: null,
      },
    ])
    const [c] = await loadMcpCustomers(db)
    expect(c.connector.enabled).toBe(false)
    expect(c.connector.access).toEqual([])
  })

  it('treats an empty-string audience as no binding (issuer-keyed)', async () => {
    const db = fakeDb([
      {
        customer_slug: 'smd',
        issuer: 'https://clerk.smd.services',
        client_id: 'client_abc',
        audience: '',
        mcp_connector_json: null,
      },
    ])
    const [c] = await loadMcpCustomers(db)
    expect(c.clerk.audience).toBeNull()
  })

  it('returns an empty registry for no rows (dark default)', async () => {
    expect(await loadMcpCustomers(fakeDb([]))).toEqual([])
  })
})

describe('discoveryAuthorizationServers — advertised issuers', () => {
  it('returns the distinct non-empty issuers of provisioned customers', () => {
    const customers = [
      customerFixture({ customerId: 'a', issuer: 'https://clerk.smd.services' }),
      customerFixture({ customerId: 'b', issuer: 'https://clerk.smd.services' }),
      customerFixture({ customerId: 'c', issuer: 'https://other.clerk.dev' }),
    ]
    expect(discoveryAuthorizationServers(customers).sort()).toEqual([
      'https://clerk.smd.services',
      'https://other.clerk.dev',
    ])
  })

  it('returns an empty list when nothing is provisioned (honest no-AS)', () => {
    expect(discoveryAuthorizationServers([])).toEqual([])
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
