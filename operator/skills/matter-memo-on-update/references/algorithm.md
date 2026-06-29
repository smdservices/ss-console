# Matter Memo on Update - Per-Event Algorithm (v0.2.0)

Source of truth for what "good change-logging" looks like. SKILL.md's `## Procedure` is the dispatch shape; this file is the detail. The order is fixed - dedupe, then resolve, then write. This version records **who / when / how** (one memo per matter change). It depends on no snapshot store and no code execution; everything is the three connector calls plus your own reasoning.

## Connector-call budget (load-bearing - do not exceed)

The MCP client opens a circuit breaker after **3 consecutive tool errors** and then blocks ALL further calls to the connector - including your `create_memo` write - for ~60 seconds. So the call budget is deliberately tiny and **no read is ever retried**:

- `get_memos_on_matter` - once (idempotency).
- `get_staff` - once (actor); a single tolerated failure is fine, a retry is not.
- `create_memo` - once (the write).

A successful call resets the breaker's error count, so the realistic worst case (one `get_memos` error + one `get_staff` error, then the write) is 2 consecutive errors - under the threshold. Probing extra reads (`get_matter`, `auth_status`, `search_staff`) or retrying a 404 is what trips it and loses the memo. Convert `.NET ticks` in your head; never call `execute_code`.

## Phase 1 - Idempotency (FIRST, always)

1. **Change key.** `op-mmou:<matterId>:<timestamp>` - the raw `.NET ticks` value verbatim.
2. **Read existing memos once** with `get_memos_on_matter(matterId)`. If any memo body already contains that exact change-key tag, the change is already logged → **STOP, write nothing.** Webhook deliveries can repeat; a repeat is not a new change.
3. **On a `get_memos` error, do not retry.** Proceed to Phase 2. A missing dedupe read at worst yields one extra memo on a redelivery - bounded, and the skill can never loop: it is routed only from `{source: smokeball, event_type: matter.updated}`, and its own `create_memo` emits a `memo.*` event, never `matter.updated`. (If a `memo.*` event ever reaches this skill, that is a routing misconfiguration - STOP and surface it.)

## Phase 2 - Resolve actor and source (degrade honestly, never fabricate)

1. **Convert the timestamp.** The event `timestamp` is **.NET ticks** (100-ns intervals since 0001-01-01). `unix_seconds = (ticks - 621355968000000000) / 10_000_000`; render the calendar date `YYYY-MM-DD`. A timestamp parsed as ISO-8601 is wrong by ~1900 years. Give the date only unless you are confident of the local clock time - never invent one.
2. **Actor.**
   - `userId` present → `get_staff(userId)` **once** → the staff member's name.
   - `get_staff` errors (404/400/anything), or `userId` absent → record **"an unidentified user."** Never attribute to a person, never infer "probably the responsible attorney," never retry, never fall back to `search_staff`. Absence/404 is a documented, normal case.
3. **Source.** `source: Smokeball` → "in-app"; `source: API` → "via an integration." This distinguishes a person clicking in Smokeball from another system (or the Operator) writing through the API.

## Phase 3 - Write the memo

1. **`create_memo(matterId, body)`** with the factual body from `references/output-format.md`: the who/when/how line, then the `op-mmou:<matterId>:<timestamp>` tag on its own last line. Terse, clerical, plain ASCII, **no em-dash**, no interpretation.
2. That is the only write. Do not advance any state, do not write a file, do not touch the matter.

## Deferred: field-level diff (a planned enhancement, NOT active in v0.2.0)

The richer memo - "what changed, field-level old → new" (`Status: Open → Pending`, etc.) - needs the skill to remember the matter's **prior** field values, because the webhook delivers only a current snapshot. That requires a per-matter **snapshot store** the skill can read and write on the persona's volume, plus a content-governance carve-out so a snapshot or memo that legitimately mirrors customer data (which may contain an em-dash) is not refused by the outbound fabrication gate. Neither is wired yet, so this version does not attempt a field diff - it records the fact of the touch (who/when/how), accurately and once, and never invents a diff it cannot source. When the store and the carve-out land, the diff phase slots in between "resolve actor" and "write," and the memo gains the changed-field lines.

The original snapshot-store contract (kept here for that future work): keyed by `matterId`, one entry per matter; updated only after a successful `create_memo`; holds field values only, never the raw event or untrusted free text; first-touch baselines silently; an empty diff writes no memo and is the loop-break.

## What this algorithm is NOT

- **Not an analyst.** It records that a matter was touched; it never says why, never judges whether the change was right, never comments on what it means (UPL line - it is a clerk, not a lawyer).
- **Not a sender.** It writes one internal memo. No email, no external message, ever.
- **Not a matter mutator.** It never patches the matter, creates tasks, or touches funds.
- **Not chatty.** A duplicate delivery writes nothing. Silence on an already-logged change is correct behavior, not a miss.
