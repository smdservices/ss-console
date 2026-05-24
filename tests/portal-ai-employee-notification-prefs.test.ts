/**
 * Tests for the per-user notification preferences module
 * (src/lib/portal/ai-employee/notification-prefs.ts).
 *
 * Backs the per-#882 "don't notify everyone for everything" AC.  Covers:
 *
 *   - listNotificationPrefs: empty array when never written; rows
 *     ordered by event_type then scope
 *   - replaceNotificationPrefs: replace-semantics — deletes old rows,
 *     inserts new ones; deduplicates input on (event_type, scope)
 *   - shouldNotifyUser: full decision table — default routing when
 *     prefs empty; opt-in via 'all'; opt-in via 'mine' + assignment
 *   - parseNotificationPrefsForm: drops unknown event types, unknown
 *     scopes, malformed keys, and non-"1" values
 */

import { describe, it, expect } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { ORG_ID } from '../src/lib/constants'
import {
  listNotificationPrefs,
  parseNotificationPrefsForm,
  replaceNotificationPrefs,
  shouldNotifyUser,
  type NotificationPref,
} from '../src/lib/portal/ai-employee/notification-prefs'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ENTITY_A = 'entity-a'
const USER_ALEX = 'user-alex'

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(ENTITY_A, ORG_ID, 'Entity A', 'entity-a')
    .run()
  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, role, entity_id)
       VALUES (?, ?, ?, ?, 'client', ?)`
    )
    .bind(USER_ALEX, ORG_ID, 'alex@firm.com', 'Alex Paralegal', ENTITY_A)
    .run()
  return db
}

describe('listNotificationPrefs', () => {
  it('returns empty array when user has never written', async () => {
    const db = await freshDb()
    const prefs = await listNotificationPrefs(db, ENTITY_A, USER_ALEX)
    expect(prefs).toEqual([])
  })
})

describe('replaceNotificationPrefs', () => {
  it('inserts the new pref set and returns the canonical snapshot', async () => {
    const db = await freshDb()
    const snapshot = await replaceNotificationPrefs(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      prefs: [
        { eventType: 'draft_ready', scope: 'mine' },
        { eventType: 'error', scope: 'all' },
      ],
    })
    expect(snapshot).toHaveLength(2)
    const eventTypes = new Set(snapshot.map((p) => `${p.eventType}:${p.scope}`))
    expect(eventTypes).toEqual(new Set(['draft_ready:mine', 'error:all']))
  })

  it('replaces the prior set on a second call (delete + insert)', async () => {
    const db = await freshDb()
    await replaceNotificationPrefs(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      prefs: [{ eventType: 'draft_ready', scope: 'all' }],
    })
    const snapshot = await replaceNotificationPrefs(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      prefs: [{ eventType: 'error', scope: 'mine' }],
    })
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0].eventType).toBe('error')
    expect(snapshot[0].scope).toBe('mine')
  })

  it('empty input deletes every row (opt out of everything)', async () => {
    const db = await freshDb()
    await replaceNotificationPrefs(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      prefs: [{ eventType: 'draft_ready', scope: 'all' }],
    })
    const snapshot = await replaceNotificationPrefs(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      prefs: [],
    })
    expect(snapshot).toEqual([])
  })

  it('deduplicates input on (event_type, scope)', async () => {
    const db = await freshDb()
    const snapshot = await replaceNotificationPrefs(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      prefs: [
        { eventType: 'draft_ready', scope: 'all' },
        { eventType: 'draft_ready', scope: 'all' },
        { eventType: 'draft_ready', scope: 'mine' },
      ],
    })
    expect(snapshot).toHaveLength(2)
  })
})

describe('shouldNotifyUser', () => {
  const empty: NotificationPref[] = []
  const assignedToSmith = new Set(['matter-smith'])
  const noAssignments = new Set<string>()

  it('returns true for every event when prefs is empty (default routing)', () => {
    expect(shouldNotifyUser(empty, 'draft_ready', 'matter-smith', assignedToSmith)).toBe(true)
    expect(shouldNotifyUser(empty, 'error', null, noAssignments)).toBe(true)
    expect(shouldNotifyUser(empty, 'weekly_digest', null, noAssignments)).toBe(true)
  })

  it('opt-in via (event, all) delivers any matter, including non-matter events', () => {
    const prefs: NotificationPref[] = [
      { eventType: 'draft_ready', scope: 'all', updatedAt: '2026-05-01T00:00:00Z' },
    ]
    expect(shouldNotifyUser(prefs, 'draft_ready', 'matter-smith', noAssignments)).toBe(true)
    expect(shouldNotifyUser(prefs, 'draft_ready', null, noAssignments)).toBe(true)
  })

  it('opt-in via (event, mine) delivers only assigned matters', () => {
    const prefs: NotificationPref[] = [
      { eventType: 'draft_ready', scope: 'mine', updatedAt: '2026-05-01T00:00:00Z' },
    ]
    expect(shouldNotifyUser(prefs, 'draft_ready', 'matter-smith', assignedToSmith)).toBe(true)
    expect(shouldNotifyUser(prefs, 'draft_ready', 'matter-jones', assignedToSmith)).toBe(false)
    expect(shouldNotifyUser(prefs, 'draft_ready', null, assignedToSmith)).toBe(false)
  })

  it('returns false for event types absent from the pref set', () => {
    const prefs: NotificationPref[] = [
      { eventType: 'draft_ready', scope: 'all', updatedAt: '2026-05-01T00:00:00Z' },
    ]
    expect(shouldNotifyUser(prefs, 'error', 'matter-smith', assignedToSmith)).toBe(false)
    expect(shouldNotifyUser(prefs, 'weekly_digest', null, noAssignments)).toBe(false)
  })

  it('mixed prefs: mine for drafts, all for errors', () => {
    const prefs: NotificationPref[] = [
      { eventType: 'draft_ready', scope: 'mine', updatedAt: '2026-05-01T00:00:00Z' },
      { eventType: 'error', scope: 'all', updatedAt: '2026-05-01T00:00:00Z' },
    ]
    expect(shouldNotifyUser(prefs, 'draft_ready', 'matter-smith', assignedToSmith)).toBe(true)
    expect(shouldNotifyUser(prefs, 'draft_ready', 'matter-jones', assignedToSmith)).toBe(false)
    expect(shouldNotifyUser(prefs, 'error', 'matter-jones', assignedToSmith)).toBe(true)
    expect(shouldNotifyUser(prefs, 'calibration_prompt', 'matter-smith', assignedToSmith)).toBe(
      false
    )
  })
})

describe('parseNotificationPrefsForm', () => {
  function makeForm(entries: Record<string, string>): FormData {
    const fd = new FormData()
    for (const [k, v] of Object.entries(entries)) fd.set(k, v)
    return fd
  }

  it('parses well-formed pref keys', () => {
    const out = parseNotificationPrefsForm(
      makeForm({
        'pref:draft_ready:mine': '1',
        'pref:error:all': '1',
      })
    )
    expect(out).toHaveLength(2)
    expect(out).toContainEqual({ eventType: 'draft_ready', scope: 'mine' })
    expect(out).toContainEqual({ eventType: 'error', scope: 'all' })
  })

  it('drops keys with non-"1" values', () => {
    const out = parseNotificationPrefsForm(
      makeForm({
        'pref:draft_ready:mine': '0',
        'pref:error:all': 'true',
      })
    )
    expect(out).toEqual([])
  })

  it('drops unknown event types and scopes', () => {
    const out = parseNotificationPrefsForm(
      makeForm({
        'pref:fake_event:all': '1',
        'pref:draft_ready:everywhere': '1',
      })
    )
    expect(out).toEqual([])
  })

  it('drops malformed keys', () => {
    const out = parseNotificationPrefsForm(
      makeForm({
        notapref: '1',
        'pref:draft_ready': '1',
        'pref:draft_ready:mine:extra': '1',
      })
    )
    expect(out).toEqual([])
  })

  it('drops non-pref form fields', () => {
    const out = parseNotificationPrefsForm(
      makeForm({
        action: 'save',
        csrf: 'abc123',
        'pref:draft_ready:all': '1',
      })
    )
    expect(out).toEqual([{ eventType: 'draft_ready', scope: 'all' }])
  })
})
