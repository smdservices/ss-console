import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const dossierSrc = readFileSync(resolve('src/lib/enrichment/dossier.ts'), 'utf-8')
const reviewAnalysisSrc = readFileSync(resolve('src/lib/enrichment/review-analysis.ts'), 'utf-8')
const deepWebsiteSrc = readFileSync(resolve('src/lib/enrichment/deep-website.ts'), 'utf-8')

describe('enrichment prompt contracts', () => {
  it('keeps the dossier prompt evidence-bound and free of subjective inference sections', () => {
    expect(dossierSrc).toContain('Use only facts present in the supplied context.')
    expect(dossierSrc).toContain(
      'Do not infer management style, communication preference, personality, likely objections, or private business conditions.'
    )
    expect(dossierSrc).toContain(
      'When evidence is incomplete, label it as an open question instead of guessing.'
    )
    expect(dossierSrc).not.toContain('## Management Style')
    expect(dossierSrc).not.toContain('## Communication Preferences')
    expect(dossierSrc).not.toContain('## Likely Objections')
    expect(dossierSrc).not.toContain('## Talking Points')
  })

  it('keeps review-analysis scoped to observable response behavior', () => {
    expect(reviewAnalysisSrc).toContain('observable review-response behavior only')
    expect(reviewAnalysisSrc).toContain(
      'Do NOT infer management style, personality, communication preference, or private business conditions.'
    )
    expect(reviewAnalysisSrc).not.toContain('"management_style"')
    expect(reviewAnalysisSrc).not.toContain('"communication_preference"')
    expect(reviewAnalysisSrc).not.toContain('"likely_objections"')
  })

  it('keeps deep-website extractive instead of speculative', () => {
    expect(deepWebsiteSrc).toContain('extracting observable facts from a small business website')
    expect(deepWebsiteSrc).toContain(
      'Use only information explicitly supported by the supplied pages.'
    )
    expect(deepWebsiteSrc).toContain(
      'Do not infer owner personality, company trajectory, internal capacity, hidden tooling, or unstated operational problems.'
    )
    expect(deepWebsiteSrc).not.toContain('"pain_points"')
    expect(deepWebsiteSrc).not.toContain('"operational_problems"')
    expect(deepWebsiteSrc).not.toContain('"likely_objections"')
  })
})
