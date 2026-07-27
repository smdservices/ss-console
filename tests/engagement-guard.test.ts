/**
 * Guard tests for the Law 2 hook pair:
 *
 *   .claude/hooks/engagement-guard.mjs  (PreToolUse: block engagement writes
 *                                        until the engagement dossier is read)
 *   .claude/hooks/read-tracker.mjs      (PostToolUse on Read: log engagement
 *                                        reads; advise on correspondence reads
 *                                        without the dossier)
 *
 * Exercised the way Claude Code runs them: node subprocess, hook payload on
 * stdin, exit code asserted (worktree-guard.test.ts idiom). Everything runs
 * against a scratch tree + scratch read-log dir (SS_READ_LOG_DIR), so the
 * suite touches no real session state and passes identically in CI, the
 * primary checkout, and any worktree.
 *
 * The worktree/subagent cases the design review demanded are here:
 *  - suffix matching: a dossier read via a DIFFERENT absolute prefix (another
 *    worktree) satisfies the guard for this tree's payload
 *  - subagent fallback: a fresh read log under a different session id counts;
 *    a stale one does not
 *
 * Incident: 2026-07-26 Christa-reply session. @see Law 2,
 * docs/doctrine/agent-operating-doctrine.md.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const guard = path.join(process.cwd(), '.claude', 'hooks', 'engagement-guard.mjs')
const tracker = path.join(process.cwd(), '.claude', 'hooks', 'read-tracker.mjs')

const SLUG = 'test-firm'
const SESSION = 'sess-test-123'

let root: string // fake repo tree
let altRoot: string // a second "worktree" of the same repo
let engagementsRoot: string // stand-in for the private venturecrane/engagements clone
let logDir: string
let hatchAudit: string

function seedTree(base: string): void {
  mkdirSync(path.join(base, 'operator', 'customers', SLUG, 'correspondence'), { recursive: true })
  writeFileSync(path.join(base, 'operator', 'customers', SLUG, 'dossier.md'), '# dossier\n')
  writeFileSync(
    path.join(base, 'operator', 'customers', SLUG, 'correspondence', '01_letter.md'),
    'letter\n'
  )
  mkdirSync(path.join(base, 'operator', 'customers', '_template'), { recursive: true })
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'eg-root-'))
  altRoot = mkdtempSync(path.join(os.tmpdir(), 'eg-alt-'))
  engagementsRoot = mkdtempSync(path.join(os.tmpdir(), 'eg-engagements-'))
  logDir = mkdtempSync(path.join(os.tmpdir(), 'eg-log-'))
  hatchAudit = path.join(mkdtempSync(path.join(os.tmpdir(), 'eg-audit-')), 'hatch.log')
  seedTree(root)
  seedTree(altRoot)
  // The engagements clone holds the material but is NOT a checkout of this
  // repo: it carries the engagement tree only.
  mkdirSync(path.join(engagementsRoot, 'operator', 'customers'), { recursive: true })
})

/** A path that does not exist, standing in for "engagements repo not cloned". */
const MISSING_ENGAGEMENTS = path.join(os.tmpdir(), 'eg-nonexistent-engagements-dir')

function payload(target: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: SESSION,
    cwd: root,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: target },
    ...overrides,
  })
}

/**
 * SS_ENGAGEMENTS_DIR and SS_HATCH_AUDIT_FILE are pinned to scratch on EVERY
 * run. Without that the hooks would fall back to `~/dev/engagements` and
 * `~/.claude/`, so results would depend on whether the developer happens to
 * have the private repo cloned -- passing locally and failing in CI, or worse,
 * the reverse.
 */
function hookEnv(extraEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    CLAUDE_PROJECT_DIR: root,
    SS_READ_LOG_DIR: logDir,
    SS_ENGAGEMENTS_DIR: engagementsRoot,
    SS_HATCH_AUDIT_FILE: hatchAudit,
    SS_ALLOW_UNREAD_ENGAGEMENT_WRITES: '',
    ...extraEnv,
  }
}

function run(script: string, input: string, extraEnv: Record<string, string> = {}): number {
  try {
    execFileSync('node', [script], {
      input,
      env: hookEnv(extraEnv),
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    return 0
  } catch (err) {
    return (err as { status?: number }).status ?? -1
  }
}

function stderrOf(script: string, input: string, extraEnv: Record<string, string> = {}): string {
  try {
    execFileSync('node', [script], {
      input,
      env: hookEnv(extraEnv),
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    return ''
  } catch (err) {
    return String((err as { stderr?: Buffer }).stderr ?? '')
  }
}

function logRead(sessionId: string, suffix: string, ageMs = 0): void {
  const file = path.join(logDir, sessionId)
  writeFileSync(file, suffix + '\n', { flag: 'a' })
  if (ageMs > 0) {
    const t = (Date.now() - ageMs) / 1000
    utimesSync(file, t, t)
  }
}

const engagementFile = () =>
  path.join(root, 'operator', 'customers', SLUG, 'correspondence', '01_letter.md')
const dossierSuffix = `operator/customers/${SLUG}/dossier.md`

describe('engagement-guard: blocks unread-engagement writes', () => {
  it('blocks an engagement write when the dossier was never read, and names the file', () => {
    expect(run(guard, payload(engagementFile()))).toBe(2)
    expect(stderrOf(guard, payload(engagementFile()))).toContain(dossierSuffix)
  })

  it('allows the write after this session read the dossier', () => {
    logRead(SESSION, dossierSuffix)
    expect(run(guard, payload(engagementFile()))).toBe(0)
  })

  it('suffix matching: a dossier read under a different absolute prefix (another worktree) counts', () => {
    logRead(SESSION, dossierSuffix) // tracker always records the suffix, whatever tree it read from
    const altTarget = path.join(
      altRoot,
      'operator',
      'customers',
      SLUG,
      'correspondence',
      '01_letter.md'
    )
    expect(run(guard, payload(altTarget))).toBe(0)
  })

  it('subagent fallback: a FRESH read log under a different session id counts', () => {
    logRead('some-other-session', dossierSuffix)
    expect(run(guard, payload(engagementFile()))).toBe(0)
  })

  it('subagent fallback: a STALE read log under a different session id does not count', () => {
    logRead('some-other-session', dossierSuffix, 9 * 60 * 60 * 1000)
    expect(run(guard, payload(engagementFile()))).toBe(2)
  })

  it('allows authoring the dossier itself without a prior read (bootstrap)', () => {
    const dossier = path.join(root, 'operator', 'customers', SLUG, 'dossier.md')
    expect(run(guard, payload(dossier))).toBe(0)
  })

  it('allows writes when no dossier exists yet AND the engagements repo is present (bootstrap)', () => {
    rmSync(path.join(root, 'operator', 'customers', SLUG, 'dossier.md'))
    rmSync(path.join(altRoot, 'operator', 'customers', SLUG, 'dossier.md'))
    expect(run(guard, payload(engagementFile()))).toBe(0)
  })

  // The fail-closed rewire. Before the split, "no dossier on disk" meant "this
  // engagement has not been written up yet" and allowing was right. Across a
  // repo boundary the same condition also means "the repo holding every
  // dossier is not on this machine", where allowing silently disables Law 2
  // exactly where the client context is missing. Presence of the engagements
  // checkout is what tells those two apart.
  it('BLOCKS when no dossier exists and the engagements repo is ABSENT (fail-closed)', () => {
    rmSync(path.join(root, 'operator', 'customers', SLUG, 'dossier.md'))
    rmSync(path.join(altRoot, 'operator', 'customers', SLUG, 'dossier.md'))
    expect(run(guard, payload(engagementFile()), { SS_ENGAGEMENTS_DIR: MISSING_ENGAGEMENTS })).toBe(
      2
    )
  })

  it('the absent-repo block prints the exact clone command', () => {
    rmSync(path.join(root, 'operator', 'customers', SLUG, 'dossier.md'))
    rmSync(path.join(altRoot, 'operator', 'customers', SLUG, 'dossier.md'))
    const err = stderrOf(guard, payload(engagementFile()), {
      SS_ENGAGEMENTS_DIR: MISSING_ENGAGEMENTS,
    })
    expect(err).toContain('git clone https://github.com/venturecrane/engagements.git')
    expect(err).toContain(MISSING_ENGAGEMENTS)
  })

  // The read log is pinned to one absolute location precisely so this works.
  it('cross-repo: a dossier that lives ONLY in the engagements repo is found and gates the write', () => {
    rmSync(path.join(root, 'operator', 'customers', SLUG, 'dossier.md'))
    rmSync(path.join(altRoot, 'operator', 'customers', SLUG, 'dossier.md'))
    mkdirSync(path.join(engagementsRoot, 'operator', 'customers', SLUG), { recursive: true })
    writeFileSync(path.join(engagementsRoot, 'operator', 'customers', SLUG, 'dossier.md'), '# d\n')

    // Dossier exists (in the other repo) but was never read -> blocked.
    expect(run(guard, payload(engagementFile()))).toBe(2)

    // Reading it there satisfies a write here.
    logRead(SESSION, dossierSuffix)
    expect(run(guard, payload(engagementFile()))).toBe(0)
  })

  it('cross-repo: a read in the engagements repo unlocks a write in ss-console', () => {
    mkdirSync(path.join(engagementsRoot, 'operator', 'customers', SLUG), { recursive: true })
    const remoteDossier = path.join(engagementsRoot, 'operator', 'customers', SLUG, 'dossier.md')
    writeFileSync(remoteDossier, '# d\n')

    // Read happens in repo A (engagements), tracked by the shared log...
    expect(
      run(tracker, payload(remoteDossier, { hook_event_name: 'PostToolUse', tool_name: 'Read' }))
    ).toBe(0)
    // ...and authorizes the write in repo B (ss-console).
    expect(run(guard, payload(engagementFile()))).toBe(0)
  })

  it('ignores template slugs and non-engagement paths', () => {
    const template = path.join(root, 'operator', 'customers', '_template', 'dossier.md')
    expect(run(guard, payload(template))).toBe(0)
    expect(run(guard, payload(path.join(root, 'src', 'anything.ts')))).toBe(0)
  })

  // The hatch was a global off-switch: one `=1` export disabled Law 2 for
  // every engagement, indefinitely, with no trace. It is now path-scoped and
  // audited, so an exemption covers the file the Captain meant and a
  // permanently-exported hatch is visible instead of quiet.
  it('escape hatch: =1 is REJECTED and says how to scope it', () => {
    expect(run(guard, payload(engagementFile()), { SS_ALLOW_UNREAD_ENGAGEMENT_WRITES: '1' })).toBe(
      2
    )
    expect(
      stderrOf(guard, payload(engagementFile()), { SS_ALLOW_UNREAD_ENGAGEMENT_WRITES: '1' })
    ).toContain('no longer accepted')
  })

  it('escape hatch: a path-scoped value allows the file it names', () => {
    expect(
      run(guard, payload(engagementFile()), {
        SS_ALLOW_UNREAD_ENGAGEMENT_WRITES: `${SLUG}/correspondence/01_letter.md`,
      })
    ).toBe(0)
  })

  it('escape hatch: a path-scoped value does NOT allow other files', () => {
    const other = path.join(root, 'operator', 'customers', SLUG, 'SCOPING.md')
    writeFileSync(other, 'scope\n')
    expect(
      run(guard, payload(other), {
        SS_ALLOW_UNREAD_ENGAGEMENT_WRITES: `${SLUG}/correspondence/01_letter.md`,
      })
    ).toBe(2)
  })

  it('escape hatch: every use is written to the audit file', () => {
    run(guard, payload(engagementFile()), {
      SS_ALLOW_UNREAD_ENGAGEMENT_WRITES: `${SLUG}/correspondence/01_letter.md`,
    })
    const audit = readFileSync(hatchAudit, 'utf-8')
    expect(audit).toContain(SESSION)
    expect(audit).toContain(`operator/customers/${SLUG}/correspondence/01_letter.md`)
  })

  it('fails open on malformed stdin', () => {
    expect(run(guard, 'not json')).toBe(0)
  })
})

describe('read-tracker: logs engagement reads, advises on unbriefed correspondence reads', () => {
  const readPayload = (target: string) =>
    payload(target, { hook_event_name: 'PostToolUse', tool_name: 'Read' })

  it('records the repo-relative suffix so the guard can find it', () => {
    const dossier = path.join(root, 'operator', 'customers', SLUG, 'dossier.md')
    expect(run(tracker, readPayload(dossier))).toBe(0)
    // The write it just unlocked:
    expect(run(guard, payload(engagementFile()))).toBe(0)
  })

  it('advises (exit 2) on a correspondence read without a prior dossier read', () => {
    const letter = engagementFile()
    expect(run(tracker, readPayload(letter))).toBe(2)
    expect(stderrOf(tracker, readPayload(letter))).toContain(dossierSuffix)
  })

  it('stays quiet when the dossier was read first', () => {
    logRead(SESSION, dossierSuffix)
    expect(run(tracker, readPayload(engagementFile()))).toBe(0)
  })

  it('ignores non-engagement reads and fails open on malformed stdin', () => {
    expect(run(tracker, readPayload(path.join(root, 'src', 'anything.ts')))).toBe(0)
    expect(run(tracker, 'not json')).toBe(0)
  })
})
