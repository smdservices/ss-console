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
    hermes_ref: 'v2026.5.7',
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
