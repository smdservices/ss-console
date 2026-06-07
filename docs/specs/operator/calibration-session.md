# Calibration session workflow

**Spec for issue [#867](https://github.com/venturecrane/ss-console/issues/867).**
Defines the calibration cycle structure (four 90-minute sessions over two weeks),
the portal surface that exposes it, and the integration seams that connect
calibration findings back to voice ingestion, memory rules, and trust-ceiling
logging.

Gate #2 before any external draft ships was originally a single 4-6 hour
Captain-led calibration session. The single 4-6 hour block collapses at
firms that actually sign — partner calendars do not support it. This spec
adopts the four-session split as the canonical structure for every
calibration cycle.

## Source

- `docs/specs/operator/voice-ingestion.md` — structural-diff storage
- `docs/specs/operator/memory-ingestion.md` — memory rule writer
- `docs/specs/operator/trust-ceiling-logging.md` — `log_decision()`
  emission contract
- `docs/style/empty-state-pattern.md` — no fabrication; render nothing or
  an explicit marker when authored data is missing

## Why four sessions

A 90-minute block fits inside a partner's calendar in a way that a 4-6 hour
block does not. The cycle keeps the same total Captain time (six hours
spread, not four-to-six condensed) but moves the partner's involvement onto
a cadence the partner can actually keep. Each session has a single output:

| #   | Session                  | Duration | Output                                                             |
| --- | ------------------------ | -------- | ------------------------------------------------------------------ |
| 1   | Voice calibration        | 90 min   | 10-15 partner-edited drafts feeding the voice ingestion seam       |
| 2   | Skill calibration        | 90 min   | Per-skill approve / edit / refuse decisions feeding memory rules   |
| 3   | Trust-ceiling refinement | 90 min   | Per-skill ceiling set by the principal; approval rows in audit_log |
| 4   | Integration and handoff  | 90 min   | Live workflow at the partner keyboard; sign-off for the blind-test |

Cycles are scheduled across two weeks. Two sessions per week is the
recommended cadence; the spec does not enforce a per-session calendar offset
because the partner's schedule drives the spacing.

## Required framing

Every surface that names the Operator inside the calibration workflow
must include the assistant framing:

> `{persona name} assists the partner; {persona name} never replaces them.`

The persona name comes from `getActivePersona()` (see
`src/lib/portal/customer-config.ts`). When no active persona exists, the
framing is suppressed and the empty-state branch fires per
`docs/style/empty-state-pattern.md`. No fallback persona name is permitted.

## Portal surface

URL: `portal.smd.services/portal/products/operator/calibration`

Access gate (principal-only via `resolveProductAccess()`):

- Clerk session present (middleware)
- Local entity bound to the active Clerk organization
- Active Operator subscription on the entity
- Caller holds the `principal` role on (user, entity, 'operator')

Operators and compliance users redirect to the Operator landing page.
The page does not render a half-locked view; the role gate is binary.

### States the page renders

The page renders exactly one of four states, per
`docs/style/empty-state-pattern.md`. No fabrication; no placeholder cycle.

| State         | When                                                   | What renders                                                  |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `no_persona`  | Customer config has no active persona                  | Empty state: "No active persona configured. Contact Captain." |
| `not_started` | Persona exists; no calibration cycle has been created  | Empty state plus a "Start new calibration cycle" action       |
| `active`      | A calibration cycle exists and at least one session is | Full cycle: four-session schedule with per-session state      |
|               | `pending` or `in_progress`                             |                                                               |
| `completed`   | All four sessions completed                            | Read-only summary plus a "Start new calibration cycle" action |

The "Start new calibration cycle" action is the explicit way to (re-)run
calibration on demand. It posts to
`/api/portal/operator/calibration/start` (endpoint lands under #821 with
the D1 writer; the form action is the contract today).

### Sections on the page

The page composes three sections, in order:

1. **Cycle header.** Cycle ID (when present), state badge, planning-window
   length, persona name, the required assistant framing.
2. **Session schedule.** A four-row grid in `CALIBRATION_SESSION_KINDS`
   order: position number, label, description, state badge.
3. **Seams documentation.** A read-only block naming the three integration
   seams (voice, memory, trust ceiling) so the principal sees what each
   session connects to downstream. Links to `docs/specs/operator/`
   sibling specs.

The "Start new calibration cycle" action appears under the cycle header
when the state is `not_started` or `completed`. It is not present in
`active` (a cycle is already running) or `no_persona` (no persona to
calibrate against).

## Data-capture mechanics (deferred to #821)

This spec documents the seams; the actual D1 tables, writer wiring, and
emission contract land when the Hermes runtime scoping (issue #821) is
resolved. Until then, the portal surface is read-only on every seam.

### Seam 1: voice corrections → voice ingestion

During session 1, the partner edits 10-15 representative drafts. Each
edit produces a `(draft, sent)` pair that the voice ingestion pipeline
consumes — see `docs/specs/operator/voice-ingestion.md`. The
structural-diff is stored under `{customer_slug}/voice/cohort/{cohort}/`
per the existing ingestion contract; the calibration session does not
introduce a new R2 prefix.

When #821 ships, the calibration session writer posts each `(draft, sent)`
pair to the voice ingestion runner with `source=calibration_session` so
downstream consumers (compliance evidence packet, dashboard) can
distinguish calibration-derived structural-diffs from live edit-then-send
signals.

### Seam 2: rule additions → memory rules

During session 2, the partner walks each enabled skill against a real
scenario and either approves the outcome, edits it, or marks it refused.
"Edited" outcomes plus any newly stated rules ("we don't take medmal
under $1M") feed the memory rules writer per
`docs/specs/operator/memory-ingestion.md`. The rule writer enforces
the closed memory categories (rule / voice / process / person).

### Seam 3: approvals → trust-ceiling logging

During session 3, the principal sets the per-skill ceiling (autonomous,
draft_for_review, refused). Each ceiling change writes one row to
`audit_log` via the `log_decision()` emission contract in
`docs/specs/operator/trust-ceiling-logging.md`. The
`action_type` is `CEILING_PROMOTED` or `CEILING_DEMOTED` from the
closed-set vocabulary (see `audit_log.py`); the `metadata` JSON includes
`calibration_cycle_id` and `calibration_session_kind` so the compliance
evidence packet can group calibration-derived audit rows together.

## Non-goals

- **No autonomous calibration.** The agent never schedules, conducts,
  or self-grades a calibration session. Every session is a Captain-led
  90-minute walkthrough with the partner. The portal exposes the cycle
  structure; it does not run sessions.
- **No fabricated session outcomes.** When no cycle has been authored,
  the page renders the empty state. The portal does not synthesize
  placeholder sessions, sample drafts, or projected timelines.
- **No retry-pressure copy.** The action is "Start new calibration
  cycle." It is not "Recalibrate now" or "Your calibration is overdue."
  The cadence is the partner's decision.
- **No fixed dates in marketing copy.** Per `CLAUDE.md` §3, scope-based
  pricing engagements do not publish fixed timeframes externally. The
  `CALIBRATION_WINDOW_DAYS` constant (14) governs internal scheduling;
  the portal renders "two weeks" as descriptive text, not as a
  commitment.

## Customer.yaml shape (under #821)

Calibration cycles persist in a per-customer D1 table once #821 lands.
The expected shape lives in `customer.yaml` under a new
`calibration_state` block (schema not yet defined; ADR pending). Until
then, the portal reads from the projection only when the resolver
returns a non-null cycle — today the resolver always returns null and
the empty-state branch fires.

## Verification

- `tests/portal-operator-calibration.test.ts` exercises the closed
  vocabulary helpers (`isCalibrationSessionKind`,
  `isCalibrationSessionState`, formatters), the framing builder
  (`buildAssistantFraming`), and the cycle projection
  (`buildDefaultSessionRows`, `getActiveCalibrationCycle`).
- The portal page is unit-tested through the lib helpers it consumes
  (Astro page rendering is not in the test surface for portal
  Operator surfaces, consistent with the existing settings test set).

## Cross-references

- `docs/specs/operator/voice-ingestion.md` — seam 1 consumer
- `docs/specs/operator/memory-ingestion.md` — seam 2 consumer
- `docs/specs/operator/trust-ceiling-logging.md` — seam 3 consumer
- issue [#821](https://github.com/venturecrane/ss-console/issues/821) —
  Hermes runtime scoping that unblocks the D1 writer paths
