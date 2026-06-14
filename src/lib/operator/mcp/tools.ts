/**
 * SPIKE SCAFFOLD (A0) — MCP tool registry for the Operator ⇄ Claude connector.
 *
 * Phase 1 ships exactly one STUB read tool, `operator_status`, returning a
 * placeholder payload. Real data wiring (the runtime-read seam in
 * runtime-read-transport.ts → the Machine's `GET /runtime/<kind>`) is a later
 * slice per the build plan (Workstream B). The read/handoff tool surface
 * (`operator_search_memory`, `operator_get_context`, `operator_handoff_task`)
 * is intentionally NOT built here — B0 decides the final surface from observed
 * bytes against the running Machine.
 *
 * Each tool is a pure descriptor + handler so the JSON-RPC layer (mcp-handler.ts)
 * stays transport-only. Handlers receive the authenticated identity so a real
 * tool can scope its read to the entitled user; the stub ignores it beyond echo.
 */

/** JSON-Schema-ish shape for a tool's input. Kept minimal for the spike. */
export interface McpToolInputSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

/** MCP `tools/list` entry shape (subset of the spec we emit). */
export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: McpToolInputSchema
}

/** The authenticated caller context handed to a tool handler. */
export interface McpToolContext {
  customerId: string
  subject: string
  email: string
  profile: string
}

/** MCP `tools/call` result content block (text only for the spike). */
export interface McpToolResultContent {
  type: 'text'
  text: string
}

export interface McpToolResult {
  content: McpToolResultContent[]
  isError?: boolean
}

export interface McpTool {
  descriptor: McpToolDescriptor
  handle: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<McpToolResult>
}

/**
 * STUB tool: `operator_status`. Real version surfaces Operator liveness + this
 * user's handoff queue via the runtime-read seam (build plan B1). The spike
 * returns a clearly-labeled placeholder so a `claude.ai` connector add can make
 * one real authed `tools/call` round-trip end to end.
 */
const operatorStatus: McpTool = {
  descriptor: {
    name: 'operator_status',
    description:
      'Report this Operator’s current status and the calling user’s handoff queue. ' +
      'SPIKE STUB: returns a placeholder; live data wiring is a later slice.',
    inputSchema: { type: 'object', properties: {} },
  },
  // Not `async`: the stub does no I/O. The live version (runtime-read seam) will
  // be async; the interface already returns a Promise, so swapping in real I/O
  // is a body change, not a signature change.
  handle: (_args, ctx) => {
    const payload = {
      stub: true,
      note: 'SPIKE placeholder — not live Operator data.',
      customer_id: ctx.customerId,
      authenticated_as: { profile: ctx.profile, email: ctx.email },
      operator: { status: 'unknown', handoff_queue_depth: null },
    }
    return Promise.resolve({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] })
  },
}

const REGISTRY: ReadonlyMap<string, McpTool> = new Map([
  [operatorStatus.descriptor.name, operatorStatus],
])

/** All tool descriptors for `tools/list`. */
export function listToolDescriptors(): McpToolDescriptor[] {
  return [...REGISTRY.values()].map((t) => t.descriptor)
}

/** Look up a tool by name for `tools/call`; null when unknown. */
export function getTool(name: string): McpTool | null {
  return REGISTRY.get(name) ?? null
}
