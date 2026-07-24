/**
 * Guard tests for .claude/hooks/worktree-guard.mjs (the PreToolUse hook that
 * makes the primary checkout read-only for agent sessions).
 *
 * The hook is exercised as Claude Code runs it: a node subprocess with the
 * PreToolUse payload on stdin. Exit 2 = blocked, exit 0 = allowed. Paths are
 * built from the resolved primary-repo root so the suite passes both in CI
 * (where the checkout IS the primary root) and inside a worktree session
 * (where the primary root is the parent repo).
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const primaryRoot = (() => {
  const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim()
  const common = path.isAbsolute(out) ? out : path.resolve(process.cwd(), out)
  return path.dirname(common)
})()

const script = path.join(process.cwd(), '.claude', 'hooks', 'worktree-guard.mjs')

function runGuard(input: string, extraEnv: Record<string, string> = {}): number {
  try {
    execFileSync('node', [script], {
      input,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: primaryRoot,
        SS_ALLOW_PRIMARY_WRITES: '',
        ...extraEnv,
      },
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    return 0
  } catch (err) {
    return (err as { status?: number }).status ?? -1
  }
}

function payloadFor(filePath: string): string {
  return JSON.stringify({
    cwd: primaryRoot,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath },
  })
}

describe('worktree-guard hook', () => {
  it('blocks writes to repo files in the primary checkout', () => {
    expect(runGuard(payloadFor(path.join(primaryRoot, 'src', 'pages', 'index.astro')))).toBe(2)
  })

  it('blocks new files in the primary checkout, even in directories that do not exist yet', () => {
    expect(
      runGuard(payloadFor(path.join(primaryRoot, 'operator', 'skills', 'brand-new', 'SKILL.md')))
    ).toBe(2)
  })

  it('allows writes under .claude/ (session files, settings)', () => {
    expect(runGuard(payloadFor(path.join(primaryRoot, '.claude', 'handoff.md')))).toBe(0)
  })

  it('allows writes inside worktrees (they live under .claude/worktrees/)', () => {
    expect(
      runGuard(
        payloadFor(
          path.join(primaryRoot, '.claude', 'worktrees', 'some-wt', 'src', 'pages', 'index.astro')
        )
      )
    ).toBe(0)
  })

  it('allows writes outside the repository', () => {
    expect(runGuard(payloadFor(path.join(os.tmpdir(), 'scratch-file.md')))).toBe(0)
  })

  it('honors the Captain escape hatch', () => {
    expect(
      runGuard(payloadFor(path.join(primaryRoot, 'src', 'pages', 'index.astro')), {
        SS_ALLOW_PRIMARY_WRITES: '1',
      })
    ).toBe(0)
  })

  it('fails open on malformed input', () => {
    expect(runGuard('not json at all')).toBe(0)
  })

  it('fails open when the payload has no file path', () => {
    expect(runGuard(JSON.stringify({ tool_name: 'Write', tool_input: {} }))).toBe(0)
  })
})
