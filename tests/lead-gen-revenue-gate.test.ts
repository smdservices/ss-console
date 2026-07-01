import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const generatorTypes = readFileSync(resolve('src/lib/generators/types.ts'), 'utf8')
const jobPrompt = readFileSync(resolve('src/lead-gen/prompts/job-qualification-prompt.ts'), 'utf8')
const reviewPrompt = readFileSync(resolve('src/lead-gen/prompts/review-scoring-prompt.ts'), 'utf8')

describe('lead-gen revenue gate removal', () => {
  it('removes revenue_range from generator config types', () => {
    expect(generatorTypes).not.toContain('revenue_range')
    expect(generatorTypes).not.toContain('DEFAULT_REVENUE_RANGE')
  })

  it('removes $750k-$5M framing from qualification prompts', () => {
    for (const prompt of [jobPrompt, reviewPrompt]) {
      expect(prompt).not.toMatch(/\$750k|\$5M|750k|5M revenue/)
    }
  })

  it('keeps enterprise as a structural disqualification', () => {
    expect(jobPrompt).toContain('Enterprise / 500+ employees / multi-state corporate buyer')
    expect(reviewPrompt).toContain('Enterprise / multi-state corporate buyers are not prospects')
  })
})
