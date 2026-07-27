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
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const guard = path.join(process.cwd(), '.claude', 'hooks', 'engagement-guard.mjs')
const tracker = path.join(process.cwd(), '.claude', 'hooks', 'read-tracker.mjs')

const SLUG = 'test-firm'
const SESSION = 'sess-test-123'

let root: string // fake repo tree
let altRoot: string // a second "worktree" of the same repo
let logDir: string

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
  logDir = mkdtempSync(path.join(os.tmpdir(), 'eg-log-'))
  seedTree(root)
  seedTree(altRoot)
})

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

function run(script: string, input: string, extraEnv: Record<string, string> = {}): number {
  try {
    execFileSync('node', [script], {
      input,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        SS_READ_LOG_DIR: logDir,
        SS_ALLOW_UNREAD_ENGAGEMENT_WRITES: '',
        ...extraEnv,
      },
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    return 0
  } catch (err) {
    return (err as { status?: number }).status ?? -1
  }
}

function stderrOf(script: string, input: string): string {
  try {
    execFileSync('node', [script], {
      input,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        SS_READ_LOG_DIR: logDir,
        SS_ALLOW_UNREAD_ENGAGEMENT_WRITES: '',
      },
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

  it('allows writes when the slug has no dossier on disk yet (structure test closes this window)', () => {
    rmSync(path.join(root, 'operator', 'customers', SLUG, 'dossier.md'))
    rmSync(path.join(altRoot, 'operator', 'customers', SLUG, 'dossier.md'))
    expect(run(guard, payload(engagementFile()))).toBe(0)
  })

  it('ignores template slugs and non-engagement paths', () => {
    const template = path.join(root, 'operator', 'customers', '_template', 'dossier.md')
    expect(run(guard, payload(template))).toBe(0)
    expect(run(guard, payload(path.join(root, 'src', 'anything.ts')))).toBe(0)
  })

  it('escape hatch: SS_ALLOW_UNREAD_ENGAGEMENT_WRITES=1 allows everything', () => {
    expect(run(guard, payload(engagementFile()), { SS_ALLOW_UNREAD_ENGAGEMENT_WRITES: '1' })).toBe(
      0
    )
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
