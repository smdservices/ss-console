/**
 * Review-response pattern analysis.
 * Reads review signals and extracts observable response behavior only.
 */

import { ModuleError } from './instrument'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 512

const ANALYSIS_PROMPT = `Analyze these business review signals for observable review-response behavior only. Do NOT infer management style, personality, communication preference, or private business conditions. Return ONLY valid JSON:
{
  "response_pattern": "responsive | sporadic | unresponsive | unknown",
  "engagement_level": "high | medium | low | unknown",
  "owner_accessible": true/false,
  "evidence_summary": "1-2 sentence summary of the observable review-response behavior"
}`

export interface ReviewAnalysis {
  response_pattern: string
  engagement_level: string
  owner_accessible: boolean
  evidence_summary: string
}

export async function analyzeReviewPatterns(
  signalContent: string,
  anthropicKey: string
): Promise<ReviewAnalysis | null> {
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
      system: ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: `Review signals:\n\n${signalContent}` }],
    }),
  })

  if (!response.ok) {
    // Issue #631 follow-up: surface Anthropic errors as failed runs.
    const body = await response.text().catch(() => '')
    throw new ModuleError(
      'api_error',
      `Anthropic API returned ${response.status}: ${body.slice(0, 500)}`
    )
  }

  const result: { content?: Array<{ type: string; text?: string }> } = await response.json()
  const text = result?.content?.find((b) => b.type === 'text')?.text?.trim()
  if (!text) return null

  let jsonText = text
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(jsonText)
  return {
    response_pattern: parsed.response_pattern ?? 'unknown',
    engagement_level: parsed.engagement_level ?? 'unknown',
    owner_accessible: parsed.owner_accessible ?? false,
    evidence_summary: parsed.evidence_summary ?? '',
  }
}
