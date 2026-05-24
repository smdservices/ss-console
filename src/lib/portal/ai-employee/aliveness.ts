/**
 * AI Employee — dashboard aliveness signal (issue #875).
 *
 * Customers asked "where is the agent right now?" The aliveness signal
 * is the persistent header chip that answers that question without
 * making them open the audit viewer. Four states cover every observable
 * posture of a customer's Hermes Machine:
 *
 *   idle        — the Machine is up; the last audit event is recent and
 *                 nothing is currently running. Healthy default.
 *   running     — there is an in-flight skill invocation. The signal
 *                 carries the skill name so the header reads "Running
 *                 inbox-triage" instead of a generic "Working".
 *   sticky_stop — the safety substrate has pinned the agent. WARN /
 *                 SOFT_STOP / HARD_STOP from `sticky_stop_state` all
 *                 collapse to this signal here; the dashboard surfaces
 *                 the reason text the substrate stored. Captain
 *                 escalation is required to clear (see ADR for
 *                 sticky-stop recovery contract in
 *                 `ai-employee/safety-substrate/sticky_stop.py`).
 *   offline     — no audit_log activity within OFFLINE_THRESHOLD_MINUTES.
 *                 This is a derived posture: the audit writer is
 *                 synchronous on every action (issue #891), so absence
 *                 of audit rows past the freshness window means either
 *                 the Machine is down, the bridge is broken, or the
 *                 customer's agent is genuinely doing nothing.
 *
 * Data sources, when the Hermes bridge lands (#821):
 *
 *   - Latest `audit_log` row → `lastActionAt`, `currentSkill` (when the
 *     action is in flight per a future running-action marker — today
 *     we infer "running" only when the bridge explicitly says so), and
 *     the audit row drives the idle/offline split via timestamp age.
 *
 *   - `sticky_stop_state` (per-customer D1, schema in migration 0004)
 *     → the sticky_stop posture, reason, and the substrate condition
 *     that pinned it.
 *
 * Today the bridge is not wired. `resolveAlivenessSignal` returns null
 * and the AlivenessHeader component renders the empty-state branch
 * (no fabricated activity, per
 * `docs/style/empty-state-pattern.md`). When #821 lands, swap the body
 * of `fetchAlivenessFromHermes`; the derivation, formatters, and
 * threshold constant stay put.
 *
 * The derivation helper `deriveAlivenessFromBridge` is exported pure
 * and tested directly. The component does not derive from raw inputs;
 * it consumes the resolved signal.
 *
 * Per-customer: the resolver takes a `SubscriptionRow` and the bridge
 * routes to the matching customer Machine. Aggregate is explicitly out
 * of scope — the issue AC is "per-customer status, not aggregate."
 */

import type { SubscriptionRow } from '../product-access'

/**
 * Closed vocabulary for the dashboard aliveness signal. The page must
 * render exactly one of these states; unknown / pending data degrades
 * to null (empty-state) rather than fabricating a posture.
 */
export type AlivenessLevel = 'idle' | 'running' | 'sticky_stop' | 'offline'

export const ALIVENESS_LEVELS: readonly AlivenessLevel[] = [
  'idle',
  'running',
  'sticky_stop',
  'offline',
] as const

/**
 * Tone for the aliveness chip, drawn from the portal `Tone` vocabulary
 * in `src/lib/portal/status.ts`. Returned as a string here to avoid
 * importing the full tone module at the resolver layer — the component
 * is the only consumer that needs the typed value, and it imports both
 * sides.
 *
 * Assignment rationale:
 *   idle        → success — the Machine is healthy and reachable
 *   running     → info    — actively working; reviewer-noticeable but
 *                           not actionable
 *   sticky_stop → danger  — Captain escalation required
 *   offline     → warning — degraded; may or may not need attention
 *                           depending on hours-of-operation; reviewers
 *                           should look at the last-action timestamp
 */
export function alivenessTone(level: AlivenessLevel): 'success' | 'info' | 'danger' | 'warning' {
  switch (level) {
    case 'idle':
      return 'success'
    case 'running':
      return 'info'
    case 'sticky_stop':
      return 'danger'
    case 'offline':
      return 'warning'
  }
}

/**
 * Number of minutes of audit-log silence after which a Machine is
 * considered "offline." The audit writer is synchronous on every
 * safety-relevant action; gaps in the log past this window indicate
 * either a downed Machine, a broken bridge, or genuine inactivity.
 *
 * 30 minutes is the default because the AI Employee is an
 * assistant-class agent expected to be active during the firm's
 * business day; a half-hour gap during work hours is the right amount
 * of "something is probably off, take a look." Reviewers can still
 * widen the audit page's date range to see longer-tail history.
 *
 * Tracked as an exported constant so the PR body, tests, and any future
 * customer-yaml override (out of scope today) share one source of
 * truth.
 */
export const OFFLINE_THRESHOLD_MINUTES = 30

/**
 * One resolved aliveness signal for the dashboard header. The component
 * renders exactly the fields present here — no field-presence inference,
 * no derived friendly labels beyond what the formatters below produce.
 *
 *   level              — the four-state enum above.
 *   lastActionAt       — ISO 8601 UTC of the most recent audit_log row.
 *                        null only when the customer has no audit
 *                        history at all (first-day case).
 *   currentSkill       — when `level === 'running'`, the slug of the
 *                        in-flight skill. null in every other state.
 *   stickyStopReason   — when `level === 'sticky_stop'`, the substrate's
 *                        recorded reason string. The Captain-escalation
 *                        affordance surfaces this verbatim. null in
 *                        every other state.
 */
export interface AlivenessSignal {
  level: AlivenessLevel
  lastActionAt: string | null
  currentSkill: string | null
  stickyStopReason: string | null
}

/**
 * Minimal shape of the data the Hermes bridge will return per request.
 * Captured here so `deriveAlivenessFromBridge` has a stable, named
 * contract independent of the audit_log row schema (which carries many
 * fields the dashboard does not use). Keeps test fixtures readable.
 */
export interface AlivenessBridgeReading {
  /** ISO 8601 UTC of the most recent audit_log row, null if none. */
  lastAuditTs: string | null
  /**
   * Slug of an in-flight skill at the moment the bridge was polled,
   * null if nothing is running. The bridge is responsible for the
   * "in-flight" determination (e.g., a started-but-not-completed
   * marker in the per-customer runtime); this module does not infer
   * it from the audit row.
   */
  inFlightSkill: string | null
  /**
   * The forward-only sticky-stop level. 'OK' means not pinned;
   * anything else means the agent is constrained. The level vocabulary
   * mirrors `ai-employee/safety-substrate/sticky_stop.py::StickyStopLevel`.
   * Unknown values surface as 'OK' rather than collapsing to
   * sticky_stop — under-reporting is preferable to false-positive
   * "agent is stopped" copy.
   */
  stickyStopLevel: 'OK' | 'WARN' | 'SOFT_STOP' | 'HARD_STOP'
  /**
   * Human-readable reason text the substrate stored when it pinned the
   * stop. null when `stickyStopLevel === 'OK'`.
   */
  stickyStopReason: string | null
}

/**
 * Pure derivation: bridge reading → AlivenessSignal. The four-state
 * enum collapses from three inputs in priority order:
 *
 *   1. sticky_stop wins over everything else — when the substrate has
 *      pinned the agent, no other posture is interesting until Captain
 *      clears it.
 *   2. an in-flight skill → 'running'.
 *   3. lastAuditTs age compared against OFFLINE_THRESHOLD_MINUTES
 *      decides idle vs offline. No audit history at all (null ts) is
 *      treated as 'offline' too — the bridge is the authority on
 *      "agent is alive enough to write audit rows" and absence is
 *      the honest answer.
 *
 * `nowMs` is injectable for deterministic tests.
 */
export function deriveAlivenessFromBridge(
  reading: AlivenessBridgeReading,
  nowMs: number = Date.now()
): AlivenessSignal {
  if (reading.stickyStopLevel !== 'OK') {
    return {
      level: 'sticky_stop',
      lastActionAt: reading.lastAuditTs,
      currentSkill: null,
      stickyStopReason: reading.stickyStopReason,
    }
  }

  if (reading.inFlightSkill !== null && reading.inFlightSkill.length > 0) {
    return {
      level: 'running',
      lastActionAt: reading.lastAuditTs,
      currentSkill: reading.inFlightSkill,
      stickyStopReason: null,
    }
  }

  if (reading.lastAuditTs === null) {
    return {
      level: 'offline',
      lastActionAt: null,
      currentSkill: null,
      stickyStopReason: null,
    }
  }

  const lastMs = Date.parse(reading.lastAuditTs)
  if (!Number.isFinite(lastMs)) {
    return {
      level: 'offline',
      lastActionAt: reading.lastAuditTs,
      currentSkill: null,
      stickyStopReason: null,
    }
  }

  const ageMs = nowMs - lastMs
  const thresholdMs = OFFLINE_THRESHOLD_MINUTES * 60_000
  if (ageMs > thresholdMs) {
    return {
      level: 'offline',
      lastActionAt: reading.lastAuditTs,
      currentSkill: null,
      stickyStopReason: null,
    }
  }

  return {
    level: 'idle',
    lastActionAt: reading.lastAuditTs,
    currentSkill: null,
    stickyStopReason: null,
  }
}

/**
 * Friendly label for an AlivenessLevel. The component pairs this with
 * the chip tone; the label is the headline text in the header band.
 *
 * Closed vocabulary; the switch is exhaustive so any new level surfaces
 * at compile time.
 */
export function formatAlivenessLevel(level: AlivenessLevel): string {
  switch (level) {
    case 'idle':
      return 'Idle'
    case 'running':
      return 'Running'
    case 'sticky_stop':
      return 'Paused by safety check'
    case 'offline':
      return 'Offline'
  }
}

/**
 * Friendly relative-time label for the last-action timestamp.
 *
 * Returns "just now" for ages under a minute, "N minute(s) ago" up to
 * an hour, "N hour(s) ago" up to a day, "N day(s) ago" beyond that.
 * The component pairs this with the absolute ISO value in a tooltip /
 * `title` attribute so reviewers can hover for the exact instant.
 *
 * Returns null when the input is null or unparseable — the component
 * renders the absolute fallback (`ts` verbatim or omits the line)
 * rather than fabricating "unknown ago" copy.
 *
 * `nowMs` is injectable for deterministic tests.
 */
export function formatLastActionRelative(
  ts: string | null,
  nowMs: number = Date.now()
): string | null {
  if (ts === null) return null
  const tsMs = Date.parse(ts)
  if (!Number.isFinite(tsMs)) return null
  const deltaMs = nowMs - tsMs
  if (deltaMs < 0) return 'just now'
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Format the absolute last-action timestamp for the chip's `title`
 * attribute and the visible secondary line. Same UTC + locale-stable
 * shape the audit page uses (`src/lib/portal/ai-employee/audit.ts ::
 * formatAuditTimestamp`) so the two surfaces agree at a glance.
 *
 * Returns the input verbatim when unparseable.
 */
export function formatLastActionAbsolute(ts: string | null): string | null {
  if (ts === null) return null
  const parsedMs = Date.parse(ts)
  if (!Number.isFinite(parsedMs)) return ts
  const dt = new Date(parsedMs)
  const fmt = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
  return fmt.format(dt)
}

/**
 * Whether the current signal warrants the Captain-escalation
 * affordance. True for `sticky_stop` (the agent is pinned and only
 * Captain can clear) and `offline` (the Machine is not reporting
 * activity and may need investigation). The component renders the
 * affordance only when this is true.
 *
 * `idle` and `running` are healthy postures; surfacing an escalation
 * link there would train customers to ignore it.
 */
export function needsEscalationAffordance(level: AlivenessLevel): boolean {
  return level === 'sticky_stop' || level === 'offline'
}

/**
 * Server-side resolver invoked by the dashboard header. Today this
 * returns null — the per-customer Hermes bridge that feeds real data
 * is tracked in #821. When the bridge lands, replace the body of
 * `fetchAlivenessFromHermes` and the typed contract above stays put.
 *
 * IMPORTANT: do not seed a synthetic "idle" reading here. Per
 * `docs/style/empty-state-pattern.md`, the component must render the
 * empty (silent) state until real data lands, never a fabricated
 * "agent is healthy" chip. A green chip the customer cannot trust is
 * worse than no chip at all.
 */
export async function resolveAlivenessSignal(
  subscription: SubscriptionRow,
  nowMs: number = Date.now()
): Promise<AlivenessSignal | null> {
  const reading = await fetchAlivenessFromHermes(subscription)
  if (reading === null) return null
  return deriveAlivenessFromBridge(reading, nowMs)
}

/**
 * Hermes bridge stub. Returns null. When #821 (Hermes runtime wiring)
 * lands, replace the body with the bridge fetch — the subscription
 * row carries the customer identity needed to route to the right
 * Machine D1.
 */
function fetchAlivenessFromHermes(
  _subscription: SubscriptionRow
): Promise<AlivenessBridgeReading | null> {
  return Promise.resolve(null)
}
