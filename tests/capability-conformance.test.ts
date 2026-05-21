/**
 * Tests for the AI Employee capability conformance harness
 * (src/lib/ai-employee/capabilities/conformance.ts).
 *
 * The harness defends ADR 0005 (reviewer-as-sender) and the Platform
 * PRD invariants at the adapter layer: an adapter that exposes
 * `Email.send` or `Payments.initiate_transfer` is a release blocker,
 * not a code-review nit. These tests verify the harness catches what
 * it claims to catch.
 *
 * Vendor adapters do not exist yet — the tests use minimal in-test
 * fakes to drive each invariant. Adapter authors copy the fake shape
 * when wiring real vendors.
 */

import { describe, it, expect } from 'vitest'
import {
  AdapterError,
  CONFORMANCE_INVARIANTS,
  BANNED_METHOD_NAMES,
  inspectAdapter,
  assertCapabilitySetWellFormed,
  assertHealthStatusWellFormed,
  makeAdapterErrorCodes,
  type AdapterBase,
  type CapabilityName,
  type CapabilitySet,
  type HealthStatus,
} from '../src/lib/ai-employee/capabilities'

function makeAdapter(
  capability: CapabilityName,
  extra: Record<string, unknown> = {},
  setOverrides: Partial<CapabilitySet> = {}
): AdapterBase {
  const set: CapabilitySet = {
    capability,
    adapter: 'test-adapter',
    version: '1.0.0',
    supported_methods: ['describe_capabilities', 'health_check'],
    unsupported_methods: [],
    ...setOverrides,
  }
  const adapter: AdapterBase = {
    describe_capabilities: () => set,
    health_check: () =>
      Promise.resolve({
        status: 'healthy' as const,
        last_ok_at: new Date().toISOString(),
      }),
  }
  return Object.assign(adapter, extra)
}

describe('capability conformance: invariant constants', () => {
  it('CONFORMANCE_INVARIANTS includes every invariant the harness claims to check', () => {
    const expected = [
      'CAPABILITY_SET_HONEST',
      'NULL_FOR_ABSENT',
      'TYPED_ERRORS',
      'NO_AUTONOMOUS_EXTERNAL_SEND',
      'NO_AUTONOMOUS_TRUST_TRANSFER',
      'HEALTH_CHECK_BOUNDED',
      'UNSUPPORTED_METHODS_THROW',
      'NO_FIELD_FABRICATION',
    ]
    expect(Object.keys(CONFORMANCE_INVARIANTS).sort()).toEqual(expected.sort())
  })

  it('BANNED_METHOD_NAMES enumerates every capability so the harness never silently skips one', () => {
    const expected: CapabilityName[] = [
      'PracticeManagement',
      'Email',
      'Calendar',
      'DocumentStorage',
      'ESign',
      'CourtAccess',
      'Payments',
      'Accounting',
      'IntakeCRM',
      'CallTracking',
      'InternalComms',
    ]
    expect(Object.keys(BANNED_METHOD_NAMES).sort()).toEqual(expected.sort())
  })

  it('makeAdapterErrorCodes returns the closed set of AdapterErrorCode values', () => {
    const codes = makeAdapterErrorCodes()
    expect(codes).toContain('not_found')
    expect(codes).toContain('unauthorized')
    expect(codes).toContain('scope_violation')
    expect(codes).toContain('fabrication_blocked')
    expect(codes).toContain('capability_not_supported')
  })
})

describe('capability conformance: NO_AUTONOMOUS_EXTERNAL_SEND', () => {
  it('passes a vanilla Email adapter without forbidden methods', () => {
    const adapter = makeAdapter('Email')
    const result = inspectAdapter(adapter)
    expect(result.passed).toBe(true)
    expect(result.banned_methods_present).toEqual([])
    expect(result.invariants.NO_AUTONOMOUS_EXTERNAL_SEND).toBe(true)
  })

  it('fails an Email adapter that exposes a send() method (ADR 0005 violation)', () => {
    const adapter = makeAdapter('Email', { send: () => Promise.resolve() })
    const result = inspectAdapter(adapter)
    expect(result.passed).toBe(false)
    expect(result.banned_methods_present).toContain('send')
    expect(result.invariants.NO_AUTONOMOUS_EXTERNAL_SEND).toBe(false)
    expect(result.notes.some((n) => n.includes('send'))).toBe(true)
  })

  it('fails an ESign adapter that exposes send_envelope (ADR 0005 violation)', () => {
    const adapter = makeAdapter('ESign', { send_envelope: () => Promise.resolve() })
    const result = inspectAdapter(adapter)
    expect(result.passed).toBe(false)
    expect(result.banned_methods_present).toContain('send_envelope')
  })

  it('fails a Calendar adapter that exposes send_invitation', () => {
    const adapter = makeAdapter('Calendar', { send_invitation: () => Promise.resolve() })
    const result = inspectAdapter(adapter)
    expect(result.passed).toBe(false)
    expect(result.banned_methods_present).toContain('send_invitation')
  })

  it('fails a DocumentStorage adapter that exposes share_document (use share_document_draft)', () => {
    const adapter = makeAdapter('DocumentStorage', { share_document: () => Promise.resolve() })
    const result = inspectAdapter(adapter)
    expect(result.passed).toBe(false)
    expect(result.banned_methods_present).toContain('share_document')
  })

  it('lists every forbidden method when an adapter exposes several', () => {
    const adapter = makeAdapter('Email', {
      send: () => Promise.resolve(),
      send_email: () => Promise.resolve(),
      send_message: () => Promise.resolve(),
    })
    const result = inspectAdapter(adapter)
    expect(result.banned_methods_present).toEqual(
      expect.arrayContaining(['send', 'send_email', 'send_message'])
    )
    expect(result.banned_methods_present).toHaveLength(3)
  })
})

describe('capability conformance: NO_AUTONOMOUS_TRUST_TRANSFER', () => {
  it('marks the invariant as N/A for non-Payments adapters', () => {
    const adapter = makeAdapter('PracticeManagement')
    const result = inspectAdapter(adapter)
    expect(result.invariants.NO_AUTONOMOUS_TRUST_TRANSFER).toBe(null)
  })

  it('passes a Payments adapter with no transfer methods', () => {
    const adapter = makeAdapter('Payments')
    const result = inspectAdapter(adapter)
    expect(result.invariants.NO_AUTONOMOUS_TRUST_TRANSFER).toBe(true)
    expect(result.passed).toBe(true)
  })

  it('fails a Payments adapter that exposes trust_disbursement (invariant #3 violation)', () => {
    const adapter = makeAdapter('Payments', { trust_disbursement: () => Promise.resolve() })
    const result = inspectAdapter(adapter)
    expect(result.invariants.NO_AUTONOMOUS_TRUST_TRANSFER).toBe(false)
    expect(result.banned_methods_present).toContain('trust_disbursement')
  })

  it('fails a Payments adapter that exposes initiate_transfer', () => {
    const adapter = makeAdapter('Payments', { initiate_transfer: () => Promise.resolve() })
    const result = inspectAdapter(adapter)
    expect(result.invariants.NO_AUTONOMOUS_TRUST_TRANSFER).toBe(false)
    expect(result.banned_methods_present).toContain('initiate_transfer')
  })
})

describe('capability conformance: CAPABILITY_SET_HONEST', () => {
  it('flags an adapter whose capability is not in the closed union', () => {
    const adapter = makeAdapter(
      'Email',
      {},
      {
        capability: 'NotARealCapability' as CapabilityName,
      }
    )
    const result = inspectAdapter(adapter)
    expect(result.invariants.CAPABILITY_SET_HONEST).toBe(false)
    expect(result.passed).toBe(false)
  })
})

describe('AdapterError', () => {
  it('preserves the code, adapter, and capability', () => {
    const err = new AdapterError('rate_limited', 'Email', 'microsoft-graph', 'slow down')
    expect(err.code).toBe('rate_limited')
    expect(err.adapter).toBe('microsoft-graph')
    expect(err.capability).toBe('Email')
    expect(err.message).toBe('slow down')
  })

  it('attaches cause when given', () => {
    const cause = new Error('original')
    const err = new AdapterError('transient', 'Payments', 'lawpay', 'wrapped', cause)
    expect(err.cause).toBe(cause)
  })

  it('omits cause when not provided', () => {
    const err = new AdapterError('not_found', 'Email', 'gmail', 'missing')
    expect(err.cause).toBeUndefined()
  })
})

describe('capability conformance: helpers', () => {
  it('assertCapabilitySetWellFormed rejects empty adapter slug', () => {
    expect(() =>
      assertCapabilitySetWellFormed({
        capability: 'Email',
        adapter: '',
        version: '1.0.0',
        supported_methods: ['x'],
        unsupported_methods: [],
      })
    ).toThrow(/adapter/)
  })

  it('assertCapabilitySetWellFormed rejects empty supported_methods', () => {
    expect(() =>
      assertCapabilitySetWellFormed({
        capability: 'Email',
        adapter: 'a',
        version: '1.0.0',
        supported_methods: [],
        unsupported_methods: [],
      })
    ).toThrow(/supported_methods/)
  })

  it('assertCapabilitySetWellFormed rejects supported / unsupported overlap', () => {
    expect(() =>
      assertCapabilitySetWellFormed({
        capability: 'Email',
        adapter: 'a',
        version: '1.0.0',
        supported_methods: ['x', 'y'],
        unsupported_methods: ['y', 'z'],
      })
    ).toThrow(/y/)
  })

  it('assertCapabilitySetWellFormed accepts a well-formed set', () => {
    expect(() =>
      assertCapabilitySetWellFormed({
        capability: 'Email',
        adapter: 'a',
        version: '1.0.0',
        supported_methods: ['x'],
        unsupported_methods: ['y'],
      })
    ).not.toThrow()
  })

  it('assertHealthStatusWellFormed rejects an unknown status', () => {
    expect(() =>
      assertHealthStatusWellFormed({
        status: 'fine' as HealthStatus['status'],
        last_ok_at: null,
      })
    ).toThrow(/status/)
  })

  it('assertHealthStatusWellFormed accepts a healthy status', () => {
    expect(() =>
      assertHealthStatusWellFormed({
        status: 'healthy',
        last_ok_at: '2026-05-21T12:00:00Z',
      })
    ).not.toThrow()
  })

  it('assertHealthStatusWellFormed accepts unhealthy with null last_ok_at (never reached)', () => {
    expect(() =>
      assertHealthStatusWellFormed({
        status: 'unhealthy',
        last_ok_at: null,
      })
    ).not.toThrow()
  })
})
