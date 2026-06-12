/**
 * Review-response pattern analysis.
 * Reads review signals and extracts observable response behavior only.
 */

import { ModuleError } from './instrument'
import { ANTHROPIC_API_URL, ANTHROPIC_VERSION, FAST_MODEL } from '../llm/models'

const MODEL = FAST_MODEL
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

/**
 * Parse + coerce the LLM's JSON into a ReviewAnalysis, or null when
 * malformed (issue #835: LLM output is external input — a response that
 * fails to parse must skip the module, not throw into the Workflow
 * step's retry loop).
 */
function parseAnalysisJson(jsonText: string): ReviewAnalysis | null {
  let parsed: Record<string, unknown>
  try {
    const raw: unknown = JSON.parse(jsonText)
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      console.warn('[review-analysis] LLM returned non-object JSON; skipping')
      return null
    }
    parsed = raw as Record<string, unknown>
  } catch {
    console.warn('[review-analysis] LLM returned unparseable JSON; skipping')
    return null
  }
  return {
    response_pattern:
      typeof parsed.response_pattern === 'string' ? parsed.response_pattern : 'unknown',
    engagement_level:
      typeof parsed.engagement_level === 'string' ? parsed.engagement_level : 'unknown',
    owner_accessible:
      typeof parsed.owner_accessible === 'boolean' ? parsed.owner_accessible : false,
    evidence_summary: typeof parsed.evidence_summary === 'string' ? parsed.evidence_summary : '',
  }
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

  return parseAnalysisJson(jsonText)
}
