/**
 * OAuth state parameter — signed, stateless, single-use-by-expiry.
 *
 * The state parameter on an OAuth authorize URL must round-trip back to the
 * callback unchanged. We use it for two things:
 *
 *   1. CSRF binding — the value is HMAC-signed with a server-side secret,
 *      so the callback can refuse a state it did not issue.
 *   2. Context carry — we pack `(customer_id, provider, reviewer_id, nonce,
 *      expiry)` into the state itself so the callback knows which customer
 *      and provider this consent was issued for, and which reviewer
 *      initiated the flow.
 *
 * Why not a D1 row keyed by an opaque state? D1 single-use states (the
 * existing `src/lib/db/oauth-states.ts` pattern) serialize on every flow
 * across all customers. For multi-tenant AI Employee provisioning we expect
 * to scale this beyond what a single shared table comfortably owns, and we
 * already need a server-side secret for downstream token handling. A signed
 * stateless token is the natural shape.
 *
 * Replay protection: the callback caller is responsible for binding the
 * decoded `reviewer_id` to the currently authenticated reviewer (Clerk or
 * magic-link session). A leaked state with a valid signature but for the
 * wrong reviewer must be rejected. Expiry is 10 minutes from issue.
 *
 * Encoding format (matches src/lib/booking/conversation-token.ts):
 *
 *   `<base64url(json-payload)>.<base64url(hmac-sha256)>`
 *
 * Signing key: `OAUTH_STATE_SIGNING_KEY` env var, base64-encoded raw bytes.
 * Generate with `openssl rand -base64 32`. Rotation: bump the key in
 * Cloudflare Workers secrets; any in-flight authorize redirects issued
 * under the old key will fail validation at callback time and the
 * reviewer can simply re-initiate consent. No grace window — short TTL
 * makes rotation safe.
 */

import { env } from 'cloudflare:workers'

const ALGORITHM: HmacImportParams = { name: 'HMAC', hash: 'SHA-256' }
const ENCODER = new TextEncoder()
const SCHEMA_VERSION = 1

export const DEFAULT_STATE_TTL_SECONDS = 10 * 60

export interface OAuthStatePayload {
  v: number
  customer_id: string
  provider: string
  reviewer_id: string
  nonce: string
  exp: number
}

export interface IssueOAuthStateInput {
  customer_id: string
  provider: string
  reviewer_id: string
  ttl_seconds?: number
}

export type VerifyOAuthStateResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; error: 'malformed' | 'bad_signature' | 'expired' | 'unknown_version' }

export async function issueOAuthState(input: IssueOAuthStateInput): Promise<string> {
  const key = await importSigningKey()
  const ttl = input.ttl_seconds ?? DEFAULT_STATE_TTL_SECONDS
  const exp = Math.floor(Date.now() / 1000) + ttl

  const payload: OAuthStatePayload = {
    v: SCHEMA_VERSION,
    customer_id: input.customer_id,
    provider: input.provider,
    reviewer_id: input.reviewer_id,
    nonce: crypto.randomUUID(),
    exp,
  }

  const payloadB64 = base64UrlEncode(ENCODER.encode(JSON.stringify(payload)))
  const sigBuf = await crypto.subtle.sign(ALGORITHM, key, ENCODER.encode(payloadB64))
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf))
  return `${payloadB64}.${sigB64}`
}

function splitState(state: string): { payloadB64: string; sigB64: string } | null {
  if (typeof state !== 'string' || state.length === 0) return null
  const dot = state.indexOf('.')
  if (dot <= 0 || dot === state.length - 1) return null
  return { payloadB64: state.slice(0, dot), sigB64: state.slice(dot + 1) }
}

function decodePayload(payloadB64: string): OAuthStatePayload | null {
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64))
    return JSON.parse(json) as OAuthStatePayload
  } catch {
    return null
  }
}

function payloadShapeOk(payload: OAuthStatePayload): boolean {
  return (
    typeof payload.customer_id === 'string' &&
    typeof payload.provider === 'string' &&
    typeof payload.reviewer_id === 'string' &&
    typeof payload.nonce === 'string' &&
    payload.customer_id.length > 0 &&
    payload.provider.length > 0 &&
    payload.reviewer_id.length > 0 &&
    payload.nonce.length > 0
  )
}

export async function verifyOAuthState(state: string): Promise<VerifyOAuthStateResult> {
  const parts = splitState(state)
  if (!parts) return { ok: false, error: 'malformed' }

  let sigBytes: Uint8Array
  try {
    sigBytes = base64UrlDecode(parts.sigB64)
  } catch {
    return { ok: false, error: 'malformed' }
  }

  const key = await importSigningKey()
  const valid = await crypto.subtle.verify(
    ALGORITHM,
    key,
    sigBytes as unknown as ArrayBuffer,
    ENCODER.encode(parts.payloadB64)
  )
  if (!valid) return { ok: false, error: 'bad_signature' }

  const payload = decodePayload(parts.payloadB64)
  if (!payload) return { ok: false, error: 'malformed' }
  if (payload.v !== SCHEMA_VERSION) return { ok: false, error: 'unknown_version' }

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    return { ok: false, error: 'expired' }
  }

  if (!payloadShapeOk(payload)) return { ok: false, error: 'malformed' }

  return { ok: true, payload }
}

async function importSigningKey(): Promise<CryptoKey> {
  const raw = env.OAUTH_STATE_SIGNING_KEY
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(
      'OAUTH_STATE_SIGNING_KEY is not configured. Set it in wrangler env (32 random bytes, base64-encoded) before issuing OAuth states.'
    )
  }
  let bin: string
  try {
    bin = atob(raw)
  } catch {
    throw new Error('OAUTH_STATE_SIGNING_KEY is not valid base64.')
  }
  const keyBytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', keyBytes, ALGORITHM, false, ['sign', 'verify'])
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (padded.length % 4)) % 4
  const b64 = padded + '='.repeat(padLen)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
