/**
 * Signal metadata hydration for evidence-dense admin rows.
 */

export interface EntitySignalMetadata {
  entity_id: string
  top_problems: string[] | null
  signal_source_label: string | null
  signal_subject: string | null
  signal_location: string | null
  signal_date: string | null
  signal_address: string | null
  actor_role: 'business' | 'contractor' | 'unknown' | null
  actor_role_confidence: 'high' | 'medium' | 'low' | null
  enrichment_summary: string | null
  last_activity_at: string | null
}

type ActorRole = NonNullable<EntitySignalMetadata['actor_role']>
type ActorRoleConfidence = NonNullable<EntitySignalMetadata['actor_role_confidence']>

function parseStringMeta(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseActorRole(meta: Record<string, unknown>): ActorRole | null {
  const value = meta.actor_role
  return value === 'business' || value === 'contractor' || value === 'unknown' ? value : null
}

function defaultActorRoleConfidence(role: ActorRole | null): ActorRoleConfidence | null {
  if (role === 'business' || role === 'contractor') return 'high'
  if (role === 'unknown') return 'low'
  return null
}

function parseActorRoleConfidence(
  meta: Record<string, unknown>,
  role: ActorRole | null
): ActorRoleConfidence | null {
  const value = meta.actor_role_confidence
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return defaultActorRoleConfidence(role)
}

function parseSignalMetadataRow(row: {
  entity_id: string
  metadata: string | null
}): EntitySignalMetadata {
  let topProblems: string[] | null = null
  let signalSourceLabel: string | null = null
  let signalSubject: string | null = null
  let signalLocation: string | null = null
  let signalDate: string | null = null
  let signalAddress: string | null = null
  let actorRole: ActorRole | null = null
  let actorRoleConfidence: ActorRoleConfidence | null = null
  if (row.metadata) {
    try {
      const meta = JSON.parse(row.metadata) as Record<string, unknown>
      if (
        Array.isArray(meta.top_problems) &&
        meta.top_problems.every((problem) => typeof problem === 'string')
      ) {
        topProblems = meta.top_problems.length ? meta.top_problems : null
      }
      signalSourceLabel = parseStringMeta(meta, 'signal_source_label')
      signalSubject = parseStringMeta(meta, 'signal_subject')
      signalLocation = parseStringMeta(meta, 'signal_location')
      signalDate = parseStringMeta(meta, 'signal_date') ?? parseStringMeta(meta, 'date_found')
      signalAddress = parseStringMeta(meta, 'signal_address')
      actorRole = parseActorRole(meta)
      actorRoleConfidence = parseActorRoleConfidence(meta, actorRole)
    } catch {
      // Malformed JSON - treat as missing metadata.
    }
  }
  return {
    entity_id: row.entity_id,
    top_problems: topProblems,
    signal_source_label: signalSourceLabel,
    signal_subject: signalSubject,
    signal_location: signalLocation,
    signal_date: signalDate,
    signal_address: signalAddress,
    actor_role: actorRole,
    actor_role_confidence: actorRoleConfidence,
    enrichment_summary: null,
    last_activity_at: null,
  }
}

function firstSentenceFromEnrichmentContent(content: string): string | null {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.endsWith(':'))

  for (const line of lines) {
    const sentenceMatch = line.match(/.+?[.!?](?:\s|$)/)
    if (sentenceMatch) return sentenceMatch[0].trim()
    if (line.length > 0) return line
  }

  return null
}

function buildEmptyMetadata(entityId: string): EntitySignalMetadata {
  return {
    entity_id: entityId,
    top_problems: null,
    signal_source_label: null,
    signal_subject: null,
    signal_location: null,
    signal_date: null,
    signal_address: null,
    actor_role: null,
    actor_role_confidence: null,
    enrichment_summary: null,
    last_activity_at: null,
  }
}

function applyEnrichmentSummary(
  out: Map<string, EntitySignalMetadata>,
  row: { entity_id: string; content: string | null }
): void {
  const summary = row.content ? firstSentenceFromEnrichmentContent(row.content) : null
  const existing = out.get(row.entity_id) ?? buildEmptyMetadata(row.entity_id)
  existing.enrichment_summary = summary
  out.set(row.entity_id, existing)
}

function applyLastActivity(
  out: Map<string, EntitySignalMetadata>,
  row: { entity_id: string; last_activity_at: string | null }
): void {
  const existing = out.get(row.entity_id) ?? buildEmptyMetadata(row.entity_id)
  existing.last_activity_at = row.last_activity_at
  out.set(row.entity_id, existing)
}

async function loadSignalRows(
  db: D1Database,
  orgId: string,
  entityIdsJson: string
): Promise<Array<{ entity_id: string; metadata: string | null }>> {
  const signalSql = `
    SELECT c.entity_id, c.metadata
    FROM context c
    WHERE c.org_id = ?
      AND c.entity_id IN (SELECT value FROM json_each(?))
      AND c.type IN ('signal', 'scorecard')
      AND c.created_at = (
        SELECT MAX(c2.created_at)
        FROM context c2
        WHERE c2.entity_id = c.entity_id
          AND c2.type IN ('signal', 'scorecard')
      )
  `
  const rows = await db
    .prepare(signalSql)
    .bind(orgId, entityIdsJson)
    .all<{ entity_id: string; metadata: string | null }>()
  return rows.results
}

async function loadEnrichmentRows(
  db: D1Database,
  orgId: string,
  entityIdsJson: string
): Promise<Array<{ entity_id: string; content: string | null }>> {
  const enrichmentSql = `
    SELECT c.entity_id, c.content
    FROM context c
    WHERE c.org_id = ?
      AND c.entity_id IN (SELECT value FROM json_each(?))
      AND c.type = 'enrichment'
      AND c.created_at = (
        SELECT MAX(c2.created_at)
        FROM context c2
        WHERE c2.entity_id = c.entity_id
          AND c2.type = 'enrichment'
      )
  `
  const rows = await db
    .prepare(enrichmentSql)
    .bind(orgId, entityIdsJson)
    .all<{ entity_id: string; content: string | null }>()
  return rows.results
}

async function loadActivityRows(
  db: D1Database,
  orgId: string,
  entityIdsJson: string
): Promise<Array<{ entity_id: string; last_activity_at: string | null }>> {
  const activitySql = `
    SELECT entity_id, MAX(created_at) AS last_activity_at
    FROM context
    WHERE org_id = ?
      AND entity_id IN (SELECT value FROM json_each(?))
    GROUP BY entity_id
  `
  const rows = await db
    .prepare(activitySql)
    .bind(orgId, entityIdsJson)
    .all<{ entity_id: string; last_activity_at: string | null }>()
  return rows.results
}

export async function getSignalMetadataForEntities(
  db: D1Database,
  orgId: string,
  entityIds: string[]
): Promise<Map<string, EntitySignalMetadata>> {
  const out = new Map<string, EntitySignalMetadata>()
  if (entityIds.length === 0) return out

  const entityIdsJson = JSON.stringify(entityIds)

  for (const row of await loadSignalRows(db, orgId, entityIdsJson)) {
    out.set(row.entity_id, parseSignalMetadataRow(row))
  }

  for (const row of await loadEnrichmentRows(db, orgId, entityIdsJson)) {
    applyEnrichmentSummary(out, row)
  }

  for (const row of await loadActivityRows(db, orgId, entityIdsJson)) {
    applyLastActivity(out, row)
  }

  return out
}
