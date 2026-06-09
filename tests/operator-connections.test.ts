import { describe, it, expect } from 'vitest'
import {
  buildConnectionRows,
  formatCustody,
  describeCustody,
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
  it('formatCustody', () => {
    expect(formatCustody('self_held')).toBe('Self-held')
    expect(formatCustody('delegated')).toBe('Delegated to SMD')
  })
  it('describeCustody is honest about the recovery trade', () => {
    expect(describeCustody('self_held')).toContain('Only you')
    expect(describeCustody('delegated')).toContain('SMD')
  })
})
