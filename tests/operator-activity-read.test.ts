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

// ---------------------------------------------------------------------------
// #2179 — the windowed walk. The starvation reproduction is the centerpiece:
// a seam whose first page is ALL suppressed telemetry with the client-visible
// events behind it. The pre-fix single-fetch code fails this by construction
// (live-proven 2026-08-02: 56 mapped events in-window, page rendered zero,
// seam ok — vfy_01KZ204YY88HD2VJ2ZXNW85JDV).
// ---------------------------------------------------------------------------

import { walkMachineWindow } from '../src/lib/portal/operator/activity-read'

/** Build a 200-row full page of suppressed telemetry (TOOL_CALL_COMPLETED). */
function telemetryPage(idPrefix: string, day: string, cursor: string | null) {
  const entries = Array.from({ length: 200 }, (_, i) => ({
    id: `${idPrefix}-${String(i).padStart(3, '0')}`,
    ts: `${day}T12:00:${String(i % 60).padStart(2, '0')}.000Z`,
    actor: 'agent',
    action: 'TOOL_CALL_COMPLETED',
  }))
  return { entries, cursor }
}

/** A transport serving a scripted sequence of audit_log pages. */
function scriptedTransport(pages: Array<{ entries: unknown[]; cursor: string | null }>) {
  const calls: Array<{ cursor?: string | null; limit?: number | null }> = []
  const transport: import('../src/lib/operator/runtime-read').MachineRuntimeTransport = {
    read: async (_slug, query) => {
      calls.push({ cursor: query.cursor, limit: query.limit })
      const page = pages[calls.length - 1]
      if (!page) return { data: { entries: [], cursor: null } }
      return { data: page }
    },
  }
  return { calls, transport }
}

function recordingAudit() {
  const records: unknown[] = []
  return { records, audit: { record: async (row: unknown) => void records.push(row) } }
}

describe('walkMachineWindow (#2179): starvation reproduction', () => {
  it('reaches client-visible events buried behind a full page of suppressed telemetry', async () => {
    const buried = {
      entries: [
        { id: 'r-1', ts: '2026-07-29T09:00:00.000Z', actor: 'agent', action: 'REPLY_SENT' },
        { id: 'r-0', ts: '2026-07-29T08:00:00.000Z', actor: 'agent', action: 'REPLY_HELD' },
      ],
      cursor: null,
    }
    const { transport, calls } = scriptedTransport([
      telemetryPage('t', '2026-07-30', 't-199'),
      buried,
    ])
    const { audit } = recordingAudit()

    const win = await walkMachineWindow(
      { transport, audit },
      'smith-pi',
      { actor: 'partner@firm.com', actorRole: 'principal' },
      '2026-07-26'
    )

    // The buried replies were reached — the single-fetch code never made call 2.
    expect(calls.length).toBe(2)
    expect(calls[1].cursor).toBe('t-199')
    const actions = win.rows.map((r) => r.action)
    expect(actions).toContain('REPLY_SENT')
    expect(actions).toContain('REPLY_HELD')
    expect(win.coverageFloor).toBeNull()
  })

  it('stops walking once a page passes the window start (no full-history scan)', async () => {
    const oldPage = {
      entries: [
        { id: 'o-1', ts: '2026-07-01T09:00:00.000Z', actor: 'agent', action: 'REPLY_SENT' },
      ],
      cursor: 'o-1',
    }
    const { transport, calls } = scriptedTransport([
      telemetryPage('t', '2026-07-30', 't-199'),
      oldPage,
      telemetryPage('never', '2026-06-01', null),
    ])
    const { audit } = recordingAudit()

    await walkMachineWindow(
      { transport, audit },
      'smith-pi',
      { actor: 'a', actorRole: 'principal' },
      '2026-07-26'
    )
    // Page 2's oldest ts (Jul 1) precedes from (Jul 26) → page 3 never fetched.
    expect(calls.length).toBe(2)
  })

  it('declares an honest coverage floor when the page budget exhausts in-window', async () => {
    // 15-page budget, every page full, all newer than `from`, cursor always present.
    const pages = Array.from({ length: 16 }, (_, i) =>
      telemetryPage(
        `p${String(i).padStart(2, '0')}`,
        '2026-07-30',
        `p${String(i).padStart(2, '0')}-199`
      )
    )
    const { transport, calls } = scriptedTransport(pages)
    const { audit } = recordingAudit()

    const win = await walkMachineWindow(
      { transport, audit },
      'smith-pi',
      { actor: 'a', actorRole: 'principal' },
      '2026-07-01'
    )
    expect(calls.length).toBe(15) // budget, not the 16th page
    expect(win.coverageFloor).not.toBeNull()
  })

  it('one logical read = one read-audit row, regardless of segments walked', async () => {
    const { transport } = scriptedTransport([
      telemetryPage('t', '2026-07-30', 't-199'),
      telemetryPage('u', '2026-07-29', 'u-199'),
      { entries: [], cursor: null },
    ])
    const { audit, records } = recordingAudit()

    await walkMachineWindow(
      { transport, audit },
      'smith-pi',
      { actor: 'a', actorRole: 'principal' },
      '2026-07-01'
    )
    expect(records.length).toBe(1)
  })

  it('FALSE CONTROL: a window whose ledger truly has no visible events stays empty without a floor', async () => {
    const { transport } = scriptedTransport([telemetryPage('t', '2026-07-30', null)])
    const { audit } = recordingAudit()
    const win = await walkMachineWindow(
      { transport, audit },
      'smith-pi',
      { actor: 'a', actorRole: 'principal' },
      '2026-07-26'
    )
    expect(win.rows.every((r) => r.action === 'TOOL_CALL_COMPLETED')).toBe(true)
    expect(win.coverageFloor).toBeNull()
  })
})
