/**
 * Cost Anomaly Worker — nightly per-customer cost spike detector.
 *
 * Wires on top of the ss-cost-telemetry data path (02:00 UTC ingest)
 * and the dashboard from PR #1026. Runs at 03:00 UTC daily so the
 * trailing-day data is fresh when detection runs.
 *
 * Flow:
 *   1. Enumerate Operator customers from central customer_configs.
 *   2. For each customer:
 *      a. Read the trailing 8 days from the CENTRAL cost_telemetry
 *         table (ADR 0062, migration 0083) via the D1 binding.
 *      b. Run detectAnomaly() on the aggregate daily series.
 *      c. On breach, identify the top-1 driver by absolute delta and
 *         UPSERT one alert row into central D1's cost_anomaly_alerts.
 *   3. Send one digest email to Captain summarizing new alerts.
 *
 * The per-customer-D1 HTTP fan-out is retired (ADR 0062: those
 * databases were never provisioned). The reserved slugs '_org' and
 * '_unmapped' are excluded by construction — they have no
 * customer_configs row.
 *
 * Fabrication discipline (CLAUDE.md Pattern A/B): every figure in an
 * alert traces to a real cost_telemetry row. The "top driver" attribution
 * is `''` (aggregate sentinel) when no single driver dominated the delta.
 * The schema does not record per-skill attribution; the alert names the
 * driver, accurate to the data we have.
 */

import {
  AGGREGATE_DRIVER_SENTINEL,
  DEFAULT_THRESHOLD_BPS,
  buildDailySeries,
  detectAnomaly,
  pickTopDriverByDelta,
  upsertAlert,
} from '../../../src/lib/admin/cost-anomaly'
import { fetchCustomerCostRows, enumerateDates } from '../../../src/lib/admin/cost-query'
import { listCustomers, type CustomerRow } from './customers'
import { sendAnomalyDigest, type AlertNotificationItem } from './notify'
import { fetchTenantErrorsLast24h, writeSentrySync, type SentrySyncResult } from './sentry-sync'

export interface Env {
  DB: D1Database
  ANOMALY_THRESHOLD_BPS?: string
  ALERT_FROM_EMAIL?: string
  ALERT_TO_EMAIL?: string
  RESEND_API_KEY?: string
  COST_ANOMALY_BEARER?: string
  ADMIN_BASE_URL?: string
  /**
   * Sentry observability env (ADR 0023 Wave 1). All three must be set
   * for the daily 24h-errors sync to run; missing any one skips the
   * sync entirely (logged at INFO). Configured in the SMD-owned
   * `smd-operator` Sentry project; staged on this Worker via
   * `wrangler secret put` after PR 5 lands.
   */
  SENTRY_API_TOKEN?: string
  SENTRY_ORG_SLUG?: string
  SENTRY_PROJECT_ID?: string
}

interface PerCustomerOutcome {
  customer_slug: string
  status: 'skipped:insufficient-history' | 'no-anomaly' | 'anomaly' | 'error'
  reason?: string
  alert?: AlertNotificationItem
}

export interface RunSummary {
  runDay: string
  windowStart: string
  windowEnd: string
  thresholdBps: number
  customersTotal: number
  perCustomer: PerCustomerOutcome[]
  alertsCreated: number
  notification: { sent: boolean; reason?: string; resendId?: string }
  sentrySync: { ran: boolean; reason?: string; results: SentrySyncResult[] }
}

const WINDOW_DAYS = 8

function utcDateString(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Window = trailing WINDOW_DAYS calendar days ending yesterday inclusive.
 * Half-open `[start, end)` to match `fetchCustomerCostRows`. The candidate
 * day inside detectAnomaly is the last element of the dense series, i.e.
 * yesterday.
 */
function computeWindow(now: Date = new Date()): {
  windowStart: string
  windowEnd: string
  candidateDay: string
} {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  // `end` exclusive = today 00:00 UTC, so the series ends at yesterday.
  const end = today
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000)
  const candidate = new Date(end.getTime() - 86_400_000)
  return {
    windowStart: utcDateString(start),
    windowEnd: utcDateString(end),
    candidateDay: utcDateString(candidate),
  }
}

function parseThreshold(v: string | undefined): number {
  if (!v) return DEFAULT_THRESHOLD_BPS
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 10_000) return DEFAULT_THRESHOLD_BPS
  return Math.round(n)
}

async function processCustomer(
  env: Env,
  customer: CustomerRow,
  window: { windowStart: string; windowEnd: string; candidateDay: string },
  thresholdBps: number
): Promise<PerCustomerOutcome> {
  const fetched = await fetchCustomerCostRows(
    env.DB,
    customer.customer_slug,
    window.windowStart,
    window.windowEnd
  )
  if (fetched.error) {
    return {
      customer_slug: customer.customer_slug,
      status: 'error',
      reason: fetched.error,
    }
  }

  const dates = enumerateDates(window.windowStart, window.windowEnd)
  const series = buildDailySeries(fetched.rows, dates)
  const detection = detectAnomaly(series, thresholdBps)

  if (detection.kind === 'insufficient-history') {
    return {
      customer_slug: customer.customer_slug,
      status: 'skipped:insufficient-history',
      reason: detection.reason,
    }
  }
  if (detection.kind === 'no-anomaly') {
    return { customer_slug: customer.customer_slug, status: 'no-anomaly' }
  }

  const top = pickTopDriverByDelta(fetched.rows, dates)
  const driver = top?.driver ?? AGGREGATE_DRIVER_SENTINEL
  const dailyCents = top?.daily_cents ?? detection.daily_cents
  const rollingAvgCents = top?.rolling_avg_cents ?? detection.rolling_avg_cents
  const ratioBps =
    rollingAvgCents > 0 ? Math.round((dailyCents * 10_000) / rollingAvgCents) : detection.ratio_bps

  await upsertAlert(env.DB, {
    entity_id: customer.entity_id,
    customer_slug: customer.customer_slug,
    alert_date: detection.date,
    driver,
    daily_cents: dailyCents,
    rolling_avg_cents: rollingAvgCents,
    ratio_bps: ratioBps,
    threshold_bps: thresholdBps,
  })

  return {
    customer_slug: customer.customer_slug,
    status: 'anomaly',
    alert: {
      customer_slug: customer.customer_slug,
      entity_name: null, // filled in by enrichment query if needed downstream
      alert_date: detection.date,
      driver,
      daily_cents: dailyCents,
      rolling_avg_cents: rollingAvgCents,
      ratio_bps: ratioBps,
    },
  }
}

export async function run(env: Env, now: Date = new Date()): Promise<RunSummary> {
  const window = computeWindow(now)
  const thresholdBps = parseThreshold(env.ANOMALY_THRESHOLD_BPS)
  const customers = await listCustomers(env.DB)

  const perCustomer: PerCustomerOutcome[] = []
  for (const customer of customers) {
    try {
      const outcome = await processCustomer(env, customer, window, thresholdBps)
      perCustomer.push(outcome)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[cost-anomaly] ${customer.customer_slug}: ${msg}`)
      perCustomer.push({
        customer_slug: customer.customer_slug,
        status: 'error',
        reason: `unhandled: ${msg}`,
      })
    }
  }

  const newAlerts: AlertNotificationItem[] = perCustomer
    .filter((o): o is PerCustomerOutcome & { alert: AlertNotificationItem } =>
      Boolean(o.alert && o.status === 'anomaly')
    )
    .map((o) => o.alert)

  let notification: RunSummary['notification']
  if (newAlerts.length === 0) {
    notification = { sent: false, reason: 'no new anomalies' }
  } else if (!env.RESEND_API_KEY || !env.ALERT_TO_EMAIL || !env.ALERT_FROM_EMAIL) {
    notification = {
      sent: false,
      reason: 'RESEND_API_KEY / ALERT_TO_EMAIL / ALERT_FROM_EMAIL not configured',
    }
    console.warn(`[cost-anomaly] notification skipped: ${notification.reason}`)
  } else {
    const dashboardUrl = `${env.ADMIN_BASE_URL ?? 'https://admin.smd.services'}/operator/costs`
    const result = await sendAnomalyDigest(
      {
        apiKey: env.RESEND_API_KEY,
        fromEmail: env.ALERT_FROM_EMAIL,
        toEmail: env.ALERT_TO_EMAIL,
        dashboardUrl,
      },
      newAlerts,
      window.candidateDay
    )
    notification = result.ok
      ? { sent: true, resendId: result.resendId }
      : { sent: false, reason: result.reason }
    if (!result.ok) {
      console.error(`[cost-anomaly] digest send failed: ${result.reason}`)
    }
  }

  const sentrySync = await runSentrySync(env, customers)

  const summary: RunSummary = {
    runDay: window.candidateDay,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    thresholdBps,
    customersTotal: customers.length,
    perCustomer,
    alertsCreated: newAlerts.length,
    notification,
    sentrySync,
  }

  console.log(
    `[cost-anomaly] day=${summary.runDay} customers=${summary.customersTotal} ` +
      `alerts=${summary.alertsCreated} notified=${summary.notification.sent} ` +
      `sentry=${sentrySync.ran ? sentrySync.results.length : 'skipped'}`
  )

  return summary
}

async function runSentrySync(
  env: Env,
  customers: CustomerRow[]
): Promise<RunSummary['sentrySync']> {
  if (!env.SENTRY_API_TOKEN || !env.SENTRY_ORG_SLUG || !env.SENTRY_PROJECT_ID) {
    return {
      ran: false,
      reason: 'SENTRY_API_TOKEN / SENTRY_ORG_SLUG / SENTRY_PROJECT_ID not configured',
      results: [],
    }
  }
  const nowIso = new Date().toISOString()
  const results: SentrySyncResult[] = []
  for (const c of customers) {
    const r = await fetchTenantErrorsLast24h(env, c.customer_slug)
    results.push(r)
    if (r.status === 'unavailable') continue
    try {
      await writeSentrySync(env.DB, c.entity_id, c.customer_slug, r, nowIso)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[cost-anomaly] sentry-sync write failed for ${c.customer_slug}: ${msg}`)
    }
  }
  return { ran: true, results }
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    await run(env)
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (env.COST_ANOMALY_BEARER) {
      const auth = request.headers.get('Authorization')
      if (auth !== `Bearer ${env.COST_ANOMALY_BEARER}`) {
        return new Response('Unauthorized', { status: 401 })
      }
    }
    const summary = await run(env)
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
} satisfies ExportedHandler<Env>
