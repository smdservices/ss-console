/**
 * Executed agreement documents for an Operator instance (ss#2641).
 *
 * The firm's own signed paper, readable in its portal Compliance surface.
 * Service agreement §4.5 put the audit record there; the document that
 * creates that obligation belongs in the same place.
 *
 * Two invariants live here rather than in the callers:
 *
 *   1. **Executed only.** `executed_on` is NOT NULL in the schema and
 *      {@link isExecutedOnValid} additionally refuses a future date. A draft
 *      cannot be recorded, because anything a client sees in its own portal
 *      reads as the operative terms.
 *   2. **Authored, never derived.** Title and date come from a human in the
 *      admin flow. Nothing here parses a date out of a filename, which is the
 *      runtime-fabrication pattern CLAUDE.md bans as Pattern B.
 *
 * Amendments are ordinary rows with a later `executed_on`. There is no
 * supersession concept: every executed document stays visible with its date
 * and the reader decides what is in force.
 */

import type { D1Database } from '@cloudflare/workers-types'

export interface OperatorAgreementDocument {
  id: string
  org_id: string
  entity_id: string
  instance_slug: string
  title: string
  /** Authored date of execution, YYYY-MM-DD. */
  executed_on: string
  storage_key: string
  file_name: string
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

export interface CreateOperatorAgreementDocument {
  org_id: string
  entity_id: string
  instance_slug: string
  title: string
  executed_on: string
  storage_key: string
  file_name: string
  uploaded_by: string | null
}

/** `YYYY-MM-DD`, a real calendar date, and not in the future. */
export function isExecutedOnValid(value: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  // Round-trip guard: `2026-02-31` parses by rolling over into March.
  if (parsed.toISOString().slice(0, 10) !== value) return false
  return value <= today.toISOString().slice(0, 10)
}

/**
 * One instance's executed documents, newest execution first. The order is the
 * product requirement: a dated set read top-down is what tells a reader which
 * paper is the most recent.
 */
export async function listOperatorAgreementDocuments(
  db: D1Database,
  entityId: string,
  instanceSlug: string
): Promise<OperatorAgreementDocument[]> {
  const result = await db
    .prepare(
      `SELECT * FROM operator_agreement_documents
        WHERE entity_id = ? AND instance_slug = ?
        ORDER BY executed_on DESC, created_at DESC`
    )
    .bind(entityId, instanceSlug)
    .all<OperatorAgreementDocument>()
  return result.results ?? []
}

/** Every executed document on an entity, across instances. The admin hub read. */
export async function listOperatorAgreementDocumentsForEntity(
  db: D1Database,
  orgId: string,
  entityId: string
): Promise<OperatorAgreementDocument[]> {
  const result = await db
    .prepare(
      `SELECT * FROM operator_agreement_documents
        WHERE org_id = ? AND entity_id = ?
        ORDER BY executed_on DESC, created_at DESC`
    )
    .bind(orgId, entityId)
    .all<OperatorAgreementDocument>()
  return result.results ?? []
}

export async function createOperatorAgreementDocument(
  db: D1Database,
  data: CreateOperatorAgreementDocument
): Promise<OperatorAgreementDocument> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO operator_agreement_documents
         (id, org_id, entity_id, instance_slug, title, executed_on, storage_key,
          file_name, uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(storage_key) DO UPDATE SET
         title = excluded.title,
         executed_on = excluded.executed_on,
         file_name = excluded.file_name,
         uploaded_by = excluded.uploaded_by,
         updated_at = excluded.updated_at`
    )
    .bind(
      id,
      data.org_id,
      data.entity_id,
      data.instance_slug,
      data.title,
      data.executed_on,
      data.storage_key,
      data.file_name,
      data.uploaded_by,
      now,
      now
    )
    .run()
  const row = await db
    .prepare('SELECT * FROM operator_agreement_documents WHERE storage_key = ?')
    .bind(data.storage_key)
    .first<OperatorAgreementDocument>()
  if (!row) throw new Error('operator agreement document not persisted')
  return row
}

/** Remove the D1 row. The R2 object is deleted by the caller that owns it. */
export async function deleteOperatorAgreementDocument(
  db: D1Database,
  orgId: string,
  id: string
): Promise<OperatorAgreementDocument | null> {
  const row = await db
    .prepare('SELECT * FROM operator_agreement_documents WHERE org_id = ? AND id = ?')
    .bind(orgId, id)
    .first<OperatorAgreementDocument>()
  if (!row) return null
  await db
    .prepare('DELETE FROM operator_agreement_documents WHERE org_id = ? AND id = ?')
    .bind(orgId, id)
    .run()
  return row
}
