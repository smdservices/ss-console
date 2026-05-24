/**
 * Tests for the customer.yaml structural validator
 * (src/lib/ai-employee/customer-yaml/validator.ts).
 *
 * Test strategy: build one valid in-memory fixture (the schema's worked
 * example, simplified) and validate it once to lock the happy path. Then
 * mutate that fixture per error category and assert the matching
 * ValidationErrorCode is produced. Validator does NOT short-circuit on
 * the first error, so a single broken fixture can carry multiple
 * mutations and we assert the full error list.
 *
 * The validator never throws — every check appends to the errors[] list.
 * If a test ever expects throw, the validator's contract is broken.
 *
 * No real YAML parser is used here: the validator takes a parsed object,
 * not raw text. That separation matches ADR 0012 §4 (portal and Hermes
 * parse independently with their own libraries).
 */

import { describe, it, expect } from 'vitest'
import {
  validate,
  type CustomerYaml,
  type ValidationError,
  type ValidationErrorCode,
} from '../src/lib/ai-employee/customer-yaml'

// -----------------------------------------------------------------------------
// Fixture builder
// -----------------------------------------------------------------------------

/**
 * Return a fresh, valid customer.yaml-shaped object. Tests mutate this
 * before passing to validate(); they never mutate a shared instance.
 *
 * The shape mirrors the spec's worked example (the smith-pi-firm example)
 * trimmed to the minimum that satisfies every required field. Optional
 * sections appear once across the suite (in `withFullOptionals`) so they
 * also get coverage.
 */
function validFixture(): Record<string, unknown> {
  return {
    schema_version: 1,
    customer_id: 'smith-pi-firm',
    customer_name: 'Smith PI Firm',
    vertical: 'law-firm',
    practice_areas: ['personal-injury', 'workers-comp'],
    fly_region: 'lax',
    model: 'claude-opus-4-7',
    hermes_ref: 'v2026.5.7-smd.0',
    machine: {
      size: 'performance-1x',
      memory_mb: 1024,
    },
    users: [
      { email: 'partner@firm.com', role: 'principal', full_name: 'Jane Smith' },
      { email: 'paralegal@firm.com', role: 'operator', full_name: 'Pat Lee' },
    ],
    personas: [
      {
        slug: 'marcus',
        status: 'active',
        name: 'Marcus',
        title: 'AI Associate',
        signature_html: '<p>Marcus | AI Associate at Smith PI</p>',
        tone: ['warm-but-professional', 'concise'],
        send_as: { agentmail_identity: 'marcus@smith-pi-firm.agents.smd.services' },
        skills: [
          {
            name: 'inbox-triage-and-draft',
            trust_ceiling: 'draft_for_review',
            enabled: true,
            cost_estimate: {
              tokens_in_per_run: 2000,
              tokens_out_per_run: 800,
              tool_calls_per_run: 4,
              runs_per_day_typical: 30,
            },
          },
          { name: 'conflict-check', trust_ceiling: 'autonomous' },
        ],
        channel_bindings: [{ integration: 'ms-graph', channels: ['primary-inbox'] }],
      },
    ],
    connectors: {
      Email: {
        adapter: 'microsoft-graph',
        backend: 'mcp:softeria/ms-365-mcp-server',
        token_ref: 'infisical:/ai-employee/smith-pi-firm/email/refresh',
      },
      Calendar: { adapter: 'microsoft-graph', backend: 'mcp:softeria/ms-365-mcp-server' },
      PracticeManagement: {
        adapter: 'filevine',
        backend: 'build:filevine-mcp',
        scopes: ['matters:read', 'contacts:read'],
      },
    },
    scope: {
      email_folders_visible: ['Inbox', 'Clients', 'Intake'],
      email_folders_blind: ['Strategy', 'Private'],
      email_keyword_blocks: ['PRIVILEGED'],
      domain_blocks: ['opposing-counsel.example.com'],
    },
    escalation: {
      red_flag_recipients: ['partner@firm.com'],
      failure_recipients: ['partner@firm.com', 'paralegal@firm.com'],
    },
    memory: {
      d1_namespace: 'smith-pi-firm',
      r2_vault_path: 'vaults/smith-pi-firm/',
      vectorize_index: 'hermes-smith-pi-firm-vault',
    },
  }
}

function withFullOptionals(): Record<string, unknown> {
  const f = validFixture()
  f['voice_library'] = { samples_path: 'r2://vaults/smith-pi-firm/voice-samples/' }
  f['business_hours'] = {
    timezone: 'America/Phoenix',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    start: '08:00',
    end: '18:00',
  }
  f['logging'] = { level: 'info', ship_to: ['cloudflare-d1'] }
  f['pause'] = { active: false }
  return f
}

function codesOf(errors: ValidationError[]): ValidationErrorCode[] {
  return errors.map((e) => e.code)
}

// -----------------------------------------------------------------------------
// Happy path
// -----------------------------------------------------------------------------

describe('validate — happy path', () => {
  it('accepts the minimal valid fixture', () => {
    const result = validate(validFixture())
    if (!result.ok) {
      throw new Error(`expected ok; got errors: ${JSON.stringify(result.errors, null, 2)}`)
    }
    expect(result.ok).toBe(true)
    const value: CustomerYaml = result.value
    expect(value.customer_id).toBe('smith-pi-firm')
    expect(value.personas).toHaveLength(1)
    expect(value.personas[0].skills).toHaveLength(2)
    expect(value.connectors.Email?.token_ref).toBe(
      'infisical:/ai-employee/smith-pi-firm/email/refresh'
    )
  })

  it('accepts the fixture with all optional sections populated', () => {
    const result = validate(withFullOptionals())
    if (!result.ok) {
      throw new Error(
        `expected ok with optionals; got errors: ${JSON.stringify(result.errors, null, 2)}`
      )
    }
    expect(result.ok).toBe(true)
    expect(result.value.business_hours?.timezone).toBe('America/Phoenix')
    expect(result.value.logging?.level).toBe('info')
    expect(result.value.pause?.active).toBe(false)
  })

  it('accepts non-law-firm vertical without practice_areas', () => {
    const f = validFixture()
    f['vertical'] = 'marketing-agency'
    delete f['practice_areas']
    const result = validate(f)
    if (!result.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(result.errors)}`)
    }
    expect(result.value.practice_areas).toEqual([])
  })
})

// -----------------------------------------------------------------------------
// Missing required fields
// -----------------------------------------------------------------------------

describe('validate — MissingField', () => {
  const requiredTopLevel = [
    'schema_version',
    'customer_id',
    'customer_name',
    'vertical',
    'fly_region',
    'model',
    'hermes_ref',
    'machine',
    'users',
    'personas',
    'connectors',
    'scope',
    'escalation',
    'memory',
  ]

  for (const field of requiredTopLevel) {
    it(`reports missing top-level field: ${field}`, () => {
      const f = validFixture()
      delete f[field]
      const r = validate(f)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(codesOf(r.errors)).toContain('MissingField')
      expect(r.errors.some((e) => e.path.startsWith(field))).toBe(true)
    })
  }

  it('requires practice_areas when vertical=law-firm', () => {
    const f = validFixture()
    delete f['practice_areas']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'practice_areas' && e.code === 'MissingField')).toBe(
      true
    )
  })

  it('requires pause.reason when pause.active=true', () => {
    const f = validFixture()
    f['pause'] = { active: true }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'pause.reason')).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Enum violations
// -----------------------------------------------------------------------------

describe('validate — EnumViolation', () => {
  it('rejects unknown vertical', () => {
    const f = validFixture()
    f['vertical'] = 'pet-grooming'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('EnumViolation')
  })

  it('rejects unknown user role', () => {
    const f = validFixture()
    ;(f['users'] as Array<{ role: string }>)[0].role = 'janitor'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.code === 'EnumViolation' && e.path.includes('users'))).toBe(true)
  })

  it('rejects unknown trust_ceiling', () => {
    const f = validFixture()
    ;(
      f['personas'] as Array<{ skills: Array<{ trust_ceiling: string }> }>
    )[0].skills[0].trust_ceiling = 'YOLO'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => e.code === 'EnumViolation' && e.path.includes('trust_ceiling'))
    ).toBe(true)
  })

  it('rejects unknown persona status', () => {
    const f = validFixture()
    ;(f['personas'] as Array<{ status: string }>)[0].status = 'on-vacation'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => e.code === 'EnumViolation' && e.path.includes('personas[0].status'))
    ).toBe(true)
  })

  it('rejects machine.memory_mb outside range', () => {
    const f = validFixture()
    ;(f['machine'] as { memory_mb: number }).memory_mb = 16384
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'machine.memory_mb')).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Slug validation
// -----------------------------------------------------------------------------

describe('validate — InvalidSlug', () => {
  it('rejects customer_id with uppercase', () => {
    const f = validFixture()
    f['customer_id'] = 'Smith-PI-Firm'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidSlug')
  })

  it('rejects customer_id with leading dash', () => {
    const f = validFixture()
    f['customer_id'] = '-smith'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidSlug')
  })

  it('rejects customer_id over 32 chars', () => {
    const f = validFixture()
    f['customer_id'] = 'a'.repeat(33)
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidSlug')
  })

  it('rejects persona.slug with uppercase', () => {
    const f = validFixture()
    ;(f['personas'] as Array<{ slug: string }>)[0].slug = 'Marcus'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidSlug')
  })
})

// -----------------------------------------------------------------------------
// Personas: array invariants
// -----------------------------------------------------------------------------

describe('validate — personas[]', () => {
  it('rejects personas as a singular object (ADR 0011 enforcement)', () => {
    const f = validFixture()
    f['personas'] = { slug: 'marcus', status: 'active', name: 'Marcus' }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('TypeMismatch')
  })

  it('rejects an empty personas array', () => {
    const f = validFixture()
    f['personas'] = []
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('EmptyList')
  })

  it('rejects personas with no active entry', () => {
    const f = validFixture()
    ;(f['personas'] as Array<{ status: string }>)[0].status = 'archived'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('MissingActivePersona')
  })

  it('rejects duplicate persona slugs', () => {
    const f = validFixture()
    const personas = f['personas'] as Array<Record<string, unknown>>
    personas.push({
      ...personas[0],
      name: 'Marcus Clone',
    })
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('DuplicatePersonaSlug')
  })

  it('accepts multiple personas when slugs are unique', () => {
    const f = validFixture()
    const personas = f['personas'] as Array<Record<string, unknown>>
    personas.push({
      slug: 'casey',
      status: 'archived',
      name: 'Casey',
      tone: ['warm'],
      skills: [{ name: 'inbox-triage-and-draft', trust_ceiling: 'draft_for_review' }],
    })
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.personas).toHaveLength(2)
  })
})

// -----------------------------------------------------------------------------
// Connectors: capability union + backend prefix + token_ref
// -----------------------------------------------------------------------------

describe('validate — connectors', () => {
  it('rejects an unknown capability name', () => {
    const f = validFixture()
    ;(f['connectors'] as Record<string, unknown>)['LoyaltyProgram'] = {
      adapter: 'foo',
      backend: 'mcp:foo',
    }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('UnknownCapability')
  })

  it('rejects an unknown backend prefix', () => {
    const f = validFixture()
    ;(f['connectors'] as Record<string, Record<string, string>>)['Email'].backend =
      'mystery:foo-bar'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidBackend')
  })

  it('accepts all four documented backend prefixes', () => {
    const prefixes = ['composio:gmail', 'mcp:foo/bar', 'build:wrapper', 'synthetic:fixture']
    for (const backend of prefixes) {
      const f = validFixture()
      ;(f['connectors'] as Record<string, Record<string, unknown>>)['Email'] = {
        adapter: 'x',
        backend,
      }
      const r = validate(f)
      if (!r.ok) {
        const has = r.errors.some(
          (e) => e.code === 'InvalidBackend' && e.path === 'connectors.Email.backend'
        )
        expect(has).toBe(false)
      }
    }
  })

  it('rejects a non-infisical token_ref', () => {
    const f = validFixture()
    ;(f['connectors'] as Record<string, Record<string, string>>)['Email'].token_ref =
      'vault://path/that/is/not/infisical'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidTokenRef')
  })

  it('rejects an infisical token_ref with too few segments', () => {
    const f = validFixture()
    ;(f['connectors'] as Record<string, Record<string, string>>)['Email'].token_ref =
      'infisical:/short'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidTokenRef')
  })
})

// -----------------------------------------------------------------------------
// Composio per-connection isolation (issue #850)
//
// The validator must require a composio_connection_id whenever backend
// starts with "composio:", and that ID must embed the customer_id slug.
// The runtime backstop lives at
// ai-employee/adapter/connectors/composio_assertion.py.
// -----------------------------------------------------------------------------

describe('validate — composio per-connection isolation', () => {
  function fixtureWithComposioEmail(connectionId: string | null): Record<string, unknown> {
    const f = validFixture()
    const entry: Record<string, unknown> = {
      adapter: 'gmail',
      backend: 'composio:gmail',
      token_ref: 'infisical:/ai-employee/smith-pi-firm/email/refresh',
    }
    if (connectionId !== null) entry['composio_connection_id'] = connectionId
    ;(f['connectors'] as Record<string, unknown>)['Email'] = entry
    return f
  }

  it('accepts a well-formed composio connection ID bound to customer_id', () => {
    const r = validate(fixtureWithComposioEmail('conn_smith-pi-firm_xyz-1234'))
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors, null, 2)}`)
    }
    expect(r.value.connectors.Email?.composio_connection_id).toBe('conn_smith-pi-firm_xyz-1234')
  })

  it('requires composio_connection_id when backend is composio:*', () => {
    const r = validate(fixtureWithComposioEmail(null))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some(
        (e) => e.code === 'MissingField' && e.path === 'connectors.Email.composio_connection_id'
      )
    ).toBe(true)
  })

  it('rejects composio_connection_id that does not match conn_{slug}_{suffix}', () => {
    const r = validate(fixtureWithComposioEmail('not-a-conn-id'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some(
        (e) => e.code === 'InvalidFormat' && e.path === 'connectors.Email.composio_connection_id'
      )
    ).toBe(true)
  })

  it('rejects composio_connection_id whose slug differs from customer_id (cross-customer leak)', () => {
    const r = validate(fixtureWithComposioEmail('conn_other-customer_xyz-1234'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some(
        (e) =>
          e.code === 'IsolationViolation' && e.path === 'connectors.Email.composio_connection_id'
      )
    ).toBe(true)
  })

  it('rejects composio_connection_id with too-short suffix', () => {
    const r = validate(fixtureWithComposioEmail('conn_smith-pi-firm_abc'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects composio_connection_id when present on a non-composio backend', () => {
    const f = validFixture()
    ;(f['connectors'] as Record<string, Record<string, unknown>>)['Email'][
      'composio_connection_id'
    ] = 'conn_smith-pi-firm_xyz-1234'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some(
        (e) =>
          e.code === 'IsolationViolation' && e.path === 'connectors.Email.composio_connection_id'
      )
    ).toBe(true)
  })

  it('rejects non-string composio_connection_id', () => {
    const f = fixtureWithComposioEmail(null)
    ;(f['connectors'] as Record<string, Record<string, unknown>>)['Email'][
      'composio_connection_id'
    ] = 12345
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('TypeMismatch')
  })

  it('accepts a composio_connection_id with the maximum suffix length', () => {
    const longSuffix = 'a'.repeat(80)
    const r = validate(fixtureWithComposioEmail(`conn_smith-pi-firm_${longSuffix}`))
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors, null, 2)}`)
    }
  })

  it('rejects a composio_connection_id with a suffix longer than 80 chars', () => {
    const tooLong = 'a'.repeat(81)
    const r = validate(fixtureWithComposioEmail(`conn_smith-pi-firm_${tooLong}`))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('handles multi-dash customer slugs in the connection ID', () => {
    const f = fixtureWithComposioEmail('conn_smith-pi-firm_a-b-c-d')
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors, null, 2)}`)
    }
    expect(r.value.connectors.Email?.composio_connection_id).toBe('conn_smith-pi-firm_a-b-c-d')
  })
})

// -----------------------------------------------------------------------------
// Memory: isolation invariants
// -----------------------------------------------------------------------------

describe('validate — memory isolation', () => {
  it('rejects d1_namespace that does not equal customer_id', () => {
    const f = validFixture()
    ;(f['memory'] as Record<string, string>)['d1_namespace'] = 'someone-else'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('IsolationViolation')
  })

  it('rejects r2_vault_path that does not equal vaults/{id}/', () => {
    const f = validFixture()
    ;(f['memory'] as Record<string, string>)['r2_vault_path'] = 'vaults/other/'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('IsolationViolation')
  })

  it('rejects vectorize_index that does not match the expected name', () => {
    const f = validFixture()
    ;(f['memory'] as Record<string, string>)['vectorize_index'] = 'global-shared-vault'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('IsolationViolation')
  })
})

// -----------------------------------------------------------------------------
// Escalation
// -----------------------------------------------------------------------------

describe('validate — escalation', () => {
  it('rejects empty red_flag_recipients', () => {
    const f = validFixture()
    ;(f['escalation'] as Record<string, unknown>)['red_flag_recipients'] = []
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'escalation.red_flag_recipients')).toBe(true)
  })

  it('rejects empty failure_recipients', () => {
    const f = validFixture()
    ;(f['escalation'] as Record<string, unknown>)['failure_recipients'] = []
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'escalation.failure_recipients')).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Schema version
// -----------------------------------------------------------------------------

describe('validate — schema_version', () => {
  it('rejects unsupported schema_version', () => {
    const f = validFixture()
    f['schema_version'] = 99
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('SchemaVersionUnsupported')
  })

  it('rejects non-integer schema_version', () => {
    const f = validFixture()
    f['schema_version'] = '1'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('TypeMismatch')
  })
})

// -----------------------------------------------------------------------------
// Secret detection through validate()
// -----------------------------------------------------------------------------

describe('validate — secret detection integration', () => {
  it('rejects when a banned field name appears anywhere', () => {
    const f = validFixture()
    ;(f['connectors'] as Record<string, Record<string, unknown>>)['Email']['client_secret'] =
      'irrelevant'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('BannedFieldName')
  })

  it('rejects when a provider-shaped key appears in a value', () => {
    const f = validFixture()
    ;(f['personas'] as Array<Record<string, unknown>>)[0]['notes'] = [
      'sk',
      'live',
      'abcdefghijklmnopqrstuvwxyz12345678',
    ].join('_')
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('SecretDetected')
  })

  it('runs scanRawYaml when rawText is supplied (catches malformed YAML)', () => {
    const garbageYaml = '::: not valid :::\napi_key: anything\n'
    // Pass a structurally minimal object so the structural pass also has
    // something to chew on; the raw scan must STILL find the leak.
    const r = validate(validFixture(), { rawText: garbageYaml })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('BannedFieldName')
  })

  it('NEVER echoes the matched secret in error messages', () => {
    const secret = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz12345678'].join('_')
    const f = validFixture()
    ;(f['personas'] as Array<Record<string, unknown>>)[0]['notes'] = secret
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    const serialized = JSON.stringify(r.errors)
    expect(serialized).not.toContain(secret)
  })
})

// -----------------------------------------------------------------------------
// Aggregate behavior
// -----------------------------------------------------------------------------

describe('validate — aggregate error behavior', () => {
  it('returns multiple errors from a single broken fixture (no short-circuit)', () => {
    const f = validFixture()
    // Break multiple unrelated fields at once.
    delete f['customer_name']
    f['vertical'] = 'pet-grooming'
    ;(f['memory'] as Record<string, string>)['d1_namespace'] = 'wrong'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    // We expect at minimum: MissingField (customer_name), EnumViolation
    // (vertical), IsolationViolation (memory.d1_namespace).
    expect(r.errors.length).toBeGreaterThanOrEqual(3)
    const codes = codesOf(r.errors)
    expect(codes).toContain('MissingField')
    expect(codes).toContain('EnumViolation')
    expect(codes).toContain('IsolationViolation')
  })

  it('rejects a non-object root', () => {
    const r = validate(['not', 'an', 'object'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0].code).toBe('TypeMismatch')
    expect(r.errors[0].path).toBe('$')
  })

  it('rejects null root', () => {
    const r = validate(null)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0].code).toBe('TypeMismatch')
  })

  it('never throws on adversarial input', () => {
    const adversarial: unknown[] = [
      null,
      undefined,
      'string',
      123,
      [],
      { customer_id: null },
      { connectors: 'not-an-object' },
      { personas: 'not-an-array' },
    ]
    for (const input of adversarial) {
      expect(() => validate(input)).not.toThrow()
    }
  })
})

// -----------------------------------------------------------------------------
// hermes_ref fork-tag enforcement (ADR 0015)
// -----------------------------------------------------------------------------

describe('validate — hermes_ref fork-tag enforcement (ADR 0015)', () => {
  it('accepts a fork tag at the initial -smd.0 revision', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.7-smd.0'
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.hermes_ref).toBe('v2026.5.7-smd.0')
  })

  it('accepts a fork tag at a higher SMD revision', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.7-smd.12'
    expect(validate(f).ok).toBe(true)
  })

  it('accepts a fork tag built on a SemVer upstream', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v0.14.0-smd.0'
    expect(validate(f).ok).toBe(true)
  })

  it('accepts a fork tag with SemVer pre-release identifiers', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v0.14.0-rc.1-smd.0'
    expect(validate(f).ok).toBe(true)
  })

  it('rejects a bare upstream tag (no -smd.N suffix)', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.7'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'hermes_ref' && e.code === 'InvalidFormat')).toBe(true)
  })

  it('rejects a missing v-prefix', () => {
    const f = validFixture()
    f['hermes_ref'] = '2026.5.7-smd.0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects an -smd.N suffix with a non-integer counter', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.7-smd.beta'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects an -smd suffix without a counter', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.7-smd'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects an -smd.N counter with leading zeros', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.7-smd.01'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects an arbitrary content-hash SHA', () => {
    const f = validFixture()
    f['hermes_ref'] = '7ce6b504a269ac3f9aed5b406b7a18c432e2fdb5'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects the empty string with MissingField/EmptyField, not InvalidFormat', () => {
    const f = validFixture()
    f['hermes_ref'] = ''
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    // The required-string check fires first and exclusively when the value
    // is empty; the fork-tag check intentionally no-ops on the empty case
    // so authors only see one error per defect.
    expect(codesOf(r.errors)).toContain('EmptyField')
    expect(codesOf(r.errors)).not.toContain('InvalidFormat')
  })

  it('rejects a missing field with MissingField, not InvalidFormat', () => {
    const f = validFixture()
    delete f['hermes_ref']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('MissingField')
    expect(codesOf(r.errors)).not.toContain('InvalidFormat')
  })
})

// -----------------------------------------------------------------------------
// users[].voice_profile_id — multi-user voice (#858)
//
// Per-user voice profiles let a customer attach distinct writing-voice
// signatures to individual reviewers (partner Sarah vs. associate Mike
// vs. paralegal Jane). The field is optional and backwards-compatible:
// customers without per-user voice ship the field absent and every
// reviewer inherits the customer-level general voice.
// -----------------------------------------------------------------------------

describe('validate — users[].voice_profile_id (#858)', () => {
  it('accepts users without voice_profile_id (backwards compat)', () => {
    const r = validate(validFixture())
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.users[0].voice_profile_id).toBeNull()
    expect(r.value.users[1].voice_profile_id).toBeNull()
  })

  it('accepts users with a well-formed voice_profile_id slug', () => {
    const f = validFixture()
    ;(f['users'] as Array<Record<string, unknown>>)[0].voice_profile_id = 'partner-sarah'
    ;(f['users'] as Array<Record<string, unknown>>)[1].voice_profile_id = 'paralegal-mike'
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.users[0].voice_profile_id).toBe('partner-sarah')
    expect(r.value.users[1].voice_profile_id).toBe('paralegal-mike')
  })

  it('rejects a non-string voice_profile_id', () => {
    const f = validFixture()
    ;(f['users'] as Array<Record<string, unknown>>)[0].voice_profile_id = 42
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => e.code === 'TypeMismatch' && e.path === 'users[0].voice_profile_id')
    ).toBe(true)
  })

  it('rejects voice_profile_id with uppercase', () => {
    const f = validFixture()
    ;(f['users'] as Array<Record<string, unknown>>)[0].voice_profile_id = 'Partner-Sarah'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => e.code === 'InvalidSlug' && e.path === 'users[0].voice_profile_id')
    ).toBe(true)
  })

  it('rejects voice_profile_id with leading dash', () => {
    const f = validFixture()
    ;(f['users'] as Array<Record<string, unknown>>)[0].voice_profile_id = '-sarah'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidSlug')
  })

  it('rejects voice_profile_id over 32 chars', () => {
    const f = validFixture()
    ;(f['users'] as Array<Record<string, unknown>>)[0].voice_profile_id = 'a'.repeat(33)
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidSlug')
  })

  it('rejects duplicate voice_profile_id across users', () => {
    // Two users sharing a profile would defeat the per-user attribution
    // model — the transform could not tell which reviewer's voice was
    // actually applied. Treat as an authoring error.
    const f = validFixture()
    ;(f['users'] as Array<Record<string, unknown>>)[0].voice_profile_id = 'shared-slug'
    ;(f['users'] as Array<Record<string, unknown>>)[1].voice_profile_id = 'shared-slug'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('DuplicateVoiceProfileId')
    expect(r.errors.some((e) => e.path === 'users[1].voice_profile_id')).toBe(true)
  })

  it('allows mix of users with and without voice_profile_id', () => {
    const f = validFixture()
    ;(f['users'] as Array<Record<string, unknown>>)[0].voice_profile_id = 'partner-sarah'
    // users[1] left without voice_profile_id — inherits general voice
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.users[0].voice_profile_id).toBe('partner-sarah')
    expect(r.value.users[1].voice_profile_id).toBeNull()
  })

  it('does not echo voice_profile_id values in unrelated error messages', () => {
    // The slug itself is not secret, but the validator should not
    // surface it in errors unrelated to it. Smoke test that duplicate
    // detection cites the field by path, not by mixing it into other
    // error messages.
    const f = validFixture()
    ;(f['users'] as Array<Record<string, unknown>>)[0].voice_profile_id = 'real-slug'
    ;(f['users'] as Array<Record<string, unknown>>)[1].voice_profile_id = 'real-slug'
    delete f['vertical']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    const verticalErr = r.errors.find((e) => e.path === 'vertical')
    expect(verticalErr?.message).not.toContain('real-slug')
  })
})

// -----------------------------------------------------------------------------
// voice_cohorts — per-recipient cohort taxonomy (#857)
//
// Customers declare the cohort vocabulary their voice samples are
// partitioned into. Omission accepts the BASE_VOICE_COHORTS default;
// presence requires a non-empty slug list with unique entries.
// -----------------------------------------------------------------------------

describe('validate — voice_cohorts (#857)', () => {
  it('accepts customer.yaml with no voice_cohorts block (defaults to base)', () => {
    const r = validate(validFixture())
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.voice_cohorts).toBeNull()
  })

  it('accepts a customer-extended cohort list', () => {
    const f = validFixture()
    f['voice_cohorts'] = {
      cohorts: ['client', 'opposing-counsel', 'court', 'internal', 'mediator'],
    }
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.voice_cohorts?.cohorts).toEqual([
      'client',
      'opposing-counsel',
      'court',
      'internal',
      'mediator',
    ])
    expect(r.value.voice_cohorts?.min_samples_per_cohort).toBeNull()
  })

  it('accepts a customer-dropped cohort list (no court for transactional firms)', () => {
    const f = validFixture()
    f['voice_cohorts'] = {
      cohorts: ['client', 'opposing-counsel', 'internal'],
    }
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.voice_cohorts?.cohorts).toHaveLength(3)
  })

  it('accepts voice_cohorts with min_samples_per_cohort override', () => {
    const f = validFixture()
    f['voice_cohorts'] = {
      cohorts: ['client', 'opposing-counsel'],
      min_samples_per_cohort: 12,
    }
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.voice_cohorts?.min_samples_per_cohort).toBe(12)
  })

  it('rejects voice_cohorts as a non-object', () => {
    const f = validFixture()
    f['voice_cohorts'] = 'client,opposing-counsel'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'voice_cohorts' && e.code === 'TypeMismatch')).toBe(true)
  })

  it('rejects voice_cohorts without a cohorts field', () => {
    const f = validFixture()
    f['voice_cohorts'] = { min_samples_per_cohort: 8 }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => e.path === 'voice_cohorts.cohorts' && e.code === 'MissingField')
    ).toBe(true)
  })

  it('rejects voice_cohorts.cohorts that is empty', () => {
    const f = validFixture()
    f['voice_cohorts'] = { cohorts: [] }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('EmptyList')
  })

  it('rejects voice_cohorts.cohorts entries that are not strings', () => {
    const f = validFixture()
    f['voice_cohorts'] = { cohorts: ['client', 42, 'court'] }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => e.path === 'voice_cohorts.cohorts[1]' && e.code === 'TypeMismatch')
    ).toBe(true)
  })

  it('rejects cohort slugs that fail the slug pattern', () => {
    const f = validFixture()
    f['voice_cohorts'] = { cohorts: ['Client', 'opposing_counsel'] }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidSlug')
  })

  it('rejects duplicate cohort slugs', () => {
    const f = validFixture()
    f['voice_cohorts'] = { cohorts: ['client', 'opposing-counsel', 'client'] }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('DuplicateVoiceCohort')
    expect(r.errors.some((e) => e.path === 'voice_cohorts.cohorts[2]')).toBe(true)
  })

  it('rejects min_samples_per_cohort ≤ 0', () => {
    const f = validFixture()
    f['voice_cohorts'] = { cohorts: ['client'], min_samples_per_cohort: 0 }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some(
        (e) => e.path === 'voice_cohorts.min_samples_per_cohort' && e.code === 'TypeMismatch'
      )
    ).toBe(true)
  })

  it('rejects non-integer min_samples_per_cohort', () => {
    const f = validFixture()
    f['voice_cohorts'] = { cohorts: ['client'], min_samples_per_cohort: 5.5 }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('TypeMismatch')
  })
})

// -----------------------------------------------------------------------------
// resolveCohortVocabulary — small helper that materializes the default
// -----------------------------------------------------------------------------

describe('resolveCohortVocabulary (#857)', () => {
  it('returns BASE_VOICE_COHORTS when voice_cohorts is null', async () => {
    const { resolveCohortVocabulary, BASE_VOICE_COHORTS } =
      await import('../src/lib/ai-employee/customer-yaml')
    expect(resolveCohortVocabulary(null)).toEqual(BASE_VOICE_COHORTS)
  })

  it('returns the customer cohort list when present', async () => {
    const { resolveCohortVocabulary } = await import('../src/lib/ai-employee/customer-yaml')
    const resolved = resolveCohortVocabulary({
      cohorts: ['client', 'mediator'],
      min_samples_per_cohort: null,
    })
    expect(resolved).toEqual(['client', 'mediator'])
  })
})

// -----------------------------------------------------------------------------
// memory.retention block — audit-retention.md (#893)
// -----------------------------------------------------------------------------

describe('validate — memory.retention', () => {
  function withRetention(retention: Record<string, unknown>): Record<string, unknown> {
    const f = validFixture()
    const memory = f['memory'] as Record<string, unknown>
    memory['retention'] = retention
    return f
  }

  it('accepts a customer.yaml with no retention block', () => {
    const r = validate(validFixture())
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.memory.retention).toBeNull()
  })

  it('accepts retention.audit_log_days equal to the law-firm default (2555)', () => {
    const r = validate(withRetention({ audit_log_days: 2555 }))
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.memory.retention?.audit_log_days).toBe(2555)
  })

  it('accepts retention.audit_log_days above the law-firm default (override-up)', () => {
    const r = validate(withRetention({ audit_log_days: 3650 }))
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.memory.retention?.audit_log_days).toBe(3650)
  })

  it('rejects retention.audit_log_days below the law-firm default', () => {
    const r = validate(withRetention({ audit_log_days: 1825 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('RetentionOverrideBelowDefault')
    expect(r.errors.some((e) => e.path === 'memory.retention.audit_log_days')).toBe(true)
  })

  it('rejects retention.audit_log_days above the sanity cap (>36500)', () => {
    const r = validate(withRetention({ audit_log_days: 73000 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('RetentionOverrideUnreasonable')
  })

  it('rejects non-positive retention.audit_log_days', () => {
    const r = validate(withRetention({ audit_log_days: 0 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('TypeMismatch')
  })

  it('rejects non-integer retention.audit_log_days', () => {
    const r = validate(withRetention({ audit_log_days: 2555.5 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('TypeMismatch')
  })

  it('rejects non-object retention block', () => {
    const f = validFixture()
    const memory = f['memory'] as Record<string, unknown>
    memory['retention'] = 'never'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'memory.retention')).toBe(true)
  })

  it('uses the marketing-agency default (1095) when vertical=marketing-agency', () => {
    // 1095 is the marketing-agency floor; 2555 is the law-firm floor.
    // For marketing-agency, 1095 passes; for law-firm, 1095 would be rejected.
    const f = validFixture()
    f['vertical'] = 'marketing-agency'
    delete f['practice_areas']
    const memory = f['memory'] as Record<string, unknown>
    memory['retention'] = { audit_log_days: 1095 }
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.memory.retention?.audit_log_days).toBe(1095)
  })

  it('rejects below-marketing-agency-default audit_log_days for marketing-agency vertical', () => {
    const f = validFixture()
    f['vertical'] = 'marketing-agency'
    delete f['practice_areas']
    const memory = f['memory'] as Record<string, unknown>
    memory['retention'] = { audit_log_days: 365 }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('RetentionOverrideBelowDefault')
  })

  it('accepts the other retention.*_days fields as positive integers', () => {
    const r = validate(
      withRetention({
        matters_days: 730,
        documents_days: 365,
        recipients_days: 730,
        voice_samples_days: 365,
        audit_log_days: 2555,
        drafts_days: 90,
      })
    )
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    const ret = r.value.memory.retention
    expect(ret?.matters_days).toBe(730)
    expect(ret?.documents_days).toBe(365)
    expect(ret?.recipients_days).toBe(730)
    expect(ret?.voice_samples_days).toBe(365)
    expect(ret?.drafts_days).toBe(90)
  })

  it('rejects non-positive matters_days', () => {
    const r = validate(withRetention({ matters_days: -1 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'memory.retention.matters_days')).toBe(true)
  })

  it('reports the supplied value and the vertical minimum in the below-default error', () => {
    const r = validate(withRetention({ audit_log_days: 1000 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    const err = r.errors.find((e) => e.code === 'RetentionOverrideBelowDefault')
    expect(err).toBeDefined()
    expect(err?.message).toContain('1000')
    expect(err?.message).toContain('2555')
    expect(err?.message).toContain('law-firm')
  })
})

// -----------------------------------------------------------------------------
// compliance_enabled (#895)
// -----------------------------------------------------------------------------

describe('validate — compliance_enabled (#895)', () => {
  it('defaults to false when the field is omitted', () => {
    const r = validate(validFixture())
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.compliance_enabled).toBe(false)
  })

  it('accepts compliance_enabled: true', () => {
    const f = validFixture()
    f['compliance_enabled'] = true
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.compliance_enabled).toBe(true)
  })

  it('accepts compliance_enabled: false explicitly', () => {
    const f = validFixture()
    f['compliance_enabled'] = false
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.compliance_enabled).toBe(false)
  })

  it('rejects non-boolean compliance_enabled', () => {
    const f = validFixture()
    f['compliance_enabled'] = 'yes'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'compliance_enabled' && e.code === 'TypeMismatch')).toBe(
      true
    )
  })

  it('treats null as omitted (defaults to false)', () => {
    const f = validFixture()
    f['compliance_enabled'] = null
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.compliance_enabled).toBe(false)
  })
})
