import type { D1Database } from '@cloudflare/workers-types'

export type McpAuditEventType = 'auth' | 'tool_call'
export type McpAuditDecision = 'allow' | 'deny'

export interface McpAuditEvent {
  entityId: string
  customerSlug: string
  eventType: McpAuditEventType
  decision: McpAuditDecision
  reason: string
  clerkSubject: string | null
  localUserId: string | null
  profile: string | null
  tool: string | null
}

export async function recordMcpAudit(db: D1Database, event: McpAuditEvent): Promise<void> {
  await db
    .prepare(
      'INSERT INTO operator_mcp_audit ' +
        '(entity_id, customer_slug, event_type, decision, reason, clerk_subject, ' +
        'local_user_id, profile, tool) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      event.entityId,
      event.customerSlug,
      event.eventType,
      event.decision,
      event.reason,
      event.clerkSubject,
      event.localUserId,
      event.profile,
      event.tool
    )
    .run()
}
