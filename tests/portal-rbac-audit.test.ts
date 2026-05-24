/**
 * Tests for the RBAC audit emission helper
 * (src/lib/portal/ai-employee/rbac-audit.ts).
 *
 * Covers:
 *   - buildRoleAuditEvent shape (role_granted, role_revoked) — full
 *     field set incl. customer_id, actor identity, target identity,
 *     and ISO timestamp
 *   - buildInviteAuditEvent shape — Clerk org/invitation IDs
 *     surfaced; timestamp deterministic when `now` injected
 *   - recordRbacAuditEvent emission contract — single console.info
 *     line, `audit:rbac_event` type prefix, JSON-parseable payload
 *
 * The Hermes-side tail-log drain (#821) keys on the `type` field, so
 * the emission contract is load-bearing: a regression that drops the
 * prefix or changes the JSON shape silently breaks audit ingestion.
 */

import { describe, it, expect } from 'vitest'
import {
  RBAC_SUB_ACTIONS,
  buildInviteAuditEvent,
  buildMatterAssignmentAuditEvent,
  buildNotificationPrefsAuditEvent,
  buildPtoClearedAuditEvent,
  buildPtoSetAuditEvent,
  buildRoleAuditEvent,
  recordRbacAuditEvent,
  type InviteSentAuditEvent,
} from '../src/lib/portal/ai-employee/rbac-audit'

describe('RBAC_SUB_ACTIONS vocabulary', () => {
  it('contains the role + invite sub-actions', () => {
    expect(RBAC_SUB_ACTIONS).toContain('role_granted')
    expect(RBAC_SUB_ACTIONS).toContain('role_revoked')
    expect(RBAC_SUB_ACTIONS).toContain('invite_sent')
  })

  it('contains the multi-user matter sub-actions (per #882)', () => {
    expect(RBAC_SUB_ACTIONS).toContain('matter_assigned')
    expect(RBAC_SUB_ACTIONS).toContain('matter_unassigned')
    expect(RBAC_SUB_ACTIONS).toContain('pto_set')
    expect(RBAC_SUB_ACTIONS).toContain('pto_cleared')
    expect(RBAC_SUB_ACTIONS).toContain('notification_prefs_updated')
  })

  it('has no duplicate entries', () => {
    expect(new Set(RBAC_SUB_ACTIONS).size).toBe(RBAC_SUB_ACTIONS.length)
  })
})

describe('buildMatterAssignmentAuditEvent', () => {
  const baseInput = {
    customer_id: 'cust-smith-pi',
    product_slug: 'ai-employee',
    actorUserId: 'u-pat-001',
    actorClerkUserId: 'clerk_user_pat',
    actorEmail: 'pat.owner@smithlaw.com',
    matterId: 'matter-doe-2026-04',
    assigneeUserId: 'u-alex-002',
    assigneeEmail: 'alex.paralegal@smithlaw.com',
    now: new Date('2026-05-23T10:00:00.000Z'),
  }

  it('builds a matter_assigned event with the full field set', () => {
    const event = buildMatterAssignmentAuditEvent({ ...baseInput, subAction: 'matter_assigned' })
    expect(event.type).toBe('audit:rbac_event')
    expect(event.subAction).toBe('matter_assigned')
    expect(event.matterId).toBe('matter-doe-2026-04')
    expect(event.assigneeUserId).toBe('u-alex-002')
    expect(event.assigneeEmail).toBe('alex.paralegal@smithlaw.com')
    expect(event.timestamp).toBe('2026-05-23T10:00:00.000Z')
  })

  it('builds a matter_unassigned event mirroring the assigned shape', () => {
    const assigned = buildMatterAssignmentAuditEvent({
      ...baseInput,
      subAction: 'matter_assigned',
    })
    const unassigned = buildMatterAssignmentAuditEvent({
      ...baseInput,
      subAction: 'matter_unassigned',
    })
    expect(unassigned.subAction).toBe('matter_unassigned')
    expect(unassigned.matterId).toBe(assigned.matterId)
    expect(unassigned.assigneeUserId).toBe(assigned.assigneeUserId)
  })
})

describe('buildPtoSetAuditEvent / buildPtoClearedAuditEvent', () => {
  it('builds pto_set with backup metadata', () => {
    const event = buildPtoSetAuditEvent({
      customer_id: 'cust-smith-pi',
      product_slug: 'ai-employee',
      actorUserId: 'u-alex-002',
      actorClerkUserId: 'clerk_alex',
      actorEmail: 'alex@smithlaw.com',
      awayUserId: 'u-alex-002',
      awayEmail: 'alex@smithlaw.com',
      backupUserId: 'u-jamie-003',
      backupEmail: 'jamie@smithlaw.com',
      now: new Date('2026-05-24T08:00:00.000Z'),
    })
    expect(event.subAction).toBe('pto_set')
    expect(event.awayUserId).toBe('u-alex-002')
    expect(event.backupUserId).toBe('u-jamie-003')
    expect(event.backupEmail).toBe('jamie@smithlaw.com')
  })

  it('builds pto_set with null backup', () => {
    const event = buildPtoSetAuditEvent({
      customer_id: 'cust-smith-pi',
      product_slug: 'ai-employee',
      actorUserId: 'u-alex-002',
      actorClerkUserId: null,
      actorEmail: 'alex@smithlaw.com',
      awayUserId: 'u-alex-002',
      awayEmail: 'alex@smithlaw.com',
      backupUserId: null,
      backupEmail: null,
      now: new Date('2026-05-24T08:00:00.000Z'),
    })
    expect(event.backupUserId).toBeNull()
    expect(event.backupEmail).toBeNull()
  })

  it('builds pto_cleared with the away user identity', () => {
    const event = buildPtoClearedAuditEvent({
      customer_id: 'cust-smith-pi',
      product_slug: 'ai-employee',
      actorUserId: 'u-alex-002',
      actorClerkUserId: 'clerk_alex',
      actorEmail: 'alex@smithlaw.com',
      awayUserId: 'u-alex-002',
      awayEmail: 'alex@smithlaw.com',
      now: new Date('2026-05-30T08:00:00.000Z'),
    })
    expect(event.subAction).toBe('pto_cleared')
    expect(event.awayUserId).toBe('u-alex-002')
    expect(event.timestamp).toBe('2026-05-30T08:00:00.000Z')
  })
})

describe('buildNotificationPrefsAuditEvent', () => {
  it('builds an event whose prefsSnapshot is sorted (event_type, scope)', () => {
    const event = buildNotificationPrefsAuditEvent({
      customer_id: 'cust-smith-pi',
      product_slug: 'ai-employee',
      actorUserId: 'u-alex-002',
      actorClerkUserId: 'clerk_alex',
      actorEmail: 'alex@smithlaw.com',
      targetUserId: 'u-alex-002',
      targetEmail: 'alex@smithlaw.com',
      prefsSnapshot: [
        { event_type: 'error', scope: 'mine' },
        { event_type: 'draft_ready', scope: 'all' },
        { event_type: 'error', scope: 'all' },
      ],
      now: new Date('2026-05-24T09:00:00.000Z'),
    })
    expect(event.subAction).toBe('notification_prefs_updated')
    expect(event.prefsSnapshot).toEqual([
      { event_type: 'draft_ready', scope: 'all' },
      { event_type: 'error', scope: 'all' },
      { event_type: 'error', scope: 'mine' },
    ])
  })

  it('preserves the empty snapshot (opt-out of everything)', () => {
    const event = buildNotificationPrefsAuditEvent({
      customer_id: 'cust-smith-pi',
      product_slug: 'ai-employee',
      actorUserId: 'u-alex-002',
      actorClerkUserId: null,
      actorEmail: 'alex@smithlaw.com',
      targetUserId: 'u-alex-002',
      targetEmail: 'alex@smithlaw.com',
      prefsSnapshot: [],
      now: new Date('2026-05-24T09:00:00.000Z'),
    })
    expect(event.prefsSnapshot).toEqual([])
  })
})

describe('buildRoleAuditEvent', () => {
  const baseInput = {
    customer_id: 'cust-smith-pi',
    product_slug: 'ai-employee',
    actorUserId: 'u-pat-001',
    actorClerkUserId: 'clerk_user_pat',
    actorEmail: 'pat.owner@smithlaw.com',
    targetUserId: 'u-alex-002',
    targetEmail: 'alex.paralegal@smithlaw.com',
    role: 'operator',
    now: new Date('2026-05-23T10:00:00.000Z'),
  }

  it('builds a role_granted event with the full field set', () => {
    const event = buildRoleAuditEvent({ ...baseInput, subAction: 'role_granted' })

    expect(event.type).toBe('audit:rbac_event')
    expect(event.subAction).toBe('role_granted')
    expect(event.customer_id).toBe('cust-smith-pi')
    expect(event.product_slug).toBe('ai-employee')
    expect(event.actorUserId).toBe('u-pat-001')
    expect(event.actorClerkUserId).toBe('clerk_user_pat')
    expect(event.actorEmail).toBe('pat.owner@smithlaw.com')
    expect(event.targetUserId).toBe('u-alex-002')
    expect(event.targetEmail).toBe('alex.paralegal@smithlaw.com')
    expect(event.role).toBe('operator')
    expect(event.timestamp).toBe('2026-05-23T10:00:00.000Z')
  })

  it('builds a role_revoked event with the same shape and only subAction differs', () => {
    const granted = buildRoleAuditEvent({ ...baseInput, subAction: 'role_granted' })
    const revoked = buildRoleAuditEvent({ ...baseInput, subAction: 'role_revoked' })

    expect(revoked.subAction).toBe('role_revoked')
    expect(revoked.customer_id).toBe(granted.customer_id)
    expect(revoked.actorUserId).toBe(granted.actorUserId)
    expect(revoked.targetUserId).toBe(granted.targetUserId)
    expect(revoked.role).toBe(granted.role)
    expect(revoked.timestamp).toBe(granted.timestamp)
  })

  it('tolerates null actorClerkUserId (legacy / pre-bridge users)', () => {
    const event = buildRoleAuditEvent({
      ...baseInput,
      actorClerkUserId: null,
      subAction: 'role_granted',
    })

    expect(event.actorClerkUserId).toBeNull()
    expect(event.actorUserId).toBe('u-pat-001')
  })

  it('defaults timestamp to now() when not provided', () => {
    const before = Date.now()
    const event = buildRoleAuditEvent({
      ...baseInput,
      now: undefined,
      subAction: 'role_granted',
    })
    const after = Date.now()

    const ts = Date.parse(event.timestamp)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})

describe('buildInviteAuditEvent', () => {
  it('builds an invite_sent event with Clerk org + invitation IDs', () => {
    const event: InviteSentAuditEvent = buildInviteAuditEvent({
      customer_id: 'cust-smith-pi',
      product_slug: 'ai-employee',
      actorUserId: 'u-pat-001',
      actorClerkUserId: 'clerk_user_pat',
      actorEmail: 'pat.owner@smithlaw.com',
      inviteeEmail: 'new.hire@smithlaw.com',
      clerkOrgId: 'org_smith',
      clerkInvitationId: 'orginv_abc123',
      now: new Date('2026-05-23T11:00:00.000Z'),
    })

    expect(event.type).toBe('audit:rbac_event')
    expect(event.subAction).toBe('invite_sent')
    expect(event.customer_id).toBe('cust-smith-pi')
    expect(event.actorEmail).toBe('pat.owner@smithlaw.com')
    expect(event.inviteeEmail).toBe('new.hire@smithlaw.com')
    expect(event.clerkOrgId).toBe('org_smith')
    expect(event.clerkInvitationId).toBe('orginv_abc123')
    expect(event.timestamp).toBe('2026-05-23T11:00:00.000Z')
  })
})

describe('recordRbacAuditEvent — emission contract', () => {
  it('emits a single console.info line with type=audit:rbac_event', async () => {
    const lines: string[] = []
    const original = console.info
    console.info = ((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '))
    }) as typeof console.info

    try {
      await recordRbacAuditEvent(
        buildRoleAuditEvent({
          subAction: 'role_granted',
          customer_id: 'cust-1',
          product_slug: 'ai-employee',
          actorUserId: 'u-pat',
          actorClerkUserId: 'clerk_pat',
          actorEmail: 'pat@x.com',
          targetUserId: 'u-alex',
          targetEmail: 'alex@x.com',
          role: 'operator',
          now: new Date('2026-05-23T12:00:00.000Z'),
        })
      )
    } finally {
      console.info = original
    }

    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.type).toBe('audit:rbac_event')
    expect(parsed.subAction).toBe('role_granted')
    expect(parsed.customer_id).toBe('cust-1')
    expect(parsed.role).toBe('operator')
    expect(parsed.timestamp).toBe('2026-05-23T12:00:00.000Z')
  })

  it('round-trips invite_sent events through JSON without losing fields', async () => {
    const lines: string[] = []
    const original = console.info
    console.info = ((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '))
    }) as typeof console.info

    try {
      await recordRbacAuditEvent(
        buildInviteAuditEvent({
          customer_id: 'cust-1',
          product_slug: 'ai-employee',
          actorUserId: 'u-pat',
          actorClerkUserId: null,
          actorEmail: 'pat@x.com',
          inviteeEmail: 'hire@x.com',
          clerkOrgId: 'org_x',
          clerkInvitationId: 'orginv_x',
          now: new Date('2026-05-23T12:30:00.000Z'),
        })
      )
    } finally {
      console.info = original
    }

    const parsed = JSON.parse(lines[0])
    expect(parsed.subAction).toBe('invite_sent')
    expect(parsed.inviteeEmail).toBe('hire@x.com')
    expect(parsed.clerkOrgId).toBe('org_x')
    expect(parsed.clerkInvitationId).toBe('orginv_x')
    expect(parsed.actorClerkUserId).toBeNull()
  })
})
