#!/usr/bin/env node
/**
 * read-tracker.mjs -- PostToolUse hook on Read. Two jobs:
 *
 *  1. LOG: append the repo-relative suffix of every Read target to a
 *     per-session read log (.claude/read-log/<session_id>). The log is what
 *     engagement-guard.mjs consults to decide whether this session has
 *     loaded an engagement's dossier before writing into that engagement.
 *
 *  2. ADVISE (radar tier, Law 2): a Read of engagement correspondence
 *     without a prior read of that engagement's dossier.md emits an
 *     advisory to the model (exit 2 on PostToolUse surfaces stderr WITHOUT
 *     undoing the Read -- the tool already ran; nothing is blocked). This
 *     covers the analysis path: reviews that never write a file.
 *
 * Suffix matching everywhere: paths are recorded and compared by their
 * `operator/customers/...` suffix, so worktree vs primary-checkout absolute
 * paths never mismatch.
 *
 * Incident: 2026-07-26 Christa-reply session -- a client letter was
 * critiqued with the engagement posture unread. See Law 2,
 * docs/doctrine/agent-operating-doctrine.md.
 *
 * Failure posture: FAIL OPEN, silently. This is workflow hygiene in the
 * worktree-guard idiom, not a safety gate. Log-dir override for tests:
 * SS_READ_LOG_DIR.
 */

import fs from 'node:fs'
import path from 'node:path'

const CUSTOMERS_MARKER = 'operator/customers/'
const LOG_TTL_MS = 7 * 24 * 60 * 60 * 1000 // prune logs older than 7 days

function suffixOf(p) {
  const norm = p.replaceAll('\\', '/')
  const idx = norm.indexOf(CUSTOMERS_MARKER)
  return idx === -1 ? null : norm.slice(idx)
}

function slugOf(suffix) {
  const rest = suffix.slice(CUSTOMERS_MARKER.length)
  const slug = rest.split('/')[0]
  return slug && slug.length > 0 ? slug : null
}

try {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'))
  const target = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path
  if (typeof target !== 'string' || target.length === 0) process.exit(0)

  const suffix = suffixOf(target)
  if (!suffix) process.exit(0) // only engagement paths are tracked

  const sessionId = typeof payload?.session_id === 'string' && payload.session_id.length > 0
      ? payload.session_id.replaceAll(/[^A-Za-z0-9_-]/g, '')
      : 'unknown-session'

  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd()
  const logDir = process.env.SS_READ_LOG_DIR || path.join(projectDir, '.claude', 'read-log')
  fs.mkdirSync(logDir, { recursive: true })

  // Opportunistic prune: read logs are session-scoped scratch, not a record.
  const now = Date.now()
  for (const f of fs.readdirSync(logDir)) {
    try {
      const full = path.join(logDir, f)
      if (now - fs.statSync(full).mtimeMs > LOG_TTL_MS) fs.unlinkSync(full)
    } catch {
      /* prune is best-effort */
    }
  }

  const logFile = path.join(logDir, sessionId)
  const prior = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
  fs.appendFileSync(logFile, suffix + '\n')

  // Advisory: correspondence read without the engagement dossier loaded.
  const slug = slugOf(suffix)
  const isCorrespondence = slug && suffix.includes(`${CUSTOMERS_MARKER}${slug}/correspondence/`)
  if (isCorrespondence && !slug.startsWith('_')) {
    const dossierSuffix = `${CUSTOMERS_MARKER}${slug}/dossier.md`
    const dossierExistsHere = fs.existsSync(path.join(projectDir, dossierSuffix))
    if (dossierExistsHere && !prior.includes(dossierSuffix) && !suffix.endsWith('/dossier.md')) {
      process.stderr.write(
        `read-tracker (advisory, nothing blocked): you are reading ${slug} correspondence without having read ` +
          `${dossierSuffix} this session. The dossier carries the relationship map, commercial rationale, and ` +
          `canonical-document ledger this correspondence answers to. Read it before forming a view. ` +
          `See Law 2, docs/doctrine/agent-operating-doctrine.md.\n`
      )
      process.exit(2)
    }
  }

  process.exit(0)
} catch {
  process.exit(0) // fail open: a broken tracker must not degrade Reads
}
