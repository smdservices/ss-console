/**
 * Tests for the credential-custody contract (src/lib/operator/credential-custody.ts)
 * and the write-only static-secret core (src/lib/operator/credential-secret-write.ts).
 * ADR 0042.
 *
 * The custody tests lock the resolver precedence (per-connector → client
 * default → delegated). The secret-write tests are the load-bearing ones: they
 * prove the value never escapes into the result, the audit row, or a failure
 * path — the §Verification 3 guarantee the whole privacy story rests on.
 */

import { describe, it, expect } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import {
  DEFAULT_CREDENTIAL_CUSTODY,
  parseCredentialCustody,
  resolveCredentialCustody,
  smdCanReachSecret,
} from '../src/lib/operator/credential-custody'
import {
  MAX_SECRET_LENGTH,
  handleSecretWrite,
  maskSecret,
  validateSecretInput,
  type CredentialSecretAudit,
  type CustomerSecretWriter,
  type SecretWriteResult,
} from '../src/lib/operator/credential-secret-write'
import { createSecretAudit } from '../src/lib/operator/credential-secret-transport'

// ---------------------------------------------------------------------------
// Custody resolver
// ---------------------------------------------------------------------------

describe('resolveCredentialCustody', () => {
  it('defaults to delegated when nothing is set', () => {
    expect(resolveCredentialCustody(null, null)).toBe('delegated')
    expect(DEFAULT_CREDENTIAL_CUSTODY).toBe('delegated')
  })

  it('client default applies when the connector does not pin its own', () => {
    expect(resolveCredentialCustody(null, 'self_held')).toBe('self_held')
  })

  it('per-connector value overrides the client default', () => {
    expect(resolveCredentialCustody('delegated', 'self_held')).toBe('delegated')
    expect(resolveCredentialCustody('self_held', 'delegated')).toBe('self_held')
  })
})

describe('smdCanReachSecret', () => {
  it('is true only for delegated', () => {
    expect(smdCanReachSecret('delegated')).toBe(true)
    expect(smdCanReachSecret('self_held')).toBe(false)
  })
})

describe('parseCredentialCustody', () => {
  it('accepts the two modes, returns null otherwise', () => {
    expect(parseCredentialCustody('delegated')).toBe('delegated')
    expect(parseCredentialCustody('self_held')).toBe('self_held')
    expect(parseCredentialCustody('smd')).toBeNull()
    expect(parseCredentialCustody(null)).toBeNull()
    expect(parseCredentialCustody(42)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// maskSecret
// ---------------------------------------------------------------------------

describe('maskSecret', () => {
  it('reveals at most the last four characters', () => {
    expect(maskSecret('sk-live-abcdef1234')).toBe('••••••1234')
  })

  it('fully masks short secrets (≤8 chars)', () => {
    expect(maskSecret('short')).toBe('••••••••')
    expect(maskSecret('12345678')).toBe('••••••••')
  })

  it('never contains the full secret', () => {
    const secret = 'sk-live-supersecretvalue9999'
    expect(maskSecret(secret).includes(secret)).toBe(false)
    expect(maskSecret(secret).includes('supersecret')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateSecretInput — rejections never echo the value
// ---------------------------------------------------------------------------

describe('validateSecretInput', () => {
  it('rejects an unknown connector', () => {
    expect(
      validateSecretInput({ customerSlug: 's', connector: 'NotACapability', secret: 'x' })
    ).toBe('invalid_connector')
  })

  it('rejects an empty secret', () => {
    expect(validateSecretInput({ customerSlug: 's', connector: 'CallTracking', secret: '' })).toBe(
      'empty_secret'
    )
  })

  it('rejects an over-long secret', () => {
    expect(
      validateSecretInput({
        customerSlug: 's',
        connector: 'CallTracking',
        secret: 'a'.repeat(MAX_SECRET_LENGTH + 1),
      })
    ).toBe('too_long')
  })

  it('accepts a well-formed input', () => {
    expect(
      validateSecretInput({ customerSlug: 's', connector: 'CourtAccess', secret: 'key-123' })
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// handleSecretWrite — the no-leak guarantee
// ---------------------------------------------------------------------------

const RAW_SECRET = 'sk-live-PrivilegedCourtListenerKey-7f3a9b2c1d'

function makeSpies() {
  const writes: Array<{ customerSlug: string; connector: string; secret: string }> = []
  const audits: Array<Record<string, string>> = []
  const writer: CustomerSecretWriter = {
    write: async (input) => {
      writes.push(input)
      return { ref: `infisical:/operator/${input.customerSlug}/${input.connector}/api-key` }
    },
  }
  const audit: CredentialSecretAudit = {
    record: async (row) => {
      audits.push(row)
    },
  }
  return { writer, audit, writes, audits }
}

describe('handleSecretWrite', () => {
  it('writes the value exactly once and returns only a masked confirmation', async () => {
    const { writer, audit, writes } = makeSpies()
    const result = await handleSecretWrite(
      { writer, audit },
      { customerSlug: 'smith-pi-firm', connector: 'CourtAccess', secret: RAW_SECRET },
      { actor: 'partner@firm.com', actorRole: 'principal' }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.masked).toBe(maskSecret(RAW_SECRET))
    expect(result.ref).toContain('smith-pi-firm')
    expect(writes).toHaveLength(1)
    expect(writes[0].secret).toBe(RAW_SECRET)
  })

  it('NEVER lets the raw value escape into the result', async () => {
    const { writer, audit } = makeSpies()
    const result = await handleSecretWrite(
      { writer, audit },
      { customerSlug: 'smith-pi-firm', connector: 'CourtAccess', secret: RAW_SECRET },
      { actor: 'partner@firm.com', actorRole: 'principal' }
    )
    expect(JSON.stringify(result).includes(RAW_SECRET)).toBe(false)
  })

  it('NEVER lets the raw value escape into the audit row', async () => {
    const { writer, audit, audits } = makeSpies()
    await handleSecretWrite(
      { writer, audit },
      { customerSlug: 'smith-pi-firm', connector: 'CourtAccess', secret: RAW_SECRET },
      { actor: 'partner@firm.com', actorRole: 'principal' }
    )
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0]).includes(RAW_SECRET)).toBe(false)
    expect(audits[0].masked).toBe(maskSecret(RAW_SECRET))
    expect(audits[0].actor).toBe('partner@firm.com')
  })

  it('does not call the writer or audit on invalid input', async () => {
    const { writer, audit, writes, audits } = makeSpies()
    const result = await handleSecretWrite(
      { writer, audit },
      { customerSlug: 's', connector: 'NotReal', secret: RAW_SECRET },
      { actor: 'x', actorRole: 'principal' }
    )
    expect(result).toEqual<SecretWriteResult>({ ok: false, error: 'invalid_connector' })
    expect(writes).toHaveLength(0)
    expect(audits).toHaveLength(0)
  })

  it('collapses a transport throw to write_failed without leaking the thrown detail', async () => {
    // A hostile/buggy transport that embeds the secret in its thrown error —
    // the core must not surface it.
    const writer: CustomerSecretWriter = {
      write: async (input) => {
        throw new Error(`upstream rejected value=${input.secret}`)
      },
    }
    const audits: Array<Record<string, string>> = []
    const audit: CredentialSecretAudit = { record: async (r) => void audits.push(r) }
    const result = await handleSecretWrite(
      { writer, audit },
      { customerSlug: 'smith-pi-firm', connector: 'CourtAccess', secret: RAW_SECRET },
      { actor: 'partner@firm.com', actorRole: 'principal' }
    )
    expect(result).toEqual<SecretWriteResult>({ ok: false, error: 'write_failed' })
    expect(JSON.stringify(result).includes(RAW_SECRET)).toBe(false)
    // No audit row is written on failure (no secret was stored).
    expect(audits).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// createSecretAudit — D1-backed sink writes a value-free row
// ---------------------------------------------------------------------------

describe('createSecretAudit (D1)', () => {
  it('persists a connector_secret_audit row with the masked tail and no value', async () => {
    const db = createTestD1()
    await runMigrations(db, {
      files: discoverNumericMigrations(resolve(process.cwd(), 'migrations')),
    })
    const audit = createSecretAudit(db, { entityId: 'entity-1', actorUserId: 'user-1' })
    await audit.record({
      customerSlug: 'smith-pi-firm',
      connector: 'CourtAccess',
      actor: 'partner@firm.com',
      actorRole: 'principal',
      masked: maskSecret(RAW_SECRET),
      ref: 'infisical:/operator/smith-pi-firm/CourtAccess/api-key',
    })
    const row = await db
      .prepare('SELECT * FROM connector_secret_audit WHERE customer_slug = ?')
      .bind('smith-pi-firm')
      .first<Record<string, unknown>>()
    expect(row).not.toBeNull()
    expect(row?.connector).toBe('CourtAccess')
    expect(row?.masked_tail).toBe(maskSecret(RAW_SECRET))
    expect(row?.actor_email).toBe('partner@firm.com')
    // The whole row, serialized, cannot contain the raw value — no column holds it.
    expect(JSON.stringify(row).includes(RAW_SECRET)).toBe(false)
  })
})
