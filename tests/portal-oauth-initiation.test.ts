/**
 * Coverage for the customer-facing portal OAuth *initiation* route at
 * `src/pages/portal/products/operator/oauth/[connector]/index.ts`.
 *
 * Regression guard for the 2026-06-30 code-review PR 2a bug: initiation stamped
 * `reviewer_id = access.user.id` (local users.id) while the callback verifies it
 * against `locals.auth().userId` (Clerk id) — so every real consent attempt
 * returned `reviewer_mismatch`. The contract this file locks in: the issued
 * state's `reviewer_id` is the reviewer's CLERK id, matching what the callback
 * checks. (The callback side is covered by tests/portal-oauth-callback.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env as testEnv } from 'cloudflare:workers'

import { verifyOAuthState } from '../src/lib/oauth/state'

// Mock the two DB-backed resolvers; keep issueOAuthState real so we can decode
// and assert the reviewer_id the route actually signed into the state.
vi.mock('../src/lib/portal/operator-access', async (orig) => ({
  ...(await orig<typeof import('../src/lib/portal/operator-access')>()),
  resolveOperatorAccess: vi.fn(),
}))
vi.mock('../src/lib/portal/customer-config', async (orig) => ({
  ...(await orig<typeof import('../src/lib/portal/customer-config')>()),
  getCustomerConfig: vi.fn(),
}))

import { resolveOperatorAccess } from '../src/lib/portal/operator-access'
import { getCustomerConfig } from '../src/lib/portal/customer-config'
import { GET as initiate } from '../src/pages/portal/products/operator/oauth/[connector]/index'

const SIGNING_KEY_B64 = 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE='
const PORTAL_BASE = 'https://portal.smd.services'

const LOCAL_USER_ID = 'local-user-id-999'
const CLERK_USER_ID = 'user_clerk_abc'

function redirect(url: string, status?: number): Response {
  return new Response(null, { status: status ?? 302, headers: { Location: url } })
}

function parseLocation(response: Response): URL {
  const location = response.headers.get('Location')
  if (!location) throw new Error('response missing Location header')
  return new URL(location)
}

function primeAccess(clerkUserId: string | null): void {
  vi.mocked(resolveOperatorAccess).mockResolvedValue({
    kind: 'allowed',
    user: {
      id: LOCAL_USER_ID,
      org_id: 'org-1',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'principal',
      entity_id: 'ent-1',
      clerk_user_id: clerkUserId,
      last_clerk_session_id: null,
    },
    client: { id: 'ent-1' } as never,
    subscription: {} as never,
    roles: ['principal'],
    customerSlug: 'smd',
    config: { customer_slug: 'smd', entity_id: 'ent-1' } as never,
  })
  vi.mocked(getCustomerConfig).mockResolvedValue({ customer_slug: 'smd' } as never)
}

async function invoke(): Promise<Response> {
  // The instance rides in as a query param (OAuth stays on the stable path).
  return await initiate({
    locals: {} as App.Locals,
    params: { connector: 'google-workspace' },
    url: new URL(`${PORTAL_BASE}/portal/products/operator/oauth/google-workspace?instance=smd`),
    redirect,
  } as unknown as Parameters<typeof initiate>[0])
}

describe('portal oauth initiation — reviewer_id id-space', () => {
  beforeEach(() => {
    Object.assign(testEnv, {
      PORTAL_BASE_URL: PORTAL_BASE,
      APP_BASE_URL: PORTAL_BASE,
      OAUTH_STATE_SIGNING_KEY: SIGNING_KEY_B64,
      GOOGLE_CLIENT_ID: 'google-client-id',
      DB: {} as never, // resolvers are mocked; DB is unused
    })
  })

  afterEach(() => {
    for (const key of Object.keys(testEnv)) {
      delete (testEnv as unknown as Record<string, unknown>)[key]
    }
    vi.clearAllMocks()
  })

  it('signs the reviewer CLERK id into the state (not the local users.id)', async () => {
    primeAccess(CLERK_USER_ID)
    const response = await invoke()

    // Redirects to the Google authorize URL carrying the signed state.
    const authorizeUrl = parseLocation(response)
    expect(authorizeUrl.hostname).toContain('google')
    const state = authorizeUrl.searchParams.get('state')
    expect(state).toBeTruthy()

    const verified = await verifyOAuthState(state as string)
    expect(verified.ok).toBe(true)
    if (!verified.ok) throw new Error('state did not verify')
    // The contract: reviewer_id is the Clerk id (what the callback compares),
    // NOT the local users.id (the pre-fix bug).
    expect(verified.payload.reviewer_id).toBe(CLERK_USER_ID)
    expect(verified.payload.reviewer_id).not.toBe(LOCAL_USER_ID)
    expect(verified.payload.customer_id).toBe('smd')
    expect(verified.payload.provider).toBe('google-workspace')
  })

  it('fails with no_clerk_identity when the reviewer has no clerk_user_id', async () => {
    primeAccess(null)
    const response = await invoke()
    const location = parseLocation(response)
    expect(location.pathname).toBe('/portal/products/operator/smd/settings')
    expect(location.searchParams.get('status')).toBe('failed')
    expect(location.searchParams.get('reason')).toBe('no_clerk_identity')
  })
})
