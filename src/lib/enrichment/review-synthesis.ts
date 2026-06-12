/**
 * Cross-platform review synthesis using Claude Sonnet.
 * Reads existing signal and enrichment context, produces unified analysis.
 */

import { ModuleError } from './instrument'
import { ANTHROPIC_API_URL, ANTHROPIC_VERSION, QUALITY_MODEL } from '../llm/models'

const MODEL = QUALITY_MODEL
const MAX_TOKENS = 1024

export interface ReviewSynthesis {
  unified_rating: number | null
  total_reviews_across_platforms: number
  sentiment_trend: 'improving' | 'stable' | 'declining' | 'insufficient_data'
  top_themes: string[]
  operational_problems: Array<{ problem: string; confidence: string; evidence: string }>
  customer_sentiment: string
}

export async function synthesizeReviews(
  contextEntries: string,
  anthropicKey: string
): Promise<ReviewSynthesis | null> {
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
      system: `Synthesize all review data for this business across platforms. Map operational issues to these 5 solution areas: process_design, tool_systems, data_visibility, customer_pipeline, team_operations. Return ONLY valid JSON:
{
  "unified_rating": "number 1-5 or null",
  "total_reviews_across_platforms": "number",
  "sentiment_trend": "improving | stable | declining | insufficient_data",
  "top_themes": ["array of 3-5 recurring themes"],
  "operational_problems": [{"problem": "problem_id", "confidence": "high|medium|low", "evidence": "brief quote or pattern"}],
  "customer_sentiment": "1-2 sentence overall assessment"
}`,
      messages: [
        {
          role: 'user',
          content: `All available review and enrichment data:\n\n${contextEntries}`,
        },
      ],
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
  let text = result?.content?.find((b) => b.type === 'text')?.text?.trim()
  if (!text) return null
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

  return parseSynthesisJson(text)
}

/**
 * Parse + validate the LLM's JSON into a ReviewSynthesis, or null when
 * malformed. Issue #835: `return JSON.parse(text)` was an implicit
 * any→ReviewSynthesis cast that threw on malformed output, burning
 * Workflow retries; a response that fails validation skips the module.
 */
function parseSynthesisJson(text: string): ReviewSynthesis | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    console.warn('[review-synthesis] LLM returned unparseable JSON; skipping')
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn('[review-synthesis] LLM returned non-object JSON; skipping')
    return null
  }
  const candidate = raw as Record<string, unknown>
  return {
    unified_rating: typeof candidate.unified_rating === 'number' ? candidate.unified_rating : null,
    total_reviews_across_platforms:
      typeof candidate.total_reviews_across_platforms === 'number'
        ? candidate.total_reviews_across_platforms
        : 0,
    sentiment_trend: coerceSentimentTrend(candidate.sentiment_trend),
    top_themes: Array.isArray(candidate.top_themes)
      ? candidate.top_themes.filter((t): t is string => typeof t === 'string')
      : [],
    operational_problems: coerceOperationalProblems(candidate.operational_problems),
    customer_sentiment:
      typeof candidate.customer_sentiment === 'string' ? candidate.customer_sentiment : '',
  }
}

function coerceSentimentTrend(value: unknown): ReviewSynthesis['sentiment_trend'] {
  if (value === 'improving' || value === 'stable' || value === 'declining') return value
  return 'insufficient_data'
}

function coerceOperationalProblems(value: unknown): ReviewSynthesis['operational_problems'] {
  if (!Array.isArray(value)) return []
  return value.filter((p): p is { problem: string; confidence: string; evidence: string } => {
    if (p === null || typeof p !== 'object') return false
    const record = p as Record<string, unknown>
    return (
      typeof record.problem === 'string' &&
      typeof record.confidence === 'string' &&
      typeof record.evidence === 'string'
    )
  })
}
