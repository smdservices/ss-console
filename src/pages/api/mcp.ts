/**
 * SPIKE SCAFFOLD (A0) — Operator ⇄ Claude MCP endpoint (Streamable HTTP).
 *
 * `POST /api/mcp` — the single MCP endpoint a client org's Claude connects to.
 * Auth = Clerk OAuth (the console is the OAuth Resource Server; Clerk is the
 * Authorization Server). Flow:
 *   1. Client discovers the AS via `/.well-known/oauth-protected-resource/api/mcp`.
 *   2. Client runs OAuth 2.1 + PKCE against the customer's Clerk app, returns
 *      with a bearer token.
 *   3. Every POST here carries `Authorization: Bearer <token>`. We validate it
 *      fail-closed (signature + iss + aud/azp via @clerk/backend, then map the
 *      identity to the customer's authored `mcp_connector.access[]`).
 *   4. Authenticated → dispatch the JSON-RPC method (initialize/tools.list/
 *      tools.call) and answer with a single application/json response.
 *
 * Hosting decision (lower-friction path, justified): a path under `src/pages/api`
 * rather than a dedicated `mcp.smd.services` host. The apex/any host already
 * serves `/api/*` unauthenticated through the existing middleware (only /admin
 * and /portal are gated), so no `src/middleware.ts` change, no new DNS record,
 * no new TLS cert, no new Worker route are needed. The dedicated-host option
 * stays open (the design's durable on-Machine sidecar is the other axis) but is
 * unnecessary cost for the Phase-1 pilot.
 *
 * Audit (build plan C3): every call SHOULD write an `MCP_AUTH` / `MCP_TOOL_CALL`
 * row (console-side, digest-only). The spike marks the exact emission point with
 * a TODO + a clearly-named seam; wiring it needs the `MCP_*` action types added
 * to the console audit allowlist, which is a C3 slice, not A0.
 *
 * NOTE: prerender is implicitly false (astro.config `output: 'server'`); this is
 * a server route. The body is read once via `request.text()`.
 */

import type { APIRoute } from 'astro'
import { resolveMcpCustomer } from '../../lib/operator/mcp/customer-resolution'
import { buildWwwAuthenticate } from '../../lib/operator/mcp/oauth-metadata'
import {
  extractBearerToken,
  validateMcpToken,
  type McpAuthResult,
} from '../../lib/operator/mcp/token-validation'
import { dispatchMcpRequest, parseMcpBody } from '../../lib/operator/mcp/mcp-handler'
import type { McpToolContext } from '../../lib/operator/mcp/tools'

const RESOURCE_PATH = '/api/mcp'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
}

function jsonWithCors(body: unknown, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...(extra ?? {}) },
  })
}

/**
 * Build the RFC 9728 `WWW-Authenticate` challenge a 401 must carry, pointing the
 * client back at the discovery document for this resource.
 */
function unauthorized(originUrl: URL, reasonDetail: string): Response {
  const metadataUrl = new URL(
    `/.well-known/oauth-protected-resource${RESOURCE_PATH}`,
    originUrl.origin
  ).toString()
  // SPIKE-AUDIT-SEAM: emit MCP_AUTH(decision=deny, reason=reasonDetail) here once
  // the MCP_* action types are added to the console audit allowlist (build plan
  // C3). Digest-only — never log the raw token.
  return jsonWithCors({ error: 'unauthorized', detail: reasonDetail }, 401, {
    'WWW-Authenticate': buildWwwAuthenticate(metadataUrl),
  })
}

/** Map a failed auth result to a 401 with the right challenge. */
function denyFor(originUrl: URL, auth: Extract<McpAuthResult, { ok: false }>): Response {
  return unauthorized(originUrl, auth.reason)
}

export const POST: APIRoute = async ({ request, url }) => {
  const customer = resolveMcpCustomer(RESOURCE_PATH)

  // --- Auth (fail-closed) ---
  const token = extractBearerToken(request.headers.get('authorization'))
  const auth = await validateMcpToken(token, customer)
  if (!auth.ok) {
    return denyFor(url, auth)
  }
  // `customer` is non-null here: a null customer fails validation above.
  const ctx: McpToolContext = {
    customerId: customer!.customerId,
    subject: auth.subject,
    email: auth.email,
    profile: auth.profile,
  }

  // --- Parse JSON-RPC body ---
  const raw = await request.text()
  const parsed = parseMcpBody(raw)
  if ('error' in parsed) return withCorsHeaders(parsed.error)

  // SPIKE-AUDIT-SEAM: emit MCP_TOOL_CALL(actor=auth.subject, customer, method)
  // here for tools/call methods once MCP_* audit types land (build plan C3).
  const response = await dispatchMcpRequest(parsed.req, ctx)
  return withCorsHeaders(response)
}

/**
 * Per the Streamable HTTP spec a server MAY support GET for a server→client SSE
 * stream. The spike is a stateless request/response surface with no
 * server-initiated messages, so we decline GET with 405 + Allow. (Not an error
 * the client can't handle — clients fall back to POST-only operation.)
 */
export const GET: APIRoute = () =>
  jsonWithCors(
    { error: 'method_not_allowed', detail: 'MCP GET/SSE not supported (stateless)' },
    405,
    {
      Allow: 'POST, OPTIONS',
    }
  )

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS_HEADERS })

/** Re-attach CORS headers to a Response produced by the transport layer. */
function withCorsHeaders(resp: Response): Response {
  const headers = new Headers(resp.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(resp.body, { status: resp.status, headers })
}
