import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const jobSerpApi = readFileSync(resolve('workers/job-monitor/src/serpapi.ts'), 'utf8')
const jobPrompt = readFileSync(resolve('src/lead-gen/prompts/job-qualification-prompt.ts'), 'utf8')
const reviewPrompt = readFileSync(resolve('src/lead-gen/prompts/review-scoring-prompt.ts'), 'utf8')

describe('lead-gen statewide pivot', () => {
  it('uses Arizona for SerpAPI job discovery', () => {
    expect(jobSerpApi).toContain("location: 'Arizona, United States'")
  })

  it('removes Phoenix-area phrasing from lead-gen qualification prompts', () => {
    for (const content of [jobPrompt, reviewPrompt]) {
      expect(content).not.toMatch(/Phoenix-area|Phoenix-based|Phoenix metro/)
      expect(content).toContain('Arizona')
    }
  })
})
