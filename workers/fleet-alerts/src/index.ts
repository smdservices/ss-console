/**
 * Fleet Alerts Worker — heartbeat-red / HARD_STOP pager (#1709).
 *
 * Closes the gap ADR 0064's honesty banner named: detection was
 * dashboard-only. Every 2 minutes (cron) this Worker reads the central
 * `fleet_status` table each Machine's heartbeat emitter pushes to (ADR 0023)
 * and emails team@smd.services on condition TRANSITIONS:
 *
 *   heartbeat_red — the seat HAS reported before, and its last heartbeat is
 *                   older than HEARTBEAT_RED_SECONDS (default 300s = the
 *                   period+grace envelope). Seats with a NULL heartbeat or
 *                   no row at all are provisioning-gray, never alerted —
 *                   a false page trains people to ignore the pager.
 *   hard_stop     — the Machine-reported cost-breaker ladder (ADR 0062) is
 *                   at HARD_STOP.
 *
 * Edge-triggered via `fleet_alert_state` (migration 0085): one open alert
 * per (customer, condition) until recovery, one recovery notice on the
 * green transition, silence otherwise. No alert storm by construction.
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
  FLEET_ALERTS_BEARER?: string
  ADMIN_BASE_URL?: string
}

export type FleetCondition = 'heartbeat_red' | 'hard_stop'

export interface FleetStatusRow {
  customer_slug: string
  last_heartbeat_ts: string | null
  sticky_stop_level: string | null
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

export interface RunSummary {
  at: string
  seats: number
  conditions: ConditionState[]
  transitions: Transition[]
}

const DEFAULT_RED_SECONDS = 300

function redSeconds(env: Env): number {
  const n = Number(env.HEARTBEAT_RED_SECONDS)
  return Number.isFinite(n) && n >= 60 ? Math.floor(n) : DEFAULT_RED_SECONDS
}

/**
 * Pure condition evaluation over fleet_status rows. Exported for tests.
 * A NULL heartbeat is provisioning-gray (never red): alert only on a seat
 * that HAS been alive and went quiet.
 */
export function evaluateConditions(
  rows: FleetStatusRow[],
  nowMs: number,
  redThresholdSeconds: number
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
  }
  return out
}

async function listFleetStatus(db: D1Database): Promise<FleetStatusRow[]> {
  const result = await db
    .prepare('SELECT customer_slug, last_heartbeat_ts, sticky_stop_level FROM fleet_status')
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

const CONDITION_LABEL: Record<FleetCondition, string> = {
  heartbeat_red: 'Machine not heartbeating',
  hard_stop: 'Cost breaker HARD_STOP',
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

/** One evaluation pass: read fleet, compute conditions, fire edge transitions. */
export async function runOnce(env: Env, nowMs: number = Date.now()): Promise<RunSummary> {
  const rows = await listFleetStatus(env.DB)
  const conditions = evaluateConditions(rows, nowMs, redSeconds(env))
  const transitions: Transition[] = []

  for (const s of conditions) {
    const prior = await getAlertState(env.DB, s.customer_slug, s.condition)
    if (s.active && prior !== 'open') {
      const sent = await sendTransitionEmail(env, s, 'opened')
      await markOpen(env.DB, s, sent.resendId ?? null)
      transitions.push({
        customer_slug: s.customer_slug,
        condition: s.condition,
        kind: 'opened',
        detail: s.detail,
        emailed: sent.ok,
        resendId: sent.resendId,
      })
    } else if (!s.active && prior === 'open') {
      const sent = await sendTransitionEmail(env, s, 'resolved')
      await markResolved(env.DB, s)
      transitions.push({
        customer_slug: s.customer_slug,
        condition: s.condition,
        kind: 'resolved',
        detail: s.detail,
        emailed: sent.ok,
        resendId: sent.resendId,
      })
    }
  }

  const summary: RunSummary = {
    at: new Date(nowMs).toISOString(),
    seats: rows.length,
    conditions,
    transitions,
  }
  if (transitions.length > 0) {
    console.log(`[fleet-alerts] transitions: ${JSON.stringify(transitions)}`)
  }
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
