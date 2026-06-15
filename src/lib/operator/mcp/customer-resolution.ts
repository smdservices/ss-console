import type { D1Database } from '@cloudflare/workers-types'
import { z } from 'zod'
import type { McpConnector } from '../customer-yaml/types'
import { parseMcpConnector } from '../../portal/customer-config'

const CUSTOMER_SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/
const MCP_RESOURCE_PREFIX = '/api/operator'
const httpsUrlSchema = z.url().refine((value) => new URL(value).protocol === 'https:', {
  message: 'MCP OAuth URLs must use HTTPS',
})

const bindingRowSchema = z.object({
  entity_id: z.string().min(1),
  customer_slug: z.string().regex(CUSTOMER_SLUG),
  issuer: httpsUrlSchema,
  resource_uri: httpsUrlSchema,
  client_id: z.string().min(1).nullable(),
  clerk_app_id: z.string().min(1).nullable(),
  clerk_org_id: z.string().min(1).nullable(),
  mcp_connector_json: z.string().nullable(),
})

const userRowSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  clerk_user_id: z.string().min(1).nullable(),
})

export interface AuthorizedMcpPrincipal {
  localUserId: string
  clerkUserId: string
  email: string
  profile: string
}

export interface ClerkCustomerBinding {
  issuer: string
  resourceUri: string
  clientId: string | null
  clerkAppId: string | null
}

export interface ResolvedMcpCustomer {
  entityId: string
  customerId: string
  clerkOrgId: string | null
  connector: McpConnector
  clerk: ClerkCustomerBinding
  principals: AuthorizedMcpPrincipal[]
}

export function buildMcpResourcePath(customerSlug: string): string {
  if (!CUSTOMER_SLUG.test(customerSlug)) throw new Error('invalid MCP customer slug')
  return `${MCP_RESOURCE_PREFIX}/${customerSlug}/mcp`
}

export function buildMcpMetadataPath(customerSlug: string): string {
  return `/.well-known/oauth-protected-resource${buildMcpResourcePath(customerSlug)}`
}

export function parseMcpResourcePath(pathname: string): string | null {
  const match = /^\/api\/operator\/([a-z0-9][a-z0-9-]{0,31})\/mcp\/?$/.exec(pathname)
  return match?.[1] ?? null
}

export function parseMcpMetadataResource(resource: string | undefined): string | null {
  const path = `/${(resource ?? '').replace(/^\/+/, '')}`
  return parseMcpResourcePath(path)
}

function resolvePrincipals(
  connector: McpConnector,
  userRows: readonly z.infer<typeof userRowSchema>[]
): AuthorizedMcpPrincipal[] {
  const usersByEmail = new Map(userRows.map((user) => [user.email.toLowerCase(), user]))
  return connector.access.flatMap((entry) => {
    const user = usersByEmail.get(entry.email.toLowerCase())
    if (!user?.clerk_user_id) return []
    return [
      {
        localUserId: user.id,
        clerkUserId: user.clerk_user_id,
        email: user.email,
        profile: entry.profile,
      },
    ]
  })
}

export async function loadMcpCustomer(
  db: D1Database,
  customerSlug: string
): Promise<ResolvedMcpCustomer | null> {
  if (!CUSTOMER_SLUG.test(customerSlug)) return null
  const rawBinding = await db
    .prepare(
      'SELECT b.entity_id, b.customer_slug, b.issuer, b.resource_uri, b.client_id, ' +
        'b.clerk_app_id, e.clerk_org_id, c.mcp_connector_json ' +
        'FROM mcp_clerk_bindings b ' +
        'LEFT JOIN customer_configs c ON c.entity_id = b.entity_id ' +
        'LEFT JOIN entities e ON e.id = b.entity_id ' +
        'WHERE b.customer_slug = ?'
    )
    .bind(customerSlug)
    .first<unknown>()
  if (!rawBinding) return null
  const binding = bindingRowSchema.parse(rawBinding)

  const rawUsers = await db
    .prepare('SELECT id, email, clerk_user_id FROM users WHERE entity_id = ?')
    .bind(binding.entity_id)
    .all<unknown>()
  const users = z.array(userRowSchema).parse(rawUsers.results ?? [])
  const connector = parseMcpConnector(binding.mcp_connector_json)

  return {
    entityId: binding.entity_id,
    customerId: binding.customer_slug,
    clerkOrgId: binding.clerk_org_id,
    connector,
    clerk: {
      issuer: binding.issuer,
      resourceUri: binding.resource_uri,
      clientId: binding.client_id,
      clerkAppId: binding.clerk_app_id,
    },
    principals: resolvePrincipals(connector, users),
  }
}
