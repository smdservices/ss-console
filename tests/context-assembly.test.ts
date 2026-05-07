import { describe, it, expect } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'

import { createEntity } from '../src/lib/db/entities'
import { appendContext, assembleEntityContext } from '../src/lib/db/context'
import { ORG_ID } from '../src/lib/constants'

const migrationsDir = resolve(process.cwd(), 'migrations')

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

describe('assembleEntityContext', () => {
  it('excludes non-authoritative model summaries by default', async () => {
    const db = await freshDb()
    const entity = await createEntity(db, ORG_ID, {
      name: 'Assembly Test Co',
      area: 'Phoenix',
      source_pipeline: 'test',
    })

    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'signal',
      content: 'Signal: repeated complaints about schedule delays.',
      source: 'test_signal',
    })
    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'enrichment',
      content: 'Legacy intelligence brief that should not feed later prompts.',
      source: 'intelligence_brief',
    })
    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'enrichment',
      content: 'Model summary that should stay out of downstream prompts.',
      source: 'custom_summary',
      metadata: {
        context_authority: 'non_authoritative',
        evidence_mode: 'model_summary',
      },
    })
    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'enrichment',
      content: 'Deep website analysis:\nServices: Water heater repair\nEmail: owner@example.com',
      source: 'deep_website',
      metadata: {
        context_authority: 'authoritative',
        evidence_mode: 'extractive',
      },
    })

    const assembled = await assembleEntityContext(db, entity.id)

    expect(assembled).toContain('Signal: repeated complaints about schedule delays.')
    expect(assembled).toContain('Services: Water heater repair')
    expect(assembled).not.toContain('Legacy intelligence brief')
    expect(assembled).not.toContain('Model summary that should stay out')
  })

  it('can include non-authoritative summaries when explicitly requested', async () => {
    const db = await freshDb()
    const entity = await createEntity(db, ORG_ID, {
      name: 'Assembly Opt In Co',
      area: 'Phoenix',
      source_pipeline: 'test',
    })

    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'signal',
      content: 'Signal: owner replies to multiple review complaints.',
      source: 'test_signal',
    })
    await appendContext(db, ORG_ID, {
      entity_id: entity.id,
      type: 'enrichment',
      content: 'Review synthesis: likely manual dispatch bottleneck.',
      source: 'review_synthesis',
      metadata: {
        context_authority: 'non_authoritative',
        evidence_mode: 'model_summary',
      },
    })

    const assembled = await assembleEntityContext(db, entity.id, {
      includeNonAuthoritative: true,
    })

    expect(assembled).toContain('Signal: owner replies to multiple review complaints.')
    expect(assembled).toContain('Review synthesis: likely manual dispatch bottleneck.')
  })
})
