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
  /** A Named Administrator pulled the audit record for one matter (ss#2122).
   *  Recorded because a compliance export that leaves no trace would be the
   *  one console action invisible to the record it exports. Carries 'applied':
   *  the bytes were produced and handed over. */
  | 'compliance_record_exported'

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

/**
 * Read one SEAT's console-action ledger, newest first.
 *
 * Scoped on BOTH keys. `entity_id` is the tenant fence. `customer_slug` is the
 * seat fence: every writer above attributes its event to the instance it was
 * performed on (`ctx.instance` / `access.customerSlug` / `auth.customerSlug`),
 * the feed that consumes this is itself per-instance, and its slug-keyed
 * siblings (`listPauseEvents`, `listEntitlementChanges`) already scope this
 * way. Reading on `entity_id` alone showed one seat's role grants and config
 * submissions on a sibling seat's activity feed for any multi-seat entity
 * (#2281 — the same identity-key defect migration 0093 fixed in fleet_status;
 * latent here only because the table is still empty in prod).
 *
 * Rows with a NULL `customer_slug` are entity-wide by construction — the
 * column is nullable by design — so they surface on every seat of the entity
 * rather than being silently dropped. Contrast `portal_login_events`, which is
 * entity-scoped on purpose: a sign-in spans the entity, not one seat.
 */
export async function listPortalActionEvents(
  db: D1Database,
  entityId: string,
  customerSlug: string | null,
  limit = 50
): Promise<PortalActionEventRow[]> {
  const res = await db
    .prepare(
      'SELECT id, entity_id, customer_slug, action_type, actor_email, actor_role, ' +
        'source, target, status, metadata_json, created_at ' +
        'FROM portal_action_events ' +
        'WHERE entity_id = ? AND (customer_slug IS NULL OR customer_slug = ?) ' +
        'ORDER BY created_at DESC LIMIT ?'
    )
    .bind(entityId, customerSlug, limit)
    .all<PortalActionEventRow>()
  return res.results ?? []
}
