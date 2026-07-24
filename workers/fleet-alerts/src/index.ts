/**
 * Fleet Alerts Worker — heartbeat-red / HARD_STOP / scheduler pager (#1709).
 *
 * Closes the gap ADR 0064's honesty banner named: detection was
 * dashboard-only. Every 2 minutes (cron) this Worker reads the central
 * `fleet_status` table each Machine's heartbeat emitter pushes to (ADR 0023)
 * and emails team@smd.services on condition TRANSITIONS:
 *
 *   heartbeat_red   — the seat HAS reported before, and its last heartbeat is
 *                     older than HEARTBEAT_RED_SECONDS (default 300s = the
 *                     period+grace envelope). Seats with a NULL heartbeat or
 *                     no row at all are provisioning-gray, never alerted —
 *                     a false page trains people to ignore the pager.
 *   hard_stop       — the Machine-reported cost-breaker ladder (ADR 0062) is
 *                     at HARD_STOP.
 *   scheduler_error — the gate's per-beat scheduler self-check reports the
 *                     cron store is unreadable or a job is in an error state
 *                     (scheduler_ok=0). This is the 8-day-silent-death class:
 *                     the gate lives (heartbeats green) but scheduled work
 *                     cannot fire.
 *   work_overdue    — the cron store is readable but a job is past its
 *                     next_run_at by more than WORK_OVERDUE_RED_SECONDS
 *                     (default 900s).
 *
 * Edge-triggered via `fleet_alert_state` (migrations 0086/0093): one open alert
 * per (customer, condition) until recovery, one recovery notice on the green
 * transition, silence otherwise. No alert storm by construction.
 *
 * This Worker only OBSERVES and EMAILS. It never touches a Machine — the
 * response ladder is human doctrine (ADR 0064/0065).
 *
 * The fetch handler exposes a bearer-gated POST /run (same pattern as the
 * cost-anomaly Worker) so the evaluation can be driven on demand for live
 * verification, plus GET /health.
 */

export interface Env {
  DB: D1Database
  RESEND_API_KEY?: string
  ALERT_FROM_EMAIL?: string
  ALERT_TO_EMAIL?: string
  HEARTBEAT_RED_SECONDS?: string
  /**
   * Seconds a job may be past its next_run_at before work_overdue fires.
   * Default 900. MUST match the admin roster's WORK_OVERDUE_RED_SECONDS
   * (src/lib/admin/fleet-status.ts) — the two live in separate wrangler/app
   * packages, so the shared literal is a documented contract, not an import.
   */
  WORK_OVERDUE_RED_SECONDS?: string
  FLEET_ALERTS_BEARER?: string
  ADMIN_BASE_URL?: string
  /**
   * healthchecks.io ping URL for the alerter itself (secret, optional). Pinged
   * at the end of every successful runOnce — if this Worker's cron dies or
   * runOnce throws, healthchecks pages independently. The one piece that makes
   * "unable to die silently" literally true for the watcher.
   */
  ALERTER_HEALTHCHECKS_PING_URL?: string
}

export type FleetCondition = 'heartbeat_red' | 'hard_stop' | 'scheduler_error' | 'work_overdue'

export interface FleetStatusRow {
  customer_slug: string
  last_heartbeat_ts: string | null
  sticky_stop_level: string | null
  scheduler_ok: number | null
  scheduler_max_overdue_seconds: number | null
}

export interface ConditionState {
  customer_slug: string
  condition: FleetCondition
  active: boolean
  /** Human detail for the email body (age, level). */
  detail: string
}

export interface Transition {
  customer_slug: string
  condition: FleetCondition
  kind: 'opened' | 'resolved'
  detail: string
  emailed: boolean
  resendId?: string
}

/**
 * An open alert row whose seat currently reports NULL for that condition's
 * source field (or has no fleet_status row at all — the orphaned pilot-smokeball
 * case from the 16-day alerter wedge). The NULL-hold means these will never
 * auto-resolve; they are surfaced for a documented one-line manual UPDATE.
 */
export interface StaleHold {
  customer_slug: string
  condition: FleetCondition
}

export interface RunSummary {
  at: string
  seats: number
  conditions: ConditionState[]
  transitions: Transition[]
  stale_holds: StaleHold[]
}

const DEFAULT_RED_SECONDS = 300
const DEFAULT_WORK_OVERDUE_SECONDS = 900

function redSeconds(env: Env): number {
  const n = Number(env.HEARTBEAT_RED_SECONDS)
  return Number.isFinite(n) && n >= 60 ? Math.floor(n) : DEFAULT_RED_SECONDS
}

function workOverdueSeconds(env: Env): number {
  const n = Number(env.WORK_OVERDUE_RED_SECONDS)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_WORK_OVERDUE_SECONDS
}

/**
 * Pure condition evaluation over fleet_status rows. Exported for tests.
 *
 * A NULL heartbeat is provisioning-gray (never red): alert only on a seat that
 * HAS been alive and went quiet. The two scheduler conditions apply a per-field
 * NULL-hold: when the source field is NULL the ConditionState is NOT pushed at
 * all (not pushed as active:false), so a NULL can neither open an alert nor
 * resolve an open one. A false RECOVERED email to an ops inbox cancels human
 * urgency; never emit one from an unreported signal.
 */
export function evaluateConditions(
  rows: FleetStatusRow[],
  nowMs: number,
  redThresholdSeconds: number,
  overdueThresholdSeconds: number = DEFAULT_WORK_OVERDUE_SECONDS
): ConditionState[] {
  const out: ConditionState[] = []
  for (const row of rows) {
    let hbActive = false
    let hbDetail = 'no heartbeat reported yet (provisioning-gray, not alertable)'
    if (row.last_heartbeat_ts !== null) {
      const ts = Date.parse(row.last_heartbeat_ts)
      if (Number.isFinite(ts)) {
        const ageSec = Math.floor((nowMs - ts) / 1000)
        hbActive = ageSec > redThresholdSeconds
        hbDetail = `last heartbeat ${ageSec}s ago (threshold ${redThresholdSeconds}s)`
      } else {
        // Unparseable timestamp from the store is a real fault, not gray.
        hbActive = true
        hbDetail = `unparseable last_heartbeat_ts: ${row.last_heartbeat_ts}`
      }
    }
    out.push({
      customer_slug: row.customer_slug,
      condition: 'heartbeat_red',
      active: hbActive,
      detail: hbDetail,
    })
    out.push({
      customer_slug: row.customer_slug,
      condition: 'hard_stop',
      active: row.sticky_stop_level === 'HARD_STOP',
      detail: `sticky_stop_level=${row.sticky_stop_level ?? 'null'}`,
    })
    // scheduler_error — per-field NULL-hold: only evaluate when scheduler_ok
    // was actually reported this beat.
    if (row.scheduler_ok !== null) {
      out.push({
        customer_slug: row.customer_slug,
        condition: 'scheduler_error',
        active: row.scheduler_ok === 0,
        detail: `scheduler_ok=${row.scheduler_ok} (cron store unreadable or a job is in error state)`,
      })
    }
    // work_overdue — per-field NULL-hold, independent of scheduler_ok: only
    // evaluate when an overdue figure was reported (the overlay omits it inside
    // the post-restart boot-suppression window, which must NOT read as recovered).
    if (row.scheduler_max_overdue_seconds !== null) {
      out.push({
        customer_slug: row.customer_slug,
        condition: 'work_overdue',
        active: row.scheduler_max_overdue_seconds > overdueThresholdSeconds,
        detail: `max overdue ${row.scheduler_max_overdue_seconds}s (threshold ${overdueThresholdSeconds}s)`,
      })
    }
  }
  return out
}

async function listFleetStatus(db: D1Database): Promise<FleetStatusRow[]> {
  const result = await db
    .prepare(
      `SELECT customer_slug, last_heartbeat_ts, sticky_stop_level,
              scheduler_ok, scheduler_max_overdue_seconds
         FROM fleet_status`
    )
    .all<FleetStatusRow>()
  return result.results ?? []
}

async function getAlertState(
  db: D1Database,
  slug: string,
  condition: FleetCondition
): Promise<'open' | 'resolved' | null> {
  const row = await db
    .prepare('SELECT status FROM fleet_alert_state WHERE customer_slug = ? AND condition = ?')
    .bind(slug, condition)
    .first<{ status: 'open' | 'resolved' }>()
  return row?.status ?? null
}

async function markOpen(db: D1Database, s: ConditionState, resendId: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO fleet_alert_state (customer_slug, condition, status, opened_at, resolved_at, last_alert_id, updated_at)
       VALUES (?, ?, 'open', datetime('now'), NULL, ?, datetime('now'))
       ON CONFLICT (customer_slug, condition) DO UPDATE SET
         status = 'open', opened_at = datetime('now'), resolved_at = NULL,
         last_alert_id = excluded.last_alert_id, updated_at = datetime('now')`
    )
    .bind(s.customer_slug, s.condition, resendId)
    .run()
}

async function markResolved(db: D1Database, s: ConditionState): Promise<void> {
  await db
    .prepare(
      `UPDATE fleet_alert_state SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
       WHERE customer_slug = ? AND condition = ?`
    )
    .bind(s.customer_slug, s.condition)
    .run()
}

/**
 * Open alerts stranded by the per-field NULL-hold: the alert is open but the
 * seat now reports NULL for its source field (or has no row). One LEFT JOIN;
 * no UI (4 seats). The runbook documents the manual-resolve UPDATE.
 */
async function getStaleHolds(db: D1Database): Promise<StaleHold[]> {
  const result = await db
    .prepare(
      `SELECT s.customer_slug AS customer_slug, s.condition AS condition
         FROM fleet_alert_state s
         LEFT JOIN fleet_status f ON f.customer_slug = s.customer_slug
        WHERE s.status = 'open'
          AND (
            f.customer_slug IS NULL
            OR (s.condition = 'scheduler_error' AND f.scheduler_ok IS NULL)
            OR (s.condition = 'work_overdue' AND f.scheduler_max_overdue_seconds IS NULL)
            OR (s.condition = 'heartbeat_red' AND f.last_heartbeat_ts IS NULL)
            OR (s.condition = 'hard_stop' AND f.sticky_stop_level IS NULL)
          )
        ORDER BY s.customer_slug ASC, s.condition ASC`
    )
    .all<StaleHold>()
  return result.results ?? []
}

const CONDITION_LABEL: Record<FleetCondition, string> = {
  heartbeat_red: 'Machine not heartbeating',
  hard_stop: 'Cost breaker HARD_STOP',
  scheduler_error: 'Cron scheduler broken/unreadable',
  work_overdue: 'Scheduled work not firing',
}

async function sendTransitionEmail(
  env: Env,
  s: ConditionState,
  kind: 'opened' | 'resolved'
): Promise<{ ok: boolean; resendId?: string }> {
  if (!env.RESEND_API_KEY) {
    console.log(`[fleet-alerts] DEV: would email ${kind} ${s.condition} for ${s.customer_slug}`)
    return { ok: false }
  }
  const label = CONDITION_LABEL[s.condition]
  const subject =
    kind === 'opened'
      ? `[SMD Ops] ALERT ${s.customer_slug}: ${label}`
      : `[SMD Ops] RECOVERED ${s.customer_slug}: ${label}`
  const dashboard = `${env.ADMIN_BASE_URL ?? 'https://admin.smd.services'}/operator`
  const html =
    `<p><strong>${kind === 'opened' ? 'ALERT' : 'RECOVERED'}</strong>: ${label}</p>` +
    `<ul><li>Seat: ${s.customer_slug}</li><li>Detail: ${s.detail}</li>` +
    `<li>Severity: SEV1 per ADR 0064 - work begins on detection</li></ul>` +
    `<p><a href="${dashboard}">Fleet dashboard</a>. No automatic action was taken (ADR 0064/0065).</p>`
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.ALERT_FROM_EMAIL ?? 'SMD Services Ops <team@smd.services>',
        to: env.ALERT_TO_EMAIL ?? 'team@smd.services',
        subject,
        html,
      }),
    })
    if (!resp.ok) {
      console.error(`[fleet-alerts] resend ${resp.status}: ${await resp.text()}`)
      return { ok: false }
    }
    const data: { id?: string } = await resp.json()
    return { ok: true, resendId: data.id }
  } catch (err) {
    console.error('[fleet-alerts] resend send failed:', err)
    return { ok: false }
  }
}

/**
 * Fail-soft self-ping to the alerter's own healthchecks.io check at the end of
 * a successful run. Skipped when unset; errors are swallowed. If runOnce throws
 * (which now can only happen on a fleet-wide read failure, since per-seat
 * evaluation is isolated), this is never reached and healthchecks pages.
 */
async function pingAlerterHealthcheck(env: Env): Promise<void> {
  const url = env.ALERTER_HEALTHCHECKS_PING_URL
  if (!url) return
  try {
    await fetch(url, { method: 'GET' })
  } catch (err) {
    console.error('[fleet-alerts] healthcheck self-ping failed:', err)
  }
}

/**
 * Fire the edge transition for one condition, if any. Marks alert state ONLY on
 * a successful send: a failed Resend POST leaves the row unmarked so the next
 * 2-minute cron retries — otherwise one transient failure silences the alert
 * forever (it would exist only in Worker logs). Returns the recorded transition
 * or null (silent / send-failed).
 */
async function processTransition(env: Env, s: ConditionState): Promise<Transition | null> {
  const prior = await getAlertState(env.DB, s.customer_slug, s.condition)
  if (s.active && prior !== 'open') {
    const sent = await sendTransitionEmail(env, s, 'opened')
    if (!sent.ok) return null
    await markOpen(env.DB, s, sent.resendId ?? null)
    return {
      customer_slug: s.customer_slug,
      condition: s.condition,
      kind: 'opened',
      detail: s.detail,
      emailed: true,
      resendId: sent.resendId,
    }
  }
  if (!s.active && prior === 'open') {
    const sent = await sendTransitionEmail(env, s, 'resolved')
    if (!sent.ok) return null
    await markResolved(env.DB, s)
    return {
      customer_slug: s.customer_slug,
      condition: s.condition,
      kind: 'resolved',
      detail: s.detail,
      emailed: true,
      resendId: sent.resendId,
    }
  }
  return null
}

/** One evaluation pass: read fleet, compute conditions, fire edge transitions. */
export async function runOnce(env: Env, nowMs: number = Date.now()): Promise<RunSummary> {
  const rows = await listFleetStatus(env.DB)
  const conditions = evaluateConditions(rows, nowMs, redSeconds(env), workOverdueSeconds(env))
  const transitions: Transition[] = []

  // Group by seat so one bad row (a throwing DB op, a malformed value) can't
  // abort evaluation of every OTHER seat — the whole reason this loop exists is
  // to page on failure, so it must survive a single seat's failure.
  const bySeat = new Map<string, ConditionState[]>()
  for (const c of conditions) {
    const arr = bySeat.get(c.customer_slug)
    if (arr) arr.push(c)
    else bySeat.set(c.customer_slug, [c])
  }

  for (const [slug, states] of bySeat) {
    try {
      for (const s of states) {
        const t = await processTransition(env, s)
        if (t) transitions.push(t)
      }
    } catch (err) {
      console.error('[fleet-alerts] seat evaluation failed:', slug, err)
    }
  }

  const staleHolds = await getStaleHolds(env.DB)

  const summary: RunSummary = {
    at: new Date(nowMs).toISOString(),
    seats: rows.length,
    conditions,
    transitions,
    stale_holds: staleHolds,
  }
  if (transitions.length > 0) {
    console.log(`[fleet-alerts] transitions: ${JSON.stringify(transitions)}`)
  }

  // Watch the watcher: only reached when the run completed without throwing.
  await pingAlerterHealthcheck(env)
  return summary
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runOnce(env)
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true })
    }
    if (request.method === 'POST' && url.pathname === '/run') {
      const auth = request.headers.get('authorization') ?? ''
      if (!env.FLEET_ALERTS_BEARER || auth !== `Bearer ${env.FLEET_ALERTS_BEARER}`) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      return Response.json(await runOnce(env))
    }
    return Response.json({ error: 'not found' }, { status: 404 })
  },
}
