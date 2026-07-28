import { describe, it, expect } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { loadActivityPage, parseAuditEntries } from '../src/lib/portal/operator/activity-read'
import { parseAuditListParams } from '../src/lib/portal/operator/audit'

const PARAMS = parseAuditListParams(new URLSearchParams())
// A DB that throws on every query. The console-plane loaders (pause / login /
// action unions) query D1 regardless of runtime-read configuration — they are
// console tables, not Machine reads — but each is defensive, so a throwing DB
// (or a fresh env without the tables) contributes nothing rather than
// blanking or crashing the page.
const NOOP_DB = {
  prepare() {
    throw new Error('console-plane loaders must swallow D1 failures')
  },
} as unknown as D1Database

const ACTOR = { actor: 'partner@firm.com', actorRole: 'principal' }

describe('loadActivityPage: fail-closed empty until wired', () => {
  it('returns an empty page (Machine read skipped, console loaders defensive) when OPERATOR_RUNTIME_READ_URL is unset', async () => {
    const page = await loadActivityPage(
      { db: NOOP_DB, env: {}, actorUserId: 'u-1', entityId: 'ent-1' },
      'smith-pi',
      ACTOR,
      PARAMS
    )
    expect(page.totalCount).toBe(0)
    expect(page.rows).toEqual([])
  })

  it('returns an empty page when the read URL is empty string', async () => {
    const page = await loadActivityPage(
      {
        db: NOOP_DB,
        env: { OPERATOR_RUNTIME_READ_URL: '' },
        actorUserId: 'u-1',
        entityId: 'ent-1',
      },
      'smith-pi',
      ACTOR,
      PARAMS
    )
    expect(page.totalCount).toBe(0)
  })
})

describe('parseAuditEntries: defensive parse, never cast', () => {
  it('parses a bare array of well-formed rows', () => {
    const rows = parseAuditEntries([
      {
        id: 'a1',
        ts: '2026-06-01T10:00:00.000Z',
        actor: 'marcus',
        action: 'DRAFT_CREATED',
        actorRole: 'agent',
        target: 'draft-9',
        decision: 'draft_for_review',
        reason: 'client email',
        skill: 'inbox-triage',
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('a1')
    expect(rows[0].actorRole).toBe('agent')
    expect(rows[0].decision).toBe('draft_for_review')
  })

  it('accepts an { entries: [...] } envelope', () => {
    const rows = parseAuditEntries({
      entries: [{ id: 'a1', ts: '2026-06-01T10:00:00.000Z', actor: 'm', action: 'X' }],
    })
    expect(rows).toHaveLength(1)
  })

  it('drops rows missing any required field (id/ts/actor/action)', () => {
    const rows = parseAuditEntries([
      { ts: '2026-06-01', actor: 'm', action: 'X' }, // no id
      { id: 'a', actor: 'm', action: 'X' }, // no ts
      { id: 'a', ts: '2026-06-01', action: 'X' }, // no actor
      { id: 'a', ts: '2026-06-01', actor: 'm' }, // no action
      { id: 'ok', ts: '2026-06-01', actor: 'm', action: 'X' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('ok')
  })

  it('coerces unknown actorRole / decision to null rather than passing them through', () => {
    const rows = parseAuditEntries([
      {
        id: 'a',
        ts: '2026-06-01',
        actor: 'm',
        action: 'X',
        actorRole: 'operator', // legacy role value — not in the vocabulary
        decision: 'bogus',
      },
    ])
    expect(rows[0].actorRole).toBeNull()
    expect(rows[0].decision).toBeNull()
  })

  it('returns [] for non-array / non-envelope input', () => {
    expect(parseAuditEntries(null)).toEqual([])
    expect(parseAuditEntries(undefined)).toEqual([])
    expect(parseAuditEntries('nope')).toEqual([])
    expect(parseAuditEntries({})).toEqual([])
    expect(parseAuditEntries(42)).toEqual([])
  })
})

describe('console-plane unions: logins + portal actions', () => {
  async function seededDb(): Promise<D1Database> {
    const { createTestD1, discoverNumericMigrations, runMigrations } =
      await import('@venturecrane/crane-test-harness')
    const { resolve } = await import('path')
    const db = createTestD1()
    await runMigrations(db, {
      files: discoverNumericMigrations(resolve(process.cwd(), 'migrations')),
    })
    return db
  }

  const ENTITY = 'ent-union'

  it('unions login and action events into the page even when runtime read is unconfigured', async () => {
    const db = await seededDb()
    await db
      .prepare(
        `INSERT INTO portal_login_events
           (id, user_id, entity_id, email, clerk_user_id, clerk_session_id, method, created_at)
         VALUES ('l1', 'u1', ?, 'principal@firm.example', 'clerk_u1', 'sess_1', 'clerk', ?)`
      )
      .bind(ENTITY, new Date().toISOString())
      .run()
    const { recordPortalActionEvent } = await import('../src/lib/portal/operator/action-events')
    await recordPortalActionEvent(db, {
      entity_id: ENTITY,
      customer_slug: 'firm-alpha',
      action_type: 'role_granted',
      actor_user_id: 'u1',
      actor_email: 'principal@firm.example',
      actor_role: 'principal',
      source: 'portal',
      target: 'staffer@firm.example',
      status: null,
      metadata: { role: 'staff', target_user_id: 'u2' },
    })
    await recordPortalActionEvent(db, {
      entity_id: ENTITY,
      customer_slug: 'firm-alpha',
      action_type: 'customer_yaml_update_submitted',
      actor_user_id: 'u1',
      actor_email: 'principal@firm.example',
      actor_role: 'principal',
      source: 'portal',
      target: null,
      status: 'rejected',
      metadata: {},
    })

    const page = await loadActivityPage(
      { db, env: {}, actorUserId: 'u1', entityId: ENTITY },
      'firm-alpha',
      { actor: 'principal@firm.example', actorRole: 'principal' },
      PARAMS
    )
    const actions = page.rows.map((r) => r.action).sort()
    expect(actions).toEqual(['CONFIG_CHANGE_REJECTED', 'PORTAL_LOGIN', 'TEAM_ROLE_GRANTED'])

    const roleRow = page.rows.find((r) => r.action === 'TEAM_ROLE_GRANTED')!
    expect(roleRow.actor).toBe('principal@firm.example')
    expect(roleRow.target).toBe('staffer@firm.example')
    expect(roleRow.reason).toBe('Role: staff')
  })

  it('is entity-scoped: another entity contributes nothing', async () => {
    const db = await seededDb()
    await db
      .prepare(
        `INSERT INTO portal_login_events
           (id, user_id, entity_id, email, clerk_user_id, clerk_session_id, method, created_at)
         VALUES ('l2', 'u9', 'ent-other', 'other@firm.example', NULL, NULL, 'magic_link', ?)`
      )
      .bind(new Date().toISOString())
      .run()
    const page = await loadActivityPage(
      { db, env: {}, actorUserId: 'u1', entityId: ENTITY },
      'firm-alpha',
      { actor: 'principal@firm.example', actorRole: 'principal' },
      PARAMS
    )
    expect(page.rows).toEqual([])
  })

  it('malformed role metadata yields a null reason, never a crash', async () => {
    const db = await seededDb()
    await db
      .prepare(
        `INSERT INTO portal_action_events
           (id, entity_id, action_type, actor_user_id, actor_email, actor_role, source, metadata_json, created_at)
         VALUES ('a3', ?, 'role_revoked', 'u1', 'principal@firm.example', 'principal', 'portal', 'not-json', ?)`
      )
      .bind(ENTITY, new Date().toISOString())
      .run()
    const page = await loadActivityPage(
      { db, env: {}, actorUserId: 'u1', entityId: ENTITY },
      'firm-alpha',
      { actor: 'principal@firm.example', actorRole: 'principal' },
      PARAMS
    )
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].action).toBe('TEAM_ROLE_REVOKED')
    expect(page.rows[0].reason).toBeNull()
  })
})
