import { ORG_ID } from '../../../src/lib/constants.js'
import type { Entity } from '../../../src/lib/db/entities.js'

export interface AddressCandidate {
  entity: Entity
  address: string
}

interface AddressIndexRow {
  metadata: string | null
  id: string
  org_id: string
  name: string
  slug: string
  phone: string | null
  website: string | null
  stage: Entity['stage']
  stage_changed_at: string
  pain_score: number | null
  vertical: string | null
  area: string | null
  employee_count: number | null
  tier: Entity['tier']
  summary: string | null
  next_action: string | null
  next_action_at: string | null
  source_pipeline: string | null
  created_at: string
  updated_at: string
}

export function normalizeAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(arizona|az)\b/g, ' ')
    .replace(/\b(suite|ste|unit|apt)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractAreaFromAddress(address: string): string | null {
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    const city = parts[parts.length - 2]
    return city ? `${city}, AZ` : null
  }
  return null
}

export function recordAddressCandidate(
  index: Map<string, AddressCandidate[]>,
  address: string,
  entity: Entity
): void {
  const normalized = normalizeAddress(address)
  if (!normalized) return

  const candidates = index.get(normalized) ?? []
  if (!candidates.some((candidate) => candidate.entity.id === entity.id)) {
    candidates.push({ entity, address })
    index.set(normalized, candidates)
  }
}

function hydrateEntity(row: AddressIndexRow): Entity {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    slug: row.slug,
    phone: row.phone,
    website: row.website,
    stage: row.stage,
    stage_changed_at: row.stage_changed_at,
    pain_score: row.pain_score,
    vertical: row.vertical,
    area: row.area,
    employee_count: row.employee_count,
    tier: row.tier,
    summary: row.summary,
    next_action: row.next_action,
    next_action_at: row.next_action_at,
    source_pipeline: row.source_pipeline,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function indexedAddressesFromMetadata(metadata: Record<string, unknown>): string[] {
  return [
    metadata.signal_address,
    metadata.address,
    metadata.formattedAddress,
    metadata.formatted_address,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

export async function buildAddressIndex(db: D1Database): Promise<Map<string, AddressCandidate[]>> {
  const rows = await db
    .prepare(
      `SELECT e.id, e.org_id, e.name, e.slug, e.phone, e.website, e.stage, e.stage_changed_at,
              e.pain_score, e.vertical, e.area, e.employee_count, e.tier, e.summary,
              e.next_action, e.next_action_at, e.source_pipeline, e.created_at, e.updated_at,
              c.metadata
         FROM entities e
         JOIN context c ON c.entity_id = e.id
        WHERE e.org_id = ?
          AND c.metadata IS NOT NULL
          AND c.type IN ('signal', 'enrichment')`
    )
    .bind(ORG_ID)
    .all<AddressIndexRow>()

  const index = new Map<string, AddressCandidate[]>()
  for (const row of rows.results ?? []) {
    if (!row.metadata) continue

    let metadata: Record<string, unknown>
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>
    } catch {
      continue
    }

    const entity = hydrateEntity(row)
    for (const address of indexedAddressesFromMetadata(metadata)) {
      recordAddressCandidate(index, address, entity)
    }
  }

  return index
}
