/**
 * The provisioner's fleet_status seed must name a real conflict target (#2286).
 *
 * Migration 0093 re-keyed `fleet_status` from `entity_id TEXT PRIMARY KEY` to
 * `customer_slug TEXT PRIMARY KEY`, leaving `entity_id` a plain non-unique
 * index. SQLite rejects an `ON CONFLICT` target that names no PRIMARY KEY or
 * UNIQUE constraint — the statement does not degrade, it fails to parse. So
 * `operator/bin/provision-customer.sh` step 6d, which still said
 * `ON CONFLICT(entity_id)`, seeded zero rows from 0093 onward.
 *
 * It was invisible for two compounding reasons, both fixed alongside the
 * target: the wrangler stderr was sent to /dev/null, and the fallback log line
 * ("WARN: fleet_status seed failed") reads like a transient hiccup rather than
 * a statement that can never succeed.
 *
 * This file runs the ACTUAL statement, lifted out of the shell script, against
 * a schema built from the ACTUAL migration. Neither half is restated here: a
 * test carrying its own copy of the SQL and its own copy of the schema would
 * agree with itself forever while the shipped pair drifted apart. A future
 * re-key of fleet_status breaks this test, which is the point.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PROVISIONER = join(REPO_ROOT, 'operator', 'bin', 'provision-customer.sh')
const MIGRATIONS = join(REPO_ROOT, 'migrations')

const SEED_SLUG = 'ashton-price'
const SEED_ENTITY = 'ent_seed_test'

let workDir: string | null = null

afterEach(() => {
  if (workDir !== null) {
    rmSync(workDir, { recursive: true, force: true })
    workDir = null
  }
})

/**
 * The seed statement as the provisioner writes it, with the shell's `${SLUG}`
 * interpolation resolved. Extracted from the heredoc so the test exercises the
 * shipped SQL rather than a paraphrase of it.
 */
function extractSeedSql(): string {
  const source = readFileSync(PROVISIONER, 'utf8')
  const m = /^SEED_SQL=\$\(cat <<EOF\n([\s\S]*?)\nEOF$/m.exec(source)
  if (m === null) throw new Error('provision-customer.sh: SEED_SQL heredoc not found')
  return m[1].replaceAll('${SLUG}', SEED_SLUG)
}

/**
 * The live fleet_status shape, taken from the most recent migration that
 * creates the table (0093's rebuild, which renames `fleet_status_new` into
 * place). Columns added later by ALTER are all nullable and irrelevant to a
 * four-column seed.
 */
function extractFleetStatusSchema(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let body: string | null = null
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
    const m = /CREATE TABLE fleet_status(?:_new)?\s*\(([\s\S]*?)\n\);/.exec(sql)
    if (m !== null) body = m[1]
  }
  if (body === null) throw new Error('migrations: no CREATE TABLE fleet_status found')
  return `CREATE TABLE fleet_status (${body}\n);`
}

/** Run a SQL script through the sqlite3 CLI, capturing stdout, stderr, exit. */
function runSqlite(sql: string): { stdout: string; stderr: string; code: number } {
  workDir ??= mkdtempSync(join(tmpdir(), 'fleet-seed-'))
  const file = join(workDir, `${Math.random().toString(36).slice(2)}.sql`)
  writeFileSync(file, sql)
  try {
    const stdout = execFileSync('sqlite3', [':memory:', `.read ${file}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 }
  }
}

/** Schema + one customer_configs row, ready for the seed statement to land. */
function fixtureSchema(): string {
  return [
    'CREATE TABLE entities (id TEXT PRIMARY KEY);',
    `INSERT INTO entities VALUES ('${SEED_ENTITY}');`,
    extractFleetStatusSchema(),
    'CREATE TABLE customer_configs (customer_slug TEXT PRIMARY KEY, entity_id TEXT NOT NULL);',
    `INSERT INTO customer_configs VALUES ('${SEED_SLUG}', '${SEED_ENTITY}');`,
  ].join('\n')
}

describe('provision-customer.sh step 6d: fleet_status seed (#2286)', () => {
  it('the conflict target names the live PRIMARY KEY column', () => {
    // Static half. Cheap, and it fails on the next re-key even in an
    // environment where sqlite3 is unavailable.
    const pkLine = extractFleetStatusSchema()
      .split('\n')
      .find((l) => /PRIMARY KEY/.test(l))
    expect(pkLine, 'fleet_status has no single-column PRIMARY KEY line').toBeDefined()
    const pkColumn = pkLine?.trim().split(/\s+/)[0]

    const conflictTarget = /ON CONFLICT\(([a-z_]+)\)/.exec(extractSeedSql())?.[1]
    expect(conflictTarget, `seed conflicts on ${conflictTarget}, PK is ${pkColumn}`).toBe(pkColumn)
  })

  it('the statement actually seeds one row against the live schema', () => {
    const res = runSqlite(
      [
        fixtureSchema(),
        extractSeedSql(),
        `SELECT 'ROWS_SEEDED:' || count(*) FROM fleet_status;`,
      ].join('\n')
    )

    expect(res.stderr, `sqlite rejected the seed:\n${res.stderr}`).toBe('')
    expect(res.code).toBe(0)
    expect(res.stdout.trim()).toBe('ROWS_SEEDED:1')
  })

  it('re-running the seed is a no-op, not a constraint error', () => {
    // The whole reason for ON CONFLICT: provisioning is idempotent, so the
    // second run must leave exactly one row rather than abort the script.
    const seed = extractSeedSql()
    const res = runSqlite(
      [fixtureSchema(), seed, seed, `SELECT 'ROWS_SEEDED:' || count(*) FROM fleet_status;`].join(
        '\n'
      )
    )

    expect(res.stderr).toBe('')
    expect(res.stdout.trim()).toBe('ROWS_SEEDED:1')
  })

  it('the seed step does not discard wrangler stderr', () => {
    // Half of why this defect survived seven weeks. `2>&1` into /dev/null on
    // the seed invocation turns a permanent parse error into a silent WARN.
    const source = readFileSync(PROVISIONER, 'utf8')
    const seedBlock = source.slice(source.indexOf('Step 6d'), source.indexOf('Step 7:'))
    expect(seedBlock).toContain('wrangler d1 execute')
    expect(seedBlock).not.toMatch(/wrangler d1 execute[^\n]*2>&1\s*\)/)
    expect(seedBlock).not.toMatch(/wrangler d1 execute[^\n]*2>\s*\/dev\/null/)
    // The captured stderr has to reach the log, not just avoid /dev/null.
    expect(seedBlock).toMatch(/log "WARN: wrangler stderr/)
  })
})
