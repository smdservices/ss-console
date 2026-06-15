import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import {
  loadMcpCustomer,
  parseMcpMetadataResource,
} from '../../../lib/operator/mcp/customer-resolution'
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

export const GET: APIRoute = async ({ params }) => {
  const customerSlug = parseMcpMetadataResource(params.resource)
  if (!customerSlug) return json({ error: 'unknown_resource' }, 404)

  const customer = await loadMcpCustomer(env.DB, customerSlug)
  if (!customer?.connector.enabled) return json({ error: 'unknown_resource' }, 404)

  return json(
    buildProtectedResourceMetadata(
      customer.clerk.resourceUri,
      [customer.clerk.issuer],
      customer.clerkOrgId !== null
    ),
    200
  )
}

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS_HEADERS })
