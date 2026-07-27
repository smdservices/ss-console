#!/usr/bin/env node
/**
 * engagement-guard.mjs -- PreToolUse hook on Edit|Write|NotebookEdit.
 *
 * THE RULE (Law 2, docs/doctrine/agent-operating-doctrine.md): a session
 * does not mutate files under operator/customers/<slug>/ until it has read
 * that engagement's dossier.md. The dossier carries the relationship map,
 * commercial rationale, and canonical-document ledger; editing engagement
 * artifacts without it is how the 2026-07-26 Christa-reply incident
 * happened (an approved client draft edited, two commercial terms invented,
 * by an agent that had not loaded the engagement posture).
 *
 * Decision chain:
 *   1. SS_ALLOW_UNREAD_ENGAGEMENT_WRITES=1  -> allow (Captain escape hatch)
 *   2. target not under operator/customers/ -> allow (out of scope)
 *   3. slug starts with '_' (template)      -> allow
 *   4. target IS the slug's dossier.md      -> allow (authoring the dossier
 *      must not require having read it; that would block bootstrap)
 *   5. slug has no dossier.md on disk       -> allow (nothing to read yet;
 *      tests/doctrine-integrity.test.ts forces dossiers for engagements
 *      with correspondence, so this window closes structurally)
 *   6. dossier suffix in this session's read log -> allow
 *   7. dossier suffix in ANY read log fresher than SUBAGENT_WINDOW_MS
 *      -> allow (subagents can carry a different session_id than the parent
 *      that did the reading; hygiene posture accepts the looseness)
 *   8. otherwise -> exit 2, remedy on stderr naming the exact file.
 *
 * Matching is by `operator/customers/...` SUFFIX, never absolute path, so
 * worktree and primary-checkout paths compare equal (the same dossier read
 * in a worktree satisfies the guard for a primary-path payload and vice
 * versa). Read logs are written by read-tracker.mjs.
 *
 * Failure posture: FAIL OPEN (workflow hygiene, not a safety gate -- the
 * worktree-guard idiom; a broken guard must not brick engagement work).
 * Bash writes are not intercepted; that gap is prose-covered in CLAUDE.md,
 * same as the worktree rule. Log-dir override for tests: SS_READ_LOG_DIR.
 */

import fs from 'node:fs'
import path from 'node:path'

const CUSTOMERS_MARKER = 'operator/customers/'
const SUBAGENT_WINDOW_MS = 8 * 60 * 60 * 1000 // 8h: covers a long session's subagents

function suffixOf(p) {
  const norm = p.replaceAll('\\', '/')
  const idx = norm.indexOf(CUSTOMERS_MARKER)
  return idx === -1 ? null : norm.slice(idx)
}

try {
  if (process.env.SS_ALLOW_UNREAD_ENGAGEMENT_WRITES === '1') process.exit(0)

  const payload = JSON.parse(fs.readFileSync(0, 'utf8'))
  const target = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path
  if (typeof target !== 'string' || target.length === 0) process.exit(0)

  const suffix = suffixOf(target)
  if (!suffix) process.exit(0)

  const slug = suffix.slice(CUSTOMERS_MARKER.length).split('/')[0]
  if (!slug || slug.startsWith('_')) process.exit(0)

  const dossierSuffix = `${CUSTOMERS_MARKER}${slug}/dossier.md`
  if (suffix === dossierSuffix) process.exit(0)

  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd()
  // Resolve the dossier's existence against the tree the TARGET lives in
  // (worktree or primary), falling back to the project dir.
  const targetRootIdx = target.replaceAll('\\', '/').indexOf(CUSTOMERS_MARKER)
  const targetRoot = targetRootIdx > 0 ? target.slice(0, targetRootIdx) : projectDir + '/'
  const dossierOnDisk =
    fs.existsSync(path.join(targetRoot, dossierSuffix)) ||
    fs.existsSync(path.join(projectDir, dossierSuffix))
  if (!dossierOnDisk) process.exit(0)

  const logDir = process.env.SS_READ_LOG_DIR || path.join(projectDir, '.claude', 'read-log')
  const sessionId = typeof payload?.session_id === 'string' && payload.session_id.length > 0
      ? payload.session_id.replaceAll(/[^A-Za-z0-9_-]/g, '')
      : 'unknown-session'

  if (fs.existsSync(logDir)) {
    const own = path.join(logDir, sessionId)
    if (fs.existsSync(own) && fs.readFileSync(own, 'utf8').includes(dossierSuffix)) {
      process.exit(0)
    }
    // Subagent fallback: any sufficiently fresh log that saw the dossier.
    const now = Date.now()
    for (const f of fs.readdirSync(logDir)) {
      try {
        const full = path.join(logDir, f)
        if (now - fs.statSync(full).mtimeMs > SUBAGENT_WINDOW_MS) continue
        if (fs.readFileSync(full, 'utf8').includes(dossierSuffix)) process.exit(0)
      } catch {
        /* per-file read errors don't decide anything */
      }
    }
  }

  process.stderr.write(
    `engagement-guard: "${suffix}" is engagement material for "${slug}", and this session has not read ` +
      `${dossierSuffix}. Read the dossier first (relationship map, commercial rationale, canonical-document ` +
      `ledger), then retry the edit. See Law 2, docs/doctrine/agent-operating-doctrine.md. ` +
      `(Captain-only escape hatch: SS_ALLOW_UNREAD_ENGAGEMENT_WRITES=1.)\n`
  )
  process.exit(2)
} catch {
  process.exit(0) // fail open: hygiene, not safety
}
