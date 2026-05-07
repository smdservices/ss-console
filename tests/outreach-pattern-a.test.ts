import { afterEach, describe, expect, it, vi } from 'vitest'
import { OutreachValidationError, validateOutreachDraft } from '../src/lib/claude/outreach'

const INTELLIGENCE = `Website: Desert Bloom Florist
Review: "Beautiful arrangements and easy pickup."
Job posting: "Hiring a part-time shop coordinator."`

function mockClassifier(result: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: result }],
      }),
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('outreach Pattern A validator', () => {
  it('rejects known bad banlist phrasing before classifier', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const draft = `Desert Bloom florist

You have built something solid from day one and it shows.`

    await expect(validateOutreachDraft('sk-test', INTELLIGENCE, draft)).rejects.toThrow(
      OutreachValidationError
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects classifier-flagged ungrounded business-state claims', async () => {
    mockClassifier('Y | at an inflection point internally')
    const draft = `Desert Bloom Florist follow-up

We noticed your coordinator opening and thought it might point to the business being at an inflection point internally. If it would be useful, we would be glad to learn more about what you are trying to accomplish.

-- The SMD Services team`

    await expect(validateOutreachDraft('sk-test', INTELLIGENCE, draft)).rejects.toThrow(
      /Pattern A violation/
    )
  })

  it('accepts a grounded draft that stays factual and collaborative', async () => {
    mockClassifier('N')
    const draft = `Question about Desert Bloom Florist

We came across your part-time shop coordinator opening and your recent customer feedback about easy pickup. We help owners tighten operations when customer communication and day-to-day coordination start taking more attention than they should. If it would be useful, we would be glad to learn more about what you are trying to accomplish.

-- The SMD Services team`

    await expect(validateOutreachDraft('sk-test', INTELLIGENCE, draft)).resolves.toBeUndefined()
  })
})
