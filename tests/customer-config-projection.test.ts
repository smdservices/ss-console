import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

import { validate } from '../src/lib/operator/customer-yaml'
import type { CustomerYaml } from '../src/lib/operator/customer-yaml/types'
import {
  projectCustomerYamlToConfigRow,
  buildProjectionSql,
  escapeSqlLiteral,
} from '../src/lib/portal/customer-config-projection'
import { projectRow, type PersonaConfig } from '../src/lib/portal/customer-config'

const CTX = {
  entityId: 'entity-123',
  orgId: 'org-123',
  gitSha: 'abc123def456',
  syncedAt: '2026-06-10T18:00:00.000Z',
}

/** Load + validate the live smd customer.yaml as a realistic base fixture. */
function smdYaml(): CustomerYaml {
  const parsed = parseYaml(readFileSync(resolve('operator/customers/smd/customer.yaml'), 'utf-8'))
  const result = validate(parsed)
  if (!result.ok) {
    throw new Error('smd customer.yaml failed validation: ' + JSON.stringify(result.errors))
  }
  return result.value
}

/** Simulate SQLite's single-quote unescaping of a literal produced by escapeSqlLiteral. */
function unescapeSqlLiteral(literal: string): string | null {
  if (literal === 'NULL') return null
  return literal.slice(1, -1).replace(/''/g, "'")
}

describe('customer-config projection: real smd yaml', () => {
  it('round-trips through the read-side projectRow without throwing', () => {
    const row = projectCustomerYamlToConfigRow(smdYaml(), CTX)
    expect(() => projectRow(row)).not.toThrow()
    const config = projectRow(row)
    expect(config.customer_slug).toBe('smd')
    expect(config.vertical).toBe('mixed')
    expect(config.entity_id).toBe('entity-123')
  })

  it('absent compliance_enabled projects to 0 (never NaN)', () => {
    const row = projectCustomerYamlToConfigRow(smdYaml(), CTX)
    expect(row.compliance_enabled).toBe(0)
  })

  it('narrows personas to the read-side PersonaConfig shape (skills = {name, trust_ceiling})', () => {
    const row = projectCustomerYamlToConfigRow(smdYaml(), CTX)
    const personas = JSON.parse(row.personas_json) as PersonaConfig[]
    const crane = personas.find((p) => p.slug === 'crane')
    expect(crane).toBeDefined()
    expect(crane!.name).toBe('Crane')
    expect(crane!.skills.length).toBeGreaterThan(0)
    for (const skill of crane!.skills) {
      // Exactly the two read-side keys — no version/enabled/action_ceilings leak.
      expect(Object.keys(skill).sort()).toEqual(['name', 'trust_ceiling'])
    }
  })

  it('authority + credential custody survive the read-side resolvers', () => {
    const config = projectRow(projectCustomerYamlToConfigRow(smdYaml(), CTX))
    expect(config.authority).toBeDefined()
    expect(config.credential_custody_default).toBeTruthy()
  })

  it('mcp_connector survives the round-trip (smd authors an enabled connector)', () => {
    // smd's customer.yaml authors the Phase-1 MCP connector: enabled, with Scott
    // (scott@smd.services) bound to the crane persona. The projection must carry
    // the authored values through the write → read round-trip intact.
    const row = projectCustomerYamlToConfigRow(smdYaml(), CTX)
    expect(row.mcp_connector_json).not.toBeNull()
    const config = projectRow(row)
    expect(config.mcp_connector.enabled).toBe(true)
    expect(config.mcp_connector.access).toEqual([{ email: 'scott@smd.services', profile: 'crane' }])
  })
})

describe('customer-config projection: null normalization', () => {
  it('serializes absent nullable persona fields as JSON null (key present, not dropped)', () => {
    const yaml = smdYaml()
    // Force the nullable fields undefined to prove they normalize to null.
    yaml.personas[0] = {
      ...yaml.personas[0],
      title: undefined as unknown as string | null,
      signature_html: undefined as unknown as string | null,
      send_as: undefined as unknown as null,
    }
    const row = projectCustomerYamlToConfigRow(yaml, CTX)
    // The raw JSON text must contain explicit nulls, not omit the keys.
    expect(row.personas_json).toContain('"title":null')
    expect(row.personas_json).toContain('"signature_html":null')
    expect(row.personas_json).toContain('"send_as":null')
    const personas = JSON.parse(row.personas_json) as PersonaConfig[]
    expect(personas[0]).toHaveProperty('title', null)
    expect(personas[0]).toHaveProperty('signature_html', null)
    expect(personas[0]).toHaveProperty('send_as', null)
    expect(() => projectRow(row)).not.toThrow()
  })

  it('compliance_enabled true projects to 1', () => {
    const yaml = smdYaml()
    yaml.compliance_enabled = true
    expect(projectCustomerYamlToConfigRow(yaml, CTX).compliance_enabled).toBe(1)
  })
})

describe('customer-config projection: SQL escaping (adversarial characters)', () => {
  const ADVERSARIAL = `O'Brien said "hi"; <script>alert(1)</script>\nline2 -- not a comment`

  it('escapeSqlLiteral is lossless through a simulated SQLite unescape', () => {
    for (const v of [ADVERSARIAL, "''", "a'b'c", 'plain', '']) {
      expect(unescapeSqlLiteral(escapeSqlLiteral(v))).toBe(v)
    }
    expect(escapeSqlLiteral(null)).toBe('NULL')
    expect(unescapeSqlLiteral('NULL')).toBeNull()
  })

  it('adversarial signature_html survives projection + escape + unescape + parse', () => {
    const yaml = smdYaml()
    yaml.personas[0] = {
      ...yaml.personas[0],
      signature_html: ADVERSARIAL,
      tone: ["it's", 'a "quote"', 'semi;colon'],
    }
    const row = projectCustomerYamlToConfigRow(yaml, CTX)
    // Round-trip the escaped JSON literal back to the JSON, then parse it.
    const recovered = unescapeSqlLiteral(escapeSqlLiteral(row.personas_json))
    expect(recovered).toBe(row.personas_json)
    const personas = JSON.parse(recovered!) as PersonaConfig[]
    expect(personas[0].signature_html).toBe(ADVERSARIAL)
    expect(personas[0].tone).toEqual(["it's", 'a "quote"', 'semi;colon'])
  })
})

describe('customer-config projection: SQL document', () => {
  it('builds an idempotent UPSERT + a guarded manual history event', () => {
    const sql = buildProjectionSql(
      projectCustomerYamlToConfigRow(smdYaml(), CTX),
      'scott@smd.services'
    )
    expect(sql).toContain('INSERT INTO customer_configs')
    expect(sql).toContain('ON CONFLICT(entity_id) DO UPDATE SET')
    expect(sql).toContain('INSERT INTO customer_config_history')
    expect(sql).toContain("'manual'")
    // No-op guard + prev_git_sha lineage.
    expect(sql).toContain('WHERE NOT EXISTS')
    expect(sql).toContain('ORDER BY id DESC LIMIT 1')
  })
})
