/**
 * Tests for the Clerk Org member + pending-invitation projector
 * (src/lib/portal/clerk-org-members.ts).
 *
 * Covers:
 *   - projectClerkMember: full mapping of Clerk membership shape,
 *     null returns for partial inputs (no userId or no email)
 *   - projectClerkPendingInvite: only `status === 'pending'` rows
 *     surface; other statuses (accepted, revoked, expired) drop
 *     to null so the page never renders stale invitations
 *   - dedupePendingAgainstMembers: case-insensitive email match;
 *     joined members always win over a same-email pending row
 *
 * The integration with the actual Clerk Backend API (the
 * `listClerkOrgParticipants` HTTP path) is not exercised here — it
 * lives in the runtime caller and is verified by the Users page
 * itself. The pure-projection layer is the load-bearing unit-tested
 * surface; it's what the page renders.
 */

import { describe, it, expect } from 'vitest'
import {
  dedupePendingAgainstMembers,
  projectClerkMember,
  projectClerkPendingInvite,
  type ClerkOrgMember,
  type ClerkOrgPendingInvite,
} from '../src/lib/portal/clerk-org-members'

describe('projectClerkMember', () => {
  it('maps a fully-populated membership to the member shape', () => {
    const result = projectClerkMember({
      publicUserData: {
        userId: 'clerk_user_alex',
        identifier: 'alex.paralegal@smithlaw.com',
        firstName: 'Alex',
        lastName: 'Reyes',
      },
      role: 'org:member',
      createdAt: Date.parse('2026-05-01T10:00:00.000Z'),
    })

    expect(result).not.toBeNull()
    const member = result as ClerkOrgMember
    expect(member.kind).toBe('member')
    expect(member.email).toBe('alex.paralegal@smithlaw.com')
    expect(member.name).toBe('Alex Reyes')
    expect(member.clerkUserId).toBe('clerk_user_alex')
    expect(member.role).toBe('org:member')
    expect(member.joinedAt).toBe('2026-05-01T10:00:00.000Z')
    expect(member.invitedAt).toBeNull()
    expect(member.expiresAt).toBeNull()
  })

  it('returns null when publicUserData has no userId', () => {
    const result = projectClerkMember({
      publicUserData: {
        userId: null,
        identifier: 'someone@example.com',
        firstName: 'Someone',
        lastName: null,
      },
      role: 'org:member',
      createdAt: Date.parse('2026-05-01T10:00:00.000Z'),
    })

    expect(result).toBeNull()
  })

  it('returns null when publicUserData has no email identifier', () => {
    const result = projectClerkMember({
      publicUserData: {
        userId: 'clerk_user_x',
        identifier: null,
        firstName: 'No',
        lastName: 'Email',
      },
      role: 'org:member',
      createdAt: Date.parse('2026-05-01T10:00:00.000Z'),
    })

    expect(result).toBeNull()
  })

  it('trims whitespace when only first or last name is set', () => {
    const result = projectClerkMember({
      publicUserData: {
        userId: 'clerk_user_x',
        identifier: 'firstonly@example.com',
        firstName: 'Jordan',
        lastName: null,
      },
      role: 'org:member',
      createdAt: null,
    })
    expect((result as ClerkOrgMember).name).toBe('Jordan')
  })

  it('emits empty name when Clerk has neither first nor last name', () => {
    const result = projectClerkMember({
      publicUserData: {
        userId: 'clerk_user_x',
        identifier: 'noname@example.com',
        firstName: null,
        lastName: null,
      },
      role: 'org:member',
      createdAt: null,
    })
    expect((result as ClerkOrgMember).name).toBe('')
  })

  it('returns null joinedAt when createdAt is missing', () => {
    const result = projectClerkMember({
      publicUserData: {
        userId: 'clerk_user_x',
        identifier: 'x@example.com',
        firstName: 'X',
        lastName: 'Y',
      },
      role: 'org:member',
      createdAt: null,
    })
    expect((result as ClerkOrgMember).joinedAt).toBeNull()
  })
})

describe('projectClerkPendingInvite', () => {
  it('maps a pending invitation to the pending_invite shape', () => {
    const result = projectClerkPendingInvite({
      emailAddress: 'newhire@smithlaw.com',
      role: 'org:member',
      status: 'pending',
      createdAt: Date.parse('2026-05-20T09:00:00.000Z'),
      expiresAt: Date.parse('2026-06-19T09:00:00.000Z'),
    })

    expect(result).not.toBeNull()
    const inv = result as ClerkOrgPendingInvite
    expect(inv.kind).toBe('pending_invite')
    expect(inv.email).toBe('newhire@smithlaw.com')
    expect(inv.name).toBe('')
    expect(inv.clerkUserId).toBeNull()
    expect(inv.role).toBe('org:member')
    expect(inv.joinedAt).toBeNull()
    expect(inv.invitedAt).toBe('2026-05-20T09:00:00.000Z')
    expect(inv.expiresAt).toBe('2026-06-19T09:00:00.000Z')
  })

  it('returns null when the invitation status is accepted', () => {
    const result = projectClerkPendingInvite({
      emailAddress: 'joined@example.com',
      role: 'org:member',
      status: 'accepted',
      createdAt: Date.parse('2026-05-20T09:00:00.000Z'),
      expiresAt: null,
    })
    expect(result).toBeNull()
  })

  it('returns null for revoked and expired invitations', () => {
    expect(
      projectClerkPendingInvite({
        emailAddress: 'revoked@example.com',
        role: 'org:member',
        status: 'revoked',
        createdAt: null,
        expiresAt: null,
      })
    ).toBeNull()

    expect(
      projectClerkPendingInvite({
        emailAddress: 'expired@example.com',
        role: 'org:member',
        status: 'expired',
        createdAt: null,
        expiresAt: null,
      })
    ).toBeNull()
  })

  it('returns null when status is missing entirely', () => {
    const result = projectClerkPendingInvite({
      emailAddress: 'unknown@example.com',
      role: 'org:member',
      status: null,
      createdAt: null,
      expiresAt: null,
    })
    expect(result).toBeNull()
  })

  it('tolerates a missing expiresAt by surfacing null', () => {
    const result = projectClerkPendingInvite({
      emailAddress: 'noexp@example.com',
      role: 'org:member',
      status: 'pending',
      createdAt: Date.parse('2026-05-20T09:00:00.000Z'),
      expiresAt: null,
    })
    expect((result as ClerkOrgPendingInvite).expiresAt).toBeNull()
  })
})

describe('dedupePendingAgainstMembers', () => {
  function makeMember(email: string): ClerkOrgMember {
    return {
      kind: 'member',
      email,
      name: '',
      clerkUserId: 'clerk_x',
      role: 'org:member',
      joinedAt: null,
      invitedAt: null,
      expiresAt: null,
    }
  }

  function makeInvite(email: string): ClerkOrgPendingInvite {
    return {
      kind: 'pending_invite',
      email,
      name: '',
      clerkUserId: null,
      role: 'org:member',
      joinedAt: null,
      invitedAt: null,
      expiresAt: null,
    }
  }

  it('drops a pending invite whose email matches a joined member', () => {
    const members = [makeMember('alex@smithlaw.com')]
    const pending = [makeInvite('alex@smithlaw.com'), makeInvite('newhire@smithlaw.com')]
    const result = dedupePendingAgainstMembers(pending, members)
    expect(result).toHaveLength(1)
    expect(result[0].email).toBe('newhire@smithlaw.com')
  })

  it('matches emails case-insensitively', () => {
    const members = [makeMember('Alex@smithlaw.com')]
    const pending = [makeInvite('ALEX@SMITHLAW.COM')]
    const result = dedupePendingAgainstMembers(pending, members)
    expect(result).toHaveLength(0)
  })

  it('returns the input unchanged when there are no overlaps', () => {
    const members = [makeMember('a@x.com')]
    const pending = [makeInvite('b@x.com'), makeInvite('c@x.com')]
    const result = dedupePendingAgainstMembers(pending, members)
    expect(result).toHaveLength(2)
    expect(result.map((p) => p.email)).toEqual(['b@x.com', 'c@x.com'])
  })

  it('returns an empty list when pending is empty', () => {
    const result = dedupePendingAgainstMembers([], [makeMember('a@x.com')])
    expect(result).toEqual([])
  })
})
