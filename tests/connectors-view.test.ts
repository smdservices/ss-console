/**
 * Tests for the connectors view-model (src/lib/admin/connectors-view.ts) —
 * admin Operator console §5.4, ADR 0042 (custody) / 0020 (backends).
 *
 * Pure derivations over the connectors_json shape: only real capability
 * bindings are connectors (infra keys are skipped), effective custody resolves
 * per-connector → client-default → delegated, and the SMD-reach predicate
 * tracks delegated-only. No DB — the custody/transport contracts are frozen.
 */

import { describe, it, expect } from 'vitest'
import {
  parseConnectorViews,
  custodyBadge,
  backendLabel,
  connectionStateLabel,
} from '../src/lib/admin/connectors-view'

describe('parseConnectorViews', () => {
  it('skips infra keys and parses only real capability bindings', () => {
    const json = {
      per_customer_d1_database_id: 'db-123', // infra, not a connector
      Email: {
        backend: 'mcp:google',
        scopes: ['gmail.send'],
        token_ref: 'ref-1',
        credential_custody: null,
      },
      Calendar: {
        backend: 'mcp:google',
        scopes: [],
        token_ref: null,
        credential_custody: 'self_held',
      },
    }
    const views = parseConnectorViews(json, 'delegated')
    expect(views.map((v) => v.capability)).toEqual(['Calendar', 'Email']) // sorted, infra dropped
  })

  it('resolves effective custody: per-connector → client default → delegated', () => {
    const json = {
      Email: { backend: 'mcp:x', scopes: [], token_ref: 'r', credential_custody: null }, // inherits
      Payments: {
        backend: 'build:stripe',
        scopes: [],
        token_ref: 'r',
        credential_custody: 'self_held',
      },
    }
    // Client default self_held: Email inherits self_held; Payments pins self_held.
    const selfDefault = parseConnectorViews(json, 'self_held')
    expect(selfDefault.find((v) => v.capability === 'Email')!.custody).toBe('self_held')
    // Client default delegated: Email is delegated; Payments still self_held.
    const delegatedDefault = parseConnectorViews(json, 'delegated')
    expect(delegatedDefault.find((v) => v.capability === 'Email')!.custody).toBe('delegated')
    expect(delegatedDefault.find((v) => v.capability === 'Payments')!.custody).toBe('self_held')
  })

  it('smdCanReach is true only for delegated custody', () => {
    const json = {
      Email: { backend: 'mcp:x', scopes: [], token_ref: 'r', credential_custody: 'delegated' },
      Payments: { backend: 'build:y', scopes: [], token_ref: 'r', credential_custody: 'self_held' },
    }
    const views = parseConnectorViews(json, 'delegated')
    expect(views.find((v) => v.capability === 'Email')!.smdCanReach).toBe(true)
    expect(views.find((v) => v.capability === 'Payments')!.smdCanReach).toBe(false)
  })

  it('classifies backend kind and configured state from token_ref', () => {
    const json = {
      Email: { backend: 'mcp:google', scopes: [], token_ref: 'r', credential_custody: null },
      Accounting: { backend: 'build:qbo', scopes: [], token_ref: null, credential_custody: null },
      IntakeCRM: {
        backend: 'synthetic:no_pm',
        scopes: [],
        token_ref: '',
        credential_custody: null,
      },
    }
    const views = parseConnectorViews(json, 'delegated')
    const byName = Object.fromEntries(views.map((v) => [v.capability, v]))
    expect(byName.Email.backendKind).toBe('mcp')
    expect(byName.Email.configured).toBe(true)
    expect(byName.Accounting.backendKind).toBe('build')
    expect(byName.Accounting.configured).toBe(false)
    expect(byName.IntakeCRM.backendKind).toBe('synthetic')
    expect(byName.IntakeCRM.configured).toBe(false) // empty token_ref is not configured
  })

  it('returns [] for malformed or empty input', () => {
    expect(parseConnectorViews(null, 'delegated')).toEqual([])
    expect(parseConnectorViews('nope', 'delegated')).toEqual([])
    expect(parseConnectorViews({}, 'delegated')).toEqual([])
  })

  it('tolerates a malformed single connector value without throwing', () => {
    const json = {
      Email: 'not-an-object',
      Calendar: { backend: 'mcp:x', scopes: [], token_ref: 'r' },
    }
    const views = parseConnectorViews(json, 'delegated')
    expect(views.map((v) => v.capability)).toEqual(['Calendar'])
  })
})

describe('display helpers', () => {
  it('custodyBadge distinguishes delegated vs self-held with honest detail', () => {
    expect(custodyBadge('delegated').label).toBe('Delegated')
    expect(custodyBadge('delegated').detail).toMatch(/SMD/)
    expect(custodyBadge('self_held').label).toBe('Self-held')
    expect(custodyBadge('self_held').detail).toMatch(/cannot reach/)
  })

  it('backendLabel maps each kind', () => {
    expect(backendLabel('mcp')).toBe('MCP server')
    expect(backendLabel('build')).toBe('Built adapter')
    expect(backendLabel('synthetic')).toBe('Synthetic (no-PM)')
    expect(backendLabel('native')).toBe('Native provider')
    expect(backendLabel('unknown')).toBe('Unknown backend')
  })

  it('connectionStateLabel reflects authored state', () => {
    expect(connectionStateLabel(true)).toBe('Configured')
    expect(connectionStateLabel(false)).toBe('Not connected')
  })
})
