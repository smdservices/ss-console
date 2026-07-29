#!/bin/bash
#
# Reflex Primer Hook (UserPromptSubmit) -- the always-on doctrine surface.
#
# Emits the nine operating-law primer lines into context on every user
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
#   stdin:  JSON with .prompt (Claude Code hook contract)
#   stdout: lines below become additional context for the next turn
#   exit 0 always; never block the Captain on hook plumbing.

set -e

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

PROMPT=$(jq -r '.prompt // empty' 2>/dev/null) || exit 0
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

exit 0
