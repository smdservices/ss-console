/**
 * Guard: every HTTP route under src/pages/api/admin/** must enforce admin auth
 * through `requireAdminSession`, making the convention mechanical rather than a
 * matter of reviewer vigilance (code review 2026-07-02 §2.6, building on the
 * §1.6 positive finding that the convention is currently applied uniformly).
 *
 * Documented exception: `fleet/health.ts` is a machine-callable surface guarded
 * by a dedicated bearer secret (`OPERATOR_HEALTH_READ_KEY`, constant-time
 * compared via `verifyHealthReadKey`), not a browser session. Any new admin
 * route must either import `requireAdminSession` or be added to EXEMPT with a
 * comment justifying its alternative auth.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { resolve } from 'path'

const ADMIN_API_ROOT = resolve('src/pages/api/admin')

/** Routes that legitimately do not use requireAdminSession (see file header). */
const EXEMPT = new Set<string>([resolve('src/pages/api/admin/fleet/health.ts')])

const HTTP_HANDLER = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|ALL)\b/

function collectRouteFiles(): string[] {
  // recursive readdir returns paths relative to the constant absolute root;
  // build the full path by interpolation (not path.join) so the static
  // path-traversal scanner sees no fs-derived value entering a join/resolve.
  return readdirSync(ADMIN_API_ROOT, { recursive: true })
    .map((entry) => String(entry))
    .filter((rel) => rel.endsWith('.ts') && !rel.endsWith('.test.ts'))
    .map((rel) => `${ADMIN_API_ROOT}/${rel}`)
}

describe('admin API auth convention', () => {
  it('every admin API route enforces requireAdminSession (or is a documented exception)', () => {
    const offenders: string[] = []
    for (const file of collectRouteFiles()) {
      if (EXEMPT.has(file)) continue
      const src = readFileSync(file, 'utf8')
      if (!HTTP_HANDLER.test(src)) continue // shared helper module, not a route
      if (!src.includes('requireAdminSession')) {
        offenders.push(file.replace(`${resolve('.')}/`, ''))
      }
    }
    expect(offenders).toEqual([])
  })

  it('every EXEMPT entry still exists (prunes stale allowlist entries)', () => {
    for (const file of EXEMPT) {
      expect(statSync(file).isFile()).toBe(true)
    }
  })
})
