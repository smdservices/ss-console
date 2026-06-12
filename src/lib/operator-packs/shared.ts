// Shared frame copy for the Operator vertical pack pages.
//
// These strings are identical-by-design across all 12 packs. Keeping them here
// (rather than re-typing them in each page) prevents drift and keeps the one
// place a reviewer has to check for the shared scaffolding. Per-vertical content
// (the starting templates, the day-one narrative, the line) lives in each pack
// file and is sourced from operator/verticals/<vertical>/vertical.yaml.
//
// This module is scanned by tests/landing-page.test.ts for voice violations, so
// it must stay in firm "we"/"you" voice with no em dashes.

// A direct lander (arriving from search, not from /operator) may not have seen
// the concept yet. This link points them to the full explanation without the
// pack page having to re-run the landing's argument.
export const coldLanderLink = {
  text: 'New to the Operator? See how it works',
  href: '/operator',
}

// The three customization zones of every pack, shown in the "Yours To Shape"
// section. Titles are shared; the body under each is per-vertical.
export const shapeZoneTitles = {
  prebuilt: 'Pre-built',
  connected: 'Connected to your stack',
  yours: 'Yours to shape',
}

// The pricing line shown in every pack's closing section.
export const ctaPricingLine =
  'Pricing is a flat monthly subscription, scoped to the seat we build together, and we walk through it before any setup begins.'
