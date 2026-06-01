/**
 * RBAC audit emission for Operator user-management actions.
 *
 * Every state-changing identity event on the Operator Users page
 * emits a structured `audit:rbac_event` log line. The shape mirrors
 * `recordSendApprovedAudit` / `recordCustomerYamlUpdateAudit` (PR #960
 * and PR #877) so the same Hermes-side tail-log drain that will
 * persist those to the per-customer audit_log (#821 + #891) will
 * persist these too without a new ingestion path.
 *
 * Per #880 AC: "Audit log captures every user-management event."
 * Today the portal Worker cannot bind to the per-customer Hermes D1
 * (the bridge tracked in #821 has not landed), so the audit row's
 * destination is the Worker tail logs. The line prefix and JSON shape
 * are stable; when the bridge lands, only the destination changes.
 *
 * RBAC action vocabulary mirrored from
 * `operator/adapter/audit_log.py::ACCEPTED_ACTION_TYPES` (the
 * `RBAC_EVENT` class). The viewer-side constant lives in
 * `src/lib/portal/operator/audit.ts`; both reference the same
 * writer-side spec.
 *
 * Token material is NEVER included in audit events. Only the metadata
 * fields below.
 */

/**
 * Sub-classes of RBAC_EVENT this writer emits today. The audit_log
 * column is the broader `RBAC_EVENT`; this nested `subAction` is
 * persisted in the row's metadata so a reviewer can tell a grant from
 * a revoke from an invite.
 *
 *   role_granted             — Principal granted a product role to a user
 *   role_revoked             — Principal revoked a product role from a user
 *   invite_sent              — Principal sent a Clerk Organization invitation
 *   matter_assigned          — User assigned to a matter (per #882)
 *   matter_unassigned        — User unassigned from a matter (per #882)
 *   pto_set                  — User marked self (or another) away (per #882)
 *   pto_cleared              — Away state cleared (per #882)
 *   notification_prefs_updated — Per-user notification routing rules edited
 */
export type RbacSubAction =
  | 'role_granted'
  | 'role_revoked'
  | 'invite_sent'
  | 'matter_assigned'
  | 'matter_unassigned'
  | 'pto_set'
  | 'pto_cleared'
  | 'notification_prefs_updated'

export const RBAC_SUB_ACTIONS: readonly RbacSubAction[] = [
  'role_granted',
  'role_revoked',
  'invite_sent',
  'matter_assigned',
  'matter_unassigned',
  'pto_set',
  'pto_cleared',
  'notification_prefs_updated',
] as const

/**
 * Common header for every RBAC audit event. The viewer's `AuditEntry`
 * shape (src/lib/portal/operator/audit.ts) consumes these as
 * `action='RBAC_EVENT'`, `actor`, `actorRole='principal'`, and
 * `decision='allow'`. The customer_id maps to the per-customer audit_log
 * routing key.
 */
export interface RbacAuditEventBase {
  type: 'audit:rbac_event'
  subAction: RbacSubAction
  customer_id: string
  product_slug: string
  actorUserId: string
  actorClerkUserId: string | null
  actorEmail: string
  timestamp: string
}

export interface RoleGrantedAuditEvent extends RbacAuditEventBase {
  subAction: 'role_granted'
  targetUserId: string
  targetEmail: string
  role: string
}

export interface RoleRevokedAuditEvent extends RbacAuditEventBase {
  subAction: 'role_revoked'
  targetUserId: string
  targetEmail: string
  role: string
}

export interface InviteSentAuditEvent extends RbacAuditEventBase {
  subAction: 'invite_sent'
  inviteeEmail: string
  clerkOrgId: string
  clerkInvitationId: string
}

export interface MatterAssignedAuditEvent extends RbacAuditEventBase {
  subAction: 'matter_assigned'
  matterId: string
  assigneeUserId: string
  assigneeEmail: string
}

export interface MatterUnassignedAuditEvent extends RbacAuditEventBase {
  subAction: 'matter_unassigned'
  matterId: string
  assigneeUserId: string
  assigneeEmail: string
}

export interface PtoSetAuditEvent extends RbacAuditEventBase {
  subAction: 'pto_set'
  awayUserId: string
  awayEmail: string
  backupUserId: string | null
  backupEmail: string | null
}

export interface PtoClearedAuditEvent extends RbacAuditEventBase {
  subAction: 'pto_cleared'
  awayUserId: string
  awayEmail: string
}

export interface NotificationPrefsUpdatedAuditEvent extends RbacAuditEventBase {
  subAction: 'notification_prefs_updated'
  /**
   * Target user whose preferences were edited. Same as actorUserId for
   * self-service edits; differs when a principal edits another user's
   * preferences (deferred — current UI is self-service only).
   */
  targetUserId: string
  targetEmail: string
  /**
   * Compact summary of the new preference set, sorted alphabetically by
   * event_type then scope. Per-row tuple shape mirrors the
   * user_notification_prefs table so a reviewer can read the post-edit
   * state at a glance. We record state, not diff, because the diff is
   * recoverable from the prior row's `prefsSnapshot` field.
   */
  prefsSnapshot: ReadonlyArray<{ event_type: string; scope: string }>
}

export type RbacAuditEvent =
  | RoleGrantedAuditEvent
  | RoleRevokedAuditEvent
  | InviteSentAuditEvent
  | MatterAssignedAuditEvent
  | MatterUnassignedAuditEvent
  | PtoSetAuditEvent
  | PtoClearedAuditEvent
  | NotificationPrefsUpdatedAuditEvent

export interface BuildRoleEventInput {
  subAction: 'role_granted' | 'role_revoked'
  customer_id: string
  product_slug: string
  actorUserId: string
  actorClerkUserId: string | null
  actorEmail: string
  targetUserId: string
  targetEmail: string
  role: string
  now?: Date
}

export function buildRoleAuditEvent(
  input: BuildRoleEventInput
): RoleGrantedAuditEvent | RoleRevokedAuditEvent {
  const timestamp = (input.now ?? new Date()).toISOString()
  return {
    type: 'audit:rbac_event',
    subAction: input.subAction,
    customer_id: input.customer_id,
    product_slug: input.product_slug,
    actorUserId: input.actorUserId,
    actorClerkUserId: input.actorClerkUserId,
    actorEmail: input.actorEmail,
    targetUserId: input.targetUserId,
    targetEmail: input.targetEmail,
    role: input.role,
    timestamp,
  }
}

export interface BuildInviteEventInput {
  customer_id: string
  product_slug: string
  actorUserId: string
  actorClerkUserId: string | null
  actorEmail: string
  inviteeEmail: string
  clerkOrgId: string
  clerkInvitationId: string
  now?: Date
}

export function buildInviteAuditEvent(input: BuildInviteEventInput): InviteSentAuditEvent {
  const timestamp = (input.now ?? new Date()).toISOString()
  return {
    type: 'audit:rbac_event',
    subAction: 'invite_sent',
    customer_id: input.customer_id,
    product_slug: input.product_slug,
    actorUserId: input.actorUserId,
    actorClerkUserId: input.actorClerkUserId,
    actorEmail: input.actorEmail,
    inviteeEmail: input.inviteeEmail,
    clerkOrgId: input.clerkOrgId,
    clerkInvitationId: input.clerkInvitationId,
    timestamp,
  }
}

export interface BuildMatterAssignmentEventInput {
  subAction: 'matter_assigned' | 'matter_unassigned'
  customer_id: string
  product_slug: string
  actorUserId: string
  actorClerkUserId: string | null
  actorEmail: string
  matterId: string
  assigneeUserId: string
  assigneeEmail: string
  now?: Date
}

export function buildMatterAssignmentAuditEvent(
  input: BuildMatterAssignmentEventInput
): MatterAssignedAuditEvent | MatterUnassignedAuditEvent {
  const timestamp = (input.now ?? new Date()).toISOString()
  return {
    type: 'audit:rbac_event',
    subAction: input.subAction,
    customer_id: input.customer_id,
    product_slug: input.product_slug,
    actorUserId: input.actorUserId,
    actorClerkUserId: input.actorClerkUserId,
    actorEmail: input.actorEmail,
    matterId: input.matterId,
    assigneeUserId: input.assigneeUserId,
    assigneeEmail: input.assigneeEmail,
    timestamp,
  }
}

export interface BuildPtoSetEventInput {
  customer_id: string
  product_slug: string
  actorUserId: string
  actorClerkUserId: string | null
  actorEmail: string
  awayUserId: string
  awayEmail: string
  backupUserId: string | null
  backupEmail: string | null
  now?: Date
}

export function buildPtoSetAuditEvent(input: BuildPtoSetEventInput): PtoSetAuditEvent {
  const timestamp = (input.now ?? new Date()).toISOString()
  return {
    type: 'audit:rbac_event',
    subAction: 'pto_set',
    customer_id: input.customer_id,
    product_slug: input.product_slug,
    actorUserId: input.actorUserId,
    actorClerkUserId: input.actorClerkUserId,
    actorEmail: input.actorEmail,
    awayUserId: input.awayUserId,
    awayEmail: input.awayEmail,
    backupUserId: input.backupUserId,
    backupEmail: input.backupEmail,
    timestamp,
  }
}

export interface BuildPtoClearedEventInput {
  customer_id: string
  product_slug: string
  actorUserId: string
  actorClerkUserId: string | null
  actorEmail: string
  awayUserId: string
  awayEmail: string
  now?: Date
}

export function buildPtoClearedAuditEvent(input: BuildPtoClearedEventInput): PtoClearedAuditEvent {
  const timestamp = (input.now ?? new Date()).toISOString()
  return {
    type: 'audit:rbac_event',
    subAction: 'pto_cleared',
    customer_id: input.customer_id,
    product_slug: input.product_slug,
    actorUserId: input.actorUserId,
    actorClerkUserId: input.actorClerkUserId,
    actorEmail: input.actorEmail,
    awayUserId: input.awayUserId,
    awayEmail: input.awayEmail,
    timestamp,
  }
}

export interface BuildNotificationPrefsEventInput {
  customer_id: string
  product_slug: string
  actorUserId: string
  actorClerkUserId: string | null
  actorEmail: string
  targetUserId: string
  targetEmail: string
  prefsSnapshot: ReadonlyArray<{ event_type: string; scope: string }>
  now?: Date
}

export function buildNotificationPrefsAuditEvent(
  input: BuildNotificationPrefsEventInput
): NotificationPrefsUpdatedAuditEvent {
  const timestamp = (input.now ?? new Date()).toISOString()
  const sortedSnapshot = [...input.prefsSnapshot].sort((a, b) => {
    const byType = a.event_type.localeCompare(b.event_type)
    if (byType !== 0) return byType
    return a.scope.localeCompare(b.scope)
  })
  return {
    type: 'audit:rbac_event',
    subAction: 'notification_prefs_updated',
    customer_id: input.customer_id,
    product_slug: input.product_slug,
    actorUserId: input.actorUserId,
    actorClerkUserId: input.actorClerkUserId,
    actorEmail: input.actorEmail,
    targetUserId: input.targetUserId,
    targetEmail: input.targetEmail,
    prefsSnapshot: sortedSnapshot,
    timestamp,
  }
}

/**
 * Emit a single RBAC audit line. Mirrors the
 * `recordSendApprovedAudit` / `recordCustomerYamlUpdateAudit`
 * contract: single `console.info` with a JSON-serialized payload
 * whose `type` field is stable for the tail-log drain.
 *
 * Async to match the eventual bridge shape so callers stay stable
 * when #821 lands. The Promise.resolve keeps the body sync today.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function recordRbacAuditEvent(event: RbacAuditEvent): Promise<void> {
  console.info(JSON.stringify(event))
}
