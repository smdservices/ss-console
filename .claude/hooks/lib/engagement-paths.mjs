/**
 * engagement-paths.mjs -- shared path resolution for the Law 2 hook pair.
 *
 * Engagement material (dossiers, correspondence, proposals, agreements) lives
 * in the PRIVATE repo `venturecrane/engagements`, not here. Only the
 * operational config (`customer.yaml`, `routine-grid.yaml`) and the
 * `_template/` provisioning scaffold remain in ss-console.
 *
 * That split creates two failure modes this module exists to prevent, both of
 * which are silent:
 *
 *   1. SPLIT READ LOG. Both hooks used to derive the log directory from the
 *      project dir. After the split a dossier READ happens in the engagements
 *      repo while the WRITE it should authorize happens in ss-console (or the
 *      reverse), so each repo consulted its own log and the guard's rules 6
 *      and 7 could never be satisfied. The gate would then block
 *      unconditionally, the escape hatch would become mandatory, and the guard
 *      would die. The log is therefore pinned to ONE absolute location shared
 *      by every repo and every worktree.
 *
 *   2. INVISIBLE DOSSIER. The guard allowed a write when no dossier existed on
 *      disk ("nothing to read yet"). Across a repo boundary that reads as
 *      "engagements repo not cloned" -> allow, which silently disables Law 2
 *      on exactly the machine that is missing the client context. Presence of
 *      the engagements repo is now the discriminator: repo present and no
 *      dossier is a genuine bootstrap; repo absent is a broken checkout and
 *      fails CLOSED.
 *
 * Overrides: SS_READ_LOG_DIR and SS_ENGAGEMENTS_DIR (both used by the tests).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CUSTOMERS_MARKER = 'operator/customers/'

/** The one read log every repo and worktree shares. */
export function readLogDir() {
  return process.env.SS_READ_LOG_DIR || path.join(os.homedir(), '.claude', 'ss-read-log')
}

/** Where escape-hatch invocations are recorded for later surfacing. */
export function hatchAuditFile() {
  return process.env.SS_HATCH_AUDIT_FILE || path.join(os.homedir(), '.claude', 'ss-hatch-audit.log')
}

/** Configured location of the private engagements repo. */
export function engagementsDir() {
  return process.env.SS_ENGAGEMENTS_DIR || path.join(os.homedir(), 'dev', 'engagements')
}

/**
 * Is the engagements repo actually checked out?
 *
 * Requires `operator/customers/` inside it, so an empty or half-made directory
 * does not read as "present" and quietly re-open the window this closes.
 */
export function engagementsRepoPresent() {
  try {
    return fs.statSync(path.join(engagementsDir(), CUSTOMERS_MARKER)).isDirectory()
  } catch {
    return false
  }
}

/** The `operator/customers/...` tail of a path, or null if it has none. */
export function suffixOf(p) {
  const norm = String(p).replaceAll('\\', '/')
  const idx = norm.indexOf(CUSTOMERS_MARKER)
  return idx === -1 ? null : norm.slice(idx)
}

/** The engagement slug a suffix belongs to, or null. */
export function slugOf(suffix) {
  const slug = suffix.slice(CUSTOMERS_MARKER.length).split('/')[0]
  return slug && slug.length > 0 ? slug : null
}

/**
 * Locate a dossier across every tree it could live in: the target's own tree
 * (worktree or primary), the project dir, and the engagements repo. Returns
 * the absolute path, or null.
 */
export function findDossier(dossierSuffix, { targetPath, projectDir } = {}) {
  const roots = []
  if (targetPath) {
    const norm = String(targetPath).replaceAll('\\', '/')
    const idx = norm.indexOf(CUSTOMERS_MARKER)
    if (idx > 0) roots.push(norm.slice(0, idx))
  }
  if (projectDir) roots.push(projectDir)
  roots.push(engagementsDir())

  for (const root of roots) {
    const candidate = path.join(root, dossierSuffix)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}
