#!/bin/bash
#
# Reflex Primer Hook (UserPromptSubmit) -- the always-on doctrine surface.
#
# Emits the eleven operating-law primer lines into context on every user
# prompt. Ported from crane-console's redirect-reflex-hook.sh (v2 always-on:
# pattern-matching redirect language proved too brittle to build a forcing
# function on; the laws are universal, so the primer fires universally).
#
# Source of truth: docs/doctrine/agent-operating-doctrine.md. Each line below
# is a law's canonical `primer_line` and MUST match it verbatim --
# tests/doctrine-integrity.test.ts pins the parity, so editing one without
# the other fails `npm run verify`. A correction that changes a law updates
# both files in the same PR (the doctrine maintenance contract).
#
# Incident: 2026-07-26 Christa-reply session (context unloaded, verb
# inflated, terms invented, ignorance reported as findings). Cost/exit
# review: 2026-09-30 per the doctrine's mechanisms-under-review block.
#
# Wire protocol:
#   stdin:  JSON with .prompt, .cwd, .session_id (Claude Code hook contract)
#   stdout: lines below become additional context for the next turn
#   exit 0 always; never block the Captain on hook plumbing.

set -e

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# Capture stdin ONCE. The payload is needed three times (.prompt, .cwd,
# .session_id) and stdin cannot be re-read, so a bare `jq` here would consume
# it and starve the staleness block below.
PAYLOAD=$(cat 2>/dev/null) || exit 0
# `.prompt` is what this harness sends and is load-bearing; `.prompt_text`
# appears in the published hook reference. Accept either so a field rename
# cannot silently reduce the primer to a no-op.
PROMPT=$(printf '%s' "$PAYLOAD" | jq -r '.prompt // .prompt_text // empty' 2>/dev/null) || exit 0
[ -z "$PROMPT" ] && exit 0

cat <<'PRIMER'
[doctrine] Operating laws (docs/doctrine/agent-operating-doctrine.md):
1. Resolve whose call it is before acting: agents execute, the Captain owns strategy, commitments, and spend, clients author their own posture. Never default-claim or default-defer.
2. Engagement work starts by reading that engagement dossier. An index line is a pointer, not knowledge.
3. The verb is the scope: "review X" or "let's review X" delivers exactly the text of X plus "what would you like to discuss", nothing volunteered; verdicts only under an evaluating ask, edits only under an editing verb. Never edit Captain-authored client documents unasked.
4. A gap in your context is a question, not a finding. Never report your own ignorance as a defect; never fill it with plausible content.
5. Client-facing numbers and terms trace to an ADR, a letter, or the Captain, with the source named. Runtime claims trace to an observation. Config is not runtime.
6. Founder and client register comes from the Captain; agents edit, never generate from nothing. Never indict the counterparty.
7. Blast radius before action: on live systems, shared state, and secrets, use the safe tool, never the convenient one.
8. Finish or say why: no stopping-point offers, no hedging finished work as draft, no relitigating settled calls.
9. The deliverable is the client's act, not your artifact: name the terminal seam, enumerate every gate between the client and the effect, and escalate an unclosable gate before building the closable ones.
10. Your snapshot is not the system. Tree state, branch lists, merged PRs, and installed dependencies decay within minutes of the briefing that reported them. Re-probe before acting on any of them.
11. The Captain's attention is the scarcest resource on the venture: default to three lines (shipped / next / blocked), put detail in the PR or issue and link it, and escalate only what costs money, touches a client, or changes a promise. An escalation is one sentence of stakes, two options, your pick, and you proceed on your pick unless told otherwise.
12. A check that cannot fail has measured nothing. Before reporting an observation, name what would have made it false and confirm your instrument would have shown it.
PRIMER

# Law 2 escape-hatch visibility.
#
# SS_ALLOW_UNREAD_ENGAGEMENT_WRITES bypasses the engagement read gate. It is
# path-scoped and audited by engagement-guard.mjs, but an exported hatch is
# still invisible in the moment it matters most -- the session that has it set
# is the session that never sees the gate. Surfacing the recent count here
# turns a quiet permanent bypass into something stated on every prompt.
HATCH_LOG="${SS_HATCH_AUDIT_FILE:-$HOME/.claude/ss-hatch-audit.log}"
if [ -f "$HATCH_LOG" ]; then
  CUTOFF=$(date -u -v-7d +%Y-%m-%d 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%d 2>/dev/null)
  if [ -n "$CUTOFF" ]; then
    RECENT=$(awk -v c="$CUTOFF" -F'\t' '$1 >= c' "$HATCH_LOG" 2>/dev/null | wc -l | tr -d ' ')
    if [ "${RECENT:-0}" -gt 0 ]; then
      echo "[doctrine] Law 2 escape hatch used ${RECENT}x in the last 7 days (${HATCH_LOG}). If it is exported permanently, unset it."
    fi
  fi
fi

# Law 10 surface: your snapshot is not the system.
#
# The gitStatus block, branch list, and dependency state seeded into a
# session's context are captured ONCE at session start. With concurrent
# sessions merging into main every ~25 minutes, they are wrong within
# minutes, and an agent reasoning carefully from them is still wrong.
# Session-start detection cannot close this: session start is exactly when
# the answer is still right. So the check runs every turn.
#
# Incident 2026-07-31: sync-primary.sh fast-forwarded the primary across a
# major-version lockfile change on behalf of a NEWLY starting session,
# invalidating node_modules for sessions already running in that tree three
# hours after their briefing rendered "Deps | current". Six of seven
# checkouts ended the day running a stale toolchain against new source.
#
# Three invariants this block must never violate:
#   1. It must never kill the primer. The script runs `set -e`, and a failing
#      `git rev-parse` or `stat` -- the NORMAL case here -- would propagate.
#      Verified 2026-07-31 with both guards removed: exit 128, and on
#      UserPromptSubmit a non-zero exit forfeits the stdout injection, so the
#      laws are computed and then discarded. Two independent containments are
#      kept, and EITHER ALONE IS SUFFICIENT (invoking as `staleness_block ||
#      true` puts the body in an `||` list, which already suspends `set -e`
#      for it). That redundancy is deliberate, not an oversight to tidy: a
#      later edit that drops one must not silently arm the failure. The block
#      also sits AFTER the heredoc, so even total containment failure leaves
#      the laws already printed. tests/staleness-detection.test.ts asserts
#      exit 0 and all primer lines on stdout across every failure path.
#   2. It must measure the tree the session is actually in. CLAUDE_PROJECT_DIR
#      is pinned at launch and does not follow EnterWorktree, so preferring it
#      would report on the primary from inside a worktree: this law's own
#      failure, reintroduced by its enforcement, wearing doctrine's authority.
#      Payload .cwd first, matching worktree-guard.mjs:53.
#   3. It must not cry wolf. A line that is sometimes wrong and always loud
#      teaches agents to skim past laws 1 through 10. mtime alone fires on
#      `git stash`, `git restore`, and rebases that rewrite the lockfile
#      without changing it, so mtime only GATES a content comparison.
staleness_block() {
  set +e

  local tree root
  tree=$(printf '%s' "$PAYLOAD" | jq -r '.cwd // empty' 2>/dev/null)
  [ -n "$tree" ] && [ -d "$tree" ] || tree="$PWD"
  [ -d "$tree" ] || tree="${CLAUDE_PROJECT_DIR:-}"
  [ -n "$tree" ] && [ -d "$tree" ] || return 0

  root=$(git -C "$tree" rev-parse --show-toplevel 2>/dev/null)
  [ -n "$root" ] && [ -d "$root" ] || return 0
  local name
  name=$(basename "$root")

  # --- Signal 1: main moved under you --------------------------------------
  # Reads the local origin/main ref; deliberately does NOT fetch, because a
  # network round trip on every turn is not affordable. Concurrent sessions
  # fetch at every start, so the ref stays close to current in practice.
  local behind
  behind=$(git -C "$root" rev-list --count HEAD..origin/main 2>/dev/null)
  if [ -n "$behind" ] && [ "$behind" -gt 0 ] 2>/dev/null; then
    echo "[doctrine] Law 10: origin/main is ${behind} commit(s) ahead of your HEAD (as of the last fetch). Anything you were briefed about main predates them."
  fi

  # --- Signal 2: the working tree moved since you were briefed --------------
  # Baselined per session so this speaks only on CHANGE, not merely on dirt.
  # Without a session id there is no baseline to diff against, so it stays
  # silent rather than guess.
  local sid dirty base_file prev
  sid=$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null)
  if [ -n "$sid" ]; then
    dirty=$(git -C "$root" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    base_file="${TMPDIR:-/tmp}/ss-staleness-$(printf '%s' "${sid}:${root}" | cksum | cut -d' ' -f1)"
    if [ -f "$base_file" ]; then
      prev=$(cat "$base_file" 2>/dev/null)
      if [ -n "$prev" ] && [ -n "$dirty" ] && [ "$prev" != "$dirty" ]; then
        echo "[doctrine] Law 10: working tree changed since session start (${prev} path(s) then, ${dirty} now). The gitStatus in your system prompt is out of date; re-read it before reasoning about the tree."
      fi
    else
      printf '%s' "${dirty:-0}" >"$base_file" 2>/dev/null
    fi
  fi

  # --- Signal 3: dependencies no longer match the lockfile ------------------
  local lock rec
  lock="$root/package-lock.json"
  rec="$root/node_modules/.package-lock.json"
  [ -f "$lock" ] || return 0

  if [ ! -d "$root/node_modules" ]; then
    echo "[doctrine] Law 10: ${name} has no node_modules. Run npm ci before trusting build, typecheck, or test results."
    return 0
  fi
  if [ ! -f "$rec" ]; then
    echo "[doctrine] Law 10: ${name} has node_modules but no install record; an install may be in flight. Do not start a second one."
    return 0
  fi

  # Cheap gate: is the lockfile newer than npm's install record?
  #
  # `find -newer` rather than `stat`, because stat's mtime flag is not
  # portable and fails UNSAFELY. BSD spells it `stat -f %m`; GNU spells it
  # `stat -c %Y`. Writing `stat -f %m ... || stat -c %Y ...` looks like a
  # correct fallback and is not: on GNU, `-f` means "display filesystem
  # status", so it SUCCEEDS with filesystem information instead of failing,
  # the `||` branch never runs, and the arithmetic silently gives up. Caught
  # by CI on 2026-07-31 after passing on macOS, which is the same
  # works-on-my-machine failure this law is about.
  #
  # Over-triggering here is harmless: this only gates the content comparison
  # below, which is what actually decides whether to speak.
  [ -n "$(find "$lock" -newer "$rec" 2>/dev/null)" ] || return 0

  # mtime says stale. Confirm against content before speaking: compare only
  # packages present in BOTH files, and only flag version mismatches. Entries
  # absent from the install record are optional platform-specific binaries
  # (141 of them in this repo on darwin) and are NOT drift -- counting them
  # would make this line fire in every checkout, forever.
  command -v node >/dev/null 2>&1 || return 0
  local verdict count example
  verdict=$(node -e '
    const fs = require("fs")
    try {
      const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      const rec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
      let n = 0, ex = ""
      for (const [k, v] of Object.entries(lock.packages || {})) {
        if (!k.startsWith("node_modules/")) continue
        const i = rec.packages && rec.packages[k]
        if (!i) continue
        if (i.version !== v.version) {
          n++
          if (!ex) ex = k.slice("node_modules/".length) + " " + i.version + " vs " + v.version
        }
      }
      process.stdout.write(n ? n + "|" + ex : "0")
    } catch (e) { process.stdout.write("0") }
  ' "$lock" "$rec" 2>/dev/null)
  count=${verdict%%|*}
  example=${verdict#*|}
  [ -n "$count" ] && [ "$count" != "0" ] 2>/dev/null || return 0
  echo "[doctrine] Law 10: ${name} dependencies are stale; ${count} package version(s) differ from package-lock.json (e.g. ${example}). Run npm ci before trusting build, typecheck, or test results."
}
staleness_block || true

exit 0
