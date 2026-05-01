import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

describe('parking-lot: data access layer', () => {
  const source = () => readFileSync(resolve('src/lib/db/parking-lot.ts'), 'utf-8')

  it('parking-lot.ts exists', () => {
    expect(existsSync(resolve('src/lib/db/parking-lot.ts'))).toBe(true)
  })

  it('exports listParkingLot function', () => {
    expect(source()).toContain('export async function listParkingLot')
  })

  it('exports getParkingLotItem function', () => {
    expect(source()).toContain('export async function getParkingLotItem')
  })

  it('exports createParkingLotItem function', () => {
    expect(source()).toContain('export async function createParkingLotItem')
  })

  it('exports dispositionParkingLotItem function', () => {
    expect(source()).toContain('export async function dispositionParkingLotItem')
  })

  it('exports deleteParkingLotItem function', () => {
    expect(source()).toContain('export async function deleteParkingLotItem')
  })

  it('exports Disposition type with three valid values', () => {
    const code = source()
    expect(code).toContain('export type Disposition')
    expect(code).toContain("'fold_in'")
    expect(code).toContain("'follow_on'")
    expect(code).toContain("'dropped'")
  })

  it('exports DISPOSITIONS constant for endpoint validation', () => {
    expect(source()).toContain('export const DISPOSITIONS')
  })

  it('uses parameterized queries (no string interpolation in SQL)', () => {
    const code = source()
    expect(code).toContain('.bind(')
    expect(code).not.toMatch(/prepare\(`[^`]*\$\{/)
  })

  it('generates UUIDs for primary keys', () => {
    expect(source()).toContain('crypto.randomUUID()')
  })

  it('orders parking lot items by created_at ASC (oldest first)', () => {
    expect(source()).toContain('ORDER BY pl.created_at ASC')
  })

  it('listParkingLot enforces org scoping via JOIN through engagements', () => {
    // parking_lot has no org_id column; all reads must JOIN engagements
    // and filter on engagements.org_id to prevent cross-tenant leaks.
    const code = source()
    expect(code).toContain('INNER JOIN engagements')
    expect(code).toContain('e.org_id = ?')
  })

  it('getParkingLotItem returns null for cross-org items (no enumeration leak)', () => {
    const code = source()
    expect(code).toMatch(/getParkingLotItem[\s\S]*INNER JOIN engagements/)
    expect(code).toContain('return result ?? null')
  })

  it('createParkingLotItem inserts only the four schema-required write fields', () => {
    const code = source()
    expect(code).toContain('INSERT INTO parking_lot')
    expect(code).toContain('id, engagement_id, description, requested_by')
  })

  it('dispositionParkingLotItem stamps reviewed_at on update', () => {
    const code = source()
    expect(code).toContain('UPDATE parking_lot')
    expect(code).toContain('reviewed_at')
    expect(code).toContain('new Date().toISOString()')
  })

  it('dispositionParkingLotItem returns null for cross-org items', () => {
    // Pre-checks via getParkingLotItem (org-scoped); returns null if not found.
    const code = source()
    expect(code).toMatch(/dispositionParkingLotItem[\s\S]*getParkingLotItem/)
    expect(code).toMatch(/if \(!existing\)[\s\S]*return null/)
  })

  it('deleteParkingLotItem refuses to delete dispositioned items', () => {
    const code = source()
    expect(code).toMatch(
      /deleteParkingLotItem[\s\S]*disposition !== null[\s\S]*return 'dispositioned'/
    )
  })

  it('deleteParkingLotItem returns not_found for cross-org items', () => {
    const code = source()
    expect(code).toMatch(/deleteParkingLotItem[\s\S]*getParkingLotItem[\s\S]*return 'not_found'/)
  })
})

describe('parking-lot: API endpoint', () => {
  const source = () =>
    readFileSync(resolve('src/pages/api/admin/engagements/[id]/parking-lot.ts'), 'utf-8')

  it('endpoint file exists', () => {
    expect(existsSync(resolve('src/pages/api/admin/engagements/[id]/parking-lot.ts'))).toBe(true)
  })

  it('rejects non-admin sessions with 401', () => {
    const code = source()
    expect(code).toContain("session.role !== 'admin'")
    expect(code).toContain('status: 401')
  })

  it('validates engagement ownership via getEngagement', () => {
    const code = source()
    expect(code).toContain('getEngagement(env.DB, session.orgId, engagementId)')
  })

  it('redirects unknown/cross-org engagements to /admin/entities?error=not_found', () => {
    const code = source()
    expect(code).toContain("'/admin/entities?error=not_found'")
  })

  it('dispatches on _method=DELETE, action=disposition, and default=create', () => {
    const code = source()
    expect(code).toContain("method === 'DELETE'")
    expect(code).toContain("action === 'disposition'")
  })

  it('requires non-empty disposition_note (Decision #11 demands rationale)', () => {
    const code = source()
    expect(code).toContain('error=missing_note')
    expect(code).toMatch(/!note\.trim\(\)/)
  })

  it('validates disposition value against DISPOSITIONS constant', () => {
    const code = source()
    expect(code).toContain('DISPOSITIONS.includes')
    expect(code).toContain('error=invalid_disposition')
  })

  it('blocks delete of dispositioned items with explicit error code', () => {
    const code = source()
    expect(code).toContain('error=cannot_delete_dispositioned')
  })

  it('appends a context audit entry on every mutation (create/disposition/delete)', () => {
    const code = source()
    // appendContext should appear three times: once per mutation path.
    const matches = code.match(/appendContext\(env\.DB/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  it('audit entries use type=parking_lot and engagement_id for timeline filtering', () => {
    const code = source()
    expect(code).toContain("type: 'parking_lot'")
    expect(code).toContain('engagement_id: engagementId')
  })

  it('audit source_refs are namespaced parking_lot:<id>:<action>', () => {
    const code = source()
    expect(code).toMatch(/parking_lot:\$\{[^}]+\}:created/)
    expect(code).toMatch(/parking_lot:\$\{[^}]+\}:dispositioned/)
    expect(code).toMatch(/parking_lot:\$\{[^}]+\}:deleted/)
  })

  it('emits success flash params parking_lot_added/dispositioned/deleted', () => {
    const code = source()
    expect(code).toContain('parking_lot_added=1')
    expect(code).toContain('parking_lot_dispositioned=1')
    expect(code).toContain('parking_lot_deleted=1')
  })

  it('rejects items belonging to a different engagement under the same org', () => {
    // Defense-in-depth: even within an org, an item_id must belong to the
    // URL-path engagement, not a sibling engagement.
    const code = source()
    expect(code).toContain('item.engagement_id !== engagementId')
  })
})

describe('parking-lot: engagement detail page wiring', () => {
  it('engagement-detail-page.ts loads parking lot data', () => {
    const code = readFileSync(resolve('src/lib/admin/engagement-detail-page.ts'), 'utf-8')
    expect(code).toContain("import { listParkingLot } from '../db/parking-lot'")
    expect(code).toContain('listParkingLot(params.db, params.orgId, params.engagementId)')
    expect(code).toContain('parkingLotAdded')
    expect(code).toContain('parkingLotDispositioned')
    expect(code).toContain('parkingLotDeleted')
  })

  it('engagement detail page mounts the parking lot panel component', () => {
    const code = readFileSync(resolve('src/pages/admin/engagements/[id].astro'), 'utf-8')
    expect(code).toContain('EngagementParkingLotPanel')
    expect(code).toContain('parkingLot={parkingLot}')
  })

  it('parking lot panel component exists and renders the list + add form', () => {
    const path = 'src/components/admin/EngagementParkingLotPanel.astro'
    expect(existsSync(resolve(path))).toBe(true)
    const code = readFileSync(resolve(path), 'utf-8')
    expect(code).toContain('Parking Lot')
    expect(code).toContain('parkingLot.map')
    expect(code).toContain('parking-lot') // form action url
    expect(code).toContain('+ Log parking lot item')
  })
})

describe('parking-lot: status badge tones', () => {
  it('status-badge.ts defines tones for fold_in, follow_on, dropped', () => {
    const code = readFileSync(resolve('src/lib/ui/status-badge.ts'), 'utf-8')
    expect(code).toContain('fold_in:')
    expect(code).toContain('follow_on:')
    expect(code).toContain('dropped:')
  })
})
