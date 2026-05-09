import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { VERTICALS } from '../src/portal/assessments/extraction-schema'

const newBusinessPrompt = readFileSync(
  resolve('src/lead-gen/prompts/new-business-prompt.ts'),
  'utf8'
)

describe('new-business prompt vertical heading canonicalization (#747)', () => {
  it('uses canonical enum names as heuristic section headings', () => {
    const heuristicHeadings = [
      'home_services',
      'professional_services',
      'contractor_trades',
      'retail_salon',
      'restaurant_food',
    ]
    for (const heading of heuristicHeadings) {
      expect(newBusinessPrompt).toContain(`- **${heading}:**`)
    }
  })

  it('does not emit the deprecated retail_food sibling that Haiku invented', () => {
    expect(newBusinessPrompt).not.toContain('retail_food')
  })

  it('does not use freeform spaced/slashed heading variants', () => {
    expect(newBusinessPrompt).not.toMatch(/- \*\*Home services:/)
    expect(newBusinessPrompt).not.toMatch(/- \*\*Professional services:/)
    expect(newBusinessPrompt).not.toMatch(/- \*\*Contractor\/trades:/)
    expect(newBusinessPrompt).not.toMatch(/- \*\*Retail\/salon\/spa:/)
    expect(newBusinessPrompt).not.toMatch(/- \*\*Restaurant\/food:/)
  })

  it('keeps every canonical vertical referenced somewhere in the prompt', () => {
    for (const vertical of VERTICALS) {
      expect(newBusinessPrompt).toContain(vertical)
    }
  })
})
