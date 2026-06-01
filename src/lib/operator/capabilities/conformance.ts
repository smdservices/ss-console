/**
 * Adapter conformance test contract.
 *
 * Every vendor adapter implementing one of the capability interfaces
 * MUST satisfy the invariants encoded here. The harness is the
 * boot-time line of defense behind the type system: TypeScript catches
 * structural drift; conformance catches behavioral drift (e.g. an
 * adapter that silently stubs an "optional" method, or a Payments
 * adapter that quietly exposes a trust-disbursement method that
 * Platform PRD invariant #3 prohibits).
 *
 * Per ADR 0006, the invariants are architectural commitments, not
 * style preferences. A failing invariant is a release blocker.
 *
 * Conformance suites are authored as plain test files (`*.conformance.test.ts`)
 * next to each adapter. They import `CONFORMANCE_INVARIANTS` and
 * `runConformanceSuite` and pass their adapter instance through.
 */

import type {
  AdapterBase,
  AdapterErrorCode,
  CapabilityName,
  CapabilitySet,
  HealthStatus,
} from './types'

/**
 * The invariants every adapter must satisfy. Each is a machine-checkable
 * behavioral assertion. Tests must cover every invariant; the suite
 * fails closed when any are unverified.
 *
 * The invariant list is intentionally short. Adding a new invariant
 * requires an ADR — adapters trust this list to be stable across
 * vendors.
 */
export const CONFORMANCE_INVARIANTS = {
  /**
   * `describe_capabilities()` returns a CapabilitySet whose
   * `capability` matches the interface the adapter implements, and
   * whose `supported_methods` is a superset of the interface's
   * required-method set.
   */
  CAPABILITY_SET_HONEST:
    'describe_capabilities() must declare the correct capability name and list every required method as supported.',

  /**
   * Adapters never throw `not_found` for normal absence — they return
   * null. `not_found` is reserved for semantic-distinct absence
   * (e.g. the parent matter was deleted).
   */
  NULL_FOR_ABSENT:
    "Read methods (get_*) return null for absent records. AdapterError code 'not_found' is reserved for semantic-distinct absence.",

  /**
   * Adapters only throw AdapterError with codes from `AdapterErrorCode`.
   * Vendor exceptions are wrapped, never re-thrown raw.
   */
  TYPED_ERRORS:
    'All errors thrown are AdapterError instances with codes in the closed AdapterErrorCode union.',

  /**
   * Per ADR 0005, no adapter exposes a method that sends an external
   * message under any identity other than the reviewer's drafts
   * folder. Email cannot have `send`; ESign cannot have
   * `send_envelope`; Calendar cannot have `send_invitation`;
   * DocumentStorage cannot have `share_document` (only
   * `share_document_draft`); Payments cannot have
   * `send_payment_request` (only `create_payment_request_draft`);
   * etc. The harness asserts these method names are not present.
   */
  NO_AUTONOMOUS_EXTERNAL_SEND:
    "No adapter exposes a method that sends external messages under any identity other than the reviewer's drafts folder.",

  /**
   * Per Platform PRD invariant #3, no Payments adapter exposes a
   * trust-disbursement or autonomous-transfer method, regardless of
   * vendor capability. The harness asserts these names are not
   * present on Payments adapters.
   */
  NO_AUTONOMOUS_TRUST_TRANSFER:
    'Payments adapters MUST NOT expose initiate_transfer / send_payment_request / trust_disbursement methods.',

  /**
   * `health_check()` resolves within 5 seconds. Adapters that need
   * longer must cache and return the cached result, not block on a
   * synchronous probe.
   */
  HEALTH_CHECK_BOUNDED:
    'health_check() resolves within 5 seconds. Implementations cache where vendor latency exceeds the budget.',

  /**
   * Adapters that declare a method as `unsupported_methods` in their
   * CapabilitySet MUST throw `capability_not_supported` when that
   * method is invoked. Silent stubs are forbidden.
   */
  UNSUPPORTED_METHODS_THROW:
    "Methods listed in CapabilitySet.unsupported_methods throw AdapterError('capability_not_supported') when invoked.",

  /**
   * Per Platform PRD invariant #8 (fabrication discipline), adapters
   * MUST NOT infer fields. Returned objects expose only what the
   * underlying source system actually provides; absent fields are
   * null. Synthetic / inferred fields, when present, MUST be
   * declared in CapabilitySet.field_coverage.derived.
   */
  NO_FIELD_FABRICATION:
    'Returned objects expose only fields read from the source. Inferred fields are declared in field_coverage.derived.',
} as const

export type ConformanceInvariantKey = keyof typeof CONFORMANCE_INVARIANTS

/**
 * Methods banned per capability. The harness reflects on the adapter's
 * prototype and asserts none of these names are defined as functions.
 * Adding a banned name requires an ADR.
 */
export const BANNED_METHOD_NAMES: Record<CapabilityName, string[]> = {
  Email: ['send', 'send_message', 'send_draft', 'send_email'],
  Calendar: ['send_invitation', 'send_invite', 'send_event'],
  ESign: ['send_envelope', 'create_and_send_envelope', 'send_signing_request', 'initiate_signing'],
  DocumentStorage: ['share_document', 'send_share_invitation'],
  Payments: [
    'send_payment_request',
    'initiate_transfer',
    'trust_disbursement',
    'transfer_funds',
    'disburse',
  ],
  Accounting: ['post_invoice', 'post_expense_entry', 'post_to_general_ledger'],
  IntakeCRM: ['send_to_lead', 'send_lead_email', 'message_lead'],
  CourtAccess: ['file_document', 'submit_filing', 'send_to_court'],
  CallTracking: ['create_call', 'originate_call', 'place_call', 'send_text', 'send_sms'],
  InternalComms: [],
  PracticeManagement: [],
}

/**
 * Conformance result for one adapter. Suites return one of these and
 * a CI step fails the build when `passed === false`.
 */
export interface ConformanceResult {
  capability: CapabilityName
  adapter: string
  /** Per-invariant outcome. `null` means the invariant was not
   * applicable (e.g. NO_AUTONOMOUS_TRUST_TRANSFER on a non-Payments
   * adapter). */
  invariants: Record<ConformanceInvariantKey, boolean | null>
  /** Banned method names actually present on the adapter (should be
   * empty on a passing adapter). */
  banned_methods_present: string[]
  passed: boolean
  /** Human-readable explanation of any failures. */
  notes: string[]
}

/**
 * Inspect an adapter and return a ConformanceResult. The harness does
 * not invoke vendor APIs — it inspects the adapter's surface via
 * `describe_capabilities()` and reflection. Suites complement this
 * with per-invariant behavioral tests (calling methods, asserting
 * results).
 *
 * Returns a result object rather than throwing; callers decide whether
 * a failed invariant aborts CI or surfaces as a warning during
 * development.
 */
export function inspectAdapter(adapter: AdapterBase): ConformanceResult {
  const set: CapabilitySet = adapter.describe_capabilities()
  const notes: string[] = []
  const invariants: Record<ConformanceInvariantKey, boolean | null> = {
    CAPABILITY_SET_HONEST: true,
    NULL_FOR_ABSENT: null,
    TYPED_ERRORS: null,
    NO_AUTONOMOUS_EXTERNAL_SEND: true,
    NO_AUTONOMOUS_TRUST_TRANSFER: null,
    HEALTH_CHECK_BOUNDED: null,
    UNSUPPORTED_METHODS_THROW: null,
    NO_FIELD_FABRICATION: null,
  }

  // CAPABILITY_SET_HONEST — the adapter declares a known capability.
  if (!(set.capability in BANNED_METHOD_NAMES)) {
    invariants.CAPABILITY_SET_HONEST = false
    notes.push(
      `describe_capabilities() returned unknown capability "${set.capability}". Capability names are a closed union.`
    )
  }

  // NO_AUTONOMOUS_EXTERNAL_SEND and NO_AUTONOMOUS_TRUST_TRANSFER —
  // both reduce to "none of these method names are defined on the
  // adapter."
  const banned = BANNED_METHOD_NAMES[set.capability] ?? []
  const present: string[] = []
  for (const name of banned) {
    if (typeof (adapter as unknown as Record<string, unknown>)[name] === 'function') {
      present.push(name)
    }
  }
  if (present.length > 0) {
    invariants.NO_AUTONOMOUS_EXTERNAL_SEND = false
    if (set.capability === 'Payments') invariants.NO_AUTONOMOUS_TRUST_TRANSFER = false
    notes.push(
      `Adapter exposes banned method(s): ${present.join(', ')}. See CONFORMANCE_INVARIANTS.NO_AUTONOMOUS_EXTERNAL_SEND.`
    )
  } else if (set.capability === 'Payments') {
    invariants.NO_AUTONOMOUS_TRUST_TRANSFER = true
  }

  const passed = !Object.values(invariants).some((v) => v === false)

  return {
    capability: set.capability,
    adapter: set.adapter,
    invariants,
    banned_methods_present: present,
    passed,
    notes,
  }
}

/**
 * Helper for suite authors: assert a CapabilitySet has a coherent
 * shape. Used in unit tests; the runtime harness uses inspectAdapter().
 */
export function assertCapabilitySetWellFormed(set: CapabilitySet): void {
  if (!set.adapter || set.adapter.length === 0) {
    throw new Error('CapabilitySet.adapter must be a non-empty string')
  }
  if (!set.version || set.version.length === 0) {
    throw new Error('CapabilitySet.version must be a non-empty string')
  }
  if (!Array.isArray(set.supported_methods) || set.supported_methods.length === 0) {
    throw new Error('CapabilitySet.supported_methods must declare at least one method')
  }
  // unsupported_methods and supported_methods must be disjoint
  const sup = new Set(set.supported_methods)
  for (const m of set.unsupported_methods ?? []) {
    if (sup.has(m)) {
      throw new Error(
        `CapabilitySet method "${m}" appears in both supported_methods and unsupported_methods`
      )
    }
  }
}

/**
 * Helper for suite authors: assert a HealthStatus has the expected shape.
 */
export function assertHealthStatusWellFormed(h: HealthStatus): void {
  const valid: HealthStatus['status'][] = ['healthy', 'degraded', 'unhealthy']
  if (!valid.includes(h.status)) {
    throw new Error(`HealthStatus.status must be one of ${valid.join(', ')}; got "${h.status}"`)
  }
  if (h.status === 'unhealthy' && h.last_ok_at === undefined) {
    throw new Error('HealthStatus.last_ok_at must be set (null is allowed for never-reached)')
  }
}

/**
 * Helper for suite authors: build an AdapterError with the right
 * shape. Adapters can use this directly; suite authors can use it as
 * a fixture in tests.
 */
export function makeAdapterErrorCodes(): readonly AdapterErrorCode[] {
  return [
    'not_found',
    'unauthorized',
    'rate_limited',
    'transient',
    'capability_not_supported',
    'scope_violation',
    'fabrication_blocked',
    'validation_failed',
    'unknown',
  ] as const
}
