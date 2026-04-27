/**
 * Integration tests for the #612 orchestrator hardening:
 *
 *   1. A module that throws ends the scan in `scan_status='failed'` with
 *      `<module>: <message>` in `scan_status_reason`. The pipeline stops
 *      — no subsequent modules run with corrupt context.
 *
 *   2. A wrong-match Places result (Places returned a different
 *      business's website) trips the strict domain-match guard, leaves
 *      the entity row unpolluted, and the thin-footprint gate sets
 *      `scan_status='thin_footprint'` with reason
 *      'no_strict_places_match'.
 *
 * We hoist `vi.mock(...)` for the enrichment modules and the admin-alert
 * sender so the test does not hit live Anthropic / Resend / Google APIs.
 * Each test then uses the harness D1 to assert the on-disk state the
 * orchestrator persists.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'

// Hoisted mocks: vitest evaluates these before module bodies, so the
// orchestrator imports the mocked versions when it runs.
vi.mock('../src/lib/enrichment/google-places', () => ({
  lookupGooglePlaces: vi.fn(),
}))
vi.mock('../src/lib/enrichment/outscraper', () => ({
  lookupOutscraper: vi.fn(),
}))
vi.mock('../src/lib/enrichment/website-analyzer', () => ({
  analyzeWebsite: vi.fn(),
}))
vi.mock('../src/lib/enrichment/review-synthesis', () => ({
  synthesizeReviews: vi.fn(),
}))
vi.mock('../src/lib/enrichment/deep-website', () => ({
  deepWebsiteAnalysis: vi.fn(),
}))
vi.mock('../src/lib/enrichment/dossier', () => ({
  generateDossier: vi.fn(),
}))
vi.mock('../src/lib/email/resend', () => ({
  sendOutreachEmail: vi.fn().mockResolvedValue({ success: true, id: 'mock' }),
}))
vi.mock('../src/lib/diagnostic/admin-alert', () => ({
  sendScanFailureAlert: vi.fn().mockResolvedValue(true),
}))

import { lookupGooglePlaces } from '../src/lib/enrichment/google-places'
import { lookupOutscraper } from '../src/lib/enrichment/outscraper'
import { analyzeWebsite } from '../src/lib/enrichment/website-analyzer'
import { synthesizeReviews } from '../src/lib/enrichment/review-synthesis'
import { sendScanFailureAlert } from '../src/lib/diagnostic/admin-alert'
import { runDiagnosticScan } from '../src/lib/diagnostic'
import { createScanRequest, getScanRequest, markScanVerified } from '../src/lib/db/scan-requests'
import { listContext } from '../src/lib/db/context'
import { generateScanToken } from '../src/lib/scan/tokens'

const migrationsDir = resolve(process.cwd(), 'migrations')

async function freshDb(): Promise<D1Database> {
  const db = createTestD1() as unknown as D1Database
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  // The SMD Services org row (id = ORG_ID) is created by migration 0003,
  // so we don't insert it again here. The runDiagnosticScan code path
  // uses the production ORG_ID constant directly.
  return db
}

async function seedScan(
  db: D1Database,
  domain: string,
  email = 'prospect@example.com'
): Promise<string> {
  const { hash } = await generateScanToken()
  const row = await createScanRequest(db, {
    email,
    domain,
    verification_token_hash: hash,
    request_ip: '1.1.1.1',
  })
  await markScanVerified(db, row.id)
  return row.id
}

describe('runDiagnosticScan — orchestrator error handling (#612)', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
    vi.clearAllMocks()
  })

  it('marks scan_status=failed with module + message when a module throws', async () => {
    const submitted = 'venturecrane.com'
    const id = await seedScan(db, submitted)

    // google_places passes (returns a strict match), outscraper throws.
    vi.mocked(lookupGooglePlaces).mockResolvedValue({
      phone: '+1 555 0001',
      website: `https://${submitted}`,
      rating: 4.5,
      reviewCount: 25,
      businessStatus: 'OPERATIONAL',
      address: '123 Main St, Phoenix, AZ',
    })
    vi.mocked(lookupOutscraper).mockRejectedValue(new Error('503 Service Unavailable'))

    const result = await runDiagnosticScan(
      {
        DB: db,
        GOOGLE_PLACES_API_KEY: 'test',
        OUTSCRAPER_API_KEY: 'test',
        ANTHROPIC_API_KEY: 'test',
      },
      id
    )

    expect(result.status).toBe('failed')
    expect(result.failed_module).toBe('outscraper')
    expect(result.error).toContain('503 Service Unavailable')

    const row = await getScanRequest(db, id)
    expect(row?.scan_status).toBe('failed')
    expect(row?.scan_status_reason).toContain('outscraper')
    expect(row?.scan_status_reason).toContain('503')
    expect(row?.scan_completed_at).toBeTruthy()
    expect(row?.email_sent_at).toBeNull()

    // Subsequent modules MUST NOT have run — no website_analysis context row
    const enrichments = await listContext(db, row!.entity_id!, { type: 'enrichment' })
    const sources = enrichments.map((e) => e.source)
    expect(sources).not.toContain('website_analysis')
    expect(sources).not.toContain('deep_website')
    expect(sources).not.toContain('intelligence_brief')

    // Admin alert was fired
    expect(vi.mocked(sendScanFailureAlert)).toHaveBeenCalledTimes(1)
    const alertArg = vi.mocked(sendScanFailureAlert).mock.calls[0][1]
    expect(alertArg.failingModule).toBe('outscraper')
    expect(alertArg.submittedDomain).toBe(submitted)
  })

  it('records orchestrator failures with failed_module=orchestrator', async () => {
    const id = await seedScan(db, 'biz.com')

    // Mocking lookupGooglePlaces to bypass the wrapper but cause a downstream
    // failure: throw inside synthesizeReviews. The wrapper rethrows as a
    // ScanModuleError, the top-level catches it and tags failed_module.
    vi.mocked(lookupGooglePlaces).mockResolvedValue({
      phone: '+1 555 0001',
      website: 'https://biz.com',
      rating: 4.0,
      reviewCount: 12,
      businessStatus: 'OPERATIONAL',
      address: 'Phoenix, AZ',
    })
    vi.mocked(lookupOutscraper).mockResolvedValue({
      phone: '+1 555 0001',
      website: 'https://biz.com',
      rating: 4.0,
      review_count: 12,
      verified: true,
    } as unknown as Awaited<ReturnType<typeof lookupOutscraper>>)
    vi.mocked(analyzeWebsite).mockResolvedValue(null)
    vi.mocked(synthesizeReviews).mockRejectedValue(new Error('anthropic 429 rate-limited'))

    const result = await runDiagnosticScan(
      {
        DB: db,
        GOOGLE_PLACES_API_KEY: 'test',
        OUTSCRAPER_API_KEY: 'test',
        ANTHROPIC_API_KEY: 'test',
      },
      id
    )

    expect(result.status).toBe('failed')
    expect(result.failed_module).toBe('review_synthesis')
    const row = await getScanRequest(db, id)
    expect(row?.scan_status).toBe('failed')
    expect(row?.scan_status_reason).toContain('review_synthesis')
    expect(row?.scan_status_reason).toContain('429')

    // deep_website must NOT have run
    const enrichments = await listContext(db, row!.entity_id!, { type: 'enrichment' })
    const sources = enrichments.map((e) => e.source)
    expect(sources).not.toContain('deep_website')
    expect(sources).not.toContain('intelligence_brief')
  })
})

describe('runDiagnosticScan — wrong-match guard (#612)', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
    vi.clearAllMocks()
  })

  it("trips thin-footprint with reason='no_strict_places_match' when Places returns a different business", async () => {
    // The exact bug exemplar from 2026-04-27. Submitter wanted a scan of
    // venturecrane.com; Google Places fuzzy-matched to Sunrise Crane.
    const submitted = 'venturecrane.com'
    const id = await seedScan(db, submitted)

    vi.mocked(lookupGooglePlaces).mockResolvedValue({
      phone: '(623) 825-5362',
      website: 'https://sunrisecrane.com/',
      rating: 4.7,
      reviewCount: 40,
      businessStatus: 'OPERATIONAL',
      address: 'Phoenix, AZ',
    })

    const result = await runDiagnosticScan(
      {
        DB: db,
        GOOGLE_PLACES_API_KEY: 'test',
        // No OUTSCRAPER / ANTHROPIC keys — Places-only run still trips the
        // gate because the strict-match guard is the dominant signal.
      },
      id
    )

    expect(result.status).toBe('thin_footprint')
    expect(result.thin_footprint_skipped).toBe(true)

    const row = await getScanRequest(db, id)
    expect(row?.scan_status).toBe('thin_footprint')
    expect(row?.thin_footprint_skipped).toBe(1)
    expect(row?.scan_status_reason).toBe('no_strict_places_match')

    // The wrong-business contact data MUST NOT have polluted the entity row.
    // The orchestrator created the entity with website='https://venturecrane.com'
    // and the strict-match guard prevented Places from overwriting that or
    // the phone with sunrisecrane.com data.
    const entityId = row!.entity_id!
    const entity = await db
      .prepare('SELECT phone, website FROM entities WHERE id = ?')
      .bind(entityId)
      .first<{ phone: string | null; website: string | null }>()
    expect(entity?.website).toBe('https://venturecrane.com')
    expect(entity?.phone).toBeNull()

    // No Places enrichment row was written — guard rejected it before persistence.
    const enrichments = await listContext(db, entityId, { type: 'enrichment' })
    const sources = enrichments.map((e) => e.source)
    expect(sources).not.toContain('google_places')
    expect(sources).not.toContain('outscraper')
    expect(sources).not.toContain('website_analysis')
    expect(sources).not.toContain('deep_website')
  })

  it('proceeds normally when Places returns a strict-match result', async () => {
    const submitted = 'realbiz.com'
    const id = await seedScan(db, submitted)

    vi.mocked(lookupGooglePlaces).mockResolvedValue({
      phone: '+1 555 0123',
      website: `https://${submitted}/`,
      rating: 4.6,
      reviewCount: 33,
      businessStatus: 'OPERATIONAL',
      address: 'Phoenix, AZ',
    })
    // Anthropic key absent → website_analysis / review_synthesis /
    // deep_website / intelligence_brief all return early (soft no-result).
    // The scan completes with whatever signals we have.

    const result = await runDiagnosticScan(
      {
        DB: db,
        GOOGLE_PLACES_API_KEY: 'test',
      },
      id
    )

    expect(result.status).toBe('completed')
    expect(result.modules_ran).toContain('google_places')
    expect(result.thin_footprint_skipped).toBe(false)

    const row = await getScanRequest(db, id)
    expect(row?.scan_status).toBe('completed')

    // Places enrichment row WAS persisted because the guard accepted it.
    const enrichments = await listContext(db, row!.entity_id!, { type: 'enrichment' })
    const sources = enrichments.map((e) => e.source)
    expect(sources).toContain('google_places')
  })

  it('treats Places result with multi-level subdomain website as no match', async () => {
    const submitted = 'acme-plumbing.com'
    const id = await seedScan(db, submitted)

    vi.mocked(lookupGooglePlaces).mockResolvedValue({
      phone: '+1 555 0123',
      website: `https://scan.${submitted}/`,
      rating: 4.6,
      reviewCount: 33,
      businessStatus: 'OPERATIONAL',
      address: 'Phoenix, AZ',
    })

    const result = await runDiagnosticScan(
      {
        DB: db,
        GOOGLE_PLACES_API_KEY: 'test',
      },
      id
    )

    expect(result.status).toBe('thin_footprint')
    const row = await getScanRequest(db, id)
    expect(row?.scan_status_reason).toBe('no_strict_places_match')
  })
})
