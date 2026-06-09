/**
 * Tests for the runtime-observe view-model (src/lib/admin/runtime-observe.ts) —
 * admin Operator console §5.5, ADR 0043 path A.
 *
 * The loader's contract is what matters: a not-configured read path returns
 * `not_enabled` WITHOUT attempting a read (no audit noise on a dark feature);
 * a configured read fails closed to `unreachable`, and ok results classify into
 * empty / items. The transport + audit are injected stubs (the real path is the
 * frozen seam, already tested in operator-runtime-read.test.ts).
 */

import { describe, it, expect } from 'vitest'
import { RUNTIME_VIEWS, parseRuntimeView, loadRuntimeView } from '../src/lib/admin/runtime-observe'
import type {
  MachineRuntimeTransport,
  RuntimeReadAudit,
  RuntimeReadActor,
} from '../src/lib/operator/runtime-read'

const actor: RuntimeReadActor = { actor: 'captain@example.com', actorRole: 'admin' }
const activity = RUNTIME_VIEWS[0]

function countingAudit(): { audit: RuntimeReadAudit; getCalls: () => number } {
  let calls = 0
  const audit: RuntimeReadAudit = {
    record: async () => {
      calls += 1
    },
  }
  return { audit, getCalls: () => calls }
}

describe('parseRuntimeView', () => {
  it('resolves known ids and defaults to activity', () => {
    expect(parseRuntimeView('audit').id).toBe('audit')
    expect(parseRuntimeView('matters').id).toBe('matters')
    expect(parseRuntimeView('activity').id).toBe('activity')
    expect(parseRuntimeView(null).id).toBe('activity')
    expect(parseRuntimeView('bogus').id).toBe('activity')
  })

  it('every view maps to a runtime-read kind and a noun', () => {
    for (const v of RUNTIME_VIEWS) {
      expect(v.kind.length).toBeGreaterThan(0)
      expect(v.noun.length).toBeGreaterThan(0)
    }
  })
})

describe('loadRuntimeView', () => {
  it('returns not_enabled WITHOUT reading or auditing when the path is not configured', async () => {
    let readCalls = 0
    const transport: MachineRuntimeTransport = {
      read: async () => {
        readCalls += 1
        return { data: [] }
      },
    }
    const a = countingAudit()
    const res = await loadRuntimeView({ transport, audit: a.audit }, 'acme', activity, actor, false)
    expect(res).toEqual({ status: 'not_enabled' })
    expect(readCalls).toBe(0)
    expect(a.getCalls()).toBe(0) // no audit noise on a dark feature
  })

  it('fails closed to unreachable when the (configured) transport throws', async () => {
    const transport: MachineRuntimeTransport = {
      read: async () => {
        throw new Error('machine down')
      },
    }
    const a = countingAudit()
    const res = await loadRuntimeView({ transport, audit: a.audit }, 'acme', activity, actor, true)
    expect(res).toEqual({ status: 'unreachable', reason: 'unreachable' })
    expect(a.getCalls()).toBe(1) // a real attempt IS audited
  })

  it('classifies an ok-but-empty read as empty', async () => {
    const transport: MachineRuntimeTransport = { read: async () => ({ data: [] }) }
    const a = countingAudit()
    const res = await loadRuntimeView({ transport, audit: a.audit }, 'acme', activity, actor, true)
    expect(res).toEqual({ status: 'empty' })
  })

  it('classifies rows as items with a count (array or {items:[]})', async () => {
    const arr: MachineRuntimeTransport = { read: async () => ({ data: [1, 2, 3] }) }
    const r1 = await loadRuntimeView(
      { transport: arr, audit: countingAudit().audit },
      'acme',
      activity,
      actor,
      true
    )
    expect(r1).toEqual({ status: 'items', count: 3, data: [1, 2, 3] })

    const wrapped: MachineRuntimeTransport = { read: async () => ({ data: { items: [1, 2] } }) }
    const r2 = await loadRuntimeView(
      { transport: wrapped, audit: countingAudit().audit },
      'acme',
      activity,
      actor,
      true
    )
    expect(r2.status).toBe('items')
    if (r2.status === 'items') expect(r2.count).toBe(2)
  })
})
