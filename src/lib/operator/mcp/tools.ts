/**
 * MCP tool registry for the Operator ⇄ Claude connector.
 *
 * Phase 1: `operator_status` — read-only reachability + recent activity via
 * the runtime-read seam (ADR 0043 path A).
 *
 * Phase 2: `operator_handoff_task` — post an async work request to the Machine
 * via the signed webhook gate (`/webhooks/mcp`). The Operator works it and
 * reports back via its authored channels.
 *
 * Both capabilities are injected via {@link McpToolContext} so tool handlers
 * stay free of env/db wiring. `sendHandoff` is optional — when unconfigured the
 * tool returns a `not_configured` error rather than throwing.
 *
 * See docs/design/operator/03-mcp-server-exposure.md.
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
 * The authenticated caller context handed to a tool handler.
 *
 * `readRuntime` — customer+actor-scoped, read-only, audited runtime read (the
 * route layer binds the customer and actor; there is no way to express a
 * cross-customer read).
 *
 * `sendHandoff` — optional. When configured (Phase 2), posts an async work
 * request to the Machine and returns once the Machine acknowledges receipt.
 * Absent when `OPERATOR_MCP_WEBHOOK_SECRET` is unset; the handoff tool returns
 * `not_configured` rather than throwing.
 */
export interface McpToolContext {
  customerId: string
  subject: string
  email: string
  profile: string
  readRuntime: (query: RuntimeReadQuery) => Promise<RuntimeReadResult>
  sendHandoff?: (params: { handoff_id: string; task: string; context?: string }) => Promise<void>
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
        })),
      },
    }
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
  },
}

/**
 * Phase 2 tool: `operator_handoff_task`. Posts an async work request to the
 * Operator. The Operator acknowledges receipt immediately and works the task
 * through its authored channels (email, Telegram, etc.). The caller receives
 * a `handoff_id` for correlation.
 *
 * Fail-closed: returns `not_configured` when the webhook transport is absent,
 * `delivery_failed` when the Machine returns an error.
 */
const operatorHandoffTask: McpTool = {
  descriptor: {
    name: 'operator_handoff_task',
    description:
      'Hand a task to the Operator to work asynchronously. The Operator acknowledges ' +
      'immediately and reports back via its authored channels (email, Telegram, etc.). ' +
      'Returns a handoff_id for correlation.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task to hand off — be specific about what you want the Operator to do.',
        },
        context: {
          type: 'string',
          description: 'Optional additional context or constraints for the Operator.',
        },
      },
      required: ['task'],
    },
  },
  handle: async (args, ctx) => {
    const task = typeof args.task === 'string' ? args.task.trim() : ''
    if (!task) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'task_required' }) }],
        isError: true,
      }
    }
    if (!ctx.sendHandoff) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'not_configured' }) }],
        isError: true,
      }
    }
    const handoff_id = crypto.randomUUID()
    const context =
      typeof args.context === 'string' && args.context.trim() ? args.context.trim() : undefined
    try {
      await ctx.sendHandoff({ handoff_id, task, context })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, accepted: true, handoff_id }),
          },
        ],
      }
    } catch {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'delivery_failed' }) }],
        isError: true,
      }
    }
  },
}

const REGISTRY: ReadonlyMap<string, McpTool> = new Map([
  [operatorStatus.descriptor.name, operatorStatus],
  [operatorHandoffTask.descriptor.name, operatorHandoffTask],
])

/** All tool descriptors for `tools/list`. */
export function listToolDescriptors(): McpToolDescriptor[] {
  return [...REGISTRY.values()].map((t) => t.descriptor)
}

/** Look up a tool by name for `tools/call`; null when unknown. */
export function getTool(name: string): McpTool | null {
  return REGISTRY.get(name) ?? null
}
