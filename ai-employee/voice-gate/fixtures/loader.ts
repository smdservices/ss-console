/**
 * Fixture loader. Reads the synthetic blind-test set bundled with the
 * harness and returns typed `BlindTestDraft` items.
 *
 * Real customer runs do NOT use this loader — they read drafts from the
 * per-customer voice_samples table per d1-schema.md §8. This loader
 * exists for tests + CLI smoke tests where no live customer database is
 * available.
 *
 * The fixtures are deliberately small (3 cohorts × 3 drafts = 9 total)
 * because their job is to drive harness scaffolding tests. Production
 * minimums (≥10 per authorship, ≥3 judges) are enforced separately by
 * the panel layer when `enforceProductionMinimums: true`.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { RECIPIENT_COHORTS } from '../scoring.js'
import type { BlindTestDraft, RecipientCohort } from '../types.js'

export interface FixtureSet {
  customer_slug: string
  drafts: BlindTestDraft[]
}

/**
 * Set of valid authorship labels. Sorted alphabetically (matches the
 * `DraftAuthorship` union) so the validator can reuse the array for
 * `.includes()` membership.
 */
const VALID_AUTHORSHIPS = ['agent', 'customer'] as const

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DEFAULT_FIXTURE_PATH = resolve(__dirname, './synthetic-set.json')

/**
 * Load and validate the bundled synthetic fixture set. Throws if the
 * JSON is malformed or any draft is missing required fields. The
 * validator's strictness is intentional — fixture rot is a fast way to
 * mask harness bugs.
 */
export async function loadFixtureSet(pathOverride?: string): Promise<FixtureSet> {
  const target = pathOverride ?? DEFAULT_FIXTURE_PATH
  const raw = await readFile(target, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`fixture file ${target}: top-level value must be an object`)
  }
  const obj = parsed as Record<string, unknown>
  const customer_slug = obj['customer_slug']
  if (typeof customer_slug !== 'string' || customer_slug.length === 0) {
    throw new Error(`fixture file ${target}: customer_slug missing`)
  }
  const draftsRaw = obj['drafts']
  if (!Array.isArray(draftsRaw)) {
    throw new Error(`fixture file ${target}: drafts must be an array`)
  }
  const drafts: BlindTestDraft[] = draftsRaw.map((d, i) => parseDraft(d, i, target))
  return { customer_slug, drafts }
}

function parseDraft(raw: unknown, index: number, source: string): BlindTestDraft {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${source}: draft[${index}] must be an object, got ${typeof raw}`)
  }
  const obj = raw as Record<string, unknown>
  const id = parseStringField(obj['id'], `${source}: draft[${index}].id`)
  const cohort = parseCohortField(obj['cohort'], `${source}: draft[${index}].cohort`)
  const authorship = parseAuthorshipField(
    obj['authorship'],
    `${source}: draft[${index}].authorship`
  )
  const body = parseBodyField(obj['body'], `${source}: draft[${index}].body`)
  const out: BlindTestDraft = { id, cohort, authorship, body }
  const metadata = parseMetadataField(obj['metadata'], `${source}: draft[${index}].metadata`)
  if (metadata !== undefined) out.metadata = metadata
  return out
}

function parseStringField(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`${label} missing or not a string`)
  }
  return raw
}

function parseCohortField(raw: unknown, label: string): RecipientCohort {
  if (typeof raw !== 'string' || !RECIPIENT_COHORTS.includes(raw as RecipientCohort)) {
    throw new Error(`${label} must be one of ${RECIPIENT_COHORTS.join(' | ')}, got ${String(raw)}`)
  }
  return raw as RecipientCohort
}

function parseAuthorshipField(raw: unknown, label: string): 'customer' | 'agent' {
  if (typeof raw !== 'string' || !(VALID_AUTHORSHIPS as readonly string[]).includes(raw)) {
    throw new Error(`${label} must be 'customer' | 'agent', got ${String(raw)}`)
  }
  return raw as 'customer' | 'agent'
}

function parseBodyField(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`${label} missing or empty`)
  }
  return raw
}

function parseMetadataField(
  raw: unknown,
  label: string
): NonNullable<BlindTestDraft['metadata']> | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${label} must be an object`)
  }
  const meta = raw as Record<string, unknown>
  const cleanMeta: NonNullable<BlindTestDraft['metadata']> = {}
  if (meta['subject'] !== undefined) {
    if (typeof meta['subject'] !== 'string') {
      throw new Error(`${label}.subject must be a string`)
    }
    cleanMeta.subject = meta['subject']
  }
  if (meta['scenario'] !== undefined) {
    if (typeof meta['scenario'] !== 'string') {
      throw new Error(`${label}.scenario must be a string`)
    }
    cleanMeta.scenario = meta['scenario']
  }
  if (meta['includeInPresentation'] !== undefined) {
    if (typeof meta['includeInPresentation'] !== 'boolean') {
      throw new Error(`${label}.includeInPresentation must be a boolean`)
    }
    cleanMeta.includeInPresentation = meta['includeInPresentation']
  }
  return cleanMeta
}
