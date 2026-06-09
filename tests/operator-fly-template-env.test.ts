/**
 * Guard: the per-customer Machine fly.toml template must set every env var the
 * SMD overlay plugins REQUIRE at register.
 *
 * The overlay plugins (audit, voice, webhook-router, trust, memory-mirror) call
 * `require("SMD_CUSTOMER_SLUG", "SMD_D1_AUDIT_BINDING")` at register and bail to
 * a degraded no-op branch if either is missing. `SMD_CUSTOMER_SLUG` was once
 * omitted from the template (only `CUSTOMER_SLUG` was set), which silently
 * disabled the entire SMD plugin suite on customer-zero — audit emission never
 * wrote, so the ADR 0043 runtime-read seam read a dry well (ss-console#1285).
 * This test fails loudly if a required SMD_* var is dropped from the template.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const template = readFileSync(resolve(__dirname, '../operator/templates/fly.toml.template'), 'utf8')

// Env vars the overlay plugins require() at register. Dropping any silently
// degrades the whole suite — keep this list in lockstep with the plugins'
// require(...) calls in venturecrane/hermes-smd-overlay.
const REQUIRED_PLUGIN_ENV = ['SMD_CUSTOMER_SLUG', 'SMD_D1_AUDIT_BINDING'] as const

describe('operator fly.toml template — required plugin env', () => {
  for (const key of REQUIRED_PLUGIN_ENV) {
    it(`declares ${key} in [env]`, () => {
      // A key=value assignment for this var must appear in the template.
      expect(template).toMatch(new RegExp(`^\\s*${key}\\s*=`, 'm'))
    })
  }

  it('binds SMD_CUSTOMER_SLUG to the customer slug placeholder', () => {
    expect(template).toMatch(/SMD_CUSTOMER_SLUG\s*=\s*"\{\{CUSTOMER_SLUG\}\}"/)
  })
})
