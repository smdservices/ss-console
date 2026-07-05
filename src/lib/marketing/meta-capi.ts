/**
 * Meta Conversions API — server-side conversion events (ADR 0066 launch
 * gate 2, #1723).
 *
 * Two events, emitted at the funnel's authoritative server seams:
 *   - `Lead`     — intake success (POST /api/intake/send)
 *   - `Schedule` — booking success (POST /api/booking/reserve)
 *
 * Deduplication: the server mints the `event_id` (crypto.randomUUID) and
 * returns it to the client as `meta_event_id`; the browser pixel fires the
 * same event name with `{ eventID }` so Meta collapses the pair
 * (event_id + event_name dedup, per Meta CAPI docs).
 *
 * FAIL-CLOSED, HONESTLY: when PUBLIC_META_PIXEL_ID or
 * META_CAPI_ACCESS_TOKEN is unset, sendMetaCapiEvent reports
 * `{ sent: false, reason: 'unconfigured' }` — it never fakes success and
 * never throws into the funnel path (a Meta outage must not break a
 * booking). Callers log the outcome.
 *
 * Privacy: email is SHA-256-hashed (normalized) before it leaves the
 * Worker; every event carries Limited Data Use (data_processing_options
 * ['LDU'] with geo auto-detection 0/0). `fbc` is reconstructed from the
 * first-touch attribution cookie's fbclid + landed_at when the _fbc
 * browser cookie is absent.
 */

import { readAttributionFromCookieHeader } from './attribution'

/** Graph API version for the /events endpoint. Bump deliberately. */
const META_GRAPH_VERSION = 'v23.0'

const CAPI_TIMEOUT_MS = 4000

export type MetaEventName = 'Lead' | 'Schedule'

export interface CapiSendResult {
  sent: boolean
  /** 'unconfigured' | 'http_<status>' | 'network_error' */
  reason?: string
}

export interface CapiEventArgs {
  eventName: MetaEventName
  /** Server-minted UUID shared with the browser pixel for dedup. */
  eventId: string
  /** The inbound funnel request (cookies, IP, UA, URL come from here). */
  request: Request
  /** Prospect email — hashed before send. */
  email: string
}

interface CapiEnv {
  META_CAPI_ACCESS_TOKEN?: string
  META_CAPI_TEST_EVENT_CODE?: string
}

export function mintMetaEventId(): string {
  return crypto.randomUUID()
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Meta normalization for `em`: trim + lowercase, then SHA-256 hex. */
export async function hashEmail(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase())
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    const value = part.slice(eq + 1).trim()
    return value.length > 0 ? value : null
  }
  return null
}

/**
 * Resolve `fbc` for user_data: prefer the browser `_fbc` cookie (set by the
 * pixel), else reconstruct `fb.1.<creationTimeMs>.<fbclid>` from the
 * first-touch attribution cookie (ss_attr carries fbclid + landed_at).
 */
export function resolveFbc(cookieHeader: string | null): string | null {
  const fbcCookie = readCookieValue(cookieHeader, '_fbc')
  if (fbcCookie) return fbcCookie
  const attribution = readAttributionFromCookieHeader(cookieHeader)
  if (!attribution?.fbclid) return null
  const landedMs = attribution.landed_at ? Date.parse(attribution.landed_at) : NaN
  const creationTime = Number.isFinite(landedMs) ? landedMs : Date.now()
  return `fb.1.${creationTime}.${attribution.fbclid}`
}

/**
 * Build the /events payload. Exported for tests — the shape (event_id
 * dedup, hashed em, LDU flags) is pinned there.
 */
export async function buildCapiPayload(
  args: CapiEventArgs,
  testEventCode?: string
): Promise<Record<string, unknown>> {
  const { request } = args
  const cookieHeader = request.headers.get('cookie')
  const userData: Record<string, unknown> = {
    em: [await hashEmail(args.email)],
  }
  const clientIp = request.headers.get('cf-connecting-ip')
  if (clientIp) userData.client_ip_address = clientIp
  const userAgent = request.headers.get('user-agent')
  if (userAgent) userData.client_user_agent = userAgent
  const fbc = resolveFbc(cookieHeader)
  if (fbc) userData.fbc = fbc
  const fbp = readCookieValue(cookieHeader, '_fbp')
  if (fbp) userData.fbp = fbp

  return {
    data: [
      {
        event_name: args.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: args.eventId,
        action_source: 'website',
        event_source_url: request.headers.get('referer') ?? undefined,
        user_data: userData,
        // Limited Data Use with geolocation auto-detection (0/0) — CCPA
        // posture, pairs with the honor-GPC work in #1725.
        data_processing_options: ['LDU'],
        data_processing_options_country: 0,
        data_processing_options_state: 0,
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  }
}

/**
 * Send one conversion event. Never throws; returns an honest sent/reason.
 * Callers on the funnel path use `emitMetaEvent` (waitUntil-aware) instead
 * of calling this directly.
 */
export async function sendMetaCapiEvent(
  env: CapiEnv,
  pixelId: string | undefined,
  args: CapiEventArgs
): Promise<CapiSendResult> {
  const accessToken = env.META_CAPI_ACCESS_TOKEN?.trim()
  const pixel = pixelId?.trim()
  if (!pixel || !accessToken) {
    return { sent: false, reason: 'unconfigured' }
  }
  try {
    const payload = await buildCapiPayload(args, env.META_CAPI_TEST_EVENT_CODE?.trim())
    const res = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pixel)}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CAPI_TIMEOUT_MS),
      }
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[meta-capi] event rejected:', args.eventName, res.status, body.slice(0, 300))
      return { sent: false, reason: `http_${res.status}` }
    }
    return { sent: true }
  } catch (err) {
    console.error('[meta-capi] event send failed:', args.eventName, err)
    return { sent: false, reason: 'network_error' }
  }
}

/**
 * Funnel-path emitter: fire-and-forget via the Cloudflare execution
 * context when available (never blocks the user's response), awaited
 * otherwise. Logs the honest outcome either way.
 */
export async function emitMetaEvent(
  env: CapiEnv,
  pixelId: string | undefined,
  args: CapiEventArgs,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<void> {
  const send = sendMetaCapiEvent(env, pixelId, args).then((result) => {
    if (!result.sent && result.reason !== 'unconfigured') {
      console.error('[meta-capi] event not sent:', args.eventName, result.reason)
    }
  })
  if (waitUntil) {
    waitUntil(send)
    return
  }
  await send
}
