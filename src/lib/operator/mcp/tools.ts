/**
 * MCP tool registry for the Operator ⇄ Claude connector.
 *
 * Phase 1 ships one LIVE read tool, `operator_status`, backed by the runtime-read
 * seam (ADR 0043 path A): the console→Machine `GET /runtime/audit_log` call,
 * summarized into a liveness + recent-activity view. The handler is fail-closed
 * — if the Machine is unreachable or the read path is unconfigured it reports
 * `reachable: false` with a reason, never fabricated activity.
 *
 * The read capability is injected via {@link McpToolContext.readRuntime}: the
 * route layer builds a capability already scoped to THIS
 * customer + actor (one customer per call, audited), so a tool handler cannot
 * express a cross-customer read. Tools stay free of env/db wiring.
 *
 * Deferred (fast-follow, intentionally not here): `operator_search_memory`
 * (memory_export needs a `table` param threaded through the frozen
 * RuntimeReadQuery, and the mirror tables may be sparse for customer-zero) and
 * `operator_handoff_task` (Phase 2 — two-repo: console emitter + overlay
 * `source=mcp` recognition + deploy). See docs/design/operator/03-mcp-server-exposure.md.
 */

import type { RuntimeReadQuery, RuntimeReadResult } from '../runtime-read'

/** JSON-Schema-ish shape for a tool's input. */
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

/**
 * The authenticated caller context handed to a tool handler. `readRuntime` is a
 * customer+actor-scoped, read-only, audited runtime read (the route layer binds
 * the customer and actor; there is no way to express a cross-customer read).
 */
export interface McpToolContext {
  customerId: string
  subject: string
  email: string
  profile: string
  readRuntime: (query: RuntimeReadQuery) => Promise<RuntimeReadResult>
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
 * One audit_log entry as the Machine serves it (overlay `_shape_audit_row`):
 * id/ts/action/actor required, the rest nullable. We surface only the
 * non-sensitive fields (never the internal digest columns, which the Machine
 * does not expose anyway).
 */
interface AuditEntry {
  ts: string
  action: string
  skill: string | null
  matterRef: string | null
}

/** Defensively parse the Machine's `{entries,cursor}` audit_log page. */
function parseAuditEntries(data: unknown): AuditEntry[] {
  if (data === null || typeof data !== 'object') return []
  const entries = (data as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return []
  return entries.flatMap((e) => {
    if (e === null || typeof e !== 'object') return []
    const o = e as Record<string, unknown>
    if (typeof o.ts !== 'string' || typeof o.action !== 'string') return []
    return [
      {
        ts: o.ts,
        action: o.action,
        skill: typeof o.skill === 'string' ? o.skill : null,
        matterRef: typeof o.matterRef === 'string' ? o.matterRef : null,
      },
    ]
  })
}

const RECENT_LIMIT = 10
const RECENT_SHOWN = 5

/**
 * LIVE tool: `operator_status`. Reports the Operator's reachability and the
 * caller's recent activity, read from the Machine's audit_log via the
 * runtime-read seam. Fail-closed: an unreachable/unconfigured Machine reports
 * `reachable: false` + a reason; an empty log reports zero activity honestly —
 * never fabricated.
 */
const operatorStatus: McpTool = {
  descriptor: {
    name: 'operator_status',
    description:
      'Report this Operator’s current reachability and a summary of its most ' +
      'recent activity (newest first). Read-only; reflects live Machine state.',
    inputSchema: { type: 'object', properties: {} },
  },
  handle: async (_args, ctx) => {
    const res = await ctx.readRuntime({ kind: 'audit_log', limit: RECENT_LIMIT })

    const base = {
      customer_id: ctx.customerId,
      authenticated_as: { profile: ctx.profile, email: ctx.email },
    }

    if (!res.ok) {
      // Fail-closed: the Machine is unreachable or the read path is unconfigured.
      // Report honestly; never invent a status.
      const payload = {
        ...base,
        operator: { reachable: false as const, reason: res.reason },
      }
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
    }

    const entries = parseAuditEntries(res.data)
    const payload = {
      ...base,
      operator: {
        reachable: true as const,
        recent_activity_count: entries.length,
        latest_activity_at: entries[0]?.ts ?? null,
        recent: entries.slice(0, RECENT_SHOWN).map((e) => ({
          at: e.ts,
          action: e.action,
          skill: e.skill,
          matter: e.matterRef,
        })),
      },
    }
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
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
