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
         id,
         existing_entity_id AS targetId,
         candidate_name AS candidateName,
         candidate_address AS candidateAddress,
         score,
         reason,
         source_pipeline AS sourcePipeline,
         created_at AS createdAt
       FROM candidate_merge_log
       WHERE org_id = ?
         AND existing_entity_id = ?
         AND review_status = 'pending'
       ORDER BY score DESC, created_at DESC`
    )
    .bind(orgId, entityId)
    .all<CandidateMergeRow>()

  return rows.results
}
