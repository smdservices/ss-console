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
    hermes_ref: 'v2026.5.7@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0',
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
// Observability (ADR 0023 Wave 1)
// -----------------------------------------------------------------------------

describe('validate — observability block (ADR 0023)', () => {
  it('fills defaults when block is absent', () => {
    const r = validate(validFixture())
    if (!r.ok) throw new Error('expected ok')
    expect(r.value.observability.sentry.enabled).toBe(true)
    expect(r.value.observability.health.period_seconds).toBe(60)
    expect(r.value.observability.health.grace_minutes).toBe(5)
  })

  it('fills defaults when block is an empty object', () => {
    const f = validFixture()
    f['observability'] = {}
    const r = validate(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.value.observability).toEqual({
      sentry: { enabled: true },
      health: { period_seconds: 60, grace_minutes: 5 },
    })
  })

  it('accepts a fully populated observability block', () => {
    const f = validFixture()
    f['observability'] = {
      sentry: { enabled: false },
      health: { period_seconds: 30, grace_minutes: 10 },
    }
    const r = validate(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.value.observability.sentry.enabled).toBe(false)
    expect(r.value.observability.health.period_seconds).toBe(30)
    expect(r.value.observability.health.grace_minutes).toBe(10)
  })

  it('partial population fills only missing fields', () => {
    const f = validFixture()
    f['observability'] = { health: { period_seconds: 120 } }
    const r = validate(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.value.observability.sentry.enabled).toBe(true) // default
    expect(r.value.observability.health.period_seconds).toBe(120) // overridden
    expect(r.value.observability.health.grace_minutes).toBe(5) // default
  })

  it('rejects non-boolean sentry.enabled', () => {
    const f = validFixture()
    f['observability'] = { sentry: { enabled: 'yes' } }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => e.path === 'observability.sentry.enabled' && e.code === 'TypeMismatch')
    ).toBe(true)
  })

  it('rejects non-positive-integer health.period_seconds', () => {
    const f = validFixture()
    f['observability'] = { health: { period_seconds: 0 } }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some(
        (e) => e.path === 'observability.health.period_seconds' && e.code === 'TypeMismatch'
      )
    ).toBe(true)
  })

  it('rejects non-positive-integer health.grace_minutes', () => {
    const f = validFixture()
    f['observability'] = { health: { grace_minutes: -1 } }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some(
        (e) => e.path === 'observability.health.grace_minutes' && e.code === 'TypeMismatch'
      )
    ).toBe(true)
  })

  it('rejects non-object observability', () => {
    const f = validFixture()
    f['observability'] = 'invalid'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'observability' && e.code === 'TypeMismatch')).toBe(true)
  })

  it('does not accept an alert_webhook field (deferred per ADR 0023 §9)', () => {
    const f = validFixture()
    // Including alert_webhook is silently ignored — validator doesn't gate on
    // unknown keys, but the field doesn't appear in the typed output.
    f['observability'] = { alert_webhook: 'https://example.com/webhook' }
    const r = validate(f)
    if (!r.ok) throw new Error('expected ok (unknown keys ignored)')
    // The typed shape has no alert_webhook field.
    expect('alert_webhook' in (r.value.observability as unknown as Record<string, unknown>)).toBe(
      false
    )
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

  it('accepts all documented backend prefixes', () => {
    const prefixes = ['mcp:foo/bar', 'build:wrapper', 'synthetic:fixture']
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

// -----------------------------------------------------------------------------
// hermes_ref upstream-pin enforcement (ADR 0024)
// -----------------------------------------------------------------------------

describe('validate — hermes_ref upstream-pin enforcement (ADR 0024)', () => {
  it('accepts a valid upstream pin (v{date}@{40-hex-sha})', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.16@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0'
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.hermes_ref).toBe('v2026.5.16@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0')
  })

  it('accepts another valid upstream pin at a different release', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.28@0123456789abcdef0123456789abcdef01234567'
    expect(validate(f).ok).toBe(true)
  })

  it('rejects a retired -smd.N fork tag', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.16-smd.0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects a retired -smd.security.N fork tag', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.16-smd.security.0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects a bare date-tag (no @sha)', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.16'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.path === 'hermes_ref' && e.code === 'InvalidFormat')).toBe(true)
  })

  it('rejects legacy SemVer-style tags (year is not 4 digits)', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v0.14.0@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects a missing v-prefix', () => {
    const f = validFixture()
    f['hermes_ref'] = '2026.5.16@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects a short SHA (fewer than 40 hex chars)', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.16@a91a57fa'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects a long SHA (more than 40 hex chars)', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.16@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0ff'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects a non-hex SHA', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.16@zz1a57fa5a13d516c38b07a141a9ce8a3daabeb0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects an uppercase SHA (must be lowercase hex)', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.16@A91A57FA5A13D516C38B07A141A9CE8A3DAABEB0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects a date-tag with an empty @sha', () => {
    const f = validFixture()
    f['hermes_ref'] = 'v2026.5.16@'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidFormat')
  })

  it('rejects a bare content-hash SHA (no v{date}@ prefix)', () => {
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

// -----------------------------------------------------------------------------
// ADR 0021 — Stream D bundles + Stream B cron (per-persona)
// -----------------------------------------------------------------------------

/**
 * Helper: take the base persona and graft a bundles[] / cron[] block onto it.
 * Returns the modified fixture; tests mutate further as needed.
 */
function withBundlesAndCron(): Record<string, unknown> {
  const f = validFixture()
  const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
  persona['bundles'] = [
    {
      slug: 'pi-intake',
      description: 'Intake triage + conflict screen',
      skills: ['inbox-triage-and-draft', 'conflict-check'],
    },
  ]
  persona['cron'] = [
    {
      skill: 'inbox-triage-and-draft',
      schedule: '0 9 * * *',
      wake_policy: 'always',
    },
  ]
  return f
}

describe('validate — ADR 0021 bundles', () => {
  it('accepts a valid bundles[] block', () => {
    const r = validate(withBundlesAndCron())
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.personas[0].bundles).toHaveLength(1)
    expect(r.value.personas[0].bundles[0].slug).toBe('pi-intake')
    expect(r.value.personas[0].bundles[0].skills).toEqual([
      'inbox-triage-and-draft',
      'conflict-check',
    ])
    expect(r.value.personas[0].bundles[0].instruction).toBeNull()
  })

  it('rejects duplicate bundle slug within a persona', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    ;(persona['bundles'] as unknown[]).push({
      slug: 'pi-intake', // duplicate
      description: 'duplicate',
      skills: ['conflict-check'],
    })
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('DuplicateBundleSlug')
  })

  it('rejects bundle that references unknown skill', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    ;(persona['bundles'] as Record<string, unknown>[])[0]['skills'] = [
      'inbox-triage-and-draft',
      'does-not-exist',
    ]
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('UnknownBundleSkill')
  })

  it('rejects bundle referencing a disabled skill', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    // Disable conflict-check
    const skills = persona['skills'] as Record<string, unknown>[]
    skills[1] = { ...skills[1], enabled: false }
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('UnknownBundleSkill')
  })

  it('rejects bundle missing required description', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    delete (persona['bundles'] as Record<string, unknown>[])[0]['description']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.code === 'MissingField' && e.path.endsWith('.description'))).toBe(
      true
    )
  })
})

describe('validate — ADR 0021 cron', () => {
  it('accepts a valid cron[] block with wake_policy=always', () => {
    const r = validate(withBundlesAndCron())
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.personas[0].cron).toHaveLength(1)
    expect(r.value.personas[0].cron[0].wake_policy).toBe('always')
    expect(r.value.personas[0].cron[0].pre_run).toBeNull()
  })

  it('accepts wake_policy=pre_run_decides with a pre_run path', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    ;(persona['cron'] as Record<string, unknown>[])[0] = {
      skill: 'inbox-triage-and-draft',
      schedule: 'every 5m',
      pre_run: 'pre_run.py',
      wake_policy: 'pre_run_decides',
    }
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.personas[0].cron[0].pre_run).toBe('pre_run.py')
  })

  it('rejects unknown cron schedule grammar', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    ;(persona['cron'] as Record<string, unknown>[])[0]['schedule'] = 'not a schedule'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidCronSchedule')
  })

  it('rejects cron referencing an unknown skill', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    ;(persona['cron'] as Record<string, unknown>[])[0]['skill'] = 'does-not-exist'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('UnknownCronSkill')
  })

  it('rejects pre_run set alongside wake_policy=always', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    ;(persona['cron'] as Record<string, unknown>[])[0]['pre_run'] = 'pre_run.py'
    // wake_policy stays 'always' from withBundlesAndCron base
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidCronWakePolicy')
  })

  it('rejects wake_policy=pre_run_decides without pre_run', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    ;(persona['cron'] as Record<string, unknown>[])[0]['wake_policy'] = 'pre_run_decides'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.code === 'MissingField' && e.path.endsWith('.pre_run'))).toBe(
      true
    )
  })

  it('rejects invalid wake_policy enum', () => {
    const f = withBundlesAndCron()
    const persona = (f['personas'] as unknown[])[0] as Record<string, unknown>
    ;(persona['cron'] as Record<string, unknown>[])[0]['wake_policy'] = 'maybe'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidCronWakePolicy')
  })
})

// -----------------------------------------------------------------------------
// ADR 0021 — Stream E webhook_url + webhook_triggers
// -----------------------------------------------------------------------------

function withWebhooks(): Record<string, unknown> {
  const f = withBundlesAndCron()
  const connectors = f['connectors'] as Record<string, Record<string, unknown>>
  connectors['PracticeManagement']['webhook_url'] =
    'https://hermes-smith-pi-firm.fly.dev/webhooks/practice_management'
  f['webhook_triggers'] = [
    {
      source: 'filevine',
      event_type: 'matter.created',
      skill: 'inbox-triage-and-draft',
      persona: 'marcus',
    },
  ]
  return f
}

describe('validate — ADR 0021 webhook_url', () => {
  it('accepts a valid connector webhook_url', () => {
    const r = validate(withWebhooks())
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.connectors.PracticeManagement?.webhook_url).toBe(
      'https://hermes-smith-pi-firm.fly.dev/webhooks/practice_management'
    )
  })

  it('rejects webhook_url that does not match the customer-bound pattern', () => {
    const f = withWebhooks()
    const connectors = f['connectors'] as Record<string, Record<string, unknown>>
    connectors['PracticeManagement']['webhook_url'] = 'https://example.com/webhook'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidWebhookUrl')
  })

  it('rejects webhook_url pointing at a different customer slug (isolation)', () => {
    const f = withWebhooks()
    const connectors = f['connectors'] as Record<string, Record<string, unknown>>
    connectors['PracticeManagement']['webhook_url'] =
      'https://hermes-other-firm.fly.dev/webhooks/practice_management'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('IsolationViolation')
  })
})

describe('validate — ADR 0021 webhook_triggers', () => {
  it('accepts a valid webhook_triggers list', () => {
    const r = validate(withWebhooks())
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.webhook_triggers).toHaveLength(1)
    expect(r.value.webhook_triggers[0].source).toBe('filevine')
    expect(r.value.webhook_triggers[0].event_type).toBe('matter.created')
  })

  it('rejects trigger whose source has no connector with webhook_url', () => {
    const f = withWebhooks()
    ;(f['webhook_triggers'] as Record<string, unknown>[])[0]['source'] = 'microsoft-graph'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('UnknownWebhookSource')
  })

  it('rejects trigger whose persona does not exist', () => {
    const f = withWebhooks()
    ;(f['webhook_triggers'] as Record<string, unknown>[])[0]['persona'] = 'ghost-persona'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('UnknownWebhookPersona')
  })

  it('rejects trigger whose skill is not on the target persona', () => {
    const f = withWebhooks()
    ;(f['webhook_triggers'] as Record<string, unknown>[])[0]['skill'] = 'not-a-skill'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('UnknownWebhookSkill')
  })

  it('treats missing webhook_triggers as empty list', () => {
    const f = validFixture()
    const r = validate(f)
    if (!r.ok) {
      throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    }
    expect(r.value.webhook_triggers).toEqual([])
  })
})

// -----------------------------------------------------------------------------
// Vertical pinned form + addons + extends (ADR 0022 Stream 1)
// -----------------------------------------------------------------------------

describe('validate — vertical pinned form (ADR 0022)', () => {
  it('accepts bare vertical (back-compat path)', () => {
    const r = validate(validFixture())
    if (!r.ok) throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    expect(r.value.vertical).toBe('law-firm')
    expect(r.value.vertical_version).toBeNull()
  })

  it('accepts pinned vertical (law-firm@1.4.0)', () => {
    const f = validFixture()
    f['vertical'] = 'law-firm@1.4.0'
    const r = validate(f)
    if (!r.ok) throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    expect(r.value.vertical).toBe('law-firm')
    expect(r.value.vertical_version).toBe('1.4.0')
  })

  it('rejects malformed semver (missing patch)', () => {
    const f = validFixture()
    f['vertical'] = 'law-firm@1.4'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidVerticalSpec')
  })

  it('rejects pre-release suffix (1.4.0-rc1)', () => {
    const f = validFixture()
    f['vertical'] = 'law-firm@1.4.0-rc1'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidVerticalSpec')
  })

  it('rejects empty version (law-firm@)', () => {
    const f = validFixture()
    f['vertical'] = 'law-firm@'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidVerticalSpec')
  })

  it('rejects empty vertical (@1.4.0)', () => {
    const f = validFixture()
    f['vertical'] = '@1.4.0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidVerticalSpec')
  })

  it('rejects unknown vertical in pinned form', () => {
    const f = validFixture()
    f['vertical'] = 'petshop@1.0.0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('EnumViolation')
  })

  it('rejects non-string vertical', () => {
    const f = validFixture()
    f['vertical'] = 42
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('TypeMismatch')
  })
})

describe('validate — addons array (ADR 0022)', () => {
  it('accepts omitted addons (defaults to empty list)', () => {
    const r = validate(validFixture())
    if (!r.ok) throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    expect(r.value.addons).toEqual([])
  })

  it('accepts empty addons array', () => {
    const f = validFixture()
    f['addons'] = []
    const r = validate(f)
    if (!r.ok) throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    expect(r.value.addons).toEqual([])
  })

  it('accepts single registered addon (law-firm/pi@2.1.0)', () => {
    const f = validFixture()
    f['addons'] = ['law-firm/pi@2.1.0']
    const r = validate(f)
    if (!r.ok) throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    expect(r.value.addons).toEqual([{ vertical: 'law-firm', addon: 'pi', version: '2.1.0' }])
  })

  it('rejects addons as non-array', () => {
    const f = validFixture()
    f['addons'] = 'law-firm/pi@2.1.0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('TypeMismatch')
  })

  it('rejects addon entry missing slash', () => {
    const f = validFixture()
    f['addons'] = ['law-firm-pi@2.1.0']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidAddonSpec')
  })

  it('rejects addon entry missing version', () => {
    const f = validFixture()
    f['addons'] = ['law-firm/pi']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidAddonSpec')
  })

  it('rejects addon entry with malformed semver', () => {
    const f = validFixture()
    f['addons'] = ['law-firm/pi@2.1']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidAddonSpec')
  })

  it('rejects addon referencing unknown vertical', () => {
    const f = validFixture()
    f['addons'] = ['petshop/pi@1.0.0']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('EnumViolation')
  })

  it('rejects addon slug not registered under the parent vertical', () => {
    const f = validFixture()
    f['addons'] = ['law-firm/notreal@1.0.0']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('UnknownAddon')
  })

  it('rejects duplicate addon entries', () => {
    const f = validFixture()
    f['addons'] = ['law-firm/pi@2.1.0', 'law-firm/pi@2.1.1']
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('InvalidAddonSpec')
  })
})

describe('validate — extends reserved (ADR 0022)', () => {
  it('rejects top-level extends with explicit error', () => {
    const f = validFixture()
    f['extends'] = 'law-firm@1.0.0'
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(codesOf(r.errors)).toContain('ExtendsReserved')
    expect(r.errors.find((e) => e.code === 'ExtendsReserved')?.message).toMatch(/reserved/i)
  })

  it('does not flag extends when absent', () => {
    const r = validate(validFixture())
    if (!r.ok) throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    // No ExtendsReserved error in the success path.
    expect(r.ok).toBe(true)
  })
})

describe('validate — memory.r2_skill_bodies_* known-optional (ADR 0022)', () => {
  it('accepts memory block without skill_bodies fields', () => {
    const r = validate(validFixture())
    if (!r.ok) throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    expect(r.value.memory.r2_skill_bodies_bucket).toBeNull()
    expect(r.value.memory.r2_skill_bodies_prefix).toBeNull()
  })

  it('accepts memory block with skill_bodies fields populated', () => {
    const f = validFixture()
    ;(f['memory'] as Record<string, unknown>)['r2_skill_bodies_bucket'] =
      'smd-ai-employee-skill-bodies'
    ;(f['memory'] as Record<string, unknown>)['r2_skill_bodies_prefix'] = 'smith-pi-firm/'
    const r = validate(f)
    if (!r.ok) throw new Error(`expected ok; got: ${JSON.stringify(r.errors)}`)
    expect(r.value.memory.r2_skill_bodies_bucket).toBe('smd-ai-employee-skill-bodies')
    expect(r.value.memory.r2_skill_bodies_prefix).toBe('smith-pi-firm/')
  })

  it('rejects skill_bodies_bucket as non-string', () => {
    const f = validFixture()
    ;(f['memory'] as Record<string, unknown>)['r2_skill_bodies_bucket'] = 123
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => e.path === 'memory.r2_skill_bodies_bucket' && e.code === 'TypeMismatch')
    ).toBe(true)
  })

  it('rejects skill_bodies_prefix as empty string', () => {
    const f = validFixture()
    ;(f['memory'] as Record<string, unknown>)['r2_skill_bodies_prefix'] = ''
    const r = validate(f)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(
      r.errors.some((e) => e.path === 'memory.r2_skill_bodies_prefix' && e.code === 'EmptyField')
    ).toBe(true)
  })
})
