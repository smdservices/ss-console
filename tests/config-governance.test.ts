/**
 * Tests for the config-governance module (ADR 0026 / ADR 0030 §4).
 *
 * Pure-logic coverage of the restrictiveness ordering, raise/lower asymmetry,
 * and floor check, plus a real-D1 integration that exercises the immutable
 * ledger: an accepted lower, a floor-rejected raise (recorded as
 * rejected_floor), and a skill toggle. Also asserts that every action-class
 * key used in the seeded vertical floors is a real ActionClass — the guard
 * against portal<->runtime identifier drift.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import {
  restrictiveness,
  changeDirection,
  checkFloor,
  getVerticalFloor,
  verticalFloorActionClasses,
  applyCeilingChange,
  applySkillToggle,
  listConfigChangeAudit,
  isCeiling,
} from '../src/lib/portal/operator/config-governance'
import { ACCEPTED_ACTION_CLASSES } from '../src/lib/operator/customer-yaml/types'

const migrationsDir = resolve(process.cwd(), 'migrations')

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  await seedParents(db)
  return db
}

/**
 * Seed the FK parents config_change_audit now requires (migration 0047 added
 * entity_id -> entities(id) and actor_user_id -> users(id); the test harness
 * runs with PRAGMA foreign_keys=ON). The recordConfigChangeAudit calls below
 * reference ACTOR.user_id and entity-1..4, so insert one org, the actor user,
 * and those entities. Minimal valid rows — only the columns each table
 * requires NOT NULL without a default.
 */
async function seedParents(db: D1Database): Promise<void> {
  await db
    .prepare("INSERT INTO organizations (id, name, slug) VALUES ('org-1', 'Test Org', 'test-org')")
    .run()
  await db
    .prepare(
      "INSERT INTO users (id, org_id, email, name, role) VALUES (?, 'org-1', ?, 'Owner', 'client')"
    )
    .bind(ACTOR.user_id, ACTOR.email)
    .run()
  for (const id of ['entity-1', 'entity-2', 'entity-3', 'entity-4']) {
    await db
      .prepare("INSERT INTO entities (id, org_id, name, slug) VALUES (?, 'org-1', ?, ?)")
      .bind(id, `Entity ${id}`, id)
      .run()
  }
}

const ACTOR = { user_id: 'user-1', email: 'owner@firm.test', role: 'principal' }

describe('restrictiveness ordering', () => {
  it('orders autonomous < draft_for_review < refused', () => {
    expect(restrictiveness('autonomous')).toBeLessThan(restrictiveness('draft_for_review'))
    expect(restrictiveness('draft_for_review')).toBeLessThan(restrictiveness('refused'))
  })

  it('isCeiling accepts only the three ceilings', () => {
    expect(isCeiling('autonomous')).toBe(true)
    expect(isCeiling('draft_for_review')).toBe(true)
    expect(isCeiling('refused')).toBe(true)
    expect(isCeiling('disabled')).toBe(false)
    expect(isCeiling('')).toBe(false)
  })
})

describe('changeDirection (raise = toward less restrictive)', () => {
  it('classifies a move toward autonomy as a raise', () => {
    expect(changeDirection('draft_for_review', 'autonomous')).toBe('raise')
    expect(changeDirection('refused', 'draft_for_review')).toBe('raise')
  })
  it('classifies a move toward refused as a lower', () => {
    expect(changeDirection('autonomous', 'draft_for_review')).toBe('lower')
    expect(changeDirection('draft_for_review', 'refused')).toBe('lower')
  })
  it('classifies an unchanged value as lateral', () => {
    expect(changeDirection('autonomous', 'autonomous')).toBe('lateral')
  })
})

describe('checkFloor', () => {
  it('allows when no floor applies', () => {
    expect(checkFloor(null, 'autonomous')).toEqual({ allowed: true, reason: null })
  })
  it('rejects a raise above the floor', () => {
    const r = checkFloor('draft_for_review', 'autonomous')
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('draft_for_review')
  })
  it('allows at or below the floor', () => {
    expect(checkFloor('draft_for_review', 'draft_for_review').allowed).toBe(true)
    expect(checkFloor('draft_for_review', 'refused').allowed).toBe(true)
  })
})

describe('vertical floors', () => {
  it('pins law-firm external_send at draft_for_review', () => {
    expect(getVerticalFloor('law-firm', 'external_send')).toBe('draft_for_review')
  })
  it('has no floor for an unknown vertical', () => {
    expect(getVerticalFloor('marketing-agency', 'external_send')).toBeNull()
    expect(getVerticalFloor(null, 'external_send')).toBeNull()
  })
  it('every floor action-class key is a real ActionClass (no portal<->runtime drift)', () => {
    for (const key of verticalFloorActionClasses()) {
      expect(ACCEPTED_ACTION_CLASSES as readonly string[]).toContain(key)
    }
  })
})

describe('applyCeilingChange (D1)', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
  })

  it('rejects and audits a law-firm external_send raise to autonomous', async () => {
    const result = await applyCeilingChange(db, {
      customer_slug: 'smith-pi-firm',
      entity_id: 'entity-1',
      actor: ACTOR,
      persona_slug: 'marcus',
      skill_name: 'ar-chaser',
      action_class: 'external_send',
      vertical: 'law-firm',
      old_value: 'draft_for_review',
      new_value: 'autonomous',
    })
    expect(result.outcome).toBe('rejected_floor')

    const rows = await listConfigChangeAudit(db, 'entity-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'portal_intent',
      change_type: 'action_ceiling',
      action_class: 'external_send',
      old_value: 'draft_for_review',
      new_value: 'autonomous',
      outcome: 'rejected_floor',
      direction: 'raise',
      actor_email: 'owner@firm.test',
    })
    expect(rows[0].outcome_reason).toContain('draft_for_review')
  })

  it('accepts and audits a lower (autonomous -> draft) with no floor', async () => {
    const result = await applyCeilingChange(db, {
      customer_slug: 'shop',
      entity_id: 'entity-2',
      actor: ACTOR,
      persona_slug: null,
      skill_name: 'inbox-triage',
      action_class: 'external_send',
      vertical: 'marketing-agency',
      old_value: 'autonomous',
      new_value: 'draft_for_review',
    })
    expect(result.outcome).toBe('accepted')

    const rows = await listConfigChangeAudit(db, 'entity-2')
    expect(rows[0]).toMatchObject({ outcome: 'accepted', direction: 'lower' })
  })

  it('accepts a non-action-class (skill scalar) change with no floor', async () => {
    const result = await applyCeilingChange(db, {
      customer_slug: 'smith-pi-firm',
      entity_id: 'entity-3',
      actor: ACTOR,
      persona_slug: 'marcus',
      skill_name: 'inbox-triage',
      action_class: null,
      vertical: 'law-firm',
      old_value: 'draft_for_review',
      new_value: 'autonomous',
    })
    expect(result.outcome).toBe('accepted')
    const rows = await listConfigChangeAudit(db, 'entity-3')
    expect(rows[0]).toMatchObject({ change_type: 'trust_ceiling', action_class: null })
  })
})

describe('applySkillToggle (D1)', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
  })

  it('records disable as refused (a lower) and enable as draft_for_review', async () => {
    await applySkillToggle(db, {
      customer_slug: 'smith-pi-firm',
      entity_id: 'entity-4',
      actor: ACTOR,
      persona_slug: 'marcus',
      skill_name: 'ar-chaser',
      next_enabled: false,
      old_value: 'draft_for_review',
    })
    const rows = await listConfigChangeAudit(db, 'entity-4')
    expect(rows[0]).toMatchObject({
      change_type: 'skill_toggle',
      new_value: 'refused',
      direction: 'lower',
      outcome: 'accepted',
    })
  })
})
