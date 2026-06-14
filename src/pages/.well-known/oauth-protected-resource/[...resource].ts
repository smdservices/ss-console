/**
 * SPIKE SCAFFOLD (A0) — RFC 9728 OAuth Protected Resource Metadata endpoint.
 *
 * `GET /.well-known/oauth-protected-resource/<resource-path>` — the discovery
 * document an MCP client fetches to learn which Authorization Server (the
 * customer's Clerk instance) issues tokens for our MCP resource. Per RFC 9728
 * §3.1, the resource path is appended to the well-known prefix; for our endpoint
 * at `/api/mcp` the client requests `/.well-known/oauth-protected-resource/api/mcp`.
 *
 * Public + unauthenticated (the middleware leaves `/.well-known/*` ungated). The
 * `Access-Control-Allow-Origin: *` + OPTIONS preflight are required so
 * browser-based MCP clients (claude.ai) can read it cross-origin.
 *
 * Fail-closed: an unknown resource path → 404 (no customer ⇒ no metadata).
 */

import type { APIRoute } from 'astro'
import { resolveMcpCustomer } from '../../../lib/operator/mcp/customer-resolution'
import { buildProtectedResourceMetadata } from '../../../lib/operator/mcp/oauth-metadata'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

/**
 * Reconstruct the resource path the metadata describes from the rest param.
 * Astro gives `resource` as the captured tail (e.g. `api/mcp`); we re-prefix a
 * leading slash to match the canonical endpoint path used by `resolveMcpCustomer`.
 */
function resourcePathFromParam(resource: string | undefined): string {
  const tail = (resource ?? '').replace(/^\/+/, '')
  return `/${tail}`
}

export const GET: APIRoute = ({ params, url }) => {
  const resourcePath = resourcePathFromParam(params.resource)
  const customer = resolveMcpCustomer(resourcePath)
  if (!customer) {
    return json({ error: 'unknown_resource' }, 404)
  }

  // The canonical resource URL is this origin + the resource path. Must match
  // what the client used for discovery and (when bound) Clerk's `aud`.
  const resourceUrl = new URL(resourcePath, url.origin).toString()
  const metadata = buildProtectedResourceMetadata(resourceUrl, customer)
  return json(metadata, 200)
}

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS_HEADERS })
