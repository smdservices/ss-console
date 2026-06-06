/**
 * Builds the interviewer system prompt.
 *
 * The interviewer skill body (SKILL.md + references) carries ALL assessment
 * logic — coverage tracking, probe selection, teach-back, the decision to
 * finish. That logic is authored as instructions the agent self-executes, so
 * the same SKILL.md works whether this TS loop or another runtime (Hermes)
 * drives it. The harness contributes only an I/O directive and the DONE
 * sentinel convention, both explicitly marked as non-load-bearing scaffolding.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DONE_SENTINEL } from './conversation.js'
import type { InterviewerId } from './types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = join(HERE, 'fixtures', 'interviewer-skill')
const NULL_PATH = join(HERE, 'fixtures', 'null-interviewer.md')
const FLAT_PATH = join(HERE, 'fixtures', 'flat-interviewer.md')
const REFERENCES = ['coverage-model.md', 'probe-repertoire.md']

const HARNESS_DIRECTIVE = `You are conducting a live TEXT business assessment with a business owner who has just joined the call.

Output ONLY your next message to the owner — no narration, no stage directions, no meta commentary. Speak as the consultant, in first person.

Conduct the assessment according to the SKILL below. When (and only when) the skill's completion criteria are met, end your final message with a line containing exactly:
${DONE_SENTINEL}
That sentinel is how this session ends. It is harness scaffolding — never shown to the owner, never part of the assessment itself. Do not emit it until the assessment is genuinely complete.

--- SKILL ---
`

/** Concatenate the interviewer skill (or a control) into a system prompt. */
export async function loadInterviewerSystem(interviewerId: InterviewerId): Promise<string> {
  const body = await loadInterviewerBody(interviewerId)
  return HARNESS_DIRECTIVE + body
}

function loadInterviewerBody(interviewerId: InterviewerId): Promise<string> {
  switch (interviewerId) {
    case 'null':
      return readFile(NULL_PATH, 'utf8')
    case 'flat':
      return readFile(FLAT_PATH, 'utf8')
    case 'assessment-interview':
      return readSkill()
  }
}

async function readSkill(): Promise<string> {
  const skill = await readFile(join(SKILL_DIR, 'SKILL.md'), 'utf8')
  const refTexts = await Promise.all(
    REFERENCES.map(async (r) => {
      const text = await readFile(join(SKILL_DIR, 'references', r), 'utf8')
      return `\n\n--- reference: ${r} ---\n${text}`
    })
  )
  return skill + refTexts.join('')
}
