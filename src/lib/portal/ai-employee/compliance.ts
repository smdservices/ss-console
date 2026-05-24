/**
 * AI Employee Compliance dashboard — read resolver.
 *
 * Backs the dedicated Compliance view at
 * `/portal/products/ai-employee/compliance` (issue #895).
 *
 * The view exists because sub-50-attorney PI firms often don't retain
 * ethics counsel — the Compliance role is folded into the principal —
 * but firms that DO bring on outside counsel need a separation-of-duties
 * surface where the audit log, retention controls, and evidence packet
 * generation live together without operator-facing surfaces.
 *
 * `compliance_enabled` on `customer.yaml` is the explicit opt-in. The
 * caller decides what to do when it is false (the page renders an empty
 * state per docs/style/empty-state-pattern.md; no fabricated controls).
 *
 * Retention controls are READ-ONLY in this view. Mutation lives in
 * principal-only Settings (where the rest of customer.yaml editing
 * lives) — this view shows what is currently in effect so compliance
 * reviewers can confirm the firm's audit-history posture without
 * needing principal credentials. The current value comes from the
 * projected `customer.yaml.memory.retention.audit_log_days`; when the
 * projection has not yet been wired (today), the resolver returns null
 * for the override and the view falls back to displaying the vertical's
 * default. This is honest: the vertical default is the value in effect
 * until an override projects.
 */

import { VERTICAL_AUDIT_LOG_DAYS_DEFAULTS } from '../../ai-employee/customer-yaml'
import type { Vertical } from '../../ai-employee/customer-yaml'

/**
 * Retention posture surfaced to the Compliance dashboard. `defaultDays`
 * is the per-vertical minimum from
 * `VERTICAL_AUDIT_LOG_DAYS_DEFAULTS`; `overrideDays` is the customer's
 * declared override (null when omitted, in which case the default
 * applies). `effectiveDays` is the value in effect — equal to override
 * when present, else default.
 */
export interface RetentionPosture {
  vertical: Vertical
  defaultDays: number
  overrideDays: number | null
  effectiveDays: number
}

/**
 * Snapshot the Compliance view renders. Empty by intent when the
 * customer has not opted into the view (compliance_enabled = false) or
 * the projection has not landed; the view branches on the snapshot
 * rather than fabricating any field.
 */
export interface ComplianceView {
  /** Whether the firm has opted into the dedicated Compliance view. */
  enabled: boolean
  /** Vertical-aware retention posture, or null when the firm's
   * vertical is not yet on file (entity row has vertical=null). */
  retention: RetentionPosture | null
  /** Roles the calling user holds. Used by the view to render the
   * read-only banner for principals (who can see this view too as a
   * summary) versus the active-controls path for compliance-role
   * users. The set is derived upstream by resolveAiEmployeeAccess. */
  callerRoles: string[]
}

/**
 * Resolve the Compliance view snapshot for a given customer.
 *
 * `complianceEnabled` is the projected value from `customer_configs`
 * (defaulting to false when no row exists yet, mirroring the schema
 * default). `vertical` is the entity's vertical; we derive the default
 * retention window from it. `auditLogDaysOverride` is the projected
 * override from `customer.yaml.memory.retention.audit_log_days` —
 * pass `null` when the projection has not been wired or no override
 * was declared.
 *
 * No DB calls here: the view's data is small enough that the page
 * fetches what it needs and hands it to this resolver. That keeps the
 * resolver unit-testable without a D1 fixture.
 */
export function resolveComplianceView(input: {
  complianceEnabled: boolean
  vertical: Vertical | null
  auditLogDaysOverride: number | null
  callerRoles: string[]
}): ComplianceView {
  const { complianceEnabled, vertical, auditLogDaysOverride, callerRoles } = input

  let retention: RetentionPosture | null = null
  if (vertical !== null) {
    const defaultDays = VERTICAL_AUDIT_LOG_DAYS_DEFAULTS[vertical]
    const overrideDays =
      typeof auditLogDaysOverride === 'number' && auditLogDaysOverride > 0
        ? auditLogDaysOverride
        : null
    retention = {
      vertical,
      defaultDays,
      overrideDays,
      effectiveDays: overrideDays ?? defaultDays,
    }
  }

  return {
    enabled: complianceEnabled,
    retention,
    callerRoles,
  }
}

/**
 * Friendly label for a retention window. Days are an unfamiliar unit
 * for non-technical compliance reviewers; this renders the equivalent
 * year count alongside.
 *
 * Examples:
 *   formatRetentionWindow(2555) → "2555 days (about 7 years)"
 *   formatRetentionWindow(1095) → "1095 days (about 3 years)"
 *   formatRetentionWindow(365)  → "365 days (1 year)"
 *   formatRetentionWindow(30)   → "30 days"
 */
export function formatRetentionWindow(days: number): string {
  if (days < 365) {
    return `${days} days`
  }
  const years = days / 365
  if (Number.isInteger(years)) {
    return `${days} days (${years === 1 ? '1 year' : `${years} years`})`
  }
  const rounded = Math.round(years)
  return `${days} days (about ${rounded === 1 ? '1 year' : `${rounded} years`})`
}
