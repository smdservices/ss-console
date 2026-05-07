/**
 * Integration test for POST /api/admin/entities/[id]/send-booking-link (#467).
 *
 * Verifies the acceptance criteria end-to-end:
 *   - Button behavior matches the label: the endpoint creates a scheduled
 *     meeting row plus its legacy assessment mirror and signs a booking URL.
 *     It does NOT perform a bare stage transition.
 *   - Signed URL has a TTL (14 days default).
 *   - Meeting row is created in status `scheduled` at click time, with
 *     `scheduled_at` null (prospect hasn't picked a slot yet).
 *   - Stage transitions to `meetings` only after the meeting row exists.
 *   - Auth: non-admin sessions are rejected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { POST } from '../../src/pages/api/admin/entities/[id]/send-booking-link'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { env as testEnv } from 'cloudflare:workers'
import { verifyBookingLink, DEFAULT_BOOKING_LINK_TTL_DAYS } from '../../src/lib/booking/signed-link'

const migrationsDir = resolve(process.cwd(), 'migrations')
const TEST_SIGNING_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

const ORG_ID = 'org-test'
const ENTITY_ID = 'entity-test'
const ADMIN_ID = 'admin-test'

interface CallOptions {
  session: {
    userId: string
    orgId: string
    role: string
    email: string
    expiresAt: string
  } | null
  entityId: string
  body?: Record<string, unknown>
}

function buildContext(opts: CallOptions) {
  const request = new Request(
    `http://test.local/api/admin/entities/${opts.entityId}/send-booking-link`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.body ?? {}),
    }
  )
  return {
    request,
    params: { id: opts.entityId },
    locals: { session: opts.session },
    redirect: (url: string, status: number) =>
      new Response(null, { status, headers: { Location: url } }),
  }
}

const adminSession = {
  userId: ADMIN_ID,
  orgId: ORG_ID,
  role: 'admin',
  email: 'admin@example.com',
  expiresAt: '2099-01-01T00:00:00Z',
}

describe('POST /api/admin/entities/[id]/send-booking-link (#467)', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })

    await db
      .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(ORG_ID, 'Org Test', 'org-test')
      .run()

    await db
      .prepare(
        `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at)
         VALUES (?, ?, ?, ?, 'prospect', datetime('now'))`
      )
      .bind(ENTITY_ID, ORG_ID, 'Phoenix Plumbing Co.', 'phoenix-plumbing-co')
      .run()

    await db
      .prepare(
        `INSERT INTO contacts (id, org_id, entity_id, name, email)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind('contact-1', ORG_ID, ENTITY_ID, 'Maria Garcia', 'maria@phoenixplumbing.example')
      .run()

    Object.assign(testEnv, {
      DB: db,
      BOOKING_ENCRYPTION_KEY: TEST_SIGNING_KEY,
      APP_BASE_URL: 'https://smd.services',
    })
  })

  afterEach(() => {
    for (const k of Object.keys(testEnv)) {
      delete (testEnv as unknown as Record<string, unknown>)[k]
    }
  })

  it('creates a scheduled assessment, transitions stage, and returns a signed URL', async () => {
    // No RESEND_API_KEY in this test → sendOutreachEmail takes the dev-mode
    // path that still records a synthetic 'sent' row. Email-status assertions
    // still verify the attribution wiring. send_email: false is used here so
    // this baseline test stays focused on the create/sign/transition path.
    const ctx = buildContext({
      session: adminSession,
      entityId: ENTITY_ID,
      body: { duration_minutes: 30, meeting_type: 'discovery', send_email: false },
    })

    const response = await POST(ctx as unknown as Parameters<typeof POST>[0])
    expect(response.status).toBe(200)

    const body: Record<string, unknown> = await response.json()
    expect(body.ok).toBe(true)
    expect(body.assessment_id).toMatch(/^[0-9a-f-]+$/)
    expect(body.meeting_id).toBe(body.assessment_id)
    expect(body.token_ttl_days).toBe(DEFAULT_BOOKING_LINK_TTL_DAYS)
    expect(body.contact_email).toBe('maria@phoenixplumbing.example')
    expect(body.booking_url).toMatch(/^https:\/\/smd\.services\/book\?t=/)
    expect(body.outreach_template).toContain(body.booking_url)
    expect(body.outreach_template).toContain('Maria')
    // No fabricated client content: the body must not promise specific
    // response times, name a consultant, or commit post-call behavior.
    // The signature is the brand name only.
    expect(body.outreach_template).not.toMatch(/\bScott\b/)
    expect(body.outreach_template).not.toMatch(/\b1 business day\b/i)
    expect(body.outreach_template).not.toMatch(/\bwithin .* hours?\b/i)
    expect(body.outreach_template).toContain('— SMD Services')
    expect(body.mailto_url).toMatch(/^mailto:/)
    expect(body.email_status).toBe('skipped_by_caller')

    // --- AC: legacy assessment row exists in scheduled status, no slot yet --
    const assessment = await db
      .prepare('SELECT * FROM assessments WHERE id = ?')
      .bind(body.assessment_id)
      .first<{ status: string; scheduled_at: string | null; entity_id: string; org_id: string }>()
    expect(assessment).not.toBeNull()
    expect(assessment!.status).toBe('scheduled')
    expect(assessment!.scheduled_at).toBeNull()
    expect(assessment!.entity_id).toBe(ENTITY_ID)
    expect(assessment!.org_id).toBe(ORG_ID)

    // --- AC: canonical meeting row exists too, using the same id -----------
    const meeting = await db
      .prepare(
        `SELECT id, status, scheduled_at, entity_id, org_id, meeting_type
         FROM meetings WHERE id = ?`
      )
      .bind(body.meeting_id)
      .first<{
        id: string
        status: string
        scheduled_at: string | null
        entity_id: string
        org_id: string
        meeting_type: string | null
      }>()
    expect(meeting).not.toBeNull()
    expect(meeting!.id).toBe(body.assessment_id)
    expect(meeting!.status).toBe('scheduled')
    expect(meeting!.scheduled_at).toBeNull()
    expect(meeting!.entity_id).toBe(ENTITY_ID)
    expect(meeting!.org_id).toBe(ORG_ID)
    expect(meeting!.meeting_type).toBe('discovery')

    // --- AC: entity transitioned to `meetings` -----------------------------
    const entity = await db
      .prepare('SELECT stage FROM entities WHERE id = ?')
      .bind(ENTITY_ID)
      .first<{ stage: string }>()
    expect(entity!.stage).toBe('meetings')

    // --- AC: signed URL is verifiable and carries the right payload ---------
    const token = new URL(body.booking_url as string).searchParams.get('t')
    expect(token).toBeTruthy()
    const verify = await verifyBookingLink(token!)
    expect(verify.ok).toBe(true)
    if (!verify.ok) return
    expect(verify.payload.entity_id).toBe(ENTITY_ID)
    expect(verify.payload.assessment_id).toBe(body.assessment_id)
    expect(verify.payload.contact_id).toBe('contact-1')
    expect(verify.payload.duration_minutes).toBe(30)
    expect(verify.payload.meeting_type).toBe('discovery')

    // --- AC: TTL is ~14 days from now --------------------------------------
    const now = Math.floor(Date.now() / 1000)
    const expected = now + DEFAULT_BOOKING_LINK_TTL_DAYS * 24 * 60 * 60
    expect(verify.payload.exp).toBeGreaterThanOrEqual(expected - 10)
    expect(verify.payload.exp).toBeLessThanOrEqual(expected + 10)

    // --- AC: context timeline gets an outreach_draft entry ------------------
    const contextRow = await db
      .prepare(
        `SELECT type, source, content FROM context
         WHERE entity_id = ? AND type = 'outreach_draft' AND source = 'send_booking_link'`
      )
      .bind(ENTITY_ID)
      .first<{ type: string; source: string; content: string }>()
    expect(contextRow).not.toBeNull()
    expect(contextRow!.content).toContain(body.booking_url)
  })

  it('rejects non-admin sessions with 401', async () => {
    const ctx = buildContext({
      session: { ...adminSession, role: 'client' },
      entityId: ENTITY_ID,
    })
    const response = await POST(ctx as unknown as Parameters<typeof POST>[0])
    expect(response.status).toBe(401)
  })

  it('rejects when session is absent', async () => {
    const ctx = buildContext({ session: null, entityId: ENTITY_ID })
    const response = await POST(ctx as unknown as Parameters<typeof POST>[0])
    expect(response.status).toBe(401)
  })

  it('returns 409 when entity is not in prospect stage', async () => {
    await db.prepare(`UPDATE entities SET stage = 'meetings' WHERE id = ?`).bind(ENTITY_ID).run()

    const ctx = buildContext({ session: adminSession, entityId: ENTITY_ID })
    const response = await POST(ctx as unknown as Parameters<typeof POST>[0])
    expect(response.status).toBe(409)
    const body: Record<string, unknown> = await response.json()
    expect(body.error).toBe('invalid_stage')

    // The guard ran before anything was mutated: no assessment was created.
    const count = await db
      .prepare(`SELECT COUNT(*) as c FROM assessments WHERE entity_id = ?`)
      .bind(ENTITY_ID)
      .first<{ c: number }>()
    expect(count!.c).toBe(0)
  })

  it('returns 404 when entity does not exist', async () => {
    const ctx = buildContext({ session: adminSession, entityId: 'nonexistent' })
    const response = await POST(ctx as unknown as Parameters<typeof POST>[0])
    expect(response.status).toBe(404)
  })

  it('defaults meeting_type/duration sensibly when omitted', async () => {
    // Use send_email: false so this stays a focused unit on parsing
    // defaults, not exercising the send pipeline.
    const ctx = buildContext({
      session: adminSession,
      entityId: ENTITY_ID,
      body: { send_email: false },
    })
    const response = await POST(ctx as unknown as Parameters<typeof POST>[0])
    expect(response.status).toBe(200)
    const body: Record<string, unknown> = await response.json()
    const token = new URL(body.booking_url as string).searchParams.get('t')
    const verify = await verifyBookingLink(token!)
    if (!verify.ok) throw new Error('expected ok')
    expect(verify.payload.duration_minutes).toBe(30) // BOOKING_CONFIG.slot_minutes default
    expect(verify.payload.meeting_type).toBeNull()
  })

  it('sends via sendOutreachEmail and records a sent row in outreach_events', async () => {
    // Default: send_email = true. No RESEND_API_KEY → resend.ts dev-mode
    // path returns success: true with id 'dev-mode'. The wrapper still
    // calls recordEvent, which writes a row to outreach_events attributed
    // to this entity. That is the funnel-attribution invariant we ship for
    // #587 / #467.
    const ctx = buildContext({
      session: adminSession,
      entityId: ENTITY_ID,
      body: { duration_minutes: 30, meeting_type: 'discovery' },
    })

    const response = await POST(ctx as unknown as Parameters<typeof POST>[0])
    expect(response.status).toBe(200)

    const body: Record<string, unknown> = await response.json()
    expect(body.ok).toBe(true)
    expect(body.email_status).toBe('sent')
    expect(body.message_id).toBe('dev-mode')
    expect(body.outreach_event_id).toMatch(/^[0-9a-f-]+$/)

    // outreach_events row exists, attributed to the right entity, with the
    // synthetic message_id from the dev-mode send.
    const sentRow = await db
      .prepare(
        `SELECT id, org_id, entity_id, event_type, channel, message_id, provider_event_id
         FROM outreach_events WHERE id = ?`
      )
      .bind(body.outreach_event_id)
      .first<{
        id: string
        org_id: string
        entity_id: string
        event_type: string
        channel: string
        message_id: string
        provider_event_id: string | null
      }>()
    expect(sentRow).not.toBeNull()
    expect(sentRow!.org_id).toBe(ORG_ID)
    expect(sentRow!.entity_id).toBe(ENTITY_ID)
    expect(sentRow!.event_type).toBe('sent')
    expect(sentRow!.channel).toBe('email')
    expect(sentRow!.message_id).toBe('dev-mode')
    expect(sentRow!.provider_event_id).toBeNull()
  })

  it('skips the send when the entity has no contact email', async () => {
    await db.prepare(`DELETE FROM contacts WHERE entity_id = ?`).bind(ENTITY_ID).run()

    const ctx = buildContext({
      session: adminSession,
      entityId: ENTITY_ID,
      body: { duration_minutes: 30 },
    })
    const response = await POST(ctx as unknown as Parameters<typeof POST>[0])
    expect(response.status).toBe(200)

    const body: Record<string, unknown> = await response.json()
    expect(body.email_status).toBe('skipped_no_recipient')
    expect(body.contact_email).toBeNull()
    // Booking link and mailto are still returned so the admin can paste
    // the URL into a manual outreach.
    expect(body.booking_url).toMatch(/^https:\/\/smd\.services\/book\?t=/)
    expect(body.mailto_url).toMatch(/^mailto:/)

    // No outreach_events row was written — there was nothing to send.
    const count = await db
      .prepare(`SELECT COUNT(*) as c FROM outreach_events WHERE entity_id = ?`)
      .bind(ENTITY_ID)
      .first<{ c: number }>()
    expect(count!.c).toBe(0)
  })

  it('records the email status in the outreach_draft context metadata', async () => {
    const ctx = buildContext({
      session: adminSession,
      entityId: ENTITY_ID,
      body: { duration_minutes: 30 },
    })
    const response = await POST(ctx as unknown as Parameters<typeof POST>[0])
    expect(response.status).toBe(200)

    const contextRow = await db
      .prepare(
        `SELECT metadata FROM context
         WHERE entity_id = ? AND type = 'outreach_draft' AND source = 'send_booking_link'`
      )
      .bind(ENTITY_ID)
      .first<{ metadata: string }>()
    expect(contextRow).not.toBeNull()
    const metadata = JSON.parse(contextRow!.metadata) as Record<string, unknown>
    expect(metadata.email_status).toBe('sent')
    expect(metadata.recipient_email).toBe('maria@phoenixplumbing.example')
    expect(metadata.message_id).toBe('dev-mode')
    expect(metadata.outreach_event_id).toMatch(/^[0-9a-f-]+$/)
  })
})
