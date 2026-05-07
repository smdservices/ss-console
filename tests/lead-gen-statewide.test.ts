import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULTS } from '../src/lib/generators/types'

const jobSerpApi = readFileSync(resolve('workers/job-monitor/src/serpapi.ts'), 'utf8')
const newBusinessPrompt = readFileSync(
  resolve('src/lead-gen/prompts/new-business-prompt.ts'),
  'utf8'
)
const jobPrompt = readFileSync(resolve('src/lead-gen/prompts/job-qualification-prompt.ts'), 'utf8')
const reviewPrompt = readFileSync(resolve('src/lead-gen/prompts/review-scoring-prompt.ts'), 'utf8')

describe('lead-gen statewide pivot', () => {
  it('sets generator default geos to Arizona', () => {
    expect(DEFAULTS.new_business.geos).toEqual(['Arizona'])
    expect(DEFAULTS.job_monitor.geos).toEqual(['Arizona'])
    expect(DEFAULTS.review_mining.geos).toEqual(['Arizona'])
  })

  it('uses Arizona for SerpAPI job discovery', () => {
    expect(jobSerpApi).toContain("location: 'Arizona, United States'")
  })

  it('removes Phoenix-area phrasing from lead-gen qualification prompts', () => {
    for (const content of [newBusinessPrompt, jobPrompt, reviewPrompt]) {
      expect(content).not.toMatch(/Phoenix-area|Phoenix-based|Phoenix metro/)
      expect(content).toContain('Arizona')
    }
  })
})
