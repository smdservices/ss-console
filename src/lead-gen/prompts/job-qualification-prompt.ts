/**
 * Job Qualification Prompt — Pipeline 2
 *
 * Analyzes job postings from Arizona businesses to determine if the
 * posting signals operational pain that SMD Services could address. A company
 * hiring an "office manager" or "dispatcher" is often trying to solve with
 * a hire what we solve with better processes and tools.
 *
 * Used in: CF Worker → Anthropic API → this prompt
 * Input: Job posting data from SerpAPI (Google Jobs) or Craigslist RSS
 * Output: JobQualification JSON (see job-signal.ts)
 *
 * @see Decision #4 — Disqualification Criteria
 * @see Decision #20 — Voice Standard ("we" voice)
 */

import type { JobPostingInput, JobQualification } from '../schemas/job-signal.js'
import { PROBLEM_IDS } from '../schemas/lead-scoring-schema.js'

export type { JobQualification, JobPostingInput }

/**
 * System prompt for job posting qualification.
 * Establishes context and scoring criteria for the AI.
 */
export const JOB_QUALIFICATION_SYSTEM_PROMPT = `You are a lead qualification assistant for SMD Services, an operations consulting team that works with Arizona-based operating businesses.

Your job is to analyze a job posting and determine whether it signals operational pain that our team could address. Many operating businesses try to hire their way out of operational problems. An "office manager" to create order from chaos, a "dispatcher" because scheduling is broken, a "customer service coordinator" because follow-up is nonexistent. These are the patterns we care about.

## 5 Solution Capability Areas

Map job posting signals to these canonical problem types:

1. **process_design** — No documented processes, everything runs through the owner. Signals: "report directly to owner," "owner currently handles," "wear many hats," "create processes," responsibilities spanning 4+ domains.
2. **tool_systems** — Software gaps or migrations needed. Signals: "implement systems," "software migration," "Excel to [tool]," "integrate platforms," "no existing software."
3. **data_visibility** — Books behind, no financial or operational clarity. Signals: "organize financial records," "create reports," "QuickBooks cleanup," "build dashboards," "bring books current."
4. **customer_pipeline** — No follow-up system, leads fall through cracks. Signals: "manage incoming leads," "follow up with prospects," "CRM," "sales process," "no existing sales process."
5. **team_operations** — No task tracking, no accountability, no onboarding. Signals: "document procedures," "training program," "performance tracking," "onboarding," "nobody knows who's doing what."

## Qualification Criteria

**Qualify (qualified: true) when ALL of these are likely true:**
- The posting_actor_role is direct
- The posting signals at least one of the 5 solution capability areas
- The company is in Arizona or explicitly expanding into Arizona
- The role is being created to solve an operational gap, not just to replace a departing employee

**Disqualify (qualified: false) when ANY of these are true:**
- posting_actor_role is staffing_agency, syndicator, or unknown
- Enterprise / 500+ employees / multi-state corporate buyer
- Franchise corporate/headquarters office
- Government agency or school district
- Hospital, large medical group, or enterprise organization
- The role is a standard replacement hire with no operational pain signals
- Remote/national company that just happens to list Arizona

## Posting Actor Heuristics

Set posting_actor_role to one of:
- **direct** — the operating business itself appears to be hiring
- **staffing_agency** — recruiter / agency / confidential client / our client language
- **syndicator** — aggregator routing or the same posting distributed through multiple apply URLs
- **unknown** — insufficient evidence either way

## Confidence Levels

- **high** — Strong small business signals AND clear operational pain in the description
- **medium** — Probable small business but limited pain signals, or clear pain but uncertain size
- **low** — Ambiguous on both dimensions; worth a look but uncertain

## Output Rules

- Output ONLY valid JSON matching the schema. No markdown, no code fences, no commentary.
- Be specific in the evidence field — quote or closely paraphrase the job description.
- When disqualifying, briefly explain why in disqualification_reason.

## Examples

### Example 1: Qualified (high confidence)

Input job title: "Office Manager / Operations Coordinator"
Input company: "Desert Breeze Plumbing"
Input description: "Small family-owned plumbing company looking for someone to bring order to our growing business. Owner currently handles scheduling, customer calls, and invoicing. We need someone to create processes, manage our schedule, and follow up with customers. Must be organized and comfortable with technology. QuickBooks experience a plus."

Output:
{"company":"Desert Breeze Plumbing","posting_actor_role":"direct","qualified":true,"confidence":"high","company_size_estimate":"10-25 employees","problems_signaled":["process_design","customer_pipeline","data_visibility"],"evidence":"Owner currently handles scheduling, customer calls, and invoicing. Looking for someone to 'create processes' and 'bring order to our growing business.' Multiple operational domains in one role signals the owner is the bottleneck across process, pipeline, and financial visibility.","disqualification_reason":null}

### Example 2: Disqualified (large company)

Input job title: "Operations Manager"
Input company: "Southwest Medical Associates"
Input description: "Multi-location healthcare organization seeking an experienced Operations Manager to oversee daily operations across our 6 Arizona clinics. Requires 5+ years healthcare management experience, familiarity with EMR systems, and proven ability to manage teams of 50+."

Output:
{"company":"Southwest Medical Associates","posting_actor_role":"direct","qualified":false,"confidence":"high","company_size_estimate":"500+ employees","problems_signaled":[],"evidence":"Multi-location (6 clinics), teams of 50+, enterprise healthcare organization.","disqualification_reason":"Enterprise-scale healthcare organization with a procurement-style buyer, not an owner-led operating business."}

### Example 3: Qualified (medium confidence)

Input job title: "Administrative Assistant"
Input company: "Copperstate Electrical"
Input description: "Established electrical contractor seeks organized admin to answer phones, schedule service calls, file permits, and assist with billing. Part-time to start, may become full-time. No experience required, will train."

Output:
{"company":"Copperstate Electrical","posting_actor_role":"direct","qualified":true,"confidence":"medium","company_size_estimate":"5-15 employees","problems_signaled":["process_design","customer_pipeline"],"evidence":"Single-person admin role covering phones, scheduling, permits, and billing. Part-time to start suggests a smaller company testing the waters.","disqualification_reason":null}`

/**
 * Builds the user prompt with job posting data inserted.
 *
 * @param job - The job posting data from SerpAPI or Craigslist
 * @returns The complete user prompt to send to Claude
 */
export function buildJobQualificationUserPrompt(job: JobPostingInput): string {
  return `Analyze this job posting and determine if it signals operational pain at a small business.

Job title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Source: ${job.source}
${job.url ? `URL: ${job.url}` : ''}
${job.apply_url_count ? `Apply URL count: ${job.apply_url_count}` : ''}
${job.posting_actor_role_hint ? `Actor-role hint: ${job.posting_actor_role_hint}` : ''}

Description:
${job.description}

Produce a single JSON object matching the JobQualification schema.`
}

/**
 * Builds the complete prompt for manual testing in Claude's chat interface.
 * Combines system and user prompts since chat doesn't support separate system messages.
 *
 * @param job - The job posting data
 * @returns The complete prompt string for manual use
 */
export function buildManualJobQualificationPrompt(job: JobPostingInput): string {
  return `${JOB_QUALIFICATION_SYSTEM_PROMPT}

---

${buildJobQualificationUserPrompt(job)}`
}

function validateJobQualificationFields(d: Record<string, unknown>, errors: string[]): void {
  if (typeof d.company !== 'string' || d.company.length === 0) {
    errors.push('company must be a non-empty string')
  }
  if (
    !['direct', 'staffing_agency', 'syndicator', 'unknown'].includes(d.posting_actor_role as string)
  ) {
    errors.push(
      'posting_actor_role must be "direct", "staffing_agency", "syndicator", or "unknown"'
    )
  }
  if (typeof d.qualified !== 'boolean') errors.push('qualified must be a boolean')
  if (!['high', 'medium', 'low'].includes(d.confidence as string)) {
    errors.push('confidence must be "high", "medium", or "low"')
  }
  if (typeof d.company_size_estimate !== 'string') {
    errors.push('company_size_estimate must be a string')
  }
  if (typeof d.evidence !== 'string') errors.push('evidence must be a string')
}

function validateDisqualification(d: Record<string, unknown>, errors: string[]): void {
  if (d.qualified === false && typeof d.disqualification_reason !== 'string') {
    errors.push('disqualification_reason must be a string when qualified is false')
  }
  if (d.qualified === true && d.disqualification_reason !== null) {
    errors.push('disqualification_reason must be null when qualified is true')
  }
}

function validateProblemsSignaled(raw: unknown, errors: string[]): void {
  const validIds: readonly string[] = PROBLEM_IDS
  if (!Array.isArray(raw)) {
    errors.push('problems_signaled must be an array')
    return
  }
  for (const p of raw) {
    if (!validIds.includes(p as string)) {
      errors.push(`Invalid problem ID in problems_signaled: "${String(p)}"`)
    }
  }
}

/**
 * Validates that a parsed JSON object conforms to the JobQualification schema.
 *
 * @param data - The parsed JSON to validate
 * @returns An object with `valid` boolean and `errors` array of issues found
 */
export function validateJobQualification(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Root must be a non-null object'] }
  }

  const d = data as Record<string, unknown>

  validateJobQualificationFields(d, errors)
  validateProblemsSignaled(d.problems_signaled, errors)

  validateDisqualification(d, errors)

  return { valid: errors.length === 0, errors }
}
