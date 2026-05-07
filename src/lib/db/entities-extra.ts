/**
 * Additional entity queries (lost-reason lookup and merge).
 * Extracted from entities.ts to keep that file within the 500-line ceiling.
 * Re-exported from entities.ts for backward compatibility.
 */

import { isLostReasonCode, type LostReasonCode } from './lost-reasons.js'
import { recomputeDeterministicCache } from '../entities/recompute.js'
import { getEntity } from './entities.js'
import type { Entity } from './entities.js'

export async function getLatestLostReasonsByEntity(
  db: D1Database,
  orgId: string,
  entityIds: string[]
): Promise<Map<string, { code: LostReasonCode; detail: string | null }>> {
  const result = new Map<string, { code: LostReasonCode; detail: string | null }>()
  if (entityIds.length === 0) return result

  const entityIdsJson = JSON.stringify(entityIds)
  const rows = await db
    .prepare(
      `SELECT c.entity_id,
              json_extract(c.metadata, '$.lost_reason') AS lost_reason,
              json_extract(c.metadata, '$.lost_detail') AS lost_detail
         FROM context c
        WHERE c.org_id = ?
          AND c.type = 'stage_change'
          AND c.entity_id IN (SELECT value FROM json_each(?))
          AND json_extract(c.metadata, '$.to') = 'lost'
          AND c.created_at = (
            SELECT MAX(c2.created_at) FROM context c2
             WHERE c2.org_id = c.org_id
               AND c2.entity_id = c.entity_id
               AND c2.type = 'stage_change'
               AND json_extract(c2.metadata, '$.to') = 'lost'
          )`
    )
    .bind(orgId, entityIdsJson)
    .all<{ entity_id: string; lost_reason: string | null; lost_detail: string | null }>()

  for (const row of rows.results) {
    if (row.lost_reason && isLostReasonCode(row.lost_reason)) {
      result.set(row.entity_id, {
        code: row.lost_reason,
        detail: row.lost_detail ?? null,
      })
    }
  }
  return result
}

/**
 * Merge two entities. All context from `sourceId` moves to `targetId`.
 * The source entity is deleted after merge.
 */
export async function mergeEntities(
  db: D1Database,
  orgId: string,
  targetId: string,
  sourceId: string
): Promise<Entity | null> {
  const target = await getEntity(db, orgId, targetId)
  const source = await getEntity(db, orgId, sourceId)
  if (!target || !source) return null

  await db
    .prepare('UPDATE context SET entity_id = ? WHERE entity_id = ? AND org_id = ?')
    .bind(targetId, sourceId, orgId)
    .run()
  await db
    .prepare('UPDATE contacts SET entity_id = ? WHERE entity_id = ? AND org_id = ?')
    .bind(targetId, sourceId, orgId)
    .run()

  const content = `Merged entity "${source.name}" (${sourceId}) into this entity.`
  await db
    .prepare(
      `INSERT INTO context (id, entity_id, org_id, type, content, source, content_size, metadata, created_at) VALUES (?, ?, ?, 'note', ?, 'system', ?, ?, datetime('now'))`
    )
    .bind(
      crypto.randomUUID(),
      targetId,
      orgId,
      content,
      content.length,
      JSON.stringify({ merged_from: sourceId, merged_name: source.name, merged_slug: source.slug })
    )
    .run()

  await db.prepare('DELETE FROM entities WHERE id = ? AND org_id = ?').bind(sourceId, orgId).run()
  await recomputeDeterministicCache(db, orgId, targetId)
  return getEntity(db, orgId, targetId)
}
