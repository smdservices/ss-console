/**
 * Authority-flip write path for the admin Operator console authority panel
 * (`/admin/operator/[customer]/authority`) — design §5.9, ADR 0041.
 *
 * SMD flips a per-domain authority switch (managed <-> client) for a customer.
 * Two invariants govern this module:
 *
 *   1. Layer-1 only. A flip changes whether the CLIENT org may operate a domain.
 *      SMD always retains full control (Layer 0) regardless — nothing here ever
 *      records "SMD may not". This is orthogonal to entitlements (Layer 3 /
 *      config_change_audit); foundations §2 forbids blurring them, so authority
 *      has its OWN intent ledger (operator_authority_audit).
 *
 *   2. Intent, not replica write. The authority block lives in customer.yaml
 *      (git source of truth, ADR 0012); customer_configs is read-only on
 *      principle. A flip records INTENT to the ledger and reaches the runtime
 *      via the deferred git write-back path — the same posture the trust-ceiling
 *      endpoint takes. This module never UPDATEs customer_configs.authority_json.
 *
 * Pure decision helpers + the append-only ledger writer/reader live here; the
 * admin POST handler is the only caller and is responsible for being admin-gated.
 */

import type { D1Database } from '@cloudflare/workers-types'
import {
  isSwitchableDomain,
  type AuthorityHolder,
  type SwitchableAuthorityDomain,
} from '../operator/authority'

const HOLDERS: readonly AuthorityHolder[] = ['managed', 'client']

export function isAuthorityHolder(value: unknown): value is AuthorityHolder {
  return value === 'managed' || value === 'client'
}

/** The opposite holder — the target of a single toggle. */
export function toggleHolder(current: AuthorityHolder): AuthorityHolder {
  return current === 'client' ? 'managed' : 'client'
}

export type AuthorityFlipRejection = 'invalid_domain' | 'invalid_holder' | 'no_change'

export interface AuthorityFlipRequest {
  domain: string
  old_holder: AuthorityHolder
  new_holder: string
}

export type AuthorityFlipValidation =
  | {
      ok: true
      domain: SwitchableAuthorityDomain
      old_holder: AuthorityHolder
      new_holder: AuthorityHolder
    }
  | { ok: false; error: AuthorityFlipRejection }

/**
 * Validate a flip request without casting untrusted input: the domain must be a
 * switchable authority domain (SMD-only domains can never be client-operable),
 * the target holder must be a real holder, and it must differ from the current
 * holder (a no-op flip is rejected rather than written as a noise row).
 */
export function validateAuthorityFlip(req: AuthorityFlipRequest): AuthorityFlipValidation {
  if (!isSwitchableDomain(req.domain)) return { ok: false, error: 'invalid_domain' }
  if (!isAuthorityHolder(req.new_holder)) return { ok: false, error: 'invalid_holder' }
  if (req.new_holder === req.old_holder) return { ok: false, error: 'no_change' }
  return { ok: true, domain: req.domain, old_holder: req.old_holder, new_holder: req.new_holder }
}

export interface AuthorityFlipEvent {
  entity_id: string
  customer_slug: string
  actor_user_id: string
  actor_email: string
  actor_role: string
  domain: SwitchableAuthorityDomain
  old_holder: AuthorityHolder
  new_holder: AuthorityHolder
}

/**
 * Append a flip to the immutable authority-intent ledger. Always
 * `source='portal_intent'` — the value reaches the runtime via deferred git
 * write-back, not from this row.
 */
export async function recordAuthorityFlip(
  db: D1Database,
  event: AuthorityFlipEvent
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO operator_authority_audit ' +
        '(entity_id, customer_slug, source, actor_user_id, actor_email, actor_role, ' +
        'domain, old_holder, new_holder) ' +
        "VALUES (?, ?, 'portal_intent', ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      event.entity_id,
      event.customer_slug,
      event.actor_user_id,
      event.actor_email,
      event.actor_role,
      event.domain,
      event.old_holder,
      event.new_holder
    )
    .run()
}

export interface AuthorityAuditRow {
  id: number
  domain: string
  old_holder: AuthorityHolder
  new_holder: AuthorityHolder
  actor_email: string
  source: string
  created_at: string
}

/** Most-recent N authority flips for an entity, newest first. Read-only. */
export async function listAuthorityAudit(
  db: D1Database,
  entityId: string,
  limit = 50
): Promise<AuthorityAuditRow[]> {
  const result = await db
    .prepare(
      'SELECT id, domain, old_holder, new_holder, actor_email, source, created_at ' +
        'FROM operator_authority_audit WHERE entity_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'
    )
    .bind(entityId, limit)
    .all<AuthorityAuditRow>()
  return result.results ?? []
}

/** The valid holder values, for callers that need to enumerate them. */
export function authorityHolders(): readonly AuthorityHolder[] {
  return HOLDERS
}
