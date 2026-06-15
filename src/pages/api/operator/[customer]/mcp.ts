import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import {
  buildMcpResourcePath,
  loadMcpCustomer,
} from '../../../../lib/operator/mcp/customer-resolution'
import {
  handleMcpGet,
  handleMcpOptions,
  handleMcpPost,
} from '../../../../lib/operator/mcp/mcp-route'
import { readMachineRuntime } from '../../../../lib/operator/runtime-read'
import {
  createMachineRuntimeTransport,
  createRuntimeReadAudit,
} from '../../../../lib/operator/runtime-read-transport'

async function loadRouteCustomer(customerSlug: string | undefined, origin: string) {
  if (!customerSlug) return null
  const customer = await loadMcpCustomer(env.DB, customerSlug)
  if (!customer) return null
  const requestedResource = new URL(buildMcpResourcePath(customerSlug), origin).toString()
  return requestedResource === customer.clerk.resourceUri ? customer : null
}

export const POST: APIRoute = async ({ request, url, params }) => {
  const customer = await loadRouteCustomer(params.customer, url.origin)
  if (!customer) return new Response('Not found', { status: 404 })

  const transport = createMachineRuntimeTransport(env)
  return handleMcpPost(request, url, {
    db: env.DB,
    customer,
    readRuntime: (auth, query) => {
      const audit = createRuntimeReadAudit(env.DB, { actorUserId: auth.localUserId })
      return readMachineRuntime({ transport, audit }, customer.customerId, query, {
        actor: auth.email,
        actorRole: 'mcp_client',
      })
    },
  })
}

export const GET: APIRoute = async ({ url, params }) => {
  const customer = await loadRouteCustomer(params.customer, url.origin)
  return customer ? handleMcpGet() : new Response('Not found', { status: 404 })
}

export const OPTIONS: APIRoute = async ({ url, params }) => {
  const customer = await loadRouteCustomer(params.customer, url.origin)
  return customer ? handleMcpOptions() : new Response('Not found', { status: 404 })
}
