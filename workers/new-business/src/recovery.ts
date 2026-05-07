import { ORG_ID } from '../../../src/lib/constants.js'
import { findOrCreateEntity, type Entity } from '../../../src/lib/db/entities.js'
import { appendContext } from '../../../src/lib/db/context.js'
import { appendCandidateMergeLog } from '../../../src/lib/db/candidate-merge-log.js'
import {
  getPlacesLookupCache,
  upsertPlacesLookupCache,
  type PlacesLookupCacheEntry,
} from '../../../src/lib/db/places-lookup-cache.js'
import { dispatchEnrichmentWorkflow } from '../../../src/lib/enrichment/dispatch.js'
import { lookupGooglePlaceByAddress } from '../../../src/lib/enrichment/google-places.js'
import type { RunSummary } from './alert.js'
import type { PermitRecord } from './soda.js'
import {
  extractAreaFromAddress,
  normalizeAddress,
  recordAddressCandidate,
  type AddressCandidate,
} from './address-index.js'

const GOOGLE_PLACES_USD_PER_LOOKUP = 0.02
const PLACES_CACHE_TTL_DAYS = 7
const ENABLE_ADOR_TPT_LOOKUP = false

export interface RecoveryEnv {
  DB: D1Database
  GOOGLE_PLACES_API_KEY?: string
  ENRICHMENT_WORKFLOW_SERVICE?: { fetch: typeof fetch }
}

interface Tier3Hit {
  businessName: string
  placeId: string | null
  formattedAddress: string | null
  area: string | null
  phone: string | null
  website: string | null
  businessStatus: string | null
  types: string[] | null
}

interface PermitRecoveryContext {
  env: RecoveryEnv
  ctx?: ExecutionContext
  summary: RunSummary
  addressIndex: Map<string, AddressCandidate[]>
  weeklyBudgetUsd: number
}

function normalizeNameForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|company|llp|ltd|pllc|pc|lp)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function softNameMatch(entityName: string, candidates: Array<string | undefined>): boolean {
  const target = normalizeNameForMatch(entityName)
  if (!target) return false

  const targetTokens = new Set(target.split(' ').filter((token) => token.length > 2))
  for (const raw of candidates) {
    if (!raw) continue
    const candidate = normalizeNameForMatch(raw)
    if (!candidate) continue
    if (candidate === target) return true
    if (candidate.includes(target) || target.includes(candidate)) return true

    const overlap = candidate
      .split(' ')
      .filter((token) => token.length > 2)
      .filter((token) => targetTokens.has(token))
    if (overlap.length >= 2) return true
  }

  return false
}

function permitImpliesOccupancy(permitType?: string): boolean {
  if (!permitType) return false
  const type = permitType.toLowerCase()
  return (
    type.includes('tenant improvement') ||
    /\bti\b/.test(type) ||
    type.includes('change of occupancy') ||
    type.includes('change of use') ||
    type.includes('commercial remodel') ||
    (type.includes('remodel') && type.includes('commercial'))
  )
}

function skipAddressForReverseLookup(address: string): boolean {
  const normalized = address.toLowerCase()
  return (
    normalized.includes(' apartment ') ||
    normalized.includes(' apt ') ||
    normalized.includes(' condo ') ||
    normalized.includes(' trailer ') ||
    normalized.includes(' mobile home ')
  )
}

function buildSignalContent(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n')
}

function buildPermitObservedMetadata(
  permit: PermitRecord,
  matchedBusinessName: string
): Record<string, unknown> {
  return {
    permit_number: permit.permit_number ?? null,
    permit_type: permit.permit_type ?? null,
    filing_date: permit.filing_date,
    actor_role: permit.actor_role,
    owner_name: permit.owner_name ?? null,
    signal_source_label: 'Permit observed',
    signal_subject: matchedBusinessName,
    signal_location: extractAreaFromAddress(permit.address),
    signal_date: permit.filing_date,
    signal_address: permit.address,
    date_found: new Date().toISOString().split('T')[0],
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function appendPermitObservation(
  env: RecoveryEnv,
  entity: Entity,
  permit: PermitRecord,
  matchedBusinessName: string,
  ctx?: ExecutionContext
): Promise<void> {
  const content = buildSignalContent([
    `Permit observed: ${permit.permit_type ?? permit.entity_type}`,
    permit.address ? `Address: ${permit.address}` : null,
    permit.owner_name ? `Filed by: ${permit.owner_name}` : null,
  ])

  await appendContext(env.DB, ORG_ID, {
    entity_id: entity.id,
    type: 'signal',
    content: content || 'Permit observed.',
    source: 'new_business',
    source_ref: permit.permit_number,
    metadata: buildPermitObservedMetadata(permit, matchedBusinessName),
  })

  if (ctx) {
    ctx.waitUntil(
      dispatchEnrichmentWorkflow(env, {
        entityId: entity.id,
        orgId: ORG_ID,
        mode: 'full',
        triggered_by: 'cron:new-business-permit-observed',
      }).catch((error: unknown) => {
        console.error('[new_business] enrichment dispatch failed', {
          entityId: entity.id,
          error: toErrorMessage(error),
        })
      })
    )
  }
}

async function logAddressCandidates(
  db: D1Database,
  permit: PermitRecord,
  candidates: AddressCandidate[],
  reason: string,
  overrides: Partial<{
    candidateName: string
    candidateArea: string | null
    metadata: Record<string, unknown>
  }> = {}
): Promise<void> {
  for (const candidate of candidates) {
    await appendCandidateMergeLog(db, ORG_ID, {
      existingEntityId: candidate.entity.id,
      candidateName: overrides.candidateName ?? permit.business_name,
      candidateArea: overrides.candidateArea ?? extractAreaFromAddress(permit.address),
      candidateAddress: permit.address,
      matchedName: candidate.entity.name,
      matchedArea: candidate.entity.area,
      matchedAddress: candidate.address,
      sourcePipeline: 'new_business',
      sourceRef: permit.permit_number ?? null,
      reason,
      metadata: overrides.metadata ?? {
        actor_role: permit.actor_role,
        owner_name: permit.owner_name ?? null,
        permit_type: permit.permit_type ?? null,
      },
    })
  }
}

async function tryTier1Join(
  env: RecoveryEnv,
  permit: PermitRecord,
  addressIndex: Map<string, AddressCandidate[]>,
  summary: RunSummary
): Promise<Entity | null> {
  const normalizedAddress = normalizeAddress(permit.address)
  if (!normalizedAddress) return null

  const candidates = addressIndex.get(normalizedAddress) ?? []
  if (candidates.length === 0) return null

  if (candidates.length > 1) {
    await logAddressCandidates(env.DB, permit, candidates, 'address_match_multiple_entities')
    return null
  }

  const [candidate] = candidates
  const matches = softNameMatch(candidate.entity.name, [
    permit.business_name,
    permit.owner_name,
    permit.permit_type,
  ])

  if (!matches) {
    await logAddressCandidates(env.DB, permit, candidates, 'address_match_name_mismatch')
    return null
  }

  summary.recoveredTier1++
  return candidate.entity
}

function maybeTier2Lookup(_permit: PermitRecord): null {
  if (!ENABLE_ADOR_TPT_LOOKUP) return null
  return null
}

async function getWeeklyPlacesSpend(db: D1Database): Promise<number> {
  const now = new Date()
  const day = now.getUTCDay()
  const diffToMonday = (day + 6) % 7
  now.setUTCDate(now.getUTCDate() - diffToMonday)
  now.setUTCHours(0, 0, 0, 0)

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS calls
         FROM places_lookup_cache
        WHERE updated_at >= ?`
    )
    .bind(now.toISOString())
    .first<{ calls: number | string | null }>()

  const calls =
    typeof row?.calls === 'number'
      ? row.calls
      : typeof row?.calls === 'string'
        ? Number.parseInt(row.calls, 10)
        : 0
  return calls * GOOGLE_PLACES_USD_PER_LOOKUP
}

function cacheExpiryIso(): string {
  const expires = new Date()
  expires.setUTCDate(expires.getUTCDate() + PLACES_CACHE_TTL_DAYS)
  return expires.toISOString()
}

function cachedTier3Hit(cached: PlacesLookupCacheEntry): Tier3Hit | null {
  if (!cached.business_name || cached.business_status !== 'OPERATIONAL') return null
  return {
    businessName: cached.business_name,
    placeId: cached.place_id,
    formattedAddress: cached.formatted_address,
    area: cached.area,
    phone: cached.phone,
    website: cached.website,
    businessStatus: cached.business_status,
    types: cached.types,
  }
}

function placeToTier3Hit(
  permit: PermitRecord,
  place: Awaited<ReturnType<typeof lookupGooglePlaceByAddress>>
): Tier3Hit | null {
  if (!place?.name || place.businessStatus !== 'OPERATIONAL') return null
  return {
    businessName: place.name,
    placeId: place.placeId,
    formattedAddress: place.address,
    area: extractAreaFromAddress(place.address ?? permit.address),
    phone: place.phone,
    website: place.website,
    businessStatus: place.businessStatus,
    types: place.types,
  }
}

function buildTier3CacheEntry(
  permit: PermitRecord,
  normalizedAddress: string,
  place: Awaited<ReturnType<typeof lookupGooglePlaceByAddress>>
): PlacesLookupCacheEntry {
  if (!place) {
    return {
      normalized_address: normalizedAddress,
      business_name: null,
      place_id: null,
      formatted_address: null,
      area: extractAreaFromAddress(permit.address),
      phone: null,
      website: null,
      business_status: null,
      types: null,
      response: { matched: false },
      expires_at: cacheExpiryIso(),
    }
  }

  return {
    normalized_address: normalizedAddress,
    business_name: place.name,
    place_id: place.placeId,
    formatted_address: place.address,
    area: extractAreaFromAddress(place.address ?? permit.address),
    phone: place.phone,
    website: place.website,
    business_status: place.businessStatus,
    types: place.types,
    response: { place },
    expires_at: cacheExpiryIso(),
  }
}

function shouldAttemptTier3Lookup(env: RecoveryEnv, permit: PermitRecord): boolean {
  return Boolean(
    env.GOOGLE_PLACES_API_KEY &&
    permitImpliesOccupancy(permit.permit_type) &&
    !skipAddressForReverseLookup(permit.address)
  )
}

async function maybeTier3Lookup(
  permit: PermitRecord,
  context: PermitRecoveryContext
): Promise<Tier3Hit | null> {
  if (!shouldAttemptTier3Lookup(context.env, permit)) return null

  const normalizedAddress = normalizeAddress(permit.address)
  if (!normalizedAddress) return null

  const cached = await getPlacesLookupCache(context.env.DB, normalizedAddress)
  if (cached) return cachedTier3Hit(cached)

  const currentSpend = await getWeeklyPlacesSpend(context.env.DB)
  if (currentSpend + GOOGLE_PLACES_USD_PER_LOOKUP > context.weeklyBudgetUsd) {
    context.summary.budgetSkipped++
    return null
  }

  const place = await lookupGooglePlaceByAddress(permit.address, context.env.GOOGLE_PLACES_API_KEY!)
  await upsertPlacesLookupCache(
    context.env.DB,
    buildTier3CacheEntry(permit, normalizedAddress, place)
  )
  return placeToTier3Hit(permit, place)
}

function findConsistentCandidate(
  candidates: AddressCandidate[],
  tier3BusinessName: string,
  ownerName?: string
): AddressCandidate | undefined {
  return candidates.find((candidate) =>
    softNameMatch(candidate.entity.name, [tier3BusinessName, ownerName])
  )
}

async function createOrJoinTier3Entity(
  permit: PermitRecord,
  tier3: Tier3Hit,
  context: PermitRecoveryContext
): Promise<boolean> {
  const normalizedAddress = normalizeAddress(permit.address)
  const candidates = context.addressIndex.get(normalizedAddress) ?? []
  const consistentCandidate = findConsistentCandidate(
    candidates,
    tier3.businessName,
    permit.owner_name
  )

  if (consistentCandidate) {
    context.summary.recoveredTier3++
    await appendPermitObservation(
      context.env,
      consistentCandidate.entity,
      permit,
      consistentCandidate.entity.name,
      context.ctx
    )
    context.summary.written++
    return true
  }

  if (candidates.length > 0) {
    await logAddressCandidates(context.env.DB, permit, candidates, 'tier3_address_name_mismatch', {
      candidateName: tier3.businessName,
      candidateArea: tier3.area,
      metadata: {
        actor_role: permit.actor_role,
        owner_name: permit.owner_name ?? null,
        place_id: tier3.placeId,
      },
    })
  }

  const result = await findOrCreateEntity(context.env.DB, ORG_ID, {
    name: tier3.businessName,
    area: tier3.area,
    phone: tier3.phone,
    website: tier3.website,
    source_pipeline: 'new_business',
  })

  await appendPermitObservation(context.env, result.entity, permit, tier3.businessName, context.ctx)
  recordAddressCandidate(
    context.addressIndex,
    tier3.formattedAddress ?? permit.address,
    result.entity
  )
  context.summary.recoveredTier3++
  context.summary.written++
  return true
}

export async function recoverPermitEntity(
  permit: PermitRecord,
  context: PermitRecoveryContext
): Promise<boolean> {
  const tier1 = await tryTier1Join(context.env, permit, context.addressIndex, context.summary)
  if (tier1) {
    await appendPermitObservation(context.env, tier1, permit, tier1.name, context.ctx)
    context.summary.written++
    return true
  }

  const tier2 = maybeTier2Lookup(permit)
  if (tier2) return true

  const tier3 = await maybeTier3Lookup(permit, context)
  if (!tier3) {
    context.summary.droppedOrphan++
    return false
  }

  return createOrJoinTier3Entity(permit, tier3, context)
}
