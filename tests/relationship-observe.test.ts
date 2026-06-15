/**
 * Tests for the relationship-surface view-model
 * (src/lib/admin/relationship-observe.ts) — admin Operator console §5.6, ADR 0048.
 *
 * Two contracts matter: (1) parseStyleCorrections defensively parses the opaque
 * memory_export payload — skipping superseded rows and rows missing required
 * fields rather than rendering them half-formed; (2) loadStyleLane mirrors the
 * runtime-observe discipline — not_enabled WITHOUT a read (no audit noise) when
 * the seam is unconfigured, fail-closed to unreachable on a read error, and
 * empty/items otherwise. The transport + audit are injected stubs.
 */

import { describe, it, expect } from 'vitest'
import {
  parseStyleCorrections,
  loadStyleLane,
  parseStandingPreferences,
  loadStandingPreferences,
} from '../src/lib/admin/relationship-observe'
import type {
  MachineRuntimeTransport,
  RuntimeReadAudit,
  RuntimeReadActor,
} from '../src/lib/operator/runtime-read'

const actor: RuntimeReadActor = { actor: 'captain@example.com', actorRole: 'admin' }

function countingAudit(): { audit: RuntimeReadAudit; getCalls: () => number } {
  let calls = 0
  return { audit: { record: async () => void (calls += 1) }, getCalls: () => calls }
}

function transportReturning(data: unknown): MachineRuntimeTransport {
  return { read: async () => ({ data }) }
}

const aRow = (over: Record<string, unknown> = {}) => ({
  _rowid: 1,
  id: 'c1',
  correction_kind: 'signoff',
  pattern_kind: 'literal_ci',
  before_pattern: 'Sincerely,',
  after_text: 'Best,',
  source: 'live_edit',
  reviewer_user_id: null,
  recipient_cohort: null,
  superseded_by: null,
  ...over,
})

describe('parseStyleCorrections', () => {
  it('parses a valid row into a StyleCorrection', () => {
    const out = parseStyleCorrections({ entries: [aRow()] })
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      correctionKind: 'signoff',
      beforePattern: 'Sincerely,',
      afterText: 'Best,',
      source: 'live_edit',
      reviewerUserId: null,
      recipientCohort: null,
    })
  })

  it('preserves scope fields when present', () => {
    const out = parseStyleCorrections({
      entries: [aRow({ reviewer_user_id: 'chris', recipient_cohort: 'client' })],
    })
    expect(out[0].reviewerUserId).toBe('chris')
    expect(out[0].recipientCohort).toBe('client')
  })

  it('skips superseded rows', () => {
    expect(parseStyleCorrections({ entries: [aRow({ superseded_by: 'c2' })] })).toEqual([])
  })

  it('skips rows missing a required field', () => {
    expect(parseStyleCorrections({ entries: [aRow({ correction_kind: null })] })).toEqual([])
    expect(parseStyleCorrections({ entries: [aRow({ after_text: 42 })] })).toEqual([])
    expect(parseStyleCorrections({ entries: [aRow({ source: '' })] })).toEqual([])
  })

  it('is total on malformed payloads', () => {
    expect(parseStyleCorrections(null)).toEqual([])
    expect(parseStyleCorrections({})).toEqual([])
    expect(parseStyleCorrections({ entries: 'nope' })).toEqual([])
    expect(parseStyleCorrections({ entries: [null, 7, 'x'] })).toEqual([])
  })
})

describe('loadStyleLane', () => {
  it('returns not_enabled WITHOUT a read when unconfigured', async () => {
    const { audit, getCalls } = countingAudit()
    const res = await loadStyleLane(
      { transport: transportReturning({ entries: [aRow()] }), audit },
      'smd',
      actor,
      false
    )
    expect(res).toEqual({ status: 'not_enabled' })
    expect(getCalls()).toBe(0)
  })

  it('classifies rows as items', async () => {
    const { audit } = countingAudit()
    const res = await loadStyleLane(
      { transport: transportReturning({ entries: [aRow()] }), audit },
      'smd',
      actor,
      true
    )
    expect(res.status).toBe('items')
    if (res.status === 'items') expect(res.corrections).toHaveLength(1)
  })

  it('classifies no rows as empty', async () => {
    const { audit } = countingAudit()
    const res = await loadStyleLane(
      { transport: transportReturning({ entries: [] }), audit },
      'smd',
      actor,
      true
    )
    expect(res).toEqual({ status: 'empty' })
  })

  it('fails closed to unreachable on a read error', async () => {
    const { audit } = countingAudit()
    const transport: MachineRuntimeTransport = {
      read: async () => {
        throw new Error('boom')
      },
    }
    const res = await loadStyleLane({ transport, audit }, 'smd', actor, true)
    expect(res.status).toBe('unreachable')
  })
})

const aPerson = (over: Record<string, unknown> = {}) => ({
  id: 'scott-durgan',
  name: 'Scott Durgan',
  role: 'Principal',
  prefers: ['Lead with the material change'],
  avoid: ['Inventing estimates'],
  ...over,
})

describe('parseStandingPreferences', () => {
  it('parses a valid person', () => {
    const out = parseStandingPreferences({ entries: [aPerson()] })
    expect(out).toEqual([
      {
        id: 'scott-durgan',
        name: 'Scott Durgan',
        role: 'Principal',
        prefers: ['Lead with the material change'],
        avoid: ['Inventing estimates'],
      },
    ])
  })

  it('normalizes optional fields (absent role → null, lists → [])', () => {
    const out = parseStandingPreferences({ entries: [{ id: 'p1', name: 'P' }] })
    expect(out[0]).toEqual({ id: 'p1', name: 'P', role: null, prefers: [], avoid: [] })
  })

  it('drops non-string list items', () => {
    const out = parseStandingPreferences({ entries: [aPerson({ prefers: ['ok', 42, ''] })] })
    expect(out[0].prefers).toEqual(['ok'])
  })

  it('skips rows missing id or name', () => {
    expect(parseStandingPreferences({ entries: [{ name: 'no id' }] })).toEqual([])
    expect(parseStandingPreferences({ entries: [{ id: 'no-name' }] })).toEqual([])
  })

  it('is total on malformed payloads', () => {
    expect(parseStandingPreferences(null)).toEqual([])
    expect(parseStandingPreferences({ entries: 'nope' })).toEqual([])
    expect(parseStandingPreferences({ entries: [null, 7] })).toEqual([])
  })
})

describe('loadStandingPreferences', () => {
  it('returns not_enabled WITHOUT a read when unconfigured', async () => {
    const { audit, getCalls } = countingAudit()
    const res = await loadStandingPreferences(
      { transport: transportReturning({ entries: [aPerson()] }), audit },
      'smd',
      actor,
      false
    )
    expect(res).toEqual({ status: 'not_enabled' })
    expect(getCalls()).toBe(0)
  })

  it('classifies people as items', async () => {
    const { audit } = countingAudit()
    const res = await loadStandingPreferences(
      { transport: transportReturning({ entries: [aPerson()] }), audit },
      'smd',
      actor,
      true
    )
    expect(res.status).toBe('items')
    if (res.status === 'items') expect(res.people).toHaveLength(1)
  })

  it('classifies no people as empty', async () => {
    const { audit } = countingAudit()
    const res = await loadStandingPreferences(
      { transport: transportReturning({ entries: [] }), audit },
      'smd',
      actor,
      true
    )
    expect(res).toEqual({ status: 'empty' })
  })

  it('fails closed to unreachable on a read error', async () => {
    const { audit } = countingAudit()
    const transport: MachineRuntimeTransport = {
      read: async () => {
        throw new Error('boom')
      },
    }
    const res = await loadStandingPreferences({ transport, audit }, 'smd', actor, true)
    expect(res.status).toBe('unreachable')
  })
})
