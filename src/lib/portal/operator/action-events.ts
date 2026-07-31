/**
 * portal_action_events (0099) — durable ledger for client-initiated console
 * actions whose attribution previously lived only in console.info tail logs
 * (role grants/revokes, invitations, advanced customer.yaml submissions) or
 * nowhere (connector re-consent).
 *
 * Companion to recordPauseEvent (pause-control.ts): same actor shape, same
 * append-only posture. The console.info emitters (rbac-audit.ts,
 * customer-yaml-audit.ts) remain as secondary sinks; this table is the
 * primary, queryable record and is unioned into the client Activity feed
 * (activity-read.ts).
 */

export type PortalActionType =
  | 'role_granted'
  | 'role_revoked'
  | 'invite_sent'
  | 'customer_yaml_update_submitted'
  | 'connector_reconsent_requested'
  /** An authored output-class spec written to the customer's vault (ADR 0083).
   *  Unlike the customer.yaml submission beside it, this one really writes —
   *  which is why it is the only console action that may carry 'applied'. */
  | 'output_class_spec_authored'

export interface RecordPortalActionEventInput {
  entity_id: string
  customer_slug: string | null
  action_type: PortalActionType
  actor_user_id: string
  actor_email: string
  actor_role: string
  source: 'portal' | 'admin'
  target: string | null
  /**
   * 'submitted' | 'rejected' for customer.yaml submissions (that endpoint
   * writes nothing, so it never claims more); 'applied' | 'rejected' for
   * output-class spec authoring, which does write and proves it; null
   * otherwise.
   */
  status: 'submitted' | 'rejected' | 'applied' | null
  metadata: Record<string, unknown>
}

export async function recordPortalActionEvent(
  db: D1Database,
  input: RecordPortalActionEventInput
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO portal_action_events ' +
        '(id, entity_id, customer_slug, action_type, actor_user_id, actor_email, actor_role, ' +
        'source, target, status, metadata_json, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      crypto.randomUUID(),
      input.entity_id,
      input.customer_slug,
      input.action_type,
      input.actor_user_id,
      input.actor_email,
      input.actor_role,
      input.source,
      input.target,
      input.status,
      JSON.stringify(input.metadata),
      new Date().toISOString()
    )
    .run()
}

export interface PortalActionEventRow {
  id: string
  entity_id: string
  customer_slug: string | null
  action_type: PortalActionType
  actor_email: string
  actor_role: string
  source: string
  target: string | null
  status: string | null
  metadata_json: string
  created_at: string
}

export async function listPortalActionEvents(
  db: D1Database,
  entityId: string,
  limit = 50
): Promise<PortalActionEventRow[]> {
  const res = await db
    .prepare(
      'SELECT id, entity_id, customer_slug, action_type, actor_email, actor_role, ' +
        'source, target, status, metadata_json, created_at ' +
        'FROM portal_action_events WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .bind(entityId, limit)
    .all<PortalActionEventRow>()
  return res.results ?? []
}
