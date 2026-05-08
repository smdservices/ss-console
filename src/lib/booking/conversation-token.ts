/**
 * Signed conversation tokens for the V2 multi-turn intake (`/book` Send +
 * follow-up turns).
 *
 * The first POST to /api/intake/send creates an entity, generates a fresh
 * conversation_id, and returns this token in an HttpOnly cookie. Every
 * subsequent POST to /api/intake/continue includes the cookie; the server
 * verifies the HMAC, extracts (entity_id, conversation_id), and loads the
 * conversation history from the context table.
 *
 * Threat model:
 *   - The cookie binds conversation_id to entity_id server-side. A client
 *     cannot forge a cookie pointing at someone else's entity without the
 *     signing key.
 *   - The token has a TTL (default 1 hour). After expiry the conversation
 *     is over from the server's perspective; the prospect would need to
 *     submit a fresh /api/intake/send to start a new conversation.
 *
 * Mirrors the encoding and crypto posture of `src/lib/booking/signed-link.ts`
 * (HMAC-SHA256, base64url, constant-time verify via crypto.subtle).
 *
 * Encoding:
 *   `<base64url(json-payload)>.<base64url(hmac)>`
 *
 * Payload fields:
 *   v               — schema version (currently 1)
 *   conversation_id — UUID for this conversation
 *   entity_id       — entity created/found on first Send
 *   exp             — Unix seconds; token invalid after this time
 */
import { env } from 'cloudflare:workers'

const ALGORITHM: HmacImportParams = { name: 'HMAC', hash: 'SHA-256' }
const ENCODER = new TextEncoder()
const SCHEMA_VERSION = 1

/** 1 hour matches the typical intake conversation duration. */
export const DEFAULT_CONVERSATION_TTL_SECONDS = 60 * 60

/** Cookie name for the conversation token. */
export const CONVERSATION_COOKIE_NAME = 'ss_intake_conv'

export interface ConversationTokenPayload {
  v: number
  conversation_id: string
  entity_id: string
  exp: number
}

export interface SignConversationTokenInput {
  conversation_id: string
  entity_id: string
  /** Override the default TTL (seconds). */
  ttl_seconds?: number
}

export type VerifyConversationTokenResult =
  | { ok: true; payload: ConversationTokenPayload }
  | { ok: false; error: 'malformed' | 'bad_signature' | 'expired' | 'unknown_version' }

export async function signConversationToken(input: SignConversationTokenInput): Promise<string> {
  const key = await importSigningKey()
  const ttl = input.ttl_seconds ?? DEFAULT_CONVERSATION_TTL_SECONDS
  const exp = Math.floor(Date.now() / 1000) + ttl

  const payload: ConversationTokenPayload = {
    v: SCHEMA_VERSION,
    conversation_id: input.conversation_id,
    entity_id: input.entity_id,
    exp,
  }

  const payloadB64 = base64UrlEncode(ENCODER.encode(JSON.stringify(payload)))
  const sigBuf = await crypto.subtle.sign(ALGORITHM, key, ENCODER.encode(payloadB64))
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf))
  return `${payloadB64}.${sigB64}`
}

export async function verifyConversationToken(
  token: string
): Promise<VerifyConversationTokenResult> {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, error: 'malformed' }
  }

  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, error: 'malformed' }
  }

  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)

  let sigBytes: Uint8Array
  try {
    sigBytes = base64UrlDecode(sigB64)
  } catch {
    return { ok: false, error: 'malformed' }
  }

  const key = await importSigningKey()
  const valid = await crypto.subtle.verify(
    ALGORITHM,
    key,
    sigBytes as unknown as ArrayBuffer,
    ENCODER.encode(payloadB64)
  )
  if (!valid) return { ok: false, error: 'bad_signature' }

  let payload: ConversationTokenPayload
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64))
    payload = JSON.parse(json) as ConversationTokenPayload
  } catch {
    return { ok: false, error: 'malformed' }
  }

  if (payload.v !== SCHEMA_VERSION) {
    return { ok: false, error: 'unknown_version' }
  }

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    return { ok: false, error: 'expired' }
  }

  if (!payload.entity_id || !payload.conversation_id) {
    return { ok: false, error: 'malformed' }
  }

  return { ok: true, payload }
}

/**
 * Build a Set-Cookie header value carrying the signed token.
 * Caller is responsible for adding the header to the Response.
 */
export function buildConversationCookieHeader(
  token: string,
  ttlSeconds: number,
  secure = true
): string {
  const parts = [
    `${CONVERSATION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${ttlSeconds}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Parse the token out of a request's Cookie header. Returns null if absent.
 */
export function readConversationCookie(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const name = trimmed.slice(0, eq)
    if (name === CONVERSATION_COOKIE_NAME) {
      return trimmed.slice(eq + 1)
    }
  }
  return null
}

async function importSigningKey(): Promise<CryptoKey> {
  const raw = env.BOOKING_ENCRYPTION_KEY
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(
      'BOOKING_ENCRYPTION_KEY is not configured. Set it in wrangler env before issuing conversation tokens.'
    )
  }
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
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
