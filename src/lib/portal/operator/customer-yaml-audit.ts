/**
 * customer.yaml audit metadata — change-set hashing and audit-event emission.
 *
 * Extracted from `customer-yaml-editor.ts` (the ADR 0049 `escalation_model`
 * wiring pushed that file over the 500-line ceiling). This module depends
 * one-way on the editor's pure projection/diff/hash helpers; nothing in the
 * editor imports back, so there is no cycle.
 */

import {
  computeChangedFields,
  hashEditableConfig,
  type EditableCustomerConfig,
} from './customer-yaml-editor'

export interface CustomerYamlAuditMetadata {
  changed_fields: string[]
  before_hash: string
  after_hash: string
  actor_id: string
}

export function buildAuditMetadata(
  before: EditableCustomerConfig,
  after: EditableCustomerConfig,
  actorId: string
): CustomerYamlAuditMetadata {
  return {
    changed_fields: computeChangedFields(before, after),
    before_hash: hashEditableConfig(before),
    after_hash: hashEditableConfig(after),
    actor_id: actorId,
  }
}

/**
 * Emit the audit event to Worker tail logs. Mirrors the
 * `recordSendApprovedAudit` pattern in `send-approved.ts` (PR #960): a single
 * `console.info` line prefixed with `audit:customer_yaml_updated` so a
 * Hermes-side drain consumes it and persists to the per-customer D1.
 *
 * The audit fires even on validation failure — the attempt is itself
 * a recorded compliance event. Callers decide whether to emit on
 * failure (the route does, with `status: 'rejected'`).
 */
export async function recordCustomerYamlUpdateAudit(payload: {
  status: 'applied' | 'rejected'
  customer_id: string
  metadata: CustomerYamlAuditMetadata
}): Promise<void> {
  const line = JSON.stringify({ type: 'audit:customer_yaml_updated', ...payload })
  console.info(line)
  return Promise.resolve()
}
