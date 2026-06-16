/**
 * Tests for the relationship-surface view-model
 * (src/lib/admin/relationship-observe.ts) — admin Operator console §5.6, ADR 0048.
 *
 * Two contracts matter: (1) parseStandingPreferences defensively parses the
 * opaque config_export payload — skipping rows missing id/name and normalizing
 * optional fields rather than rendering them half-formed; (2) loadStandingPreferences
 * mirrors the runtime-observe discipline — not_enabled WITHOUT a read (no audit
 * noise) when the seam is unconfigured, fail-closed to unreachable on a read
 * error, and empty/items otherwise. The transport + audit are injected stubs.
 */

import { describe, it, expect } from 'vitest'
import {
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
