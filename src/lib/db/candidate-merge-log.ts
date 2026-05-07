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
