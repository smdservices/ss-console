/**
 * Unit tests for the ad-click attribution module (ADR 0066 launch gate 1,
 * #1722): enumerated-params-only parsing, fail-closed cookie decoding,
 * first-party cookie header reading, and the admin summary line.
 *
 * The enumerated-keys constraint is load-bearing: the first-party events
 * pipeline deliberately never stores query strings, and this module is the
 * one sanctioned exception — these tests pin that it can never widen into
 * arbitrary-query-string capture.
 */

import { describe, it, expect } from 'vitest'
import {
  AD_ATTRIBUTION_KEYS,
  ATTRIBUTION_COOKIE,
  attributionFromUnknown,
  attributionSummary,
  encodeAttributionCookie,
  parseAttributionFromUrl,
  readAttributionFromCookieHeader,
  urlHasAttributionParams,
} from '../src/lib/marketing/attribution'

const NOW = new Date('2026-07-05T12:00:00.000Z')

describe('urlHasAttributionParams', () => {
  it('is false for clean URLs and true for each param family', () => {
    expect(urlHasAttributionParams(new URL('https://smd.services/packs/law-firm'))).toBe(false)
    expect(urlHasAttributionParams(new URL('https://smd.services/?ref=x'))).toBe(false)
    expect(urlHasAttributionParams(new URL('https://smd.services/?utm_source=facebook'))).toBe(true)
    expect(urlHasAttributionParams(new URL('https://smd.services/?gclid=abc'))).toBe(true)
    expect(urlHasAttributionParams(new URL('https://smd.services/?fbclid=abc'))).toBe(true)
  })
})

describe('parseAttributionFromUrl', () => {
  it('captures only the enumerated ad params, never arbitrary query strings', () => {
    const url = new URL(
      'https://smd.services/packs/law-firm?utm_source=facebook&utm_medium=paid-social&utm_campaign=law-ops-r1&utm_content=angle-salary&secret=nope&email=x%40y.com'
    )
    const attr = parseAttributionFromUrl(url, NOW)
    expect(attr).not.toBeNull()
    expect(attr!.utm_source).toBe('facebook')
    expect(attr!.utm_medium).toBe('paid-social')
    expect(attr!.utm_campaign).toBe('law-ops-r1')
    expect(attr!.utm_content).toBe('angle-salary')
    expect(attr!.landing_path).toBe('/packs/law-firm')
    expect(attr!.landed_at).toBe(NOW.toISOString())
    // The non-enumerated params must not appear anywhere in the output.
    expect(JSON.stringify(attr)).not.toContain('nope')
    expect(JSON.stringify(attr)).not.toContain('y.com')
  })

  it('returns null when no ad params are present (never stores empty attribution)', () => {
    expect(parseAttributionFromUrl(new URL('https://smd.services/?page=2'), NOW)).toBeNull()
  })

  it('caps value length and strips control characters', () => {
    const long = 'a'.repeat(500)
    const url = new URL(`https://smd.services/?utm_source=${long}&utm_term=a%0Ab%00c`)
    const attr = parseAttributionFromUrl(url, NOW)
    expect(attr!.utm_source!.length).toBe(200)
    expect(attr!.utm_term).toBe('abc')
  })
})

describe('attributionFromUnknown (fail-closed re-validation)', () => {
  it('rejects non-objects', () => {
    expect(attributionFromUnknown(null)).toBeNull()
    expect(attributionFromUnknown('utm_source=x')).toBeNull()
    expect(attributionFromUnknown(42)).toBeNull()
    expect(attributionFromUnknown(['utm_source'])).toBeNull()
  })

  it('drops non-enumerated keys and non-string values', () => {
    const attr = attributionFromUnknown({
      utm_source: 'google',
      utm_medium: 7,
      injected_key: 'evil',
      __proto__: { hacked: true },
    })
    expect(attr).toEqual(expect.objectContaining({ utm_source: 'google' }))
    expect(attr).not.toHaveProperty('utm_medium')
    expect(attr).not.toHaveProperty('injected_key')
    expect(attr).not.toHaveProperty('hacked')
  })

  it('returns null when no enumerated ad param survives (landed_at alone is not attribution)', () => {
    expect(attributionFromUnknown({ landed_at: '2026-07-05', landing_path: '/x' })).toBeNull()
  })
})

describe('cookie round-trip', () => {
  it('encodes plain JSON and reads back through a raw Cookie header', () => {
    const attr = parseAttributionFromUrl(
      new URL('https://smd.services/operator?utm_source=google&utm_medium=cpc&gclid=XyZ123'),
      NOW
    )!
    // Astro's cookies.set URL-encodes the value on write; simulate that.
    const header = `other=1; ${ATTRIBUTION_COOKIE}=${encodeURIComponent(encodeAttributionCookie(attr))}; theme=dark`
    const restored = readAttributionFromCookieHeader(header)
    expect(restored).toEqual(attr)
  })

  it('fails closed on missing, malformed, and garbage cookie values', () => {
    expect(readAttributionFromCookieHeader(null)).toBeNull()
    expect(readAttributionFromCookieHeader('theme=dark')).toBeNull()
    expect(readAttributionFromCookieHeader(`${ATTRIBUTION_COOKIE}=not-json`)).toBeNull()
    expect(readAttributionFromCookieHeader(`${ATTRIBUTION_COOKIE}=%7B%22a%22%3A`)).toBeNull()
    expect(
      readAttributionFromCookieHeader(`${ATTRIBUTION_COOKIE}=${encodeURIComponent('{"x":"y"}')}`)
    ).toBeNull()
  })
})

describe('attributionSummary', () => {
  it('renders source/medium, campaign, ad angle, and term', () => {
    const summary = attributionSummary({
      utm_source: 'facebook',
      utm_medium: 'paid-social',
      utm_campaign: 'law-ops-r1',
      utm_content: 'angle-salary',
    })
    expect(summary).toBe('facebook/paid-social | campaign: law-ops-r1 | ad: angle-salary')
  })

  it('falls back to the click-id family when no utm_source is present', () => {
    expect(attributionSummary({ gclid: 'abc' })).toBe('google ads click')
    expect(attributionSummary({ fbclid: 'abc' })).toBe('meta ads click')
    expect(attributionSummary(null)).toBeNull()
  })
})

describe('enumerated key list', () => {
  it('stays the sanctioned seven — widening this list needs a recorded decision', () => {
    expect([...AD_ATTRIBUTION_KEYS]).toEqual([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'gclid',
      'fbclid',
    ])
  })
})
