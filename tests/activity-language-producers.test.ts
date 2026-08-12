/**
 * Every action type with a real runtime producer has an EXPLICIT client-feed
 * decision (ss#2316, from the #2280 audit roll-up item 13).
 *
 * THE FAILURE CLASS. `activity-language.ts` renders a client line only for
 * actions in `CLIENT_LANGUAGE`. Anything else renders nothing. Before this
 * guard, "nothing" had two causes that looked identical on the feed:
 *
 *   suppressed  someone decided the client should not see it
 *   undeclared  nobody decided anything; the type simply arrived
 *
 * The pre-existing exhaustiveness test (activity-language.test.ts) iterates
 * `AUDIT_ACTION_TYPES`, so it can only check types already in the vocabulary. A
 * type that is EMITTED but absent from the vocabulary is invisible to it, and
 * equally invisible to the TS<->Python parity test, which iterates the same
 * constant. This suite closes that by asking a different question: not "is every
 * declared type dispositioned" but "is every PRODUCED type dispositioned".
 *
 * WHY THE PRODUCER MANIFEST IS THE SOURCE. `operator/contracts/audit-action-type-producers.json`
 * already classifies all 63 types by producing side (ss-console / overlay /
 * deferred) and is kept in lockstep with the vocabulary by
 * tests/operator-audit-producers.test.ts. It lives in this repo, so it does not
 * go stale against an overlay commit the way a snapshot of the overlay's own
 * emitter scan would.
 *
 * EVIDENCE BEHIND THE DISPOSITIONS. Running the overlay's own AST collector
 * (its tests/test_audit_vocabulary_completeness.py) over
 * venturecrane/hermes-smd-overlay at ec3fb713 across 140 writer-surface files
 * found 22 action types emitted as string literals from 13 emitter files. Every
 * one is declared in AUDIT_ACTION_TYPES and every one is dispositioned. Two
 * bounds on that number, both reasons to anchor the guard on the manifest rather
 * than on the scan: the collector sees only literal `action_type=` arguments, and
 * overlay#256 has just moved CONFIRM_SEND_DISPATCHED / CONFIRM_SEND_FAILED to the
 * capability broker, which is outside the scanned surfaces. The scan is a lower
 * bound on what the runtime emits; the manifest is the maintained upper bound.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  SUPPRESSED_ACTION_REASONS,
  activityDisposition,
  undeclaredClientActions,
} from '../src/lib/portal/operator/activity-language'
import { AUDIT_ACTION_TYPES } from '../src/lib/portal/operator/audit'
import type { AuditEntry } from '../src/lib/portal/operator/audit'

interface ProducerEntry {
  side: 'ss-console' | 'overlay' | 'deferred'
  [k: string]: unknown
}

const manifest = JSON.parse(
  readFileSync(resolve('operator/contracts/audit-action-type-producers.json'), 'utf-8')
) as { producers: Record<string, ProducerEntry> }

/** Types something actually writes today. 'deferred' means no producer exists. */
const producedTypes = Object.entries(manifest.producers)
  .filter(([, v]) => v.side === 'ss-console' || v.side === 'overlay')
  .map(([k]) => k)

function entry(action: string): AuditEntry {
  return {
    id: `e-${action}`,
    ts: '2026-08-12T00:00:00Z',
    actor: 'agent',
    actorRole: 'agent',
    action,
    target: null,
    decision: null,
    reason: null,
    skill: null,
  }
}

describe('client-feed disposition covers every produced action type', () => {
  it('the manifest still names producers (guard has not collapsed)', () => {
    expect(producedTypes.length).toBeGreaterThan(50)
  })

  it('no produced action type is UNDECLARED', () => {
    const undeclared = producedTypes.filter((t) => activityDisposition(t) === 'undeclared')
    expect(
      undeclared,
      `these types are written to client ledgers and render as nothing with no recorded decision. ` +
        `Add authored copy in CLIENT_LANGUAGE, or add them to SUPPRESSED_ACTION_REASONS with a reason: ` +
        `${undeclared.join(', ')}`
    ).toEqual([])
  })

  it('undeclaredClientActions reports nothing for a batch of produced types', () => {
    expect(undeclaredClientActions(producedTypes.map(entry))).toEqual([])
  })

  it('every declared vocabulary member is dispositioned, produced or not', () => {
    const undeclared = [...AUDIT_ACTION_TYPES].filter(
      (t) => activityDisposition(t) === 'undeclared'
    )
    expect(undeclared).toEqual([])
  })
})

describe('suppression carries a reason, not just membership', () => {
  it('every suppressed action has a non-empty reason', () => {
    const empty = Object.entries(SUPPRESSED_ACTION_REASONS)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([action]) => action)
    expect(empty).toEqual([])
  })

  it('reasons are substantive, not a placeholder', () => {
    for (const [action, reason] of Object.entries(SUPPRESSED_ACTION_REASONS)) {
      expect(reason.trim().length, `${action} reason is too short to be a reason`).toBeGreaterThan(
        24
      )
      expect(reason, `${action} reason is a placeholder`).not.toMatch(/\bTBD\b|\bTODO\b|\bN\/A\b/i)
    }
  })

  it('every suppressed action names one of the four recorded grounds', () => {
    // The grounds are documented on SUPPRESSED_ACTION_REASONS. Requiring the tag
    // keeps a future addition from being waved through with prose that does not
    // actually say why the client is not shown this.
    for (const [action, reason] of Object.entries(SUPPRESSED_ACTION_REASONS)) {
      expect(reason, `${action} does not name a ground`).toMatch(
        /^(TELEMETRY|INSTRUMENT|INTERNAL|NEEDS COPY)/
      )
    }
  })

  it('no action is both mapped and suppressed', () => {
    for (const action of Object.keys(SUPPRESSED_ACTION_REASONS)) {
      expect(activityDisposition(action), `${action}`).toBe('suppressed')
    }
  })
})

describe('FALSE CONTROL (Law 12): the guard can actually fail', () => {
  it('a type that is neither mapped nor suppressed is reported UNDECLARED', () => {
    // If this passes trivially, every green above measures nothing.
    expect(activityDisposition('TOTALLY_UNDECLARED_TYPE')).toBe('undeclared')
    expect(undeclaredClientActions([entry('TOTALLY_UNDECLARED_TYPE')])).toEqual([
      'TOTALLY_UNDECLARED_TYPE',
    ])
  })

  it('the undeclared collector distinguishes all three dispositions', () => {
    const batch = [
      entry('DRAFT_CREATED'), // mapped
      entry('LLM_TURN_COMPLETED'), // suppressed
      entry('SOME_NEW_RUNTIME_TYPE'), // undeclared
    ]
    expect(activityDisposition('DRAFT_CREATED')).toBe('mapped')
    expect(activityDisposition('LLM_TURN_COMPLETED')).toBe('suppressed')
    expect(undeclaredClientActions(batch)).toEqual(['SOME_NEW_RUNTIME_TYPE'])
  })
})
