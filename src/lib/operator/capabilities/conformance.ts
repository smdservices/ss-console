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
   * Reversibility floor (ADR 0025). Adapters MUST NOT expose autonomous
   * methods for irreversible actions — money movement, ledger posting,
   * court filing. These are COMMITMENT / DESTRUCTIVE action classes that
   * `trust_ceiling.enforce()` additionally gates on explicit current-turn
   * approval; the adapter-level absence is defense-in-depth.
   *
   * External *send* (email, SMS, calendar invites, document sharing, lead
   * messaging) is NOT in this floor. Per ADR 0035 it is a configurable
   * entitlement: an adapter MAY expose send methods, and whether a send
   * executes autonomously, routes to a reviewer draft, or is refused is
   * decided at runtime by `trust_ceiling.enforce()` per the authored
   * EXTERNAL_SEND ceiling (fail-closed when unauthored). The draft-for-review
   * external send posture (ADR 0035) is one authored option, never an imposed
   * default — the harness does not ban send method names.
   *
   * (Key name retained for compatibility with existing conformance suites;
   * its meaning is the reversibility floor above.)
   */
  NO_AUTONOMOUS_EXTERNAL_SEND:
    'Adapters do not expose autonomous methods for irreversible actions (money movement, ledger posting, court filing). External send is a configurable entitlement gated at runtime by the trust ceiling, not banned at the adapter.',

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
  // External-send methods are intentionally NOT listed — they are configurable
  // entitlements gated at runtime by `trust_ceiling.enforce()` per the authored
  // EXTERNAL_SEND ceiling (ADR 0025/0035), not banned at the adapter. The
  // surviving entries are the irreversibility floor (ADR 0025): money movement,
  // ledger posting, and court filing, which COMMITMENT/DESTRUCTIVE gating also
  // requires explicit current-turn approval for. `send_payment_request` was an
  // external send (an invoice/request) and is removed; the fund-movement methods
  // stay.
  Email: [],
  Calendar: [],
  ESign: [],
  DocumentStorage: [],
  Payments: ['initiate_transfer', 'trust_disbursement', 'transfer_funds', 'disburse'],
  Accounting: ['post_invoice', 'post_expense_entry', 'post_to_general_ledger'],
  IntakeCRM: [],
  CourtAccess: ['file_document', 'submit_filing', 'send_to_court'],
  CallTracking: [],
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
