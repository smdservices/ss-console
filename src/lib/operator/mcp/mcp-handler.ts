/**
 * SPIKE SCAFFOLD (A0) — minimal MCP Streamable HTTP handler.
 *
 * Build-vs-adapt finding: the MCP TypeScript SDK's `StreamableHTTPServerTransport`
 * assumes a Node request/response object model and pulls Node-only deps — it is
 * not a clean fit for Astro-on-CF-Workers (web-standard Request/Response, no
 * Node APIs). The Streamable HTTP spec, however, permits a server to answer a
 * POST with a SINGLE `application/json` JSON-RPC response (SSE is optional). For
 * a stateless read/handoff surface we never need server-initiated streaming, so
 * we BUILD a tiny JSON-RPC dispatcher (~one method switch) instead of adapting
 * the SDK transport. This keeps the Worker free of Node shims.
 *
 * Scope: `initialize`, `notifications/initialized` (ack), `tools/list`,
 * `tools/call`, `ping`. Anything else → JSON-RPC method-not-found. Stateless:
 * we do not persist a session; each POST is self-contained (the optional
 * `Mcp-Session-Id` header is accepted but not required, which the spec allows
 * for stateless servers).
 */

import { getTool, listToolDescriptors, type McpToolContext, type McpToolResult } from './tools'

/** Protocol version we advertise. Mirrors the negotiated value back to clients. */
const SERVER_PROTOCOL_VERSION = '2025-06-18'

const SERVER_INFO = {
  name: 'smd-operator-connector',
  title: 'SMD Operator',
  version: '0.1.0-spike',
} as const

/** JSON-RPC 2.0 request shape (params optional). */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

/** Standard JSON-RPC error codes we use. */
const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

function rpcResult(id: JsonRpcRequest['id'], result: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id: id ?? null, result }, 200)
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string): Response {
  return jsonResponse({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, 200)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o.jsonrpc === '2.0' && typeof o.method === 'string'
}

/**
 * Dispatch one already-authenticated JSON-RPC request. The route layer
 * (src/pages/api/mcp.ts) owns auth + audit and only calls this once the caller
 * is a validated, authored identity.
 */
export async function dispatchMcpRequest(
  req: JsonRpcRequest,
  ctx: McpToolContext
): Promise<Response> {
  switch (req.method) {
    case 'initialize':
      return rpcResult(req.id, {
        protocolVersion: SERVER_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      })

    // Client lifecycle ack — a notification (no id). Nothing to return; per
    // JSON-RPC a notification gets no response body, but a 202 keeps clients
    // happy over HTTP.
    case 'notifications/initialized':
      return new Response(null, { status: 202 })

    case 'ping':
      return rpcResult(req.id, {})

    case 'tools/list':
      return rpcResult(req.id, { tools: listToolDescriptors() })

    case 'tools/call':
      return handleToolsCall(req, ctx)

    default:
      return rpcError(req.id, JSON_RPC.METHOD_NOT_FOUND, `method not found: ${req.method}`)
  }
}

async function handleToolsCall(req: JsonRpcRequest, ctx: McpToolContext): Promise<Response> {
  const params = req.params
  if (params === null || typeof params !== 'object') {
    return rpcError(req.id, JSON_RPC.INVALID_PARAMS, 'tools/call requires params')
  }
  const { name, arguments: rawArgs } = params as { name?: unknown; arguments?: unknown }
  if (typeof name !== 'string') {
    return rpcError(req.id, JSON_RPC.INVALID_PARAMS, 'tools/call requires a string name')
  }
  const tool = getTool(name)
  if (!tool) {
    return rpcError(req.id, JSON_RPC.METHOD_NOT_FOUND, `unknown tool: ${name}`)
  }
  const args: Record<string, unknown> =
    rawArgs !== null && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : {}

  let result: McpToolResult
  try {
    result = await tool.handle(args, ctx)
  } catch (err) {
    return rpcError(
      req.id,
      JSON_RPC.INTERNAL_ERROR,
      err instanceof Error ? err.message : 'tool handler threw'
    )
  }
  return rpcResult(req.id, result)
}

/**
 * Parse a raw POST body into a JSON-RPC request, or a Response describing the
 * parse/shape error. Returned as a union so the route can short-circuit.
 */
export function parseMcpBody(raw: string): { req: JsonRpcRequest } | { error: Response } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: rpcError(null, JSON_RPC.PARSE_ERROR, 'invalid JSON') }
  }
  if (!isJsonRpcRequest(parsed)) {
    return { error: rpcError(null, JSON_RPC.INVALID_REQUEST, 'not a JSON-RPC 2.0 request') }
  }
  return { req: parsed }
}
