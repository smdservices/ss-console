/**
 * Intelligence brief (dossier) generation using Claude Sonnet.
 * Produces a human-readable brief from authoritative context, but the
 * output itself is non-authoritative and must not be fed back into later
 * prompt assembly by default.
 */

import { ModuleError } from './instrument'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 4096

const DOSSIER_PROMPT = `You are generating an evidence-bound intelligence brief for a consulting team (SMD Services) that sells operations cleanup engagements to Phoenix-area small businesses. Use "we" voice.

Rules:
- Use only facts present in the supplied context.
- Do not infer management style, communication preference, personality, likely objections, or private business conditions.
- When evidence is incomplete, label it as an open question instead of guessing.
- Distinguish verified facts from hypotheses we should test on the call.

Generate a structured dossier in markdown format with these sections:

## Business Overview
- Name, vertical, location, size indicators, founding year
- Visible offerings, service area, notable credentials, public reputation signals

## Verified Operating Signals
- Specific operational patterns visible in reviews, website facts, tooling, hiring, or public materials
- Cite the evidence inline for each signal

## Engagement Hypotheses
- 2-3 hypotheses worth testing on the call
- Each item must include:
  - Confidence: high | medium | low
  - Evidence: specific supporting facts
  - What we still need to confirm

## Questions For The Call
- 3-5 targeted questions that would confirm or disprove the hypotheses

## Outreach Hooks
- 2-3 evidence-based opening lines grounded in verified facts
- No fabricated specifics, no objections handling, no personality reads

Keep it concise but thorough. 600-900 words.`

export async function generateDossier(
  assembledContext: string,
  entityName: string,
  anthropicKey: string
): Promise<string | null> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: DOSSIER_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Generate an intelligence brief for: ${entityName}\n\nAll available intelligence:\n\n${assembledContext}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    // Issue #631 follow-up: surface Anthropic errors as failed runs rather
    // than silently returning null (which records `no_data`). The 2026-04-30
    // backfill incident demonstrated the cost of silent 401s — 171 entities
    // marked no_data while the bad key sat unfixed. Throwing here lets the
    // Workflow's per-step retry handle transients and end the run in
    // `failed` state on permanent failures, visible in the dashboard.
    const body = await response.text().catch(() => '')
    throw new ModuleError(
      'api_error',
      `Anthropic API returned ${response.status}: ${body.slice(0, 500)}`
    )
  }

  const result = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>
  }
  return result?.content?.find((b) => b.type === 'text')?.text?.trim() ?? null
}
