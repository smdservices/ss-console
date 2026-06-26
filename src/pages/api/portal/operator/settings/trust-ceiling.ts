import type { APIRoute } from 'astro'

/**
 * Retired scalar trust-ceiling endpoint.
 *
 * The flag-day entitlement model authors persona exposure and skill initiation.
 * This legacy endpoint no longer records changes because doing so would create
 * audit rows the runtime cannot enforce.
 */
export const POST: APIRoute = () =>
  new Response(JSON.stringify({ error: 'Scalar trust ceiling is retired' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  })
