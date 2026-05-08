export interface CandidateMergeLogData {
  existingEntityId?: string | null
  candidateName: string
  candidateSlug?: string | null
  candidateArea?: string | null
  candidateAddress?: string | null
  matchedName?: string | null
  matchedArea?: string | null
  matchedAddress?: string | null
  sourcePipeline?: string | null
  sourceRef?: string | null
  reason: string
  score?: number | null
  metadata?: Record<string, unknown> | null
}

export interface CandidateMergeRow {
  id: string
  targetId: string | null
  candidateName: string
  candidateAddress: string | null
  score: number | null
  reason: string
  sourcePipeline: string | null
  createdAt: string
}

export async function appendCandidateMergeLog(
  db: D1Database,
  orgId: string,
  data: CandidateMergeLogData
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO candidate_merge_log (
        id, org_id, existing_entity_id, candidate_name, candidate_slug,
        candidate_area, candidate_address, matched_name, matched_area,
        matched_address, source_pipeline, source_ref, reason, score,
        metadata, review_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .bind(
      crypto.randomUUID(),
      orgId,
      data.existingEntityId ?? null,
      data.candidateName,
      data.candidateSlug ?? null,
      data.candidateArea ?? null,
      data.candidateAddress ?? null,
      data.matchedName ?? null,
      data.matchedArea ?? null,
      data.matchedAddress ?? null,
      data.sourcePipeline ?? null,
      data.sourceRef ?? null,
      data.reason,
      data.score ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      new Date().toISOString()
    )
    .run()
}

export async function getCandidateMergesForEntity(
  db: D1Database,
  orgId: string,
  entityId: string
): Promise<CandidateMergeRow[]> {
  const rows = await db
    .prepare(
      `SELECT
         cml.id,
         (
           SELECT e.id
           FROM entities e
           WHERE e.org_id = cml.org_id
             AND e.id != cml.existing_entity_id
             AND (
               (cml.candidate_slug IS NOT NULL AND e.slug = cml.candidate_slug)
               OR (
                 e.name = cml.candidate_name
                 AND (
                   cml.candidate_area IS NULL
                   OR e.area = cml.candidate_area
                 )
               )
             )
           ORDER BY e.updated_at DESC
           LIMIT 1
         ) AS targetId,
         cml.candidate_name AS candidateName,
         COALESCE(cml.candidate_address, cml.candidate_area) AS candidateAddress,
         cml.score,
         cml.reason,
         cml.source_pipeline AS sourcePipeline,
         cml.created_at AS createdAt
       FROM candidate_merge_log cml
       WHERE cml.org_id = ?
         AND cml.existing_entity_id = ?
         AND review_status = 'pending'
       ORDER BY cml.score DESC, cml.created_at DESC`
    )
    .bind(orgId, entityId)
    .all<CandidateMergeRow>()

  return rows.results
}
