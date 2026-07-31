#!/bin/bash
# SessionStart hook: keep the PRIMARY checkout synced to origin/main.
#
# Companion to worktree-guard.mjs (which makes the primary checkout read-only
# for agent sessions). With no session dirtying the tree, a fast-forward at
# session start is always safe, so the primary checkout can never drift the
# way it did before 2026-07-06 (87 commits behind, 46 dirty paths).
#
# Runs only when the session starts IN the primary checkout; worktree sessions
# exit immediately. stdout is injected into the session's context, so speak
# only when something needs the agent's attention. Never blocks startup.
set -u

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
gitdir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
common=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
# Worktree sessions have git-dir != git-common-dir; only the primary syncs.
[ "$gitdir" = "$common" ] || exit 0

if [ -n "$(git status --porcelain)" ]; then
  count=$(git status --porcelain | wc -l | tr -d ' ')
  echo "worktree-guard: PRIMARY CHECKOUT IS DIRTY ($count paths). This tree is read-only for sessions (CLAUDE.md 'Worktree discipline') - do not build on this dirt. Verify each path against origin/main and reconcile, or escalate to Captain."
  exit 0
fi

branch=$(git branch --show-current)
if [ "$branch" != "main" ]; then
  echo "worktree-guard: primary checkout is on '$branch', expected main; not syncing."
  exit 0
fi

GIT_TERMINAL_PROMPT=0 git fetch -q origin main 2>/dev/null || {
  echo "worktree-guard: fetch failed; primary checkout may be stale."
  exit 0
}

# Quiet when already current.
git merge-base --is-ancestor origin/main HEAD 2>/dev/null && exit 0

before=$(git rev-parse --short HEAD)
if git merge --ff-only -q origin/main 2>/dev/null; then
  echo "worktree-guard: primary checkout fast-forwarded $before -> $(git rev-parse --short HEAD) (origin/main)."

  # Announce the dependency tree this hook just invalidated.
  #
  # This fast-forward runs at the START of a new session but mutates a tree
  # that OTHER sessions are already working in, and it moves source without
  # moving node_modules. On 2026-07-31 it carried a major-version lockfile
  # change (astro 6 to 7) into the primary at 12:36, three and a half hours
  # after a running session had been correctly briefed "Deps | current".
  # That session then ran builds against the wrong toolchain, and every
  # worktree provisioned afterwards cloned the stale tree from here.
  #
  # It warns rather than installing: `npm ci` deletes node_modules first,
  # which would break any concurrent build in this tree, and it would not fit
  # the hook timeout. Per-turn detection in reflex-primer.sh (Law 10) catches
  # the downstream cases; this line exists so the tree that caused it says so.
  if [ -n "$(git diff --name-only "$before"..HEAD -- package-lock.json 2>/dev/null)" ]; then
    echo "worktree-guard: that fast-forward changed package-lock.json, so node_modules in this checkout is now stale. Run npm ci before trusting any build, typecheck, or test result here, and note that worktrees provisioned from this tree clone its node_modules."
  fi
else
  echo "worktree-guard: primary checkout has local commits not on origin/main; not syncing. Reconcile manually."
fi
exit 0
