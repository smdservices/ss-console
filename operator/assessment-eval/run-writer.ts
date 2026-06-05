/**
 * Serializes a transcript to a markdown run-log under
 * operator/grading/runs/assessment-interview/.
 *
 * The run-log header states plainly that a landed transcript proves the loop
 * CLOSED, not that the interviewer is top-caliber — caliber is judged by a
 * human against rubric.md (see GRADING.md). `renderTranscriptMarkdown` is a
 * pure function (no fs, no clock) so it is unit-tested directly.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Transcript } from './types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/** operator/grading/runs/assessment-interview/ (sibling of assessment-eval/). */
export const DEFAULT_RUN_DIR = join(HERE, '..', 'grading', 'runs', 'assessment-interview')

/** Render a transcript to a human-readable markdown run-log. Pure. */
export function renderTranscriptMarkdown(transcript: Transcript): string {
  const lines: string[] = [
    `# Assessment run — ${transcript.persona_id} — ${transcript.interviewer_id}`,
    '',
    `- **Persona:** ${transcript.persona_id}`,
    `- **Interviewer:** ${transcript.interviewer_id}`,
    `- **Model:** ${transcript.model}`,
    `- **Started:** ${transcript.started_at}`,
    `- **Termination:** ${transcript.termination}`,
    `- **Premature DONE:** ${transcript.premature_done ? 'yes — flagged as a quality defect' : 'no'}`,
    `- **Turns:** ${transcript.turns.length}`,
  ]
  if (transcript.error) lines.push(`- **Error:** ${transcript.error}`)
  lines.push(
    '',
    '> A landed transcript proves the loop CLOSED — not that the interviewer is',
    '> top-caliber. Caliber is judged by a human against `rubric.md`; the',
    '> blind-subagent procedure in `GRADING.md` is the objective guardrail.',
    '',
    '## Transcript',
    ''
  )
  for (const turn of transcript.turns) {
    lines.push(`**${turn.role === 'interviewer' ? 'INTERVIEWER' : 'OWNER'}:** ${turn.text}`, '')
  }
  return lines.join('\n')
}

/** Write the run-log to disk and return its path. */
export async function writeRun(
  transcript: Transcript,
  dir: string = DEFAULT_RUN_DIR
): Promise<string> {
  await mkdir(dir, { recursive: true })
  const stamp = transcript.started_at.replace(/[:.]/g, '-')
  const file = join(dir, `${stamp}-${transcript.persona_id}-${transcript.interviewer_id}.md`)
  await writeFile(file, renderTranscriptMarkdown(transcript), 'utf8')
  return file
}
