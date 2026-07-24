/**
 * Unit tests for the Meta CAPI module (ADR 0066 launch gate 2, #1723):
 * email normalization + hashing, fbc resolution (browser cookie vs
 * ss_attr-derived), payload shape (event_id dedup, LDU flags), and the
 * fail-closed honest-unconfigured send path.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildCapiPayload,
  hashEmail,
  mintMetaEventId,
  resolveFbc,
  sendMetaCapiEvent,
} from '../src/lib/marketing/meta-capi'

function funnelRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://smd.services/api/intake/send', { method: 'POST', headers })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hashEmail', () => {
  it('normalizes (trim + lowercase) before SHA-256', async () => {
    const a = await hashEmail('  John.Smith@Example.COM ')
    const b = await hashEmail('john.smith@example.com')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('resolveFbc', () => {
  it('prefers the browser _fbc cookie', () => {
    expect(resolveFbc('_fbc=fb.1.1700000000000.AbCd; other=1')).toBe('fb.1.1700000000000.AbCd')
  })

  it('reconstructs fbc from the ss_attr fbclid + landed_at', () => {
    const landedAt = '2026-07-05T19:18:06.384Z'
    const ssAttr = encodeURIComponent(JSON.stringify({ fbclid: 'CLICK123', landed_at: landedAt }))
    expect(resolveFbc(`ss_attr=${ssAttr}`)).toBe(`fb.1.${Date.parse(landedAt)}.CLICK123`)
  })

  it('returns null when neither _fbc nor an fbclid exists', () => {
    const ssAttr = encodeURIComponent(JSON.stringify({ utm_source: 'google' }))
    expect(resolveFbc(`ss_attr=${ssAttr}`)).toBeNull()
    expect(resolveFbc(null)).toBeNull()
  })
})

describe('buildCapiPayload', () => {
  it('produces the documented event shape with hashed em and LDU flags', async () => {
    const request = funnelRequest({
      cookie: `_fbp=fb.1.1700000000000.999; _fbc=fb.1.1700000000000.AbCd`,
      'cf-connecting-ip': '203.0.113.9',
      'user-agent': 'TestUA/1.0',
      referer: 'https://smd.services/book',
    })
    const payload = await buildCapiPayload(
      { eventName: 'Schedule', eventId: 'evt-1', request, email: 'X@Y.com' },
      'TEST42'
    )
    const data = payload.data as Array<Record<string, unknown>>
    expect(data).toHaveLength(1)
    const event = data[0]
    expect(event.event_name).toBe('Schedule')
    expect(event.event_id).toBe('evt-1')
    expect(event.action_source).toBe('website')
    expect(event.event_source_url).toBe('https://smd.services/book')
    expect(event.data_processing_options).toEqual(['LDU'])
    expect(event.data_processing_options_country).toBe(0)
    expect(event.data_processing_options_state).toBe(0)
    const userData = event.user_data as Record<string, unknown>
    expect(userData.em).toEqual([await hashEmail('x@y.com')])
    expect(userData.client_ip_address).toBe('203.0.113.9')
    expect(userData.client_user_agent).toBe('TestUA/1.0')
    expect(userData.fbc).toBe('fb.1.1700000000000.AbCd')
    expect(userData.fbp).toBe('fb.1.1700000000000.999')
    expect(payload.test_event_code).toBe('TEST42')
    // The raw email must never appear in the payload.
    expect(JSON.stringify(payload)).not.toContain('X@Y.com')
    expect(JSON.stringify(payload)).not.toContain('x@y.com')
  })
})

describe('sendMetaCapiEvent', () => {
  const args = {
    eventName: 'Lead' as const,
    eventId: mintMetaEventId(),
    request: funnelRequest(),
    email: 'a@b.com',
  }

  it('fails closed with an honest reason when unconfigured — and never calls fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await sendMetaCapiEvent({}, undefined, args)).toEqual({
      sent: false,
      reason: 'unconfigured',
    })
    expect(await sendMetaCapiEvent({ META_CAPI_ACCESS_TOKEN: 'tok' }, undefined, args)).toEqual({
      sent: false,
      reason: 'unconfigured',
    })
    expect(await sendMetaCapiEvent({}, 'pixel1', args)).toEqual({
      sent: false,
      reason: 'unconfigured',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports sent on HTTP 200 and posts to the pixel events endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const result = await sendMetaCapiEvent({ META_CAPI_ACCESS_TOKEN: 'tok' }, 'pixel1', args)
    expect(result).toEqual({ sent: true })
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain('/pixel1/events')
    expect(url).toContain('access_token=tok')
  })

  it('reports honest failure on non-200 and on network errors — never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })))
    expect(await sendMetaCapiEvent({ META_CAPI_ACCESS_TOKEN: 't' }, 'p', args)).toEqual({
      sent: false,
      reason: 'http_400',
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    expect(await sendMetaCapiEvent({ META_CAPI_ACCESS_TOKEN: 't' }, 'p', args)).toEqual({
      sent: false,
      reason: 'network_error',
    })
  })
})
