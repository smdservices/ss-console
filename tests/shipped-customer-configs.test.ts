/**
 * Pre-merge gate: every SHIPPED seat config must pass the same validators the
 * D1 projection runs.
 *
 * Why this exists. `scripts/project-customer-config.ts` hard-validates both
 * `customer.yaml` and its sibling `routine-grid.yaml` and exits non-zero on any
 * error, and the deploy workflow's "Sync customer.yaml → D1 projection" job
 * runs it for every changed seat on push to main. Until this file, nothing ran
 * those validators over the real configs before merge — the narrow suites that
 * walk `operator/customers/` each assert one targeted property (materializable
 * backends, banned_tools display coverage, no PLACEHOLDER markers), never the
 * whole schema. So an invalid seat config merged GREEN and failed only after
 * the fact, which costs twice:
 *
 *   1. main goes red on a post-merge job (a Deploy failure page at 02:34),
 *   2. the seat's live `customer_configs` row silently keeps the PREVIOUS
 *      config — the exact stale-projection failure class the auto-sync job was
 *      built to close (ADR 0012 §5, #1308).
 *
 * That happened on 2026-07-24: the smd-staging msgraph Email binding (#1991,
 * ADR 0078) tripped a stale `UnknownWebhookSource` coupling rule that predated
 * poll-driven inbound. Both validators were run by hand on that PR and the
 * console's own suite was green, because no suite loaded the file.
 *
 * Scope note: `_`-prefixed dirs are templates, not seats — they carry authoring
 * placeholders (`[filevine / clio / no_pm]`) and are skipped by the CI sync
 * script for the same reason. This mirrors that rule so the two never diverge.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { validate } from '../src/lib/operator/customer-yaml'
import { validateRoutineGrid } from '../src/lib/operator/routine-grid'

const CUSTOMERS_DIR = resolve('operator/customers')

/** Seat slugs the CI sync script would project: real dirs, `_`-prefixed skipped. */
function shippedSlugs(): string[] {
  if (!existsSync(CUSTOMERS_DIR)) return []
  return readdirSync(CUSTOMERS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((slug) => existsSync(join(CUSTOMERS_DIR, slug, 'customer.yaml')))
    .sort()
}

const slugs = shippedSlugs()

function formatErrors(errors: { code: string; path: string; message: string }[]): string {
  return errors.map((e) => `  [${e.code}] ${e.path}: ${e.message}`).join('\n')
}

describe('shipped customer configs validate (projection parity)', () => {
  it('discovers at least one shipped seat', () => {
    expect(slugs.length).toBeGreaterThan(0)
  })

  it.each(slugs)('%s: customer.yaml passes the canonical validator', (slug) => {
    const path = join(CUSTOMERS_DIR, slug, 'customer.yaml')
    const result = validate(parseYaml(readFileSync(path, 'utf-8')))
    if (!result.ok) {
      throw new Error(
        `operator/customers/${slug}/customer.yaml would fail the D1 projection:\n` +
          formatErrors(result.errors)
      )
    }
  })

  it.each(slugs)('%s: routine-grid.yaml passes the canonical validator when present', (slug) => {
    const path = join(CUSTOMERS_DIR, slug, 'routine-grid.yaml')
    if (!existsSync(path)) return
    const result = validateRoutineGrid(parseYaml(readFileSync(path, 'utf-8')))
    if (!result.ok) {
      throw new Error(
        `operator/customers/${slug}/routine-grid.yaml would fail the D1 projection:\n` +
          formatErrors(result.errors)
      )
    }
  })
})
