# Matter Memo on Update — Per-Event Algorithm

Source of truth for what "good change-logging" looks like. SKILL.md's `## Procedure` is the dispatch shape; this file is the detail. The order is fixed — guard, then diff, then (only if there is a real change) resolve and write. Phases 1 and 2 stop the skill on most events, and that is correct: the firm wants a memo per _substantive_ change, not per event delivery.

## The snapshot-store contract

The skill keeps, in the Operator's per-matter state (per-customer memory, keyed by `matterId`), the **last matter snapshot it has seen** — the same set of tracked fields it diffs (`references/output-format.md` lists them). This store is the skill's only memory between events; it is what makes "what changed" computable when the webhook gives only a current snapshot. Invariants:

- Keyed by `matterId`. One entry per matter.
- Updated **only after a successful `create_memo`** (or after a silent baseline on first touch). If the memo write fails, the prior snapshot is left intact so the change is retried on the next event, never silently lost.
- Holds field values only — never the raw event, never untrusted free text used as an instruction.

## Phase 1 — Loop-guard and idempotency (FIRST, always)

1. **Idempotency.** Change key = `(matterId, timestamp)`. If a memo has already been logged for this key, **STOP**. Webhook deliveries can repeat; a repeat is not a new change.
2. **Subscription discipline.** This skill is routed only from `{source: smokeball, event_type: matter.updated}`. It must **never** be wired to `memo.*` events. If a `memo.*` event ever reaches this skill, that is a routing misconfiguration — STOP and surface it; do not process it.
3. **Self-write guard.** The skill's own `create_memo` writes an internal memo, which is a separate Smokeball entity and should not fire `matter.updated`. The structural guarantee that it cannot loop is the **empty-diff stop in Phase 2**: a memo addition does not change any tracked matter field, so it produces no diff and writes no memo. Phase 1 does not need to special-case the service account; Phase 2's empty-diff stop is the defense.

## Phase 2 — Compute the change (the diff IS the loop-break)

1. **Convert the timestamp.** The event `timestamp` is **.NET ticks** (100-ns intervals since 0001-01-01). Convert to Unix seconds with `(ticks - 621355968000000000) / 10_000_000`, then to the firm's local time for the memo. A timestamp parsed as ISO-8601 is wrong by ~1900 years — a `fails`-adjacent bug, caught in fixtures.
2. **Load the prior snapshot** for `matterId` from the store.
   - **First touch (no prior snapshot):** this is the first event the skill has seen for this matter. Persist the event snapshot as the baseline and **STOP without writing a memo.** There is no prior state to diff against, and the firm does not want a "now tracking" memo cluttering the matter. The next update diffs cleanly against this baseline.
3. **Diff** the event snapshot against the prior snapshot across the tracked fields (`references/output-format.md`): a field is "changed" when its value differs. Produce the ordered list of `field: old → new`.
   - **Empty diff → STOP, no memo.** No tracked field changed (e.g. only a memo or an untracked sub-entity changed). This is correct — nothing changed in the matter record worth a supervision note — and it is the **loop-break**: the skill's own memo write can never produce a non-empty matter-field diff, so it can never trigger a second memo.
4. **Carry the diff** to Phase 3. Do not persist the new snapshot yet — persistence happens only after the memo write succeeds (the store contract).

## Phase 3 — Resolve actor and source (degrade honestly, never fabricate)

1. **Actor.**
   - `userId` present → `get_staff(userId)` → the staff member's name. If `get_staff` errors, fall back to recording the raw `userId` reference, not a guessed name.
   - `userId` absent → record **"an unidentified user."** Never attribute the change to a person, never infer "probably the responsible attorney." Absence is a documented, normal case (Smokeball notes `userId` "may not always be present").
2. **Source.** `source: Smokeball` → "in-app"; `source: API` → "via an integration." This distinguishes a person clicking in Smokeball from another system (or the Operator) writing through the API — useful supervision signal.

## Phase 4 — Write the memo

1. **`create_memo(matterId, body)`** with the factual body from `references/output-format.md`: who, the changed fields old → new, the local timestamp, the source. Terse, clerical, no interpretation.
2. **Persist** the event snapshot as the new prior for `matterId` (store contract). On a write failure, leave the prior intact and surface the failure — do not advance the snapshot, or the change is lost.

## What this algorithm is NOT

- **Not an analyst.** It records that a field changed; it never says why, never judges whether the change was right, never comments on what it means for the matter (UPL line — it is a clerk, not a lawyer).
- **Not a sender.** It writes one internal memo. No email, no external message, ever.
- **Not a matter mutator.** It never patches the matter, creates tasks, or touches funds.
- **Not chatty.** First-touch, empty-diff, and duplicate events write nothing. Silence on a non-change is correct behavior, not a miss.
