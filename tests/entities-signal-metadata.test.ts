/**
 * Tests for getSignalMetadataForEntities — the helper that hydrates the
 * Signal list rows with pipeline-generated evidence (top_problems,
 * signal evidence, enrichment summary, last_activity_at).
 *
 * Uses @venturecrane/crane-test-harness for in-memory D1 with the real
 * migration schema so metadata JSON and context-table joins exercise the
 * same SQL as production.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'

import { createEntity, getSignalMetadataForEntities } from '../src/lib/db/entities'
import { appendContext } from '../src/lib/db/context'

const migrationsDir = resolve(process.cwd(), 'migrations')
const ORG_ID = 'org-test'

describe('getSignalMetadataForEntities', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await db
      .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(ORG_ID, 'Test Org', 'test-org')
      .run()
  })

  it('returns empty map when no entity ids are passed', async () => {
    const result = await getSignalMetadataForEntities(db, ORG_ID, [])
    expect(result.size).toBe(0)
  })

  it('extracts top_problems and signal evidence fields from latest signal metadata', async () => {
    const entity = await createEntity(db, ORG_ID, {
      name: 'Acme HVAC',
      source_pipeline: 'review_mining',
    })

    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'signal',
      content: 'Initial signal',
      source: 'review_mining',
      metadata: {
        pain_score: 7,
        top_problems: ['customer_pipeline', 'process_design'],
        signal_source_label: 'Google reviews',
        signal_subject: 'HVAC contractor',
        signal_location: 'Phoenix, AZ',
        signal_date: '2026-05-07',
      },
    })

    const result = await getSignalMetadataForEntities(db, ORG_ID, [entity.id])
    const meta = result.get(entity.id)
    expect(meta).toBeDefined()
    expect(meta!.top_problems).toEqual(['customer_pipeline', 'process_design'])
    expect(meta!.signal_source_label).toBe('Google reviews')
    expect(meta!.signal_subject).toBe('HVAC contractor')
    expect(meta!.signal_location).toBe('Phoenix, AZ')
    expect(meta!.signal_date).toBe('2026-05-07')
    expect(meta!.last_activity_at).toBeTruthy()
  })

  it('returns the most recent signal when multiple exist', async () => {
    const entity = await createEntity(db, ORG_ID, { name: 'Multi Signal Biz' })

    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'signal',
      content: 'Older',
      source: 'review_mining',
      metadata: {
        top_problems: ['tool_systems'],
        signal_source_label: 'Google reviews',
        signal_subject: 'Old subject',
      },
    })
    // Ensure created_at ordering by small delay
    await new Promise((r) => setTimeout(r, 10))
    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'signal',
      content: 'Newer',
      source: 'job_monitor',
      metadata: {
        top_problems: ['team_operations'],
        signal_source_label: 'Job posting',
        signal_subject: 'Operations Manager',
      },
    })

    const result = await getSignalMetadataForEntities(db, ORG_ID, [entity.id])
    const meta = result.get(entity.id)
    expect(meta!.top_problems).toEqual(['team_operations'])
    expect(meta!.signal_source_label).toBe('Job posting')
    expect(meta!.signal_subject).toBe('Operations Manager')
  })

  it('returns null fields when metadata is absent or malformed', async () => {
    const entity = await createEntity(db, ORG_ID, { name: 'No Metadata Biz' })

    // Signal entry with no structured fields
    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'signal',
      content: 'Raw signal',
      source: 'review_mining',
      metadata: { pain_score: 5 },
    })

    const result = await getSignalMetadataForEntities(db, ORG_ID, [entity.id])
    const meta = result.get(entity.id)
    expect(meta!.top_problems).toBeNull()
    expect(meta!.signal_source_label).toBeNull()
    expect(meta!.signal_subject).toBeNull()
    expect(meta!.last_activity_at).toBeTruthy()
  })

  it('returns last_activity_at even when entity has only a non-signal context entry', async () => {
    const entity = await createEntity(db, ORG_ID, { name: 'Note Only Biz' })

    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'note',
      content: 'Made a note',
      source: 'admin',
    })

    const result = await getSignalMetadataForEntities(db, ORG_ID, [entity.id])
    const meta = result.get(entity.id)
    expect(meta).toBeDefined()
    expect(meta!.top_problems).toBeNull()
    expect(meta!.signal_source_label).toBeNull()
    expect(meta!.signal_subject).toBeNull()
    expect(meta!.last_activity_at).toBeTruthy()
  })

  it('hydrates enrichment_summary from the latest enrichment entry', async () => {
    const entity = await createEntity(db, ORG_ID, { name: 'Summary Biz' })

    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'enrichment',
      content: 'Google Places: Phone: 602-555-0100. Website: https://example.com.',
      source: 'google_places',
    })

    const result = await getSignalMetadataForEntities(db, ORG_ID, [entity.id])
    expect(result.get(entity.id)?.enrichment_summary).toBe('Google Places: Phone: 602-555-0100.')
  })

  it('ignores empty top_problems arrays (renders nothing)', async () => {
    const entity = await createEntity(db, ORG_ID, { name: 'Empty Array Biz' })

    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'signal',
      content: 'No problems detected',
      source: 'review_mining',
      metadata: { top_problems: [], signal_source_label: '' },
    })

    const result = await getSignalMetadataForEntities(db, ORG_ID, [entity.id])
    const meta = result.get(entity.id)
    expect(meta!.top_problems).toBeNull()
    expect(meta!.signal_source_label).toBeNull()
  })

  it('scopes by org_id — does not leak metadata across orgs', async () => {
    const OTHER_ORG = 'org-other'
    await db
      .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(OTHER_ORG, 'Other Org', 'other-org')
      .run()

    const myEntity = await createEntity(db, ORG_ID, { name: 'Mine' })
    const theirEntity = await createEntity(db, OTHER_ORG, { name: 'Theirs' })

    await appendContext(db, OTHER_ORG, {
      entity_id: theirEntity.id,
      type: 'signal',
      content: 'cross-org leak test',
      source: 'review_mining',
      metadata: { top_problems: ['team_operations'], signal_source_label: 'leaked' },
    })

    const result = await getSignalMetadataForEntities(db, ORG_ID, [myEntity.id, theirEntity.id])
    // theirEntity lives in the other org; scoping to ORG_ID must not surface it
    expect(result.get(theirEntity.id)).toBeUndefined()
  })
})
