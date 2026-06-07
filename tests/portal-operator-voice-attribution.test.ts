/**
 * Dashboard surface tests for multi-user voice attribution (#858).
 *
 * The DraftDetail component renders a "Shaped in <profile label>" line
 * under the existing "Drafted by [persona]" footer when the bridge has
 * supplied a `voiceProfileLabel`. The empty-state path renders nothing
 * (no fabricated attribution) when the label is null.
 *
 * The render goes through the experimental Astro container so the test
 * exercises the same component code path as the page.
 */

import { describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import DraftDetail from '../src/components/portal/operator/DraftDetail.astro'
import type { DraftDetail as DraftDetailType } from '../src/lib/portal/operator/drafts'

vi.mock('cloudflare:workers', () => ({
  env: { DB: {} },
}))

function makeDraft(overrides: Partial<DraftDetailType> = {}): DraftDetailType {
  return {
    id: 'd-858-1',
    sender: 'Marcus (Operator for Smith PI Firm)',
    recipient: 'opposing@example.com',
    skill: 'pi-demand-letter',
    trustCeiling: 'draft_for_review',
    ageSeconds: 1800,
    priority: 'normal',
    subject: 'Demand letter — Case 24-001',
    bodyPlain: 'Dear Counsel,\n\nPlease find our demand attached.\n\nSincerely,\nPartner Sarah',
    personaName: 'Marcus',
    personaSlug: 'marcus',
    personaDraftedAt: '2026-05-21T14:00:00.000Z',
    reviewerEmail: 'sarah@smithpi.com',
    sendStatus: 'pending',
    sendError: null,
    sources: [],
    voiceProfileLabel: null,
    ...overrides,
  }
}

async function renderDraftDetail(draft: DraftDetailType): Promise<string> {
  const container = await AstroContainer.create()
  return container.renderToString(DraftDetail, {
    props: {
      draft,
      callerRole: 'principal',
      reviewerEmail: draft.reviewerEmail,
      reviewerDisplayName: 'Partner Sarah',
      undoWindowMs: 5000,
    },
  })
}

describe('DraftDetail — voice attribution surface (#858)', () => {
  it('renders nothing when voiceProfileLabel is null (legacy empty state)', async () => {
    const html = await renderDraftDetail(makeDraft({ voiceProfileLabel: null }))
    expect(html).not.toContain('data-testid="voice-attribution"')
    expect(html).not.toContain('Shaped in')
  })

  it('renders nothing when voiceProfileLabel is the empty string', async () => {
    // Defensive empty-state — bridges that emit "" should not flash a
    // blank "Shaped in " row.
    const html = await renderDraftDetail(makeDraft({ voiceProfileLabel: '' }))
    expect(html).not.toContain('data-testid="voice-attribution"')
  })

  it('renders the label verbatim when voiceProfileLabel is set', async () => {
    const html = await renderDraftDetail(makeDraft({ voiceProfileLabel: "Partner Sarah's voice" }))
    expect(html).toContain('data-testid="voice-attribution"')
    expect(html).toContain('Shaped in Partner Sarah&#39;s voice')
  })

  it('renders the general-voice label when the customer has no per-user profiles', async () => {
    const html = await renderDraftDetail(makeDraft({ voiceProfileLabel: 'General firm voice' }))
    expect(html).toContain('data-testid="voice-attribution"')
    expect(html).toContain('Shaped in General firm voice')
  })

  it('keeps the persona attribution line independent of the voice label', async () => {
    // Both the "Drafted by Marcus" line and the "Shaped in ..." line
    // should appear when both are populated — voice attribution is
    // additive, not a replacement.
    const html = await renderDraftDetail(makeDraft({ voiceProfileLabel: "Partner Sarah's voice" }))
    expect(html).toContain('Drafted by Marcus')
    expect(html).toContain('Shaped in')
  })
})
