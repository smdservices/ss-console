#!/usr/bin/env npx tsx
/**
 * Assessment-eval CLI — generate one assessment transcript.
 *
 * Runs the interviewer (real skill or the `null` negative control) against a
 * persona to a transcript, writes a run-log, and prints its path. Grading is
 * NOT done here — a human reads the run-log against rubric.md, with the
 * blind-subagent procedure in GRADING.md as the objective guardrail.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *     npx tsx operator/assessment-eval/cli.ts \
 *       --persona rambler [--interviewer real|null] [--max-turns N]
 *
 * The discrimination test (the Phase-1 deliverable) is two runs of the same
 * persona — one --interviewer real, one --interviewer null — read side by side.
 *
 * This is the only module that requires a live key. CI never runs it; the
 * network-free unit test covers the loop mechanics.
 */

import { modelFor } from '../../src/lib/llm/models.js'
import {
  buildOwnerSystem,
  loadInterviewerSystem,
  loadPersona,
  runConversation,
  writeRun,
  type InterviewerId,
} from './index.js'
import { createAnthropicClient } from './llm.js'

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>()
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === undefined || !arg.startsWith('--')) {
      i++
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next)
      i += 2
    } else {
      flags.set(key, 'true')
      i++
    }
  }
  return flags
}

function usageAndExit(reason: string): never {
  console.error(`error: ${reason}`)
  console.error(
    'Usage: npx tsx operator/assessment-eval/cli.ts --persona <id> [--interviewer real|null] [--max-turns N]'
  )
  process.exit(2)
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))

  const persona = flags.get('persona')
  if (!persona) usageAndExit('--persona is required')

  const interviewerRaw = flags.get('interviewer') ?? 'real'
  if (interviewerRaw !== 'real' && interviewerRaw !== 'null') {
    usageAndExit("--interviewer must be 'real' or 'null'")
  }
  const interviewerId: InterviewerId = interviewerRaw === 'null' ? 'null' : 'assessment-interview'

  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) usageAndExit('ANTHROPIC_API_KEY is not set')

  const maxTurnsRaw = flags.get('max-turns')
  const maxTurns = maxTurnsRaw ? Number.parseInt(maxTurnsRaw, 10) : undefined
  if (maxTurns !== undefined && (!Number.isFinite(maxTurns) || maxTurns < 1)) {
    usageAndExit('--max-turns must be a positive integer')
  }

  const model = modelFor('QUALITY', process.env)
  const llm = createAnthropicClient(apiKey, model)

  const personaFixture = await loadPersona(persona)
  const ownerSystem = buildOwnerSystem(personaFixture)
  const interviewerSystem = await loadInterviewerSystem(interviewerId)
  const startedAt = new Date().toISOString()

  console.error(`running: persona=${persona} interviewer=${interviewerId} model=${model}`)
  const transcript = await runConversation({
    llm,
    interviewerSystem,
    ownerSystem,
    personaId: persona,
    interviewerId,
    model,
    startedAt,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
  })

  const path = await writeRun(transcript)
  console.error(
    `termination=${transcript.termination} turns=${transcript.turns.length} prematureDone=${transcript.premature_done}`
  )
  console.error(`run-log: ${path}`)
  process.stdout.write(`${path}\n`)
  process.exit(transcript.termination === 'error' ? 1 : 0)
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(4)
})
