import type { APIRoute } from 'astro'

const gone = (): Response =>
  new Response(JSON.stringify({ error: 'gone', detail: 'use the customer-specific MCP URL' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  })

export const POST: APIRoute = gone
export const GET: APIRoute = gone
export const OPTIONS: APIRoute = gone
