/**
 * The stale-holds query, executed (ss#2316).
 *
 * WHY THIS FILE EXISTS. `index.test.ts` covers stale_holds through a fake D1
 * whose `prepare(...).all()` returns a TypeScript REIMPLEMENTATION of the query
 * (`computeStaleHolds`, index.test.ts) for any SQL containing
 * 'LEFT JOIN fleet_status'. The SQL string is never executed, so no assertion
 * there can observe a wrong offset, a wrong column, or a malformed JSON path —
 * and the reimplementation has no clause at all for the two payload-carrying
 * connector conditions. That is the "instrument that cannot observe the layer it
 * claims to check" class the #2280 roll-up named.
 *
 * This suite runs the real `STALE_HOLDS_SQL` against real SQLite (`node:sqlite`)
 * with the real bindings, so the query is the thing under test. D1 is SQLite and
 * supports `json_each` (Cloudflare D1 SQL API, "Query JSON"), which is the
 * function the fix depends on.
 */

import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'
import {
  CONNECTOR_DOWN_PREFIX,
  CONNECTOR_TOKEN_EXPIRING_PREFIX,
  CONDITION_PREFIXES,
} from './conditions'
import { STALE_HOLDS_SQL, STALE_HOLDS_BINDINGS } from './stale-holds'

interface StatusSeed {
  customer_slug: string
  connectors_json?: string | null
  connector_token_age_json?: string | null
  spec_control_json?: string | null
  webhook_surface_json?: string | null
}

/**
 * Run the real query. `bindings` is injectable so a test can prove the SQL
 * follows the constants rather than a memorized offset: pass a prefix of a
 * DIFFERENT length and the slice must move with it.
 */
function runQuery(
  openConditions: Array<{ customer_slug: string; condition: string }>,
  statuses: StatusSeed[],
  bindings: readonly string[] = STALE_HOLDS_BINDINGS
): Array<{ customer_slug: string; condition: string }> {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE fleet_alert_state (
             customer_slug TEXT, condition TEXT, status TEXT)`)
  db.exec(`CREATE TABLE fleet_status (
             customer_slug TEXT,
             last_heartbeat_ts TEXT,
             sticky_stop_level TEXT,
             scheduler_ok INTEGER,
             scheduler_max_overdue_seconds INTEGER,
             connector_check_ok INTEGER,
             spec_control_ok INTEGER,
             webhook_surface_ok INTEGER,
             connectors_json TEXT,
             connector_token_age_json TEXT,
             spec_control_json TEXT,
             webhook_surface_json TEXT)`)

  const insertAlert = db.prepare(
    `INSERT INTO fleet_alert_state (customer_slug, condition, status) VALUES (?, ?, 'open')`
  )
  for (const a of openConditions) insertAlert.run(a.customer_slug, a.condition)

  const insertStatus = db.prepare(
    `INSERT INTO fleet_status (customer_slug, last_heartbeat_ts, sticky_stop_level,
       scheduler_ok, scheduler_max_overdue_seconds, connector_check_ok, spec_control_ok,
       webhook_surface_ok, connectors_json, connector_token_age_json, spec_control_json,
       webhook_surface_json)
     VALUES (?, '2026-08-11T00:00:00Z', 'OK', 1, 0, 1, 1, 1, ?, ?, ?, ?)`
  )
  for (const s of statuses) {
    insertStatus.run(
      s.customer_slug,
      s.connectors_json ?? null,
      s.connector_token_age_json ?? null,
      s.spec_control_json ?? null,
      s.webhook_surface_json ?? null
    )
  }

  return db.prepare(STALE_HOLDS_SQL).all(...bindings) as Array<{
    customer_slug: string
    condition: string
  }>
}

const healthy = (server: string) => JSON.stringify({ [server]: { consecutive_failures: 0 } })

describe('stale-holds SQL (executed against real SQLite)', () => {
  it('strands a connector_down whose server key is absent from the map', () => {
    const rows = runQuery(
      [{ customer_slug: 'smd', condition: `${CONNECTOR_DOWN_PREFIX}gmail` }],
      [{ customer_slug: 'smd', connectors_json: healthy('smokeball') }]
    )
    expect(rows).toEqual([{ customer_slug: 'smd', condition: `${CONNECTOR_DOWN_PREFIX}gmail` }])
  })

  it('does NOT strand a connector_down whose server key is present and live', () => {
    const rows = runQuery(
      [{ customer_slug: 'smd', condition: `${CONNECTOR_DOWN_PREFIX}gmail` }],
      [{ customer_slug: 'smd', connectors_json: healthy('gmail') }]
    )
    expect(rows).toEqual([])
  })

  it('strands a key present with a JSON null value (preserves json_extract semantics)', () => {
    const rows = runQuery(
      [{ customer_slug: 'smd', condition: `${CONNECTOR_DOWN_PREFIX}gmail` }],
      [{ customer_slug: 'smd', connectors_json: JSON.stringify({ gmail: null }) }]
    )
    expect(rows).toHaveLength(1)
  })

  it('strands every open condition when the seat has no fleet_status row at all', () => {
    const rows = runQuery([{ customer_slug: 'ghost', condition: 'heartbeat_red' }], [])
    expect(rows).toEqual([{ customer_slug: 'ghost', condition: 'heartbeat_red' }])
  })

  it('applies the same slice to connector_token_expiring', () => {
    const rows = runQuery(
      [
        { customer_slug: 'smd', condition: `${CONNECTOR_TOKEN_EXPIRING_PREFIX}gmail` },
        { customer_slug: 'smd', condition: `${CONNECTOR_TOKEN_EXPIRING_PREFIX}smokeball` },
      ],
      [
        {
          customer_slug: 'smd',
          connector_token_age_json: JSON.stringify({ smokeball: { age_days: 3 } }),
        },
      ]
    )
    expect(rows.map((r) => r.condition)).toEqual([`${CONNECTOR_TOKEN_EXPIRING_PREFIX}gmail`])
  })

  // --- (a) the SQL follows the constant, not a memorized offset --------------

  describe('prefix rename resilience (ss#2316 defect 1, hazard 1)', () => {
    it('slices correctly when the prefix is RENAMED to a different length', () => {
      // The falsifier for the old code: it sliced at a hardcoded column 16,
      // which is `'connector_down:'.length + 1`. Bind a shorter prefix and a
      // query that memorized 16 cuts in the wrong place, producing a key that
      // matches nothing and reporting the alert stranded.
      const renamed = 'cd:'
      expect(renamed.length).not.toBe(CONNECTOR_DOWN_PREFIX.length)
      const bindings = [renamed, renamed, ...STALE_HOLDS_BINDINGS.slice(2)]

      const stranded = runQuery(
        [{ customer_slug: 'smd', condition: `${renamed}gmail` }],
        [{ customer_slug: 'smd', connectors_json: healthy('smokeball') }],
        bindings
      )
      expect(stranded.map((r) => r.condition)).toEqual([`${renamed}gmail`])

      // And the healthy case must still be silent under the renamed prefix.
      const quiet = runQuery(
        [{ customer_slug: 'smd', condition: `${renamed}gmail` }],
        [{ customer_slug: 'smd', connectors_json: healthy('gmail') }],
        bindings
      )
      expect(quiet).toEqual([])
    })

    it('writes no prefix literal and no offset into the SQL text', () => {
      // Structural guard: the query must carry neither the prefix strings nor a
      // substr() with a numeric literal. Both are the shapes that drifted.
      for (const prefix of CONDITION_PREFIXES) {
        expect(STALE_HOLDS_SQL).not.toContain(prefix)
      }
      expect(STALE_HOLDS_SQL).not.toMatch(/substr\s*\([^)]*,\s*\d+/)
    })

    it('binds one value per placeholder', () => {
      const placeholders = (STALE_HOLDS_SQL.match(/\?/g) ?? []).length
      expect(placeholders).toBe(STALE_HOLDS_BINDINGS.length)
    })
  })

  // --- (b) hostile key characters -------------------------------------------

  describe('server names that are not path-safe (ss#2316 defect 1, hazard 2)', () => {
    // The old clause built '$."' || key || '"' and handed it to json_extract.
    // A key containing a double quote made that path malformed, and SQLite
    // answers a malformed path with NULL rather than an error — NULL being this
    // query's "stranded" signal, so a HEALTHY connector reported stranded
    // forever. json_each compares the key as a value, so nothing is syntax.
    const hostile = ['we"ird', 'has.dot', 'has space', "quote'single", 'br[ack]et', '$dollar']

    for (const server of hostile) {
      it(`does not strand a healthy connector named ${JSON.stringify(server)}`, () => {
        const rows = runQuery(
          [{ customer_slug: 'smd', condition: `${CONNECTOR_DOWN_PREFIX}${server}` }],
          [{ customer_slug: 'smd', connectors_json: healthy(server) }]
        )
        expect(rows).toEqual([])
      })

      it(`still strands a genuinely absent connector named ${JSON.stringify(server)}`, () => {
        const rows = runQuery(
          [{ customer_slug: 'smd', condition: `${CONNECTOR_DOWN_PREFIX}${server}` }],
          [{ customer_slug: 'smd', connectors_json: healthy('other') }]
        )
        expect(rows).toHaveLength(1)
      })
    }
  })
})
