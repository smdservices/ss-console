/**
 * Outreach draft generation via Claude API.
 *
 * Reads assembled entity context and generates a personalized outreach
 * email draft. Appended as a context entry of type 'outreach_draft'.
 *
 * Voice rules (from Decision #20 and CLAUDE.md Tone & Positioning Standard):
 * - Always "we" / "our team" — never "I" or "the consultant"
 * - Collaborative, not diagnostic — we work alongside the owner
 * - Objectives over problems — frame around where they're trying to go
 * - No pricing, no fixed timeframes
 * - No "systems" language — use "solution"
 * - Reference specific evidence from the signals
 *
 * Vertical-aware guidance (issue #594):
 * - One shared backbone (the SYSTEM prompt below).
 * - When a recognized vertical is supplied, a small per-vertical guidance
 *   block is appended that names the *general* operational pain areas
 *   that vertical commonly faces — drawn from CLAUDE.md "Pain Clusters by
 *   Vertical" and phrased in 5-cat observation vocabulary
 *   (process_design, customer_pipeline, data_visibility, team_operations,
 *   tool_systems). Per ADR 0001, outreach speaks observation, not delivery.
 * - The block is *backbone language only*. It never invents specifics
 *   (no fake numbers, names, dates, events, or claimed conversations).
 *   Per-prospect specificity comes exclusively from the assembled
 *   `enrichment context`, which the model still grounds the email in.
 * - When the vertical is missing, unknown, or 'other', the block is
 *   omitted entirely and the generic backbone runs unchanged.
 *
 * @see docs/adr/0001-taxonomy-two-layer-model.md
 * @see CLAUDE.md — "Pain Clusters by Vertical", "No fabricated client-facing content"
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 1024

const OUTREACH_SYSTEM_PROMPT = `You are writing a cold outreach email for SMD Services. We help Arizona-based operating businesses improve how the work actually runs. We work alongside owners, not above them.

## What this email is for

The draft is used after public-source enrichment is assembled. It is not a diagnostic memo. It is not a pitch deck. It is a short first email that proves we read the available material without pretending to know the owner's internal reality.

## How to write this email

1. Use the owner's first name if the intelligence explicitly includes it. Otherwise use the business name naturally.
2. Lead with one grounded fact or directly supported observation from the intelligence. Reviews, hiring text, website copy, or public business facts are all acceptable. Do not escalate that fact into a story about their growth stage, internal stress, or what they have "built."
3. State why we are relevant in plain language. Keep it collaborative. We help owners tighten operations, remove friction, and get clearer visibility into the work.
4. End with a neutral CTA. Offer to learn more about what they are trying to accomplish. Do not promise deliverables we do not ship.

## Hard rules
- Always "we" / "our team." Never "I" or "the consultant."
- No dollar amounts. No pricing. No timeframes.
- No em dashes.
- No invented deliverables. Never offer a one-page breakdown, tool list, audit, roadmap, playbook, or similar asset unless the intelligence explicitly says it already exists and we are sending that exact thing.
- Do not claim to know the recipient's business state, history, growth phase, internal experience, emotions, or thoughts unless the exact claim is present in the intelligence.
- Do not say "systems," "streamline," "leverage," or "game-changer."
- Subject line must be specific to this business. Not generic. Not clever. Specific.
- Maximum 120 words for the email body. Subject line is separate.
- Sign off as "-- The SMD Services team"

## Anti-fabrication rule (CRITICAL)
Every specific detail in the email must trace to the intelligence gathered below. If you do not have evidence for a number, event, person's name, quote, or date, do not invent one. When the intelligence is thin, stay broad and factual rather than pretending we know their business.

Output ONLY the subject line and email. No commentary, no markdown fences.`

// ---------------------------------------------------------------------------
// Vertical guidance — backbone language only (no fabricated specifics).
//
// Each entry names the general operational pain areas that vertical commonly
// faces, drawn from CLAUDE.md "Pain Clusters by Vertical". Phrased in 5-cat
// observation vocabulary per ADR 0001 — never the 6-cat marketing labels.
//
// These are HINTS to the model about the language register and which pain
// areas tend to resonate, not LICENSE to invent prospect-specific details.
// The model still grounds every concrete claim in the assembled context.
// ---------------------------------------------------------------------------

export type OutreachVertical =
  | 'home_services'
  | 'professional_services'
  | 'contractor_trades'
  | 'retail_salon'
  | 'restaurant_food'

const VERTICAL_GUIDANCE: Record<OutreachVertical, string> = {
  home_services: `## Vertical context: home services (plumber, HVAC, electrician, etc.)
Owners in this vertical commonly feel pain in three observation areas:
- customer_pipeline — leads come in by phone and text, follow-up depends on whoever picks up, jobs slip when the schedule fills
- process_design — dispatch, intake, and quoting often live in the owner's head; growth past a few crews exposes the gap
- team_operations — finding and keeping techs is a structural concern, not a recruiting blip

If the intelligence below evidences any of these, lean in. If it doesn't, do not invent specifics. Keep the language grounded in what you can actually point to.`,

  professional_services: `## Vertical context: professional services (accountant, attorney, CPA, consultant, etc.)
Owners in this vertical commonly feel pain in three observation areas:
- process_design — the owner is the bottleneck on client-facing work that should be delegable
- customer_pipeline — manual communication (email threads, phone tag) eats hours that should compound into billable work
- data_visibility — utilization, realization, pipeline value live in spreadsheets the owner reconciles by hand

If the intelligence below evidences any of these, lean in. If it doesn't, do not invent specifics. Keep the language grounded in what you can actually point to.`,

  retail_salon: `## Vertical context: retail / salon / spa
Owners in this vertical commonly feel pain in three observation areas:
- customer_pipeline — booking, no-shows, and rebooking depend on staff remembering to ask, not on a designed flow
- process_design — front-desk workflows for new clients vs. regulars are inconsistent shift-to-shift
- data_visibility — revenue per chair, retail attach rate, and product margin are guessed, not measured

If the intelligence below evidences any of these, lean in. If it doesn't, do not invent specifics. Keep the language grounded in what you can actually point to.`,

  contractor_trades: `## Vertical context: contractor / trades (general contractor, remodeler, etc.)
Owners in this vertical commonly feel pain in three observation areas:
- process_design — estimating and quoting are the owner's job long after the business should have a repeatable flow
- customer_pipeline — scheduling subs, crews, and clients across active jobs creates conflicts that get resolved by phone
- team_operations — keeping experienced field staff through busy and slow seasons is a structural problem, not a hiring blip

If the intelligence below evidences any of these, lean in. If it doesn't, do not invent specifics. Keep the language grounded in what you can actually point to.`,

  restaurant_food: `## Vertical context: restaurant / food service
Owners in this vertical commonly feel pain in three observation areas:
- team_operations — communication across shifts (FOH/BOH, AM/PM, owner/manager) breaks down at the seams
- tool_systems — POS, inventory, and scheduling tools rarely talk to each other, so the same numbers get re-entered
- data_visibility — food cost, labor percent, and prime cost are reconciled after the month closes, not steered in real time

If the intelligence below evidences any of these, lean in. If it doesn't, do not invent specifics. Keep the language grounded in what you can actually point to.`,
}

/**
 * Normalize a free-form vertical string into a recognized OutreachVertical,
 * or null if it doesn't match. Recognized values come from the canonical
 * VERTICALS list in src/portal/assessments/extraction-schema.ts.
 *
 * Verticals 'healthcare', 'technology', 'manufacturing', 'other', null,
 * undefined, and any unrecognized string all return null — meaning the
 * outreach falls back to the generic backbone with no vertical guidance
 * (per CLAUDE.md no-fabricated-content rule).
 */
export function normalizeVertical(value: string | null | undefined): OutreachVertical | null {
  if (!value) return null
  if (value in VERTICAL_GUIDANCE) {
    return value as OutreachVertical
  }
  return null
}

/**
 * Build the full system prompt with optional vertical guidance appended.
 * Exported for tests so we can assert the per-vertical content lock without
 * making real API calls.
 */
export function buildOutreachSystemPrompt(vertical: OutreachVertical | null): string {
  if (!vertical) return OUTREACH_SYSTEM_PROMPT
  return `${OUTREACH_SYSTEM_PROMPT}\n\n${VERTICAL_GUIDANCE[vertical]}`
}

export class OutreachValidationError extends Error {
  feedback: string

  constructor(message: string, feedback?: string) {
    super(message)
    this.name = 'OutreachValidationError'
    this.feedback = feedback ?? message
  }
}

const BANNED_DRAFT_PHRASES = [
  'built something solid from day one',
  'built something solid',
  'growing faster than the operation behind it',
  'holding things together',
  'running on their own by now',
  'one-page breakdown',
  'other companies their size',
  'list of tools that might help',
  'what you are building',
  'what you have built',
  'must be exhausting',
  'probably feels',
  'you are at that stage',
  'you are clearly growing',
  'you have outgrown',
  'we looked closely',
  'we spotted a pattern',
  'we noticed your job posting',
  'we can already tell',
  'we can see you are',
  'your growth phase',
  'your internal',
  'the owner is holding',
  'connect dots',
  'you are feeling',
  'you are thinking',
] as const

function parseDraft(draft: string): { subject: string; body: string } {
  const lines = draft
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => !(line === '' && index === 0 && arr.length > 1))
  const subject = lines[0]?.trim() ?? ''
  const body = lines.slice(1).join('\n').trim()
  return { subject, body }
}

function firstMechanicalViolation(draft: string): string | null {
  const { body } = parseDraft(draft)
  if (!body) return 'Draft must include a subject line and body.'
  if (draft.includes('—')) return 'Draft contains an em dash.'
  if (/\bI(?:'m|'ve|'d|'ll)?\b/.test(body)) return 'Draft uses first-person singular voice.'
  const bodyWords = body.split(/\s+/).filter(Boolean)
  if (bodyWords.length > 120) return `Draft body exceeds 120 words (${bodyWords.length}).`
  for (const phrase of BANNED_DRAFT_PHRASES) {
    if (draft.toLowerCase().includes(phrase)) {
      return `Draft contains banned phrasing: "${phrase}".`
    }
  }
  return null
}

async function classifyPatternA(
  apiKey: string,
  intelligence: string,
  draft: string
): Promise<{ violates: boolean; quote: string | null }> {
  const system = `You are a strict output validator.

Rule: Answer Y only if the draft makes any claim about the recipient's business state, history, growth phase, internal experience, or what they are feeling or thinking that is not directly supported by the supplied intelligence.

Return exactly one line:
- "N" if there is no violation.
- "Y | <quoted phrase>" if there is a violation. Quote the shortest offending phrase.`

  const user = `## Intelligence
${intelligence}

## Draft
${draft}`

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '<unreadable>')
    throw new Error(`Pattern A validator failed with ${response.status}: ${text.slice(0, 200)}`)
  }

  const result: { content?: Array<{ type: string; text?: string }> } = await response.json()
  const text = result.content?.find((block) => block.type === 'text')?.text?.trim() ?? 'N'
  if (text === 'N') return { violates: false, quote: null }
  if (text.startsWith('Y')) {
    const quote = text.split('|')[1]?.trim() ?? null
    return { violates: true, quote }
  }
  return { violates: false, quote: null }
}

export async function validateOutreachDraft(
  apiKey: string,
  intelligence: string,
  draft: string
): Promise<void> {
  const mechanicalViolation = firstMechanicalViolation(draft)
  if (mechanicalViolation) throw new OutreachValidationError(mechanicalViolation)

  const classifier = await classifyPatternA(apiKey, intelligence, draft)
  if (classifier.violates) {
    throw new OutreachValidationError(
      `Pattern A violation: ${classifier.quote ?? 'ungrounded business-state claim'}`,
      classifier.quote ?? 'Ungrounded business-state claim'
    )
  }
}

/**
 * Generate an outreach email draft from entity context.
 *
 * @param apiKey - Anthropic API key
 * @param entityName - Business name
 * @param assembledContext - Formatted context from assembleEntityContext()
 * @param vertical - Optional canonical vertical ID. When recognized, a small
 *   per-vertical guidance block is appended to the system prompt. When null,
 *   undefined, or unrecognized, the generic backbone runs unchanged.
 * @returns The generated outreach email draft
 */
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 2_000

export async function generateOutreachDraft(
  apiKey: string,
  entityName: string,
  assembledContext: string,
  vertical?: string | null
): Promise<string> {
  const systemPrompt = buildOutreachSystemPrompt(normalizeVertical(vertical))

  const userPrompt = `Write a cold outreach email for this business. Read everything below carefully before writing. The insight you lead with should come from connecting multiple data points, not just restating one fact.

Business: ${entityName}

## Intelligence gathered:

${assembledContext}`

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[outreach] Retry ${attempt}/${MAX_RETRIES} after transient failure`)
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt))
    }

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body,
      })

      if (response.status >= 500) {
        const text = await response.text().catch(() => '<unreadable>')
        lastError = new Error(`Claude API returned ${response.status}: ${text.slice(0, 200)}`)
        continue
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '<unreadable>')
        throw new Error(`Claude API returned ${response.status}: ${text.slice(0, 200)}`)
      }

      const result: { content?: Array<{ type: string; text?: string }> } = await response.json()

      const textBlock = result?.content?.find((block) => block.type === 'text')
      if (!textBlock?.text) {
        throw new Error('Claude API returned empty content for outreach draft')
      }
      const draft = textBlock.text.trim()
      await validateOutreachDraft(apiKey, assembledContext, draft)
      return draft
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Claude API returned 5')) {
        lastError = err
        continue
      }
      throw err
    }
  }

  throw lastError ?? new Error('Outreach generation failed after retries')
}
