import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'

import {
  listPortalActionEvents,
  recordPortalActionEvent,
  type PortalActionType,
  type RecordPortalActionEventInput,
} from '../src/lib/portal/operator/action-events'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ENTITY_ID = 'entity-action-events'
const OTHER_ENTITY_ID = 'entity-other'
const SLUG = 'firm-alpha'
/** A second seat on the SAME entity — the multi-operator shape (#2281). */
const SIBLING_SLUG = 'firm-alpha-two'

function baseInput(
  action_type: PortalActionType,
  overrides: Partial<RecordPortalActionEventInput> = {}
): RecordPortalActionEventInput {
  return {
    entity_id: ENTITY_ID,
    customer_slug: SLUG,
    action_type,
    actor_user_id: 'user-1',
    actor_email: 'principal@firm.example',
    actor_role: 'principal',
    source: 'portal',
    target: null,
    status: null,
    metadata: {},
    ...overrides,
  }
}

describe('portal_action_events ledger', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  })

  const ALL_TYPES: PortalActionType[] = [
    'role_granted',
    'role_revoked',
    'invite_sent',
    'customer_yaml_update_submitted',
    'connector_reconsent_requested',
    'output_class_spec_authored',
  ]

  it('round-trips every action type with actor attribution', async () => {
    for (const t of ALL_TYPES) {
      await recordPortalActionEvent(
        db,
        baseInput(t, {
          target: t === 'invite_sent' ? 'invitee@firm.example' : null,
          status:
            t === 'customer_yaml_update_submitted'
              ? 'submitted'
              : t === 'output_class_spec_authored'
                ? 'applied'
                : null,
          metadata: { marker: t },
        })
      )
    }
    const rows = await listPortalActionEvents(db, ENTITY_ID, SLUG)
    expect(rows).toHaveLength(ALL_TYPES.length)
    const byType = new Map(rows.map((r) => [r.action_type, r]))
    for (const t of ALL_TYPES) {
      const row = byType.get(t)
      expect(row).toBeDefined()
      expect(row!.actor_email).toBe('principal@firm.example')
      expect(row!.actor_role).toBe('principal')
      expect(JSON.parse(row!.metadata_json)).toEqual({ marker: t })
    }
    const invite = byType.get('invite_sent')!
    expect(invite.target).toBe('invitee@firm.example')
    const yaml = byType.get('customer_yaml_update_submitted')!
    expect(yaml.status).toBe('submitted')
  })

  it('is entity-scoped and newest-first', async () => {
    await recordPortalActionEvent(db, baseInput('role_granted'))
    await recordPortalActionEvent(db, baseInput('role_revoked', { entity_id: OTHER_ENTITY_ID }))
    const rows = await listPortalActionEvents(db, ENTITY_ID, SLUG)
    expect(rows).toHaveLength(1)
    expect(rows[0].action_type).toBe('role_granted')
  })

  // #2281 — every writer attributes its event to the instance it happened on,
  // so an entity-only read leaks one seat's actions onto a sibling's feed.
  it('is seat-scoped: a sibling seat on the same entity does not show', async () => {
    await recordPortalActionEvent(db, baseInput('role_granted'))
    await recordPortalActionEvent(
      db,
      baseInput('role_revoked', { customer_slug: SIBLING_SLUG, target: 'sibling@firm.example' })
    )

    const mine = await listPortalActionEvents(db, ENTITY_ID, SLUG)
    expect(mine.map((r) => r.action_type)).toEqual(['role_granted'])

    const theirs = await listPortalActionEvents(db, ENTITY_ID, SIBLING_SLUG)
    expect(theirs.map((r) => r.action_type)).toEqual(['role_revoked'])
  })

  it('surfaces a NULL-slug (entity-wide) row on every seat of the entity', async () => {
    await recordPortalActionEvent(db, baseInput('invite_sent', { customer_slug: null }))
    for (const slug of [SLUG, SIBLING_SLUG]) {
      const rows = await listPortalActionEvents(db, ENTITY_ID, slug)
      expect(rows.map((r) => r.action_type)).toEqual(['invite_sent'])
    }
  })

  it('CHECK constraint rejects an unknown action_type', async () => {
    await expect(
      db
        .prepare(
          `INSERT INTO portal_action_events
             (id, entity_id, action_type, actor_user_id, actor_email, actor_role, source, metadata_json, created_at)
           VALUES ('x', ?, 'made_up_action', 'u', 'e@x.com', 'principal', 'portal', '{}', ?)`
        )
        .bind(ENTITY_ID, new Date().toISOString())
        .run()
    ).rejects.toThrow()
  })

  it('CHECK constraint rejects an unknown status', async () => {
    await expect(
      db
        .prepare(
          `INSERT INTO portal_action_events
             (id, entity_id, action_type, actor_user_id, actor_email, actor_role, source, status, metadata_json, created_at)
           VALUES ('y', ?, 'customer_yaml_update_submitted', 'u', 'e@x.com', 'principal', 'portal', 'done', '{}', ?)`
        )
        .bind(ENTITY_ID, new Date().toISOString())
        .run()
    ).rejects.toThrow()
  })

  it('admits an applied status only because one action really writes (0101)', async () => {
    // 0099 barred 'applied' outright, because the only writer-shaped endpoint
    // at the time wrote nothing. The output-class spec writer does write — it
    // puts the object in the customer's vault and reads it back byte-identical
    // before claiming anything — so the vocabulary now has a word for that.
    //
    // The honest-status contract for customer.yaml did not move; it is now
    // enforced where it belongs, in the endpoint, and asserted in
    // tests/advanced-settings-surface.test.ts. A table-wide CHECK could never
    // have expressed "this action may say applied and that one may not".
    await recordPortalActionEvent(
      db,
      baseInput('output_class_spec_authored', { status: 'applied', metadata: { bodies: 2 } })
    )
    const rows = await listPortalActionEvents(db, ENTITY_ID, SLUG)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('applied')
  })
})
