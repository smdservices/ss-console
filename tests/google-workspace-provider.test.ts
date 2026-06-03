/**
 * Coverage for the Google Workspace provider at
 * `src/lib/oauth/providers/google-workspace.ts`. Verifies scope discipline
 * (drive.readonly excluded; gmail.send refused), authorize-URL shape
 * (offline + consent), and the exchange entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env as testEnv } from 'cloudflare:workers'

import {
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_OPERATOR_SCOPES,
  GOOGLE_TOKEN_URL,
  buildGoogleAuthorizeUrl,
  googleWorkspaceProvider,
} from '../src/lib/oauth/providers/google-workspace'

function clearEnv(): void {
  for (const key of Object.keys(testEnv)) {
    delete (testEnv as unknown as Record<string, unknown>)[key]
  }
}

describe('GOOGLE_OPERATOR_SCOPES', () => {
  it('excludes gmail.send and drive.readonly (restricted-scope discipline)', () => {
    expect(GOOGLE_OPERATOR_SCOPES.some((s) => s.endsWith('/gmail.send'))).toBe(false)
    expect(GOOGLE_OPERATOR_SCOPES.some((s) => s.endsWith('/drive.readonly'))).toBe(false)
  })

  it('includes the read + draft capability scopes plus identity', () => {
    expect(GOOGLE_OPERATOR_SCOPES).toContain('https://www.googleapis.com/auth/gmail.modify')
    expect(GOOGLE_OPERATOR_SCOPES).toContain('https://www.googleapis.com/auth/calendar.events')
    expect(GOOGLE_OPERATOR_SCOPES).toContain('https://www.googleapis.com/auth/drive.file')
    expect(GOOGLE_OPERATOR_SCOPES).toContain('openid')
    expect(GOOGLE_OPERATOR_SCOPES).toContain('email')
  })

  it('is frozen', () => {
    expect(Object.isFrozen(GOOGLE_OPERATOR_SCOPES)).toBe(true)
  })
})

describe('buildGoogleAuthorizeUrl', () => {
  it('emits an offline + consent authorize URL with every default scope', () => {
    const url = buildGoogleAuthorizeUrl({
      client_id: 'gid-123',
      redirect_uri:
        'https://portal.smd.services/portal/products/operator/oauth/google-workspace/callback',
      state: 'signed-state',
    })
    expect(url.startsWith(GOOGLE_AUTHORIZE_URL)).toBe(true)
    expect(url).toContain('client_id=gid-123')
    expect(url).toContain('state=signed-state')
    expect(url).toContain('response_type=code')
    expect(url).toContain('access_type=offline')
    expect(url).toContain('prompt=consent')
    for (const scope of GOOGLE_OPERATOR_SCOPES) {
      expect(url).toContain(encodeURIComponent(scope))
    }
  })

  it('includes login_hint when provided', () => {
    const url = buildGoogleAuthorizeUrl({
      client_id: 'g',
      redirect_uri: 'https://example/cb',
      state: 's',
      login_hint: 'owner@example.com',
    })
    expect(url).toMatch(/login_hint=owner(%40|@)example.com/)
  })

  it('refuses to emit a URL requesting gmail.send', () => {
    expect(() =>
      buildGoogleAuthorizeUrl({
        client_id: 'g',
        redirect_uri: 'https://example/cb',
        state: 's',
        scopes: ['https://www.googleapis.com/auth/gmail.send'],
      })
    ).toThrow(/forbidden scope/)
  })

  it('requires client_id, redirect_uri, and state', () => {
    expect(() =>
      buildGoogleAuthorizeUrl({ client_id: '', redirect_uri: 'https://e/cb', state: 's' })
    ).toThrow(/client_id is required/)
    expect(() => buildGoogleAuthorizeUrl({ client_id: 'g', redirect_uri: '', state: 's' })).toThrow(
      /redirect_uri is required/
    )
    expect(() =>
      buildGoogleAuthorizeUrl({ client_id: 'g', redirect_uri: 'https://e/cb', state: '' })
    ).toThrow(/state is required/)
  })
})

describe('googleWorkspaceProvider entry', () => {
  const ORIGINAL_FETCH = globalThis.fetch

  beforeEach(() => {
    Object.assign(testEnv, { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' })
  })
  afterEach(() => {
    clearEnv()
    globalThis.fetch = ORIGINAL_FETCH
  })

  it('declares the canonical slug and label', () => {
    expect(googleWorkspaceProvider.slug).toBe('google-workspace')
    expect(googleWorkspaceProvider.label).toBe('Google Workspace')
    expect(googleWorkspaceProvider.token_url).toBe(GOOGLE_TOKEN_URL)
  })

  it('exchange_code POSTs an authorization_code grant', async () => {
    let body = ''
    globalThis.fetch = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      body = (init?.body as URLSearchParams).toString()
      return new Response(
        JSON.stringify({
          access_token: 'tok',
          refresh_token: 'refresh',
          expires_in: 3600,
          scope: 'openid email https://www.googleapis.com/auth/gmail.modify',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    })
    const result = await googleWorkspaceProvider.exchange_code({
      code: 'AUTH',
      redirect_uri: 'https://example/cb',
    })
    expect(result.access_token).toBe('tok')
    expect(result.refresh_token).toBe('refresh')
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('client_id=gid')
    expect(body).toContain('code=AUTH')
  })

  it('throws when GOOGLE_CLIENT_ID is missing', async () => {
    delete (testEnv as unknown as Record<string, unknown>).GOOGLE_CLIENT_ID
    await expect(
      googleWorkspaceProvider.exchange_code({ code: 'x', redirect_uri: 'https://e/cb' })
    ).rejects.toThrow(/GOOGLE_CLIENT_ID/)
  })
})
