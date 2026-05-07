/**
 * Unit tests for the synthetic-sent-row dedup path in `recordEvent`
 * (PR-2b in the Outside View ship plan).
 *
 * Background: Cloudflare Workflows step-result caching can replay a
 * `step.do(...)` callback on retry, even if the previous attempt
 * completed its side effects. The render-and-email step records a
 * synthetic 'sent' row in `outreach_events` keyed on the Resend
 * `message_id`. On 2026-05-01 production showed three duplicate `sent`
 * rows for one Resend send (same `message_id`), traced to a workflow
 * retry that re-ran the entire step body. PR-2b adds a dedup layer in
 * `recordEvent` itself so any future caller — workflow step retry,
 * manual operator script, etc. — collapses repeat synthetic 'sent'
 * inserts to a single row.
 *
 * The webhook dedup path (provider_event_id non-null) is unchanged and
 * tested by `tests/resend-webhook.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { recordEvent } from '../src/lib/db/outreach-events'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ORG_ID = 'org-dedup-test'
const ENTITY_ID = 'ent-dedup-test'

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })

  // Seed FK targets so outreach_events INSERTs satisfy any FK references.
  // organizations requires NOT NULL UNIQUE slug.
  await db
    .prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)`)
    .bind(ORG_ID, 'Dedup Test Org', 'dedup-test-org')
    .run()
  await db
    .prepare(`INSERT INTO entities (id, org_id, name, slug, area) VALUES (?, ?, ?, ?, ?)`)
    .bind(ENTITY_ID, ORG_ID, 'Dedup Test Entity', 'dedup-test-entity', 'Phoenix, AZ')
    .run()
  return db
}

describe('recordEvent — synthetic sent dedup (PR-2b)', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
  })

  it('dedupes two synthetic sent rows on the same (org_id, message_id)', async () => {
    const messageId = 'resend-msg-aaaaaa'

    const first = await recordEvent(db, {
      org_id: ORG_ID,
      entity_id: ENTITY_ID,
      event_type: 'sent',
      message_id: messageId,
      provider_event_id: null,
      payload: { recorded_by: 'send-wrapper' },
    })
    expect(first.inserted).toBe(true)

    const second = await recordEvent(db, {
      org_id: ORG_ID,
      entity_id: ENTITY_ID,
      event_type: 'sent',
      message_id: messageId,
      provider_event_id: null,
      payload: { recorded_by: 'send-wrapper' },
    })
    expect(second.inserted).toBe(false)
    expect(second.id).toBe(first.id)

    // Database has exactly one row for this message_id.
    const rows = await db
      .prepare(
        `SELECT id FROM outreach_events
         WHERE org_id = ? AND message_id = ? AND event_type = 'sent'`
      )
      .bind(ORG_ID, messageId)
      .all()
    expect(rows.results).toHaveLength(1)
  })

  it('inserts a fresh row when message_id differs', async () => {
    const a = await recordEvent(db, {
      org_id: ORG_ID,
      entity_id: ENTITY_ID,
      event_type: 'sent',
      message_id: 'resend-msg-aaaa',
    })
    const b = await recordEvent(db, {
      org_id: ORG_ID,
      entity_id: ENTITY_ID,
      event_type: 'sent',
      message_id: 'resend-msg-bbbb',
    })
    expect(a.inserted).toBe(true)
    expect(b.inserted).toBe(true)
    expect(a.id).not.toBe(b.id)
  })

  it('inserts a fresh row when org_id differs (cross-tenant safety)', async () => {
    // Seed a second org for the cross-tenant assertion.
    const otherOrg = 'org-dedup-test-other'
    const otherEntity = 'ent-dedup-test-other'
    await db
      .prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)`)
      .bind(otherOrg, 'Other Org', 'dedup-test-other-org')
      .run()
    await db
      .prepare(`INSERT INTO entities (id, org_id, name, slug, area) VALUES (?, ?, ?, ?, ?)`)
      .bind(otherEntity, otherOrg, 'Other Entity', 'dedup-test-other-entity', 'Phoenix, AZ')
      .run()

    const messageId = 'resend-msg-shared-id'

    const a = await recordEvent(db, {
      org_id: ORG_ID,
      entity_id: ENTITY_ID,
      event_type: 'sent',
      message_id: messageId,
    })
    // Same message_id but different org — must insert (no cross-org dedup).
    const b = await recordEvent(db, {
      org_id: otherOrg,
      entity_id: otherEntity,
      event_type: 'sent',
      message_id: messageId,
    })
    expect(a.inserted).toBe(true)
    expect(b.inserted).toBe(true)
    expect(a.id).not.toBe(b.id)
  })

  it('does NOT dedup non-sent event types with the same message_id', async () => {
    const messageId = 'resend-msg-cccc'

    // First a synthetic 'sent' row, then an 'open' row from a webhook.
    // The webhook open row carries a provider_event_id; it should insert
    // and NOT collide with the sent row's dedup key.
    await recordEvent(db, {
      org_id: ORG_ID,
      entity_id: ENTITY_ID,
      event_type: 'sent',
      message_id: messageId,
    })
    const openEvent = await recordEvent(db, {
      org_id: ORG_ID,
      entity_id: ENTITY_ID,
      event_type: 'open',
      message_id: messageId,
      provider_event_id: 'svix-envelope-1',
    })
    expect(openEvent.inserted).toBe(true)
  })

  it('still dedupes via provider_event_id when both keys are present', async () => {
    // Webhook delivery carries provider_event_id. Path 1 should fire and
    // return inserted: false on the second call, regardless of message_id
    // matching.
    const providerId = 'svix-envelope-shared'
    const a = await recordEvent(db, {
      org_id: ORG_ID,
      entity_id: ENTITY_ID,
      event_type: 'open',
      message_id: 'resend-msg-x',
      provider_event_id: providerId,
    })
    const b = await recordEvent(db, {
      org_id: ORG_ID,
      entity_id: ENTITY_ID,
      event_type: 'open',
      message_id: 'resend-msg-y', // different message_id — irrelevant
      provider_event_id: providerId,
    })
    expect(a.inserted).toBe(true)
    expect(b.inserted).toBe(false)
    expect(b.id).toBe(a.id)
  })
})
