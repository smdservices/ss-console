/**
 * Claude API client for assessment transcript extraction.
 *
 * Uses raw fetch against the Anthropic Messages API — no SDK dependency.
 * This keeps the Cloudflare Workers bundle small and avoids Node.js runtime
 * requirements that the SDK brings along.
 *
 * @see Decision #17 — Assessment Call Capture
 * @see Deliverable #34 — MacWhisper extraction prompt
 */

import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
  validateExtraction,
} from '../../portal/assessments/extraction-prompt'
import type { AssessmentExtraction } from '../../portal/assessments/extraction-schema'

export type { AssessmentExtraction }

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 4096

/**
 * Error thrown when the Claude API returns an unexpected response.
 */
export class ExtractionApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message)
    this.name = 'ExtractionApiError'
  }
}

/**
 * Error thrown when the extraction output fails schema validation.
 */
export class ExtractionValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: string[]
  ) {
    super(message)
    this.name = 'ExtractionValidationError'
  }
}

/**
 * Call the Claude API to extract structured assessment data from a transcript.
 *
 * 1. Sends the extraction system prompt + transcript to Claude
 * 2. Parses the JSON response
 * 3. Validates against the AssessmentExtraction schema
 * 4. Returns the validated result
 *
 * @param apiKey - Anthropic API key
 * @param transcript - Full MacWhisper speaker-separated transcript text
 * @returns Validated AssessmentExtraction object
 * @throws ExtractionApiError if the API call fails or returns unexpected format
 * @throws ExtractionValidationError if the response does not match the schema
 */
export async function extractAssessment(
  apiKey: string,
  transcript: string
): Promise<AssessmentExtraction> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildExtractionUserPrompt(transcript),
        },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable>')
    throw new ExtractionApiError(
      `Claude API returned ${response.status}: ${response.statusText}`,
      response.status,
      body
    )
  }

  const result: { content?: Array<{ type: string; text?: string }> } = await response.json()

  // The Messages API returns content as an array of content blocks.
  // We expect a single text block containing the JSON.
  const contentBlocks = result?.content
  if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
    throw new ExtractionApiError(
      'Claude API returned empty content',
      response.status,
      JSON.stringify(result)
    )
  }

  const textBlock = contentBlocks.find((block) => block.type === 'text')
  if (!textBlock?.text) {
    throw new ExtractionApiError(
      'Claude API response contained no text content block',
      response.status,
      JSON.stringify(result)
    )
  }

  // Parse the JSON from the text response.
  // Claude may wrap it in code fences despite the prompt saying not to.
  let rawText = textBlock.text.trim()
  if (rawText.startsWith('```')) {
    rawText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new ExtractionApiError(
      'Claude API response was not valid JSON',
      response.status,
      rawText.slice(0, 500)
    )
  }

  // Validate against the schema
  const validation = validateExtraction(parsed)
  if (!validation.valid) {
    throw new ExtractionValidationError(
      `Extraction output failed validation: ${validation.errors.join('; ')}`,
      validation.errors
    )
  }

  return parsed as AssessmentExtraction
}
