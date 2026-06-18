import type { D1Database } from '@cloudflare/workers-types'
import type { RuntimeReadResult, RuntimeReadQuery } from '../runtime-read'
import { buildMcpMetadataPath, type ResolvedMcpCustomer } from './customer-resolution'
import { dispatchMcpRequest, getMcpToolName, parseMcpBody } from './mcp-handler'
import { recordMcpAudit } from './mcp-audit'
import { buildWwwAuthenticate } from './oauth-metadata'
import {
  extractBearerToken,
  validateMcpToken,
  type McpAuthResult,
  type McpTokenVerifier,
} from './token-validation'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
}

export interface McpRouteDependencies {
  db: D1Database
  customer: ResolvedMcpCustomer
  verifier?: McpTokenVerifier
  readRuntime: (
    auth: Extract<McpAuthResult, { ok: true }>,
    query: RuntimeReadQuery
  ) => Promise<RuntimeReadResult>
  sendHandoff?: (
    auth: Extract<McpAuthResult, { ok: true }>,
    params: { handoff_id: string; task: string; context?: string }
  ) => Promise<void>
}

function jsonWithCors(body: unknown, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...(extra ?? {}) },
  })
}

function withCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

async function recordAuth(
  deps: McpRouteDependencies,
  auth: McpAuthResult,
  decision: 'allow' | 'deny'
): Promise<void> {
  await recordMcpAudit(deps.db, {
    entityId: deps.customer.entityId,
    customerSlug: deps.customer.customerId,
    eventType: 'auth',
    decision,
    reason: auth.ok ? 'authenticated' : auth.reason,
    clerkSubject: auth.ok ? auth.subject : (auth.subject ?? null),
    tokenAudience:
      'tokenAudience' in auth && auth.tokenAudience ? JSON.stringify(auth.tokenAudience) : null,
    localUserId: auth.ok ? auth.localUserId : null,
    profile: auth.ok ? auth.profile : null,
    tool: null,
  })
}

function unauthorized(
  url: URL,
  customerSlug: string,
  requireOrganization: boolean,
  reason: string
): Response {
  const metadataUrl = new URL(buildMcpMetadataPath(customerSlug), url.origin).toString()
  return jsonWithCors({ error: 'unauthorized', detail: reason }, 401, {
    'WWW-Authenticate': buildWwwAuthenticate(metadataUrl, requireOrganization),
  })
}

export async function handleMcpPost(
  request: Request,
  url: URL,
  deps: McpRouteDependencies
): Promise<Response> {
  const token = extractBearerToken(request.headers.get('authorization'))
  const auth = await validateMcpToken(token, deps.customer, deps.verifier)
  await recordAuth(deps, auth, auth.ok ? 'allow' : 'deny')
  if (!auth.ok) {
    return unauthorized(
      url,
      deps.customer.customerId,
      deps.customer.clerkOrgId !== null,
      auth.reason
    )
  }

  const raw = await request.text()
  const parsed = parseMcpBody(raw)
  if ('error' in parsed) return withCorsHeaders(parsed.error)

  const tool = getMcpToolName(parsed.req)
  if (tool) {
    await recordMcpAudit(deps.db, {
      entityId: deps.customer.entityId,
      customerSlug: deps.customer.customerId,
      eventType: 'tool_call',
      decision: 'allow',
      reason: 'dispatched',
      clerkSubject: auth.subject,
      tokenAudience: JSON.stringify(auth.tokenAudience),
      localUserId: auth.localUserId,
      profile: auth.profile,
      tool,
    })
  }

  const response = await dispatchMcpRequest(parsed.req, {
    customerId: deps.customer.customerId,
    subject: auth.subject,
    email: auth.email,
    profile: auth.profile,
    readRuntime: (query) => deps.readRuntime(auth, query),
    sendHandoff: deps.sendHandoff ? (params) => deps.sendHandoff!(auth, params) : undefined,
  })
  return withCorsHeaders(response)
}

export function handleMcpGet(): Response {
  return jsonWithCors(
    { error: 'method_not_allowed', detail: 'MCP GET/SSE not supported (stateless)' },
    405,
    { Allow: 'POST, OPTIONS' }
  )
}

export function handleMcpOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
