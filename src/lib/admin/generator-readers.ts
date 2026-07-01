import type { PipelineId } from '../generators/types'

export interface PipelineMetrics {
  total_signals: number
  last_7d: number
  has_pain: number
  has_vertical: number
  has_area: number
  has_employee_count: number
  has_tier: number
  latest_signal_at: string | null
  top_vertical: string | null
  top_vertical_count: number
}

export interface GeneratorSignalRow {
  id: string
  name: string
  pain_score: number | null
  tier: string | null
  vertical: string | null
  area: string | null
  summary: string | null
  created_at: string
  context_id: string | null
  context_metadata: string | null
  context_content: string | null
  context_source_ref: string | null
}

export interface GeneratorDayRow {
  day: string
  count: number
}

const ZERO_COUNTS: PipelineMetrics = {
  total_signals: 0,
  last_7d: 0,
  has_pain: 0,
  has_vertical: 0,
  has_area: 0,
  has_employee_count: 0,
  has_tier: 0,
  latest_signal_at: null,
  top_vertical: null,
  top_vertical_count: 0,
}

export async function loadPipelineMetrics(
  db: D1Database,
  orgId: string,
  pipeline: PipelineId
): Promise<PipelineMetrics> {
  const [row, verticalRow] = await Promise.all([
    fetchSignalCounts(db, orgId, pipeline),
    fetchTopVertical(db, orgId, pipeline),
  ])
  const counts = row ? { ...row } : { ...ZERO_COUNTS }
  counts.top_vertical = verticalRow ? verticalRow.vertical : null
  counts.top_vertical_count = verticalRow ? verticalRow.count : 0
  return counts
}

export async function loadAveragePainScore(
  db: D1Database,
  orgId: string,
  pipeline: PipelineId
): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT AVG(pain_score) as avg
       FROM entities
       WHERE stage = 'signal' AND org_id = ? AND source_pipeline = ? AND pain_score IS NOT NULL`
    )
    .bind(orgId, pipeline)
    .first<{ avg: number | null }>()
  return row?.avg ?? null
}

export async function listGeneratorSignals(
  db: D1Database,
  orgId: string,
  pipeline: PipelineId
): Promise<GeneratorSignalRow[]> {
  const signals = await db
    .prepare(
      `SELECT e.id, e.name, e.pain_score, e.tier, e.vertical, e.area, e.summary, e.created_at,
              c.id as context_id, c.metadata as context_metadata, c.content as context_content,
              c.source_ref as context_source_ref
       FROM entities e
       LEFT JOIN context c ON c.entity_id = e.id AND c.type = 'signal'
       WHERE e.org_id = ? AND e.source_pipeline = ? AND e.stage = 'signal'
       ORDER BY e.created_at DESC, c.created_at DESC
       LIMIT 50`
    )
    .bind(orgId, pipeline)
    .all<GeneratorSignalRow>()

  const seen = new Set<string>()
  const rows: GeneratorSignalRow[] = []
  for (const row of signals.results ?? []) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
  }
  return rows
}

export async function listGeneratorSignalDays(
  db: D1Database,
  orgId: string,
  pipeline: PipelineId
): Promise<GeneratorDayRow[]> {
  const byDay = await db
    .prepare(
      `SELECT date(created_at) as day, COUNT(*) as count
       FROM entities
       WHERE org_id = ? AND source_pipeline = ? AND stage = 'signal'
         AND created_at >= datetime('now', '-30 days')
       GROUP BY day
       ORDER BY day DESC`
    )
    .bind(orgId, pipeline)
    .all<GeneratorDayRow>()
  return byDay.results ?? []
}

async function fetchSignalCounts(
  db: D1Database,
  orgId: string,
  pipeline: PipelineId
): Promise<PipelineMetrics | null> {
  return await db
    .prepare(
      `SELECT
         COUNT(*) as total_signals,
         SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as last_7d,
         SUM(CASE WHEN pain_score IS NOT NULL THEN 1 ELSE 0 END) as has_pain,
         SUM(CASE WHEN vertical IS NOT NULL AND vertical != 'unknown' THEN 1 ELSE 0 END) as has_vertical,
         SUM(CASE WHEN area IS NOT NULL THEN 1 ELSE 0 END) as has_area,
         SUM(CASE WHEN employee_count IS NOT NULL THEN 1 ELSE 0 END) as has_employee_count,
         SUM(CASE WHEN tier IS NOT NULL THEN 1 ELSE 0 END) as has_tier,
         MAX(created_at) as latest_signal_at
       FROM entities
       WHERE stage = 'signal' AND org_id = ? AND source_pipeline = ?`
    )
    .bind(orgId, pipeline)
    .first<PipelineMetrics>()
}

async function fetchTopVertical(
  db: D1Database,
  orgId: string,
  pipeline: PipelineId
): Promise<{ vertical: string; count: number } | null> {
  return await db
    .prepare(
      `SELECT vertical, COUNT(*) as count
       FROM entities
       WHERE stage = 'signal' AND org_id = ? AND source_pipeline = ?
         AND vertical IS NOT NULL AND vertical != 'unknown'
       GROUP BY vertical
       ORDER BY count DESC
       LIMIT 1`
    )
    .bind(orgId, pipeline)
    .first<{ vertical: string; count: number }>()
}
