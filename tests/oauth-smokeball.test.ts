/**
 * Coverage for the Smokeball firm-delegated connect flow:
 *  - buildSmokeballAuthorizeUrl: env-specific host, required params, scope default
 *  - exchangeSmokeballCode: env-matched creds, Basic auth, normalized token, and
 *    that a non-2xx never leaks the issuer body
 *  - relaySmokeballRefreshToken: sets SMOKEBALL_REFRESH_TOKEN + restarts, and the
 *    unknown-customer / empty-token / no-FLY_API_TOKEN rejections
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env as testEnv } from 'cloudflare:workers'

import {
  buildSmokeballAuthorizeUrl,
  exchangeSmokeballCode,
  SMOKEBALL_OPERATOR_SCOPES,
} from '../src/lib/oauth/providers/smokeball'
import { relaySmokeballRefreshToken } from '../src/lib/oauth/store'

function clearEnv(): void {
  for (const key of Object.keys(testEnv)) {
    delete (testEnv as unknown as Record<string, unknown>)[key]
  }
}

afterEach(() => {
  clearEnv()
  vi.restoreAllMocks()
})

describe('buildSmokeballAuthorizeUrl', () => {
  it('targets the staging auth host with the required params', () => {
    const url = new URL(
      buildSmokeballAuthorizeUrl({
        client_id: 'cid',
        redirect_uri: 'https://portal.smd.services/api/operator/smokeball/connect-callback',
        state: 'signed.state',
        region: 'us',
        environment: 'staging',
      })
    )
    expect(url.origin).toBe('https://datastaging-auth.smokeball.com')
    expect(url.pathname).toBe('/oauth2/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('state')).toBe('signed.state')
    expect(url.searchParams.get('scope')).toBe(SMOKEBALL_OPERATOR_SCOPES.join(' '))
  })

  it('targets the production auth host', () => {
    const url = new URL(
      buildSmokeballAuthorizeUrl({
        client_id: 'cid',
        redirect_uri: 'https://x/cb',
        state: 's',
        region: 'us',
        environment: 'production',
      })
    )
    expect(url.origin).toBe('https://auth.smokeball.com')
  })

  it('rejects a missing client_id / redirect_uri / state', () => {
    const base = {
      client_id: 'cid',
      redirect_uri: 'https://x/cb',
      state: 's',
      region: 'us' as const,
      environment: 'staging' as const,
    }
    expect(() => buildSmokeballAuthorizeUrl({ ...base, client_id: '' })).toThrow(/client_id/)
    expect(() => buildSmokeballAuthorizeUrl({ ...base, redirect_uri: '' })).toThrow(/redirect_uri/)
    expect(() => buildSmokeballAuthorizeUrl({ ...base, state: '' })).toThrow(/state/)
  })
})

describe('exchangeSmokeballCode', () => {
  it('exchanges with Basic auth at the env-matched token endpoint and normalizes the token', async () => {
    Object.assign(testEnv, {
      SMOKEBALL_STAGING_CLIENT_ID: 'scid',
      SMOKEBALL_STAGING_CLIENT_SECRET: 'ssecret',
    })
    let captured: { url: string; auth: string | null; body: string } | null = null
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      captured = { url: String(url), auth: headers.get('Authorization'), body: String(init?.body) }
      return new Response(
        JSON.stringify({
          access_token: 'AT',
          refresh_token: 'RT',
          scope: 'matters/read contacts/read',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    const token = await exchangeSmokeballCode({
      code: 'the-code',
      redirect_uri: 'https://x/cb',
      region: 'us',
      environment: 'staging',
    })

    expect(captured!.url).toBe('https://datastaging-auth.smokeball.com/oauth2/token')
    expect(captured!.auth).toBe(`Basic ${btoa('scid:ssecret')}`)
    expect(captured!.body).toContain('grant_type=authorization_code')
    expect(captured!.body).toContain('the-code')
    expect(token.access_token).toBe('AT')
    expect(token.refresh_token).toBe('RT')
    expect(token.scopes).toBe('matters/read contacts/read')
  })

  it('uses the PROD credentials + host for a production seat', async () => {
    Object.assign(testEnv, {
      SMOKEBALL_PROD_CLIENT_ID: 'pcid',
      SMOKEBALL_PROD_CLIENT_SECRET: 'psecret',
    })
    let url = ''
    globalThis.fetch = vi.fn(async (u: string) => {
      url = String(u)
      return new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT' }), {
        status: 200,
      })
    }) as unknown as typeof fetch
    await exchangeSmokeballCode({
      code: 'c',
      redirect_uri: 'https://x/cb',
      region: 'us',
      environment: 'production',
    })
    expect(url).toBe('https://auth.smokeball.com/oauth2/token')
  })

  it('throws when the env credentials are not configured', async () => {
    await expect(
      exchangeSmokeballCode({
        code: 'c',
        redirect_uri: 'https://x/cb',
        region: 'us',
        environment: 'staging',
      })
    ).rejects.toThrow(/not configured/)
  })

  it('throws on a non-2xx WITHOUT leaking the issuer body', async () => {
    Object.assign(testEnv, {
      SMOKEBALL_STAGING_CLIENT_ID: 'scid',
      SMOKEBALL_STAGING_CLIENT_SECRET: 'ssecret',
    })
    globalThis.fetch = vi.fn(
      async () => new Response('{"error":"invalid_grant","leak":"RT"}', { status: 400 })
    )
    await expect(
      exchangeSmokeballCode({
        code: 'c',
        redirect_uri: 'https://x/cb',
        region: 'us',
        environment: 'staging',
      })
    ).rejects.toThrow(/^Smokeball token exchange failed \(400\)$/)
  })
})

describe('relaySmokeballRefreshToken', () => {
  beforeEach(() => {
    Object.assign(testEnv, { FLY_API_TOKEN: 'fly-tok' })
  })

  it('sets the SMOKEBALL_REFRESH_TOKEN secret and restarts the machines', async () => {
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      calls.push(u)
      if (u.includes('graphql')) {
        const body = String(init?.body)
        // The secret name is set; the refresh token value is base64'd, never raw.
        expect(body).toContain('SMOKEBALL_REFRESH_TOKEN')
        expect(body).not.toContain('the-refresh-token')
        return new Response(
          JSON.stringify({ data: { setSecrets: { release: { id: 'r', version: 1 } } } }),
          {
            status: 200,
          }
        )
      }
      if (u.endsWith('/machines')) {
        return new Response(JSON.stringify([{ id: 'm1' }]), { status: 200 })
      }
      return new Response('{}', { status: 200 }) // restart
    }) as unknown as typeof fetch

    const result = await relaySmokeballRefreshToken({
      customer_id: 'pilot-smokeball',
      refresh_token: 'the-refresh-token',
    })
    expect(result.ok).toBe(true)
    expect(calls.some((c) => c.includes('graphql'))).toBe(true)
    expect(calls.some((c) => c.endsWith('/machines/m1/restart'))).toBe(true)
  })

  it('refuses an unknown customer', async () => {
    const result = await relaySmokeballRefreshToken({
      customer_id: 'not-a-customer',
      refresh_token: 'rt',
    })
    expect(result).toEqual({ ok: false, reason: 'unknown_customer' })
  })

  it('refuses an empty refresh token', async () => {
    const result = await relaySmokeballRefreshToken({
      customer_id: 'pilot-smokeball',
      refresh_token: '',
    })
    expect(result.ok).toBe(false)
  })

  it('is unavailable without FLY_API_TOKEN', async () => {
    clearEnv()
    const result = await relaySmokeballRefreshToken({
      customer_id: 'pilot-smokeball',
      refresh_token: 'rt',
    })
    expect(result).toEqual({ ok: false, reason: 'unavailable' })
  })
})
