/**
 * Entity data access layer.
 *
 * An entity is a single business tracked across its full lifecycle —
 * from pipeline signal through engagement delivery and repeat business.
 * Replaces the separate clients and lead_signals tables.
 *
 * All queries are parameterized to prevent SQL injection.
 * Primary keys use crypto.randomUUID().
 * Dedup enforced via UNIQUE(org_id, slug).
 */

import { computeSlug, jaroWinklerSimilarity, normalizeBusinessName } from '../entities/slug.js'
import { recomputeDeterministicCache } from '../entities/recompute.js'
import { appendContext } from './context.js'
import { isLostReasonCode, type LostReasonCode } from './lost-reasons.js'
import { appendCandidateMergeLog } from './candidate-merge-log.js'
import { getPipelineSettings } from './pipeline-settings.js'
export {
  getSignalMetadataForEntities,
  type EntitySignalMetadata,
} from './entity-signal-metadata.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Entity {
  id: string
  org_id: string
  name: string
  slug: string
  phone: string | null
  website: string | null
  stage: EntityStage
  stage_changed_at: string
  pain_score: number | null
  vertical: string | null
  area: string | null
  employee_count: number | null
  tier: EntityTier | null
  summary: string | null
  next_action: string | null
  next_action_at: string | null
  source_pipeline: string | null
  created_at: string
  updated_at: string
  /**
   * Clerk Organization ID bound to this customer. Populated when the
   * entity is provisioned for portal access (PR #904 bridge column).
   * Null for prospect / pre-purchase entities. Optional in the type
   * so legacy fixtures constructing Entity literals without this
   * field continue to compile; D1 reads always materialize it (null
   * when the row was inserted before the column was added).
   */
  clerk_org_id?: string | null
}

// prettier-ignore
export type EntityStage = 'signal' | 'prospect' | 'meetings' | 'proposing' | 'engaged' | 'delivered' | 'ongoing' | 'lost'
export type EntityTier = 'hot' | 'warm' | 'cool' | 'cold'
// prettier-ignore
export type EntityVertical = 'home_services' | 'professional_services' | 'contractor_trades' | 'retail_salon' | 'restaurant_food' | 'other'

type StageLabel = { value: EntityStage; label: string }
type TierLabel = { value: EntityTier; label: string }
type VerticalLabel = { value: EntityVertical; label: string }
// prettier-ignore
export const ENTITY_STAGES: StageLabel[] = [
  { value: 'signal', label: 'Signal' }, { value: 'prospect', label: 'Prospect' },
  { value: 'meetings', label: 'Meetings' }, { value: 'proposing', label: 'Proposing' },
  { value: 'engaged', label: 'Engaged' }, { value: 'delivered', label: 'Delivered' },
  { value: 'ongoing', label: 'Ongoing' }, { value: 'lost', label: 'Lost' },
]
// prettier-ignore
export const ENTITY_TIERS: TierLabel[] = [
  { value: 'hot', label: 'Hot' }, { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' }, { value: 'cold', label: 'Cold' },
]
// prettier-ignore
export const ENTITY_VERTICALS: VerticalLabel[] = [
  { value: 'home_services', label: 'Home Services' }, { value: 'professional_services', label: 'Professional Services' },
  { value: 'contractor_trades', label: 'Contractor / Trades' }, { value: 'retail_salon', label: 'Retail / Salon / Spa' },
  { value: 'restaurant_food', label: 'Restaurant / Food Service' }, { value: 'other', label: 'Other' },
]

/**
 * Valid stage transitions. Key = current stage, value = allowed next stages.
 * `lost` is non-terminal: can re-engage back to `prospect`.
 */
const VALID_TRANSITIONS: Record<EntityStage, EntityStage[]> = {
  signal: ['prospect', 'lost'],
  prospect: ['meetings', 'lost'],
  // From `meetings` the admin picks the next step explicitly (#470). Direct
  // transitions to `engaged`/`delivered`/`ongoing` still require going
  // through `proposing` first — the `proposing→engaged` accepted-quote
  // invariant protects the engagement model. Backing out to `prospect` is
  // allowed so a discovery/follow-up meeting that didn't qualify doesn't
  // force an entity into `lost`.
  meetings: ['proposing', 'prospect', 'lost'],
  proposing: ['engaged', 'lost'],
  engaged: ['delivered', 'lost'],
  delivered: ['ongoing', 'prospect', 'lost'],
  ongoing: ['prospect', 'lost'],
  lost: ['prospect'],
}

export interface EntityFilters {
  stage?: EntityStage
  stages?: EntityStage[]
  vertical?: string
  tier?: EntityTier
  source_pipeline?: string
}

export interface CreateEntityData {
  name: string
  area?: string | null
  phone?: string | null
  website?: string | null
  stage?: EntityStage
  source_pipeline?: string | null
}

export interface UpdateEntityData {
  name?: string
  phone?: string | null
  website?: string | null
  next_action?: string | null
  next_action_at?: string | null
  tier?: EntityTier | null
  summary?: string | null
}

export type FindOrCreateResult =
  | { status: 'created'; entity: Entity }
  | { status: 'found'; entity: Entity }

export interface TransitionStageOptions {
  /** Override reason — bypasses pre-condition checks where documented. */
  force?: string
  /**
   * Structured metadata for `lost` transitions. Captured on the
   * `stage_change` context entry's JSON metadata so the Lost tab can
   * filter and future reporting can roll up "why we lost" without
   * parsing free text.
   *
   * Required when `newStage === 'lost'`. Enforced at the DAL layer
   * rather than the API so every caller (admin UI, scripts, future
   * background jobs) is held to the same contract.
   */
  lostReason?: {
    code: LostReasonCode
    /** Optional operator note. Trimmed. Empty → stored as null. */
    detail?: string | null
  }
}

/** Combined transition args — reason is required, other fields are optional. */
export interface TransitionArgs extends TransitionStageOptions {
  reason: string
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listEntities(
  db: D1Database,
  orgId: string,
  filters?: EntityFilters
): Promise<Entity[]> {
  const conditions: string[] = ['org_id = ?']
  const params: (string | number)[] = [orgId]

  if (filters?.stage) {
    conditions.push('stage = ?')
    params.push(filters.stage)
  }

  if (filters?.stages && filters.stages.length > 0) {
    const placeholders = filters.stages.map(() => '?').join(', ')
    conditions.push(`stage IN (${placeholders})`)
    params.push(...filters.stages)
  }

  if (filters?.vertical) {
    conditions.push('vertical = ?')
    params.push(filters.vertical)
  }

  if (filters?.tier) {
    conditions.push('tier = ?')
    params.push(filters.tier)
  }

  if (filters?.source_pipeline) {
    conditions.push('source_pipeline = ?')
    params.push(filters.source_pipeline)
  }

  const where = conditions.join(' AND ')
  const sql = `SELECT * FROM entities WHERE ${where}
    ORDER BY
      CASE tier WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 WHEN 'cool' THEN 2 WHEN 'cold' THEN 3 ELSE 4 END,
      pain_score DESC,
      updated_at DESC`

  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<Entity>()
  return result.results
}

export async function getEntity(
  db: D1Database,
  orgId: string,
  entityId: string
): Promise<Entity | null> {
  return (
    (await db
      .prepare('SELECT * FROM entities WHERE id = ? AND org_id = ?')
      .bind(entityId, orgId)
      .first<Entity>()) ?? null
  )
}

export async function getEntityBySlug(
  db: D1Database,
  orgId: string,
  slug: string
): Promise<Entity | null> {
  return (
    (await db
      .prepare('SELECT * FROM entities WHERE slug = ? AND org_id = ?')
      .bind(slug, orgId)
      .first<Entity>()) ?? null
  )
}

/**
 * Counts per stage for the entity list tab badges. One GROUP BY keeps the
 * query from scaling with the number of stages. Stages with zero rows are
 * omitted from the DB result; callers that need a populated record for
 * every stage should initialise defaults before merging.
 */
export async function countEntitiesPerStage(
  db: D1Database,
  orgId: string
): Promise<Record<EntityStage, number>> {
  const rows = await db
    .prepare('SELECT stage, COUNT(*) as count FROM entities WHERE org_id = ? GROUP BY stage')
    .bind(orgId)
    .all<{ stage: EntityStage; count: number }>()
  const counts = Object.fromEntries(ENTITY_STAGES.map((s) => [s.value, 0])) as Record<
    EntityStage,
    number
  >
  for (const row of rows.results ?? []) {
    counts[row.stage] = row.count
  }
  return counts
}

// ---------------------------------------------------------------------------
// Find or Create (for pipeline ingestion)
// ---------------------------------------------------------------------------

async function maybeUpdateEntityContacts(
  db: D1Database,
  orgId: string,
  existing: Entity,
  data: CreateEntityData
): Promise<void> {
  if (!(data.phone && !existing.phone) && !(data.website && !existing.website)) {
    return
  }

  await db
    .prepare(
      `UPDATE entities SET
        phone = COALESCE(?, phone),
        website = COALESCE(?, website),
        updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`
    )
    .bind(data.phone ?? null, data.website ?? null, existing.id, orgId)
    .run()
}

async function reloadEntity(db: D1Database, orgId: string, entityId: string): Promise<Entity> {
  const entity = await getEntity(db, orgId, entityId)
  if (!entity) throw new Error(`Failed to load entity ${entityId}`)
  return entity
}

interface FuzzyMatchCandidate {
  entity: Entity
  score: number
}

/**
 * Find the highest-scoring Jaro-Winkler match for `name` across the org's
 * existing entities. Scope is org-wide as of 2026-05-18 (#751 bug 3) —
 * previously scoped `WHERE area = ?`, which silently disabled fuzzy
 * matching for area-less ingests (the common case post-bug-1, since
 * `entities.area` was being silently dropped at INSERT).
 */
async function findBestFuzzyMatch(
  db: D1Database,
  orgId: string,
  name: string,
  threshold: number
): Promise<FuzzyMatchCandidate | null> {
  const candidates = await db
    .prepare(`SELECT * FROM entities WHERE org_id = ?`)
    .bind(orgId)
    .all<Entity>()

  const target = normalizeBusinessName(name)
  let bestMatch: FuzzyMatchCandidate | null = null
  for (const candidate of candidates.results ?? []) {
    const score = jaroWinklerSimilarity(target, normalizeBusinessName(candidate.name))
    if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { entity: candidate, score }
    }
  }

  return bestMatch
}

async function maybeLogFuzzyDuplicate(
  db: D1Database,
  orgId: string,
  data: CreateEntityData,
  slug: string
): Promise<void> {
  const settings = await getPipelineSettings(db, orgId, 'new_business')
  const threshold = settings.dedup_fuzzy_threshold
  const bestMatch = await findBestFuzzyMatch(db, orgId, data.name, threshold)
  if (!bestMatch) return

  await appendCandidateMergeLog(db, orgId, {
    existingEntityId: bestMatch.entity.id,
    candidateName: data.name,
    candidateSlug: slug,
    candidateArea: data.area ?? null,
    matchedName: bestMatch.entity.name,
    matchedArea: bestMatch.entity.area,
    sourcePipeline: data.source_pipeline ?? null,
    reason: 'slug_fuzzy_match',
    score: Number(bestMatch.score.toFixed(4)),
    metadata: { threshold },
  })
}

interface InsertEntityArgs {
  id: string
  slug: string
  data: CreateEntityData
  now: string
}

async function insertEntityIfMissing(
  db: D1Database,
  orgId: string,
  args: InsertEntityArgs
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entities (
        id, org_id, name, slug, phone, website, area, stage, stage_changed_at,
        source_pipeline, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(org_id, slug) DO NOTHING`
    )
    .bind(
      args.id,
      orgId,
      args.data.name,
      args.slug,
      args.data.phone ?? null,
      args.data.website ?? null,
      args.data.area ?? null,
      args.data.stage ?? 'signal',
      args.now,
      args.data.source_pipeline ?? null,
      args.now,
      args.now
    )
    .run()
}

/**
 * Find an existing entity by slug, or create a new one.
 * Used by the pipeline ingestion endpoint to ensure one entity per business.
 */
export async function findOrCreateEntity(
  db: D1Database,
  orgId: string,
  data: CreateEntityData
): Promise<FindOrCreateResult> {
  const slug = computeSlug(data.name, data.area)

  const existing = await getEntityBySlug(db, orgId, slug)
  if (existing) {
    await maybeUpdateEntityContacts(db, orgId, existing, data)
    const entity = await reloadEntity(db, orgId, existing.id)
    return { status: 'found', entity }
  }

  await maybeLogFuzzyDuplicate(db, orgId, data, slug)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await insertEntityIfMissing(db, orgId, { id, slug, data, now })

  // Handle race condition: another request may have created it
  const entity = await getEntityBySlug(db, orgId, slug)
  if (!entity) throw new Error(`Failed to resolve entity for slug ${slug}`)
  const wasCreated = entity.id === id
  return wasCreated ? { status: 'created', entity } : { status: 'found', entity }
}

// ---------------------------------------------------------------------------
// Create (for migration and manual entry)
// ---------------------------------------------------------------------------

export async function createEntity(
  db: D1Database,
  orgId: string,
  data: CreateEntityData & { id?: string; slug?: string }
): Promise<Entity> {
  const id = data.id ?? crypto.randomUUID()
  const slug = data.slug ?? computeSlug(data.name, data.area)
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO entities (id, org_id, name, slug, phone, website, area, stage, stage_changed_at, source_pipeline, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      orgId,
      data.name,
      slug,
      data.phone ?? null,
      data.website ?? null,
      data.area ?? null,
      data.stage ?? 'signal',
      now,
      data.source_pipeline ?? null,
      now,
      now
    )
    .run()
  const entity = await getEntity(db, orgId, id)
  if (!entity) throw new Error('Failed to retrieve created entity')
  return entity
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateEntity(
  db: D1Database,
  orgId: string,
  entityId: string,
  data: UpdateEntityData
): Promise<Entity | null> {
  const existing = await getEntity(db, orgId, entityId)
  if (!existing) return null

  const fields: string[] = []
  const params: (string | number | null)[] = []
  const append = (col: string, val: string | number | null | undefined) => {
    if (val !== undefined) {
      fields.push(`${col} = ?`)
      params.push(val)
    }
  }
  append('name', data.name)
  append('phone', data.phone)
  append('website', data.website)
  append('next_action', data.next_action)
  append('next_action_at', data.next_action_at)
  append('tier', data.tier)
  append('summary', data.summary)

  if (fields.length === 0) return existing
  fields.push("updated_at = datetime('now')")
  params.push(entityId, orgId)
  await db
    .prepare(`UPDATE entities SET ${fields.join(', ')} WHERE id = ? AND org_id = ?`)
    .bind(...params)
    .run()
  return getEntity(db, orgId, entityId)
}

// ---------------------------------------------------------------------------
// Stage transitions
// ---------------------------------------------------------------------------

/**
 * Transition an entity to a new stage. Validates against allowed transitions
 * and enforces lifecycle invariants (pre-conditions) before updating.
 *
 * Pre-conditions:
 * - proposing → engaged: requires at least one accepted quote
 * - delivered → ongoing: requires paid completion invoice OR force override
 *
 * Note: signal → meetings is blocked by VALID_TRANSITIONS. Booking flows
 * must walk through `prospect` as an intermediate state (signal → prospect → meetings).
 *
 * Records a stage_change context entry automatically.
 */
interface TransitionContext {
  entity: Entity
  newStage: EntityStage
  args: TransitionArgs
}

async function checkTransitionPreconditions(
  db: D1Database,
  orgId: string,
  entityId: string,
  ctx: TransitionContext
): Promise<void> {
  const { entity, newStage, args } = ctx
  if (newStage === 'lost') {
    const lostReasonCode = String(args.lostReason?.code ?? '')
    if (!args.lostReason?.code)
      throw new Error(
        'Lost reason is required: provide args.lostReason.code when transitioning to lost.'
      )
    if (!isLostReasonCode(args.lostReason.code))
      throw new Error(
        `Invalid lost reason code: ${lostReasonCode}. See src/lib/db/lost-reasons.ts.`
      )
  }
  if (entity.stage === 'proposing' && newStage === 'engaged') {
    const acceptedQuote = await db
      .prepare(
        `SELECT 1 FROM quotes WHERE entity_id = ? AND org_id = ? AND status = 'accepted' LIMIT 1`
      )
      .bind(entityId, orgId)
      .first()
    if (!acceptedQuote)
      throw new Error(
        'Cannot transition to engaged: no accepted quote found. A quote must be signed and accepted before an engagement can begin.'
      )
  }
  if (entity.stage === 'delivered' && newStage === 'ongoing') {
    if (args.force) {
      await appendContext(db, orgId, {
        entity_id: entityId,
        type: 'stage_change',
        content: `Force override: delivered → ongoing. Reason: ${args.force}`,
        source: 'system',
        metadata: { override: true, reason: args.force },
      })
    } else {
      const paidCompletion = await db
        .prepare(
          `SELECT 1 FROM invoices WHERE entity_id = ? AND org_id = ? AND type = 'completion' AND status = 'paid' LIMIT 1`
        )
        .bind(entityId, orgId)
        .first()
      if (!paidCompletion)
        throw new Error(
          'Cannot transition to ongoing: completion invoice has not been paid. Either collect payment or provide a force override reason.'
        )
    }
  }
}

export async function transitionStage(
  db: D1Database,
  orgId: string,
  entityId: string,
  newStage: EntityStage,
  args: TransitionArgs | string
): Promise<Entity | null> {
  // Backward-compat shim: callers that pass reason as a plain string continue to work.
  const normalizedArgs: TransitionArgs = typeof args === 'string' ? { reason: args } : args

  const entity = await getEntity(db, orgId, entityId)
  if (!entity) return null

  const allowed = VALID_TRANSITIONS[entity.stage]
  if (!allowed?.includes(newStage)) {
    throw new Error(
      `Invalid stage transition: ${entity.stage} → ${newStage}. Allowed: ${allowed?.join(', ')}`
    )
  }

  await checkTransitionPreconditions(db, orgId, entityId, {
    entity,
    newStage,
    args: normalizedArgs,
  })

  const lostReasonCode =
    newStage === 'lost' &&
    normalizedArgs.lostReason?.code &&
    isLostReasonCode(normalizedArgs.lostReason.code)
      ? normalizedArgs.lostReason.code
      : null
  const rawDetail = normalizedArgs.lostReason?.detail
  const lostReasonDetail =
    typeof rawDetail === 'string' && rawDetail.trim().length > 0 ? rawDetail.trim() : null

  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE entities SET stage = ?, stage_changed_at = ?, updated_at = ? WHERE id = ? AND org_id = ?`
    )
    .bind(newStage, now, now, entityId, orgId)
    .run()

  const contextId = crypto.randomUUID()
  const content = `Stage: ${entity.stage} → ${newStage}. ${normalizedArgs.reason}`
  const metadata: Record<string, unknown> = {
    from: entity.stage,
    to: newStage,
    reason: normalizedArgs.reason,
  }
  if (lostReasonCode) {
    metadata.lost_reason = lostReasonCode
    if (lostReasonDetail) metadata.lost_detail = lostReasonDetail
  }
  await db
    .prepare(
      `INSERT INTO context (id, entity_id, org_id, type, content, source, content_size, metadata, created_at)
      VALUES (?, ?, ?, 'stage_change', ?, 'system', ?, ?, ?)`
    )
    .bind(contextId, entityId, orgId, content, content.length, JSON.stringify(metadata), now)
    .run()

  // Recompute cache after stage change
  await recomputeDeterministicCache(db, orgId, entityId)

  return getEntity(db, orgId, entityId)
}

/**
 * Returns the latest captured Lost reason code per entity, keyed by
 * entity_id. Reads from `stage_change` context entries where
 * `metadata.to = 'lost'`. Entities with no structured reason (e.g.
 * legacy Lost rows captured before #477) are absent from the map.
 *
 * This is the one place that rolls up structured Lost metadata for
 * list-rendering. Keep the query tight — it runs on every Lost-tab
 * page render.
 */
// Re-export slug utility for convenience
export { computeSlug } from '../entities/slug.js'
// Re-export extended entity queries (extracted to stay within file-line ceiling)
export { getLatestLostReasonsByEntity, mergeEntities } from './entities-extra.js'
