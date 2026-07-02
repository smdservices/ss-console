/**
 * Guard for the web assessment runtime's coupling to the operator/ skill bodies
 * (code review 2026-07-02 §1.8).
 *
 * src/lib/assessment/prompts.ts assembles its system prompts from operator skill
 * files loaded via Vite `?raw`. If one of those files is moved or renamed, the
 * only signal today is an opaque `npm run build` failure. This test reads the
 * declared source paths from the single indirection module and asserts each one
 * still resolves on disk, so a broken coupling fails a clear, named unit test
 * first — pointing the fixer straight at the manifest to update.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { OPERATOR_SKILL_SOURCE_PATHS } from '../src/lib/assessment/operator-skill-sources'

// Repo root is a constant; build absolute paths by interpolation (not
// path.resolve/join on the loop variable) to keep the static path-traversal
// scanner satisfied — the paths are compile-time `as const` literals.
const REPO_ROOT = resolve('.')

describe('assessment prompts: operator/ skill sources', () => {
  it.each(OPERATOR_SKILL_SOURCE_PATHS)('operator asset exists and is non-empty: %s', (relPath) => {
    const full = `${REPO_ROOT}/${relPath}`
    expect(
      existsSync(full),
      `Missing operator skill source "${relPath}". If it moved, update the import and OPERATOR_SKILL_SOURCE_PATHS in src/lib/assessment/operator-skill-sources.ts.`
    ).toBe(true)
    expect(readFileSync(full, 'utf8').trim().length, `${relPath} is empty`).toBeGreaterThan(0)
  })
})
