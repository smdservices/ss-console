/**
 * Tests for the AI Employee reviewer-as-sender pathway
 * (src/lib/portal/ai-employee/send-as.ts) and the supporting detail
 * resolver (src/lib/portal/ai-employee/drafts.ts).
 *
 * The reviewer-as-sender invariant is the architectural property of
 * ADR 0005 — no code path may ship a customer-bound message under any
 * identity other than the human reviewer's email. These tests pin the
 * contract at three layers:
 *
 *   1. Function signature: `sendAsReviewer` requires a `Reviewer`
 *      positional arg. A call without a reviewer must fail TypeScript
 *      compilation. We can't assert that at runtime, but we can
 *      verify the runtime-side mismatch guard rejects a draft whose
 *      staged mailbox differs from the reviewer's email.
 *
 *   2. Result shape: while the Microsoft Graph connector (#822) is
 *      pending, `sendAsReviewer` returns `{ status: 'pending_connector' }`.
 *      The test pins that contract — no fake "delivered" status, no
 *      silent success.
 *
 *   3. Audit emission: every approval emits a structured
 *      `send_approved` event with the issue-specified metadata shape
 *      (`approver_id`, `draft_hash`, `reviewer_email`, `send_window_ms`,
 *      `timestamp`). `buildSendApprovedAuditEvent` is exercised with
 *      a fixed `now` so the timestamp is deterministic for assertion.
 *
 * The undo-window arithmetic (`clampUndoWindowMs`) is also pinned
 * because the 5_000ms default is part of the issue's stated AC.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_UNDO_WINDOW_MS,
  MAX_UNDO_WINDOW_MS,
  buildSendApprovedAuditEvent,
  clampUndoWindowMs,
  hashDraftBody,
  recordSendApprovedAudit,
  sendAsReviewer,
  type Reviewer,
} from '../src/lib/portal/ai-employee/send-as'
import type { DraftDetail } from '../src/lib/portal/ai-employee/drafts'
import { formatDraftSendStatus } from '../src/lib/portal/ai-employee/drafts'

function makeDraft(overrides: Partial<DraftDetail> = {}): DraftDetail {
  return {
    id: 'd-870-1',
    sender: 'Marcus (AI Employee for Smith Law)',
    recipient: 'opposing@example.com',
    skill: 'pi-demand-letter',
    trustCeiling: 'draft_for_review',
    ageSeconds: 1800,
    priority: 'normal',
    subject: 'Demand letter — Case 24-001',
    bodyPlain:
      'Dear Counsel,\n\nPlease find our demand attached. We propose mediation on or before...\n\nRegards,\nPat',
    personaName: 'Marcus',
    personaDraftedAt: '2026-05-21T14:00:00.000Z',
    reviewerEmail: 'pat.owner@smithlaw.com',
    sendStatus: 'pending',
    sendError: null,
    // sources[] is required on DraftDetail per #807. The send-as flow
    // never reads this field — the sourcing block is a separate detail
    // surface. Empty array keeps the helper type-correct without
    // adding fabricated content.
    sources: [],
    ...overrides,
  }
}

function makeReviewer(overrides: Partial<Reviewer> = {}): Reviewer {
  return {
    userId: 'u-pat',
    email: 'pat.owner@smithlaw.com',
    displayName: 'Pat Owner',
    role: 'principal',
    ...overrides,
  }
}

describe('clampUndoWindowMs', () => {
  it('returns the default for null / undefined', () => {
    expect(clampUndoWindowMs(null)).toBe(DEFAULT_UNDO_WINDOW_MS)
    expect(clampUndoWindowMs(undefined)).toBe(DEFAULT_UNDO_WINDOW_MS)
  })

  it('returns the default for non-finite or negative values', () => {
    expect(clampUndoWindowMs(NaN)).toBe(DEFAULT_UNDO_WINDOW_MS)
    expect(clampUndoWindowMs(-1)).toBe(DEFAULT_UNDO_WINDOW_MS)
    expect(clampUndoWindowMs(-9999)).toBe(DEFAULT_UNDO_WINDOW_MS)
  })

  it('passes through a valid value', () => {
    expect(clampUndoWindowMs(7_000)).toBe(7_000)
  })

  it('floors fractional values', () => {
    expect(clampUndoWindowMs(5_499.9)).toBe(5_499)
  })

  it('caps at MAX_UNDO_WINDOW_MS', () => {
    expect(clampUndoWindowMs(MAX_UNDO_WINDOW_MS + 1_000)).toBe(MAX_UNDO_WINDOW_MS)
    expect(clampUndoWindowMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_UNDO_WINDOW_MS)
  })

  it('keeps the default at five seconds', () => {
    // Issue AC: default 5 sec. Pinned here so a future "make it 30s by
    // default" change has to update the test and the AC together.
    expect(DEFAULT_UNDO_WINDOW_MS).toBe(5_000)
  })
})

describe('hashDraftBody', () => {
  it('produces a deterministic SHA-256 hex digest', async () => {
    const hash1 = await hashDraftBody('hello reviewer')
    const hash2 = await hashDraftBody('hello reviewer')
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different digests for different bytes', async () => {
    const a = await hashDraftBody('hello reviewer')
    const b = await hashDraftBody('hello reviewer ')
    expect(a).not.toBe(b)
  })

  it('binds to the exact bytes — whitespace matters', async () => {
    // The audit row binds to the bytes the reviewer saw at approve
    // time. A trailing newline change must produce a different hash
    // so a post-approval edit is detectable.
    const original = 'Dear counsel,\n\nRegards,\nPat'
    const edited = 'Dear counsel,\n\nRegards,\nPat\n'
    expect(await hashDraftBody(original)).not.toBe(await hashDraftBody(edited))
  })
})

describe('sendAsReviewer — reviewer-as-sender invariant', () => {
  it('returns pending_connector while the connector is stubbed (#822)', async () => {
    const draft = makeDraft()
    const reviewer = makeReviewer()
    const result = await sendAsReviewer(draft, reviewer)
    expect(result.status).toBe('pending_connector')
    expect(result.reviewerEmail).toBe(reviewer.email)
    expect(result.sentAt).toBeNull()
    expect(result.error).toBeNull()
  })

  it('refuses to send when the draft is staged for a different reviewer mailbox', async () => {
    const draft = makeDraft({ reviewerEmail: 'someone.else@smithlaw.com' })
    const reviewer = makeReviewer({ email: 'pat.owner@smithlaw.com' })
    const result = await sendAsReviewer(draft, reviewer)
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/staged into a different reviewer mailbox/i)
  })

  it('is case-insensitive on the reviewer email match', async () => {
    // Email addresses are case-insensitive per RFC 5321; the
    // invariant must not refuse a valid send because of case drift.
    const draft = makeDraft({ reviewerEmail: 'Pat.Owner@smithlaw.com' })
    const reviewer = makeReviewer({ email: 'pat.owner@smithlaw.com' })
    const result = await sendAsReviewer(draft, reviewer)
    expect(result.status).toBe('pending_connector')
  })

  it('does not expose an "agent" or "system" send pathway', () => {
    // The function signature requires a Reviewer. We can't call it
    // without one (TypeScript would refuse). This test pins the
    // signature shape — sendAsReviewer accepts exactly two args, the
    // second being a Reviewer.
    expect(sendAsReviewer.length).toBe(2)
  })
})

describe('buildSendApprovedAuditEvent — issue-specified metadata shape', () => {
  it('produces every field the issue lists, plus a sendStatus', () => {
    const event = buildSendApprovedAuditEvent({
      approverId: 'u-pat',
      approverEmail: 'pat.owner@smithlaw.com',
      draftId: 'd-870-1',
      draftHash: 'a'.repeat(64),
      reviewerEmail: 'pat.owner@smithlaw.com',
      sendWindowMs: 5_000,
      sendStatus: 'pending_connector',
      now: new Date('2026-05-21T14:00:00.000Z'),
    })

    // Issue AC: metadata includes { approver_id, draft_hash,
    // reviewer_email, send_window_ms, timestamp }.
    expect(event.approverId).toBe('u-pat')
    expect(event.draftHash).toBe('a'.repeat(64))
    expect(event.reviewerEmail).toBe('pat.owner@smithlaw.com')
    expect(event.sendWindowMs).toBe(5_000)
    expect(event.timestamp).toBe('2026-05-21T14:00:00.000Z')

    // Bound to the dispatch outcome so the audit log shows both the
    // approval and the connector result.
    expect(event.sendStatus).toBe('pending_connector')
  })
})

describe('recordSendApprovedAudit — log-line emission contract', () => {
  it('emits a structured JSON line with the audit:send_approved prefix', async () => {
    const lines: string[] = []
    const original = console.info
    console.info = ((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '))
    }) as typeof console.info

    try {
      await recordSendApprovedAudit(
        buildSendApprovedAuditEvent({
          approverId: 'u-pat',
          approverEmail: 'pat.owner@smithlaw.com',
          draftId: 'd-870-1',
          draftHash: 'b'.repeat(64),
          reviewerEmail: 'pat.owner@smithlaw.com',
          sendWindowMs: 5_000,
          sendStatus: 'sent',
          now: new Date('2026-05-21T15:00:00.000Z'),
        })
      )
    } finally {
      console.info = original
    }

    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.type).toBe('audit:send_approved')
    expect(parsed.approverId).toBe('u-pat')
    expect(parsed.draftHash).toBe('b'.repeat(64))
    expect(parsed.reviewerEmail).toBe('pat.owner@smithlaw.com')
    expect(parsed.sendWindowMs).toBe(5_000)
    expect(parsed.sendStatus).toBe('sent')
    expect(parsed.timestamp).toBe('2026-05-21T15:00:00.000Z')
  })
})

describe('formatDraftSendStatus — closed vocabulary labels', () => {
  it('maps every send status to a human label', () => {
    expect(formatDraftSendStatus('pending')).toBe('Ready for review')
    expect(formatDraftSendStatus('sending')).toBe('Sending')
    expect(formatDraftSendStatus('sent')).toBe('Sent')
    expect(formatDraftSendStatus('send_failed')).toBe('Send failed')
  })
})
