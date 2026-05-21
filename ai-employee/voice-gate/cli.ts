#!/usr/bin/env npx tsx
/**
 * Voice-gate CLI runner.
 *
 * Captain invokes this on-demand for any active customer. The CLI can
 * operate in two modes:
 *
 *   1. Synthetic — drives the bundled fixture set with pre-recorded
 *      identifications from a JSON file. Used in CI and for harness
 *      smoke tests.
 *
 *   2. Interactive — reads drafts from a customer's voice_samples R2
 *      keys (future integration), prompts judges through stdin, persists
 *      results. NOT IMPLEMENTED in this PR — the live wiring depends on
 *      the per-customer Hermes D1 binding and the voice-sample
 *      ingestion store (both open workstreams). The CLI surfaces a
 *      clear error pointing at the integration plan.
 *
 * Usage:
 *   npx tsx ai-employee/voice-gate/cli.ts \
 *     --customer-slug smith-pi-firm \
 *     [--cohort client | opposing-counsel | internal-team | all] \
 *     --panel-id panel-001 \
 *     [--cycle-count 0] \
 *     [--mode synthetic | live] \
 *     [--identifications path/to/ids.json] \
 *     [--enforce-production-minimums]
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  RECIPIENT_COHORTS,
  loadFixtureSet,
  runVoiceGate,
  type CreatePanelSessionInput,
  type JudgeIdentification,
  type RecipientCohort,
} from './index.js'

interface ParsedArgs {
  customer_slug: string
  cohort: RecipientCohort | 'all'
  panel_id: string
  cycle_count: number
  mode: 'synthetic' | 'live'
  identifications_path: string | null
  enforce_production_minimums: boolean
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>()
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === undefined) {
      i++
      continue
    }
    if (!arg.startsWith('--')) {
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

function parseCohort(raw: string): RecipientCohort | 'all' {
  if (raw === 'all') return 'all'
  if (!RECIPIENT_COHORTS.includes(raw as RecipientCohort)) {
    usageAndExit(`--cohort must be one of all | ${RECIPIENT_COHORTS.join(' | ')}, got ${raw}`)
  }
  return raw as RecipientCohort
}

function parseMode(raw: string): 'synthetic' | 'live' {
  if (raw !== 'synthetic' && raw !== 'live') {
    usageAndExit("--mode must be 'synthetic' or 'live'")
  }
  return raw
}

function parseCycleCount(raw: string): number {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) {
    usageAndExit('--cycle-count must be a non-negative integer')
  }
  return n
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = parseFlags(argv)
  const customer_slug = flags.get('customer-slug')
  if (!customer_slug) usageAndExit('--customer-slug is required')
  const panel_id = flags.get('panel-id')
  if (!panel_id) usageAndExit('--panel-id is required')
  return {
    customer_slug,
    cohort: parseCohort(flags.get('cohort') ?? 'all'),
    panel_id,
    cycle_count: parseCycleCount(flags.get('cycle-count') ?? '0'),
    mode: parseMode(flags.get('mode') ?? 'synthetic'),
    identifications_path: flags.get('identifications') ?? null,
    enforce_production_minimums: flags.get('enforce-production-minimums') === 'true',
  }
}

function usageAndExit(reason: string): never {
  console.error(`error: ${reason}`)
  console.error(
    'Usage: npx tsx ai-employee/voice-gate/cli.ts --customer-slug <slug> [--cohort <cohort>] --panel-id <id> [--cycle-count N] [--mode synthetic|live] [--identifications path] [--enforce-production-minimums]'
  )
  process.exit(2)
}

async function loadIdentifications(path: string): Promise<JudgeIdentification[]> {
  const raw = await readFile(resolve(path), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error(`${path}: must be a JSON array of identifications`)
  }
  return parsed.map((entry, idx) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${path}: identification[${idx}] must be an object`)
    }
    const obj = entry as Record<string, unknown>
    const draft_id = obj['draft_id']
    const judge_id = obj['judge_id']
    const choice = obj['choice']
    if (typeof draft_id !== 'string') {
      throw new Error(`${path}: identification[${idx}].draft_id missing`)
    }
    if (typeof judge_id !== 'string') {
      throw new Error(`${path}: identification[${idx}].judge_id missing`)
    }
    if (choice !== 'customer' && choice !== 'agent' && choice !== 'uncertain') {
      throw new Error(`${path}: identification[${idx}].choice must be customer | agent | uncertain`)
    }
    const out: JudgeIdentification = { draft_id, judge_id, choice }
    const notes = obj['notes']
    if (typeof notes === 'string') out.notes = notes
    return out
  })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.mode === 'live') {
    console.error(
      'error: --mode live is not yet implemented in this PR. Live mode requires:\n' +
        '  - per-customer Hermes D1 binding (#800)\n' +
        '  - voice-sample ingestion store (open workstream, no issue filed yet)\n' +
        '  - dashboard panel form (voice-gate-fallback.md §Implementation notes)\n' +
        '\n' +
        'Use --mode synthetic with the bundled fixture set for harness verification.'
    )
    process.exit(3)
  }

  if (!args.identifications_path) {
    usageAndExit('--identifications path is required in synthetic mode')
  }

  const fixtures = await loadFixtureSet()
  if (fixtures.customer_slug !== args.customer_slug) {
    console.error(
      `warning: bundled fixture customer_slug (${fixtures.customer_slug}) does not match --customer-slug ${args.customer_slug}; using bundled drafts unchanged.`
    )
  }

  const cohortFilteredDrafts =
    args.cohort === 'all'
      ? fixtures.drafts
      : fixtures.drafts.filter((d) => d.cohort === args.cohort)

  const identifications = await loadIdentifications(args.identifications_path)
  const panel = uniqueJudgeIds(identifications)

  const input: CreatePanelSessionInput & {
    identifications: JudgeIdentification[]
    enforceProductionMinimums: boolean
  } = {
    customer_slug: args.customer_slug,
    cohort: args.cohort,
    run_id: args.panel_id,
    drafts: cohortFilteredDrafts,
    panel,
    cycle_count: args.cycle_count,
    identifications,
    enforceProductionMinimums: args.enforce_production_minimums,
  }

  const { run, result } = runVoiceGate(input)

  // Emit structured JSON to stdout so the script is composable with the
  // future D1 writer. Captain reads the summary line on stderr.
  console.error(result.summary)
  process.stdout.write(
    JSON.stringify(
      {
        run_id: run.run_id,
        customer_slug: run.customer_slug,
        cohort: run.cohort,
        cycle_count: run.cycle_count,
        started_at: run.started_at,
        scored_at: run.scored_at,
        result,
      },
      null,
      2
    ) + '\n'
  )

  // Exit code mirrors the gate state for CI use:
  //   0 — pass (advance promotion)
  //   1 — near-pass (calibration cycle; treated as warn in CI)
  //   2 — fail (block promotion)
  if (result.state === 'pass') process.exit(0)
  if (result.state === 'near-pass') process.exit(1)
  process.exit(2)
}

function uniqueJudgeIds(ids: JudgeIdentification[]): string[] {
  return [...new Set(ids.map((i) => i.judge_id))].sort()
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`error: ${msg}`)
  process.exit(4)
})
