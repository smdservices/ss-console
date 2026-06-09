import { describe, it, expect } from 'vitest'
import { safeReturnTo, OPERATOR_ROOT } from '../src/lib/portal/operator/return-to'

describe('safeReturnTo', () => {
  it('passes through a valid operator-subtree path', () => {
    expect(safeReturnTo('/portal/products/operator')).toBe('/portal/products/operator')
    expect(safeReturnTo('/portal/products/operator/connections')).toBe(
      '/portal/products/operator/connections'
    )
    expect(safeReturnTo('/portal/products/operator/matters?cr=filed')).toBe(
      '/portal/products/operator/matters?cr=filed'
    )
    expect(safeReturnTo('/portal/products/operator#top')).toBe('/portal/products/operator#top')
  })

  it('trims surrounding whitespace before validating', () => {
    expect(safeReturnTo('  /portal/products/operator/team  ')).toBe(
      '/portal/products/operator/team'
    )
  })

  it('falls back to the operator root for non-string input', () => {
    expect(safeReturnTo(null)).toBe(OPERATOR_ROOT)
    expect(safeReturnTo(undefined)).toBe(OPERATOR_ROOT)
    expect(safeReturnTo(42)).toBe(OPERATOR_ROOT)
    expect(safeReturnTo({})).toBe(OPERATOR_ROOT)
  })

  it('rejects open-redirect vectors', () => {
    // protocol-relative + absolute external
    expect(safeReturnTo('//evil.com')).toBe(OPERATOR_ROOT)
    expect(safeReturnTo('https://evil.com')).toBe(OPERATOR_ROOT)
    expect(safeReturnTo('http://evil.com/portal/products/operator')).toBe(OPERATOR_ROOT)
    // backslash normalization trick
    expect(safeReturnTo('/portal/products/operator\\@evil.com')).toBe(OPERATOR_ROOT)
    // embedded double slash anywhere
    expect(safeReturnTo('/portal/products/operator//evil')).toBe(OPERATOR_ROOT)
    // sibling-prefix escape
    expect(safeReturnTo('/portal/products/operatorX/steal')).toBe(OPERATOR_ROOT)
    // wrong subtree entirely
    expect(safeReturnTo('/admin/operator')).toBe(OPERATOR_ROOT)
    expect(safeReturnTo('/portal/invoices')).toBe(OPERATOR_ROOT)
  })

  it('rejects smuggled whitespace / control characters', () => {
    expect(safeReturnTo('/portal/products/operator/x\ny')).toBe(OPERATOR_ROOT)
    expect(safeReturnTo('/portal/products/operator/x\ty')).toBe(OPERATOR_ROOT)
    expect(safeReturnTo('/portal/products/operator/x y')).toBe(OPERATOR_ROOT)
  })
})
