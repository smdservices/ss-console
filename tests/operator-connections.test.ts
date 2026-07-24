import { describe, it, expect } from 'vitest'
import {
  buildConnectionRows,
  formatCustody,
  connectionCareNote,
  adapterDisplayName,
  capabilityDisplayName,
  connectionDefaultNote,
} from '../src/lib/portal/operator/connections'

describe('buildConnectionRows', () => {
  const connectors = {
    PracticeManagement: { adapter: 'clio', credential_custody: 'self_held' },
    Email: { adapter: 'google-workspace', credential_custody: null },
    CallTracking: { adapter: 'callrail' }, // no custody field → inherit default
  }

  it('joins status rows with resolved per-connector custody', () => {
    const rows = buildConnectionRows(connectors, 'delegated')
    const byCap = Object.fromEntries(rows.map((r) => [r.capabilityName, r]))
    // explicit self_held pins
    expect(byCap['PracticeManagement'].custody).toBe('self_held')
    expect(byCap['PracticeManagement'].smdReachable).toBe(false)
    // null per-connector → client default
    expect(byCap['Email'].custody).toBe('delegated')
    expect(byCap['Email'].smdReachable).toBe(true)
    // absent field → client default
    expect(byCap['CallTracking'].custody).toBe('delegated')
  })

  it('honors a self_held client default for connectors that do not override', () => {
    const rows = buildConnectionRows(connectors, 'self_held')
    const byCap = Object.fromEntries(rows.map((r) => [r.capabilityName, r]))
    expect(byCap['Email'].custody).toBe('self_held')
    expect(byCap['CallTracking'].smdReachable).toBe(false)
    // explicit value still wins (here it matches anyway)
    expect(byCap['PracticeManagement'].custody).toBe('self_held')
  })

  it('returns an empty list when there are no connectors', () => {
    expect(buildConnectionRows(null, 'delegated')).toEqual([])
    expect(buildConnectionRows({}, 'delegated')).toEqual([])
  })

  it('every row reports unconfigured health until the harness is portal-bound', () => {
    const rows = buildConnectionRows(connectors, 'delegated')
    expect(rows.every((r) => r.health === 'unconfigured')).toBe(true)
  })
})

describe('custody labels', () => {
  it('formatCustody speaks client language (Captain, 2026-07-15: "delegated" read as loss of control)', () => {
    expect(formatCustody('self_held')).toBe('Key held by your firm')
    expect(formatCustody('delegated')).toBe('Managed by SMD')
  })
  it('connectionCareNote is honest about who can actually reconnect', () => {
    const base = {
      capabilityName: 'Email',
      adapter: 'agentmail',
      authMode: null,
      health: 'unconfigured',
      reconsentRequired: false,
      smdReachable: true,
    } as const
    expect(connectionCareNote({ ...base, custody: 'self_held' })).toContain('Only you')
    // SMD-held credential: SMD really can re-establish alone.
    expect(connectionCareNote({ ...base, custody: 'delegated' })).toContain(
      're-establish it for you'
    )
    // authorization_code: the firm approves a fresh authorization; SMD only sends the link.
    const oauth = connectionCareNote({
      ...base,
      adapter: 'smokeball',
      authMode: 'authorization_code',
      custody: 'delegated',
    })
    expect(oauth).toContain('authorization link')
    expect(oauth).not.toContain('re-establish it for you')
  })
})

describe('client display names (no raw slugs on the page)', () => {
  it('maps known adapter slugs to product names and unknown slugs to null', () => {
    expect(adapterDisplayName('agentmail')).toBe('AgentMail')
    expect(adapterDisplayName('smokeball')).toBe('Smokeball')
    expect(adapterDisplayName('some-new-adapter')).toBeNull()
  })
  it('renders capability keys in client language', () => {
    expect(capabilityDisplayName('PracticeManagement')).toBe('Practice management')
    expect(capabilityDisplayName('Email')).toBe('Email')
  })
  it('marks the AgentMail mailbox as an SMD-provided default, nothing else', () => {
    const rows = buildConnectionRows(
      { Email: { adapter: 'agentmail' }, PracticeManagement: { adapter: 'smokeball' } },
      'delegated'
    )
    const email = rows.find((r) => r.adapter === 'agentmail')!
    const pm = rows.find((r) => r.adapter === 'smokeball')!
    expect(connectionDefaultNote(email)).toContain('default')
    expect(connectionDefaultNote(pm)).toBeNull()
  })
})
