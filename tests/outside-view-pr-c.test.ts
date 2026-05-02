/**
 * Post-Outside-View retirement — chrome unlinking + redirect retargeting.
 *
 * Outside View was retired (the public-footprint scrape didn't surface
 * useful signal). This file originally locked the OV-PR-C ship; it has
 * been repurposed to lock the unlinking that came after.
 *
 * Static-source assertions covering:
 *   1. /outside-view route file still on disk (route still serves any
 *      direct-typed traffic, scan-pipeline magic-link emails, etc.).
 *   2. Middleware 301 redirects from retired surfaces (/scan exact,
 *      /scorecard descendants, /get-started cold-mode) all point at /
 *      now, not /outside-view.
 *   3. Legacy 301-emitter pages match the middleware retargets.
 *   4. /scan/verify/[token] still resolves (in-flight magic-link
 *      tokens preserved).
 *   5. /get-started preserves ?booked=1 prep behavior.
 *   6. No /outside-view links in the home-page chrome (Hero, FinalCta,
 *      index.astro, Footer, book.astro). The conversation-mechanism team
 *      will add new CTAs in their own PR.
 *   7. Email copy still references /outside-view because the scan
 *      pipeline still feeds the portal artifact for in-flight prospects
 *      (gated on OUTSIDE_VIEW_PORTAL_DELIVERY env flag, conversation-team
 *      coordination).
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

describe('post-OV: /outside-view route preserved on disk', () => {
  it('page still exists (serves direct traffic + scan-pipeline links)', () => {
    expect(existsSync(resolve('src/pages/outside-view/index.astro'))).toBe(true)
  })
})

describe('post-OV: middleware redirects retargeted to /', () => {
  const src = readFileSync(resolve('src/middleware.ts'), 'utf-8')

  it('/scan exact match redirects to / (NOT startsWith, NOT /outside-view)', () => {
    // CRITICAL: must be exact equality, not startsWith. /scan/verify/[token]
    // is the magic-link landing for in-flight emails.
    expect(src).toMatch(
      /pathname === '\/scan'\s*\)\s*\{[\s\S]*?context\.redirect\(['"]\/['"],\s*301\)/
    )
    expect(src).not.toMatch(/pathname === '\/scan'\s*\)\s*\{[\s\S]*?\/outside-view/)
  })

  it('/scorecard redirects to / (descendants too, no longer /outside-view)', () => {
    expect(src).toMatch(
      /pathname === '\/scorecard'\s*\|\|\s*pathname\.startsWith\('\/scorecard\/'\)[\s\S]*?context\.redirect\(['"]\/['"],\s*301\)/
    )
  })

  it('/get-started redirects to / ONLY when no ?booked param', () => {
    expect(src).toMatch(
      /pathname === '\/get-started'\s*&&\s*!context\.url\.searchParams\.has\('booked'\)/
    )
    expect(src).toMatch(
      /pathname === '\/get-started'[\s\S]*?context\.redirect\(['"]\/['"],\s*301\)/
    )
  })

  it('uses 301 (permanent) for all retirement redirects', () => {
    // The three retirement redirects (scan, scorecard, get-started cold-mode)
    // all target / with 301.
    const block = src.slice(src.indexOf('Lead-magnet retirement chain'))
    const cutoff = block.indexOf('Initialize session as null')
    const chunk = cutoff > 0 ? block.slice(0, cutoff) : block
    const matches = chunk.match(/context\.redirect\(['"]\/['"],\s*301\)/g)
    expect(matches).toBeTruthy()
    expect((matches ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('preserves the /book/thanks → /get-started?booked=1 redirect', () => {
    expect(src).toMatch(/\/book\/thanks[\s\S]*?\/get-started\?booked=1.*?301/)
  })
})

describe('post-OV: legacy pages emit 301 to /', () => {
  it('/scan/index.astro emits Astro.redirect to /', () => {
    const src = readFileSync(resolve('src/pages/scan/index.astro'), 'utf-8')
    expect(src).toMatch(/Astro\.redirect\(['"]\/['"],\s*301\)/)
    expect(src).not.toMatch(/Astro\.redirect\(['"]\/outside-view['"]/)
  })

  it('/scan/index.astro no longer renders the form (file is redirect-only)', () => {
    const src = readFileSync(resolve('src/pages/scan/index.astro'), 'utf-8')
    expect(src).not.toMatch(/<form/)
    expect(src).not.toMatch(/Operational Readiness Scan/)
  })

  it('/scorecard.astro emits Astro.redirect to /', () => {
    const src = readFileSync(resolve('src/pages/scorecard.astro'), 'utf-8')
    expect(src).toMatch(/Astro\.redirect\(['"]\/['"],\s*301\)/)
    expect(src).not.toMatch(/Astro\.redirect\(['"]\/outside-view['"]/)
  })

  it('/scorecard.astro no longer renders the form', () => {
    const src = readFileSync(resolve('src/pages/scorecard.astro'), 'utf-8')
    expect(src).not.toMatch(/<form/)
  })

  it('/scan/verify/[token].astro NOT modified (in-flight tokens preserved)', () => {
    expect(existsSync(resolve('src/pages/scan/verify/[token].astro'))).toBe(true)
    const src = readFileSync(resolve('src/pages/scan/verify/[token].astro'), 'utf-8')
    // Must not have been rewritten as a top-level redirect.
    expect(src).not.toMatch(/^---\s*[\s\S]*?Astro\.redirect[\s\S]*?---\s*$/)
  })
})

describe('post-OV: /get-started ?booked=1 preserved', () => {
  const src = readFileSync(resolve('src/pages/get-started.astro'), 'utf-8')

  it('cold-mode (no ?booked) redirects to /', () => {
    expect(src).toMatch(/!isPostBooking[\s\S]*Astro\.redirect\(['"]\/['"],\s*301\)/)
  })

  it('still detects ?booked query param', () => {
    expect(src).toMatch(/searchParams\.has\(['"]booked['"]\)/)
  })

  it('still renders the prep questionnaire (post-booking mode preserved)', () => {
    expect(src).toMatch(/Help Us Prepare/)
    expect(src).toMatch(/<form/)
  })
})

describe('post-OV: home-page chrome unlinks /outside-view', () => {
  it('Hero contains no /outside-view link', () => {
    const src = readFileSync(resolve('src/components/Hero.astro'), 'utf-8')
    expect(src).not.toMatch(/href=['"]\/outside-view['"]/)
  })

  it('FinalCta contains no /outside-view link', () => {
    const src = readFileSync(resolve('src/components/FinalCta.astro'), 'utf-8')
    expect(src).not.toMatch(/href=['"]\/outside-view['"]/)
  })

  it('index.astro contains no /outside-view link (interstitial removed)', () => {
    const src = readFileSync(resolve('src/pages/index.astro'), 'utf-8')
    expect(src).not.toMatch(/href=['"]\/outside-view['"]/)
  })

  it('Footer contains no /outside-view link', () => {
    const src = readFileSync(resolve('src/components/Footer.astro'), 'utf-8')
    expect(src).not.toMatch(/href=['"]\/outside-view['"]/)
  })

  it('book.astro escape hatch contains no /outside-view link', () => {
    const src = readFileSync(resolve('src/pages/book.astro'), 'utf-8')
    expect(src).not.toMatch(/href=['"]\/outside-view['"]/)
  })

  it('Nav.astro contains no /#approach anchor (renamed to /#capabilities)', () => {
    const src = readFileSync(resolve('src/components/Nav.astro'), 'utf-8')
    expect(src).not.toMatch(/['"]\/#approach['"]/)
  })

  it('/ai eyebrow back-link points at /#capabilities (was /#approach)', () => {
    const src = readFileSync(resolve('src/pages/ai.astro'), 'utf-8')
    expect(src).toMatch(/href=['"]\/#capabilities['"]/)
    expect(src).not.toMatch(/href=['"]\/#approach['"]/)
  })

  it('WhatYouGet section anchor renamed approach → capabilities', () => {
    const src = readFileSync(resolve('src/components/WhatYouGet.astro'), 'utf-8')
    expect(src).toMatch(/id=['"]capabilities['"]/)
    expect(src).not.toMatch(/id=['"]approach['"]/)
  })
})

describe('post-OV: scan-pipeline email still routes to /outside-view portal artifact', () => {
  // Email delivery into the OV portal artifact is preserved per the
  // OUTSIDE_VIEW_PORTAL_DELIVERY env flag. Cleanup is gated on the
  // conversation-mechanism team. This test guards against accidental
  // email-copy edits that would break in-flight prospect deliveries.

  it('thin-footprint email still references smd.services/outside-view', () => {
    const src = readFileSync(resolve('src/lib/email/diagnostic-email.ts'), 'utf-8')
    expect(src).toMatch(/smd\.services\/outside-view/)
  })
})
