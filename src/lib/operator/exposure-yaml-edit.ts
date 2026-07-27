/**
 * Surgical exposure-key editing on a customer.yaml TEXT (#2003 slice 2).
 *
 * A compiled tier delta has to land in `customer.yaml` as a reviewable diff.
 * A parse → mutate → stringify round-trip is not usable here: the `yaml`
 * Document API reflows the file (measured: 383 changed lines on the
 * ashton-price seat) and drops the comments that carry WHY each entitlement
 * is authored — the reviewer's whole context, and load-bearing under the
 * repo's no-fabrication rules. So this module edits the text directly and
 * produces a ONE-LINE diff per key.
 *
 * Scope is deliberately narrow: it only ever touches
 * `personas[<slug>].entitlements.exposure.<key>`. It never rewrites, reorders,
 * reindents, or re-serializes anything else, and it refuses (never guesses)
 * when the block it expects is not exactly where the schema says it is.
 */

export type ExposureEditResult =
  { ok: true; text: string; changed: boolean } | { ok: false; error: string }

interface BlockBounds {
  /** Index of the `exposure:` line itself. */
  header: number
  /** First line index INSIDE the block. */
  start: number
  /** One past the last line inside the block. */
  end: number
  /** Indent (in spaces) of the block's entries. */
  indent: number
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function isComment(line: string): boolean {
  return line.trimStart().startsWith('#')
}

/**
 * Locate the exposure block for one persona slug. Walks the personas list by
 * its `- slug:` entries so a second persona's block can never be edited by
 * accident.
 */
function personaEndIndex(
  lines: readonly string[],
  personaIdx: number,
  personaIndent: number
): number {
  for (let i = personaIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (isBlank(line) || isComment(line)) continue
    const ind = indentOf(line)
    if (ind < personaIndent) return i
    if (ind <= personaIndent && /^\s*-\s/.test(line)) return i
  }
  return lines.length
}

function findExposureBlock(lines: readonly string[], personaSlug: string): BlockBounds | string {
  const personaIdx = lines.findIndex(
    (l) => /^\s*-\s+slug:\s*/.test(l) && l.split(':').slice(1).join(':').trim() === personaSlug
  )
  if (personaIdx < 0) return `persona "${personaSlug}" not found in customer.yaml`
  const personaIndent = indentOf(lines[personaIdx])
  const personaEnd = personaEndIndex(lines, personaIdx, personaIndent)

  let header = -1
  for (let i = personaIdx + 1; i < personaEnd; i++) {
    if (/^\s*exposure:\s*$/.test(lines[i])) {
      header = i
      break
    }
  }
  if (header < 0) return `persona "${personaSlug}" has no entitlements.exposure block`

  const headerIndent = indentOf(lines[header])
  const start = header + 1
  let end = start
  let indent = -1
  for (let i = start; i < personaEnd; i++) {
    const line = lines[i]
    if (isBlank(line)) {
      end = i + 1
      continue
    }
    const ind = indentOf(line)
    if (ind <= headerIndent) break
    if (!isComment(line) && indent < 0) indent = ind
    end = i + 1
  }
  if (indent < 0) return `persona "${personaSlug}" exposure block is empty`

  // Trim trailing blank/comment lines back out of the block so an inserted key
  // lands after the last real entry, not after a trailing comment that belongs
  // to the NEXT block.
  while (end > start && (isBlank(lines[end - 1]) || isComment(lines[end - 1]))) end--

  return { header, start, end, indent }
}

/**
 * Set, change, or remove one exposure key.
 *
 * `value === null` REMOVES the key — the fail-closed posture (ADR 0035:
 * unauthored is refused; there is no "off" value to write). Removing a key
 * that is not present, or setting a key to the value it already holds, is a
 * no-op with `changed: false`, never an error.
 *
 * Any authored comment lines attached to the key are left in place: a removal
 * takes only the `key: value` line. A reviewer therefore sees the comment
 * explaining an entitlement that is no longer authored, which is the correct
 * prompt to update or delete it in the same PR.
 */
export function setExposureKey(
  yamlText: string,
  personaSlug: string,
  key: string,
  value: string | null
): ExposureEditResult {
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    return { ok: false, error: `refusing to edit unsafe exposure key "${key}"` }
  }
  if (value !== null && !/^[a-z_]+$/.test(value)) {
    return { ok: false, error: `refusing to write unsafe exposure value "${value}"` }
  }

  const lines = yamlText.split('\n')
  const bounds = findExposureBlock(lines, personaSlug)
  if (typeof bounds === 'string') return { ok: false, error: bounds }

  const keyRe = new RegExp(`^\\s*${key}:\\s`)
  let keyIdx = -1
  for (let i = bounds.start; i < bounds.end; i++) {
    if (!isComment(lines[i]) && keyRe.test(lines[i])) {
      keyIdx = i
      break
    }
  }

  if (value === null) {
    if (keyIdx < 0) return { ok: true, text: yamlText, changed: false }
    const next = [...lines.slice(0, keyIdx), ...lines.slice(keyIdx + 1)]
    return { ok: true, text: next.join('\n'), changed: true }
  }

  const pad = ' '.repeat(bounds.indent)
  if (keyIdx >= 0) {
    const current = lines[keyIdx].split(':').slice(1).join(':').trim()
    if (current === value) return { ok: true, text: yamlText, changed: false }
    const next = [...lines]
    next[keyIdx] = `${pad}${key}: ${value}`
    return { ok: true, text: next.join('\n'), changed: true }
  }

  const next = [...lines.slice(0, bounds.end), `${pad}${key}: ${value}`, ...lines.slice(bounds.end)]
  return { ok: true, text: next.join('\n'), changed: true }
}
