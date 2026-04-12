import { describe, it, expect } from 'vitest'
import { getSowSigningFields } from '../src/lib/signwell/field-config'
import { PAGE_SIZE, PAGE_MARGINS, SIGNING_PAGE } from '../src/lib/pdf/signing-layout'

describe('signwell: SOW signing field coordinates', () => {
  const fields = getSowSigningFields()

  it('signature field is on the dedicated signing page', () => {
    expect(fields.signature.page).toBe(SIGNING_PAGE.pageNumber)
    expect(fields.signature.page).toBe(3)
  })

  it('date field is on the dedicated signing page', () => {
    expect(fields.date.page).toBe(SIGNING_PAGE.pageNumber)
    expect(fields.date.page).toBe(3)
  })

  it('signature field x starts at left margin', () => {
    expect(fields.signature.x).toBe(PAGE_MARGINS.left)
  })

  it('signature field fits within page bounds', () => {
    expect(fields.signature.x + fields.signature.width!).toBeLessThanOrEqual(
      PAGE_SIZE.width - PAGE_MARGINS.right
    )
    expect(fields.signature.y + fields.signature.height!).toBeLessThanOrEqual(
      PAGE_SIZE.height - PAGE_MARGINS.bottom
    )
  })

  it('date field is below signature field', () => {
    expect(fields.date.y).toBeGreaterThan(fields.signature.y + fields.signature.height!)
  })

  it('date field fits within page bounds', () => {
    expect(fields.date.x + fields.date.width!).toBeLessThanOrEqual(
      PAGE_SIZE.width - PAGE_MARGINS.right
    )
    expect(fields.date.y + fields.date.height!).toBeLessThanOrEqual(
      PAGE_SIZE.height - PAGE_MARGINS.bottom
    )
  })

  it('signature field has reasonable dimensions', () => {
    expect(fields.signature.width!).toBeGreaterThanOrEqual(100)
    expect(fields.signature.width!).toBeLessThanOrEqual(300)
    expect(fields.signature.height!).toBeGreaterThanOrEqual(30)
    expect(fields.signature.height!).toBeLessThanOrEqual(80)
  })

  it('fields do not overlap', () => {
    const sigBottom = fields.signature.y + fields.signature.height!
    expect(fields.date.y).toBeGreaterThanOrEqual(sigBottom)
  })
})

describe('signwell: signing layout completeness', () => {
  it('defines client signature position', () => {
    expect(SIGNING_PAGE.clientSignature).toBeDefined()
    expect(SIGNING_PAGE.clientSignature.x).toBeGreaterThan(0)
  })

  it('defines client date position', () => {
    expect(SIGNING_PAGE.clientDate).toBeDefined()
    expect(SIGNING_PAGE.clientDate.x).toBeGreaterThan(0)
  })

  it('reserves SMD signature position for future use', () => {
    expect(SIGNING_PAGE.smdSignature).toBeDefined()
    expect(SIGNING_PAGE.smdSignature.x).toBeGreaterThan(SIGNING_PAGE.clientSignature.x)
  })

  it('reserves SMD date position for future use', () => {
    expect(SIGNING_PAGE.smdDate).toBeDefined()
    expect(SIGNING_PAGE.smdDate.x).toBeGreaterThan(SIGNING_PAGE.clientDate.x)
  })

  it('SMD column starts after client column', () => {
    const clientRight = SIGNING_PAGE.clientSignature.x + SIGNING_PAGE.clientSignature.width
    expect(SIGNING_PAGE.smdSignature.x).toBeGreaterThanOrEqual(clientRight + SIGNING_PAGE.columnGap)
  })
})
