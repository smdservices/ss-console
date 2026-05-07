export interface PlacesLookupCacheEntry {
  normalized_address: string
  business_name: string | null
  place_id: string | null
  formatted_address: string | null
  area: string | null
  phone: string | null
  website: string | null
  business_status: string | null
  types: string[] | null
  response: Record<string, unknown> | null
  expires_at: string
}

interface RawPlacesLookupCacheRow {
  normalized_address: string
  business_name: string | null
  place_id: string | null
  formatted_address: string | null
  area: string | null
  phone: string | null
  website: string | null
  business_status: string | null
  types_json: string | null
  response_json: string | null
  expires_at: string
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function parseStringArray(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')
      ? parsed
      : null
  } catch {
    return null
  }
}

export async function getPlacesLookupCache(
  db: D1Database,
  normalizedAddress: string
): Promise<PlacesLookupCacheEntry | null> {
  const row = await db
    .prepare(
      `SELECT normalized_address, business_name, place_id, formatted_address,
              area, phone, website, business_status, types_json,
              response_json, expires_at
       FROM places_lookup_cache
       WHERE normalized_address = ?`
    )
    .bind(normalizedAddress)
    .first<RawPlacesLookupCacheRow>()

  if (!row) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) return null

  return {
    normalized_address: row.normalized_address,
    business_name: row.business_name,
    place_id: row.place_id,
    formatted_address: row.formatted_address,
    area: row.area,
    phone: row.phone,
    website: row.website,
    business_status: row.business_status,
    types: parseStringArray(row.types_json),
    response: parseJsonObject(row.response_json),
    expires_at: row.expires_at,
  }
}

export async function upsertPlacesLookupCache(
  db: D1Database,
  entry: PlacesLookupCacheEntry
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO places_lookup_cache (
        id, normalized_address, business_name, place_id, formatted_address,
        area, phone, website, business_status, types_json, response_json,
        expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_address) DO UPDATE SET
        business_name = excluded.business_name,
        place_id = excluded.place_id,
        formatted_address = excluded.formatted_address,
        area = excluded.area,
        phone = excluded.phone,
        website = excluded.website,
        business_status = excluded.business_status,
        types_json = excluded.types_json,
        response_json = excluded.response_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`
    )
    .bind(
      crypto.randomUUID(),
      entry.normalized_address,
      entry.business_name,
      entry.place_id,
      entry.formatted_address,
      entry.area,
      entry.phone,
      entry.website,
      entry.business_status,
      entry.types ? JSON.stringify(entry.types) : null,
      entry.response ? JSON.stringify(entry.response) : null,
      entry.expires_at,
      now,
      now
    )
    .run()
}
