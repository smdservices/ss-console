import type { APIRoute } from 'astro'
import { jsonResponse } from '../../lib/api/helpers'

const gone = (): Response =>
  jsonResponse(410, { error: 'gone', detail: 'use the customer-specific MCP URL' })

export const POST: APIRoute = gone
export const GET: APIRoute = gone
export const OPTIONS: APIRoute = gone
