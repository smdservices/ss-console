/**
 * Persona fixture loader.
 *
 * A persona fixture is YAML-frontmatter + a body split into two
 * sentinel-delimited blocks:
 *   <!-- PUBLIC -->  ... shown to the owner-LLM ...  <!-- END PUBLIC -->
 *   <!-- PRIVATE --> ... the grader's answer key ... <!-- END PRIVATE -->
 *
 * The hard invariant — enforced by the unit test — is that `groundTruth`
 * (PRIVATE) is returned as a separate field and is NEVER folded into the
 * owner prompt. owner.ts consumes only `publicPrompt`.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PersonaFixture } from '../types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PERSONA_DIR = join(HERE, 'personas')

const PUBLIC_OPEN = '<!-- PUBLIC -->'
const PUBLIC_CLOSE = '<!-- END PUBLIC -->'
const PRIVATE_OPEN = '<!-- PRIVATE -->'
const PRIVATE_CLOSE = '<!-- END PRIVATE -->'

/** Parse top-level scalar frontmatter (nested/list lines are ignored — not needed by the loop). */
export function parseFrontmatter(md: string): {
  frontmatter: Record<string, string>
  body: string
} {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md)
  if (!match) return { frontmatter: {}, body: md }
  const fmBlock = match[1] ?? ''
  const body = match[2] ?? ''
  const frontmatter: Record<string, string> = {}
  for (const line of fmBlock.split('\n')) {
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    const key = kv?.[1]
    const value = kv?.[2]
    if (key && value !== undefined && value.trim() !== '') frontmatter[key] = value.trim()
  }
  return { frontmatter, body }
}

/** Split the body into the PUBLIC (owner-facing) and PRIVATE (grader) blocks. Throws if either is missing. */
export function splitPublicPrivate(body: string): { publicPrompt: string; groundTruth: string } {
  const publicPrompt = between(body, PUBLIC_OPEN, PUBLIC_CLOSE)
  const groundTruth = between(body, PRIVATE_OPEN, PRIVATE_CLOSE)
  if (publicPrompt === null) throw new Error('persona fixture missing PUBLIC block')
  if (groundTruth === null) throw new Error('persona fixture missing PRIVATE block')
  return { publicPrompt: publicPrompt.trim(), groundTruth: groundTruth.trim() }
}

function between(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  if (start === -1) return null
  const from = start + open.length
  const end = text.indexOf(close, from)
  if (end === -1) return null
  return text.slice(from, end)
}

/** Load and parse a persona fixture by id (filename without extension). */
export async function loadPersona(id: string): Promise<PersonaFixture> {
  const md = await readFile(join(PERSONA_DIR, `${id}.md`), 'utf8')
  const { frontmatter, body } = parseFrontmatter(md)
  const { publicPrompt, groundTruth } = splitPublicPrivate(body)
  return { id, frontmatter, publicPrompt, groundTruth }
}
