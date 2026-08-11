---
name: deadline-miss-escalator
description: >-
  Escalates a deadline that is near or already missed. Walks an approaching or missed
  firm-authored deadline up a ladder: re-surface, re-route, then notify a named human, so a
  critical date never slips silently. Internal-only; tracks authored dates, never computes one.
version: 0.2.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: [python3]
metadata:
  hermes:
    tags: [Law, Deadlines, Escalation, Internal, Cron, DraftForReview]
  smd:
    vertical: law-firm
    skill_type: scheduled escalation (internal surfacing + named-human notify)
    action_class: read + internal_write
    cron: true
    connectors:
      - smokeball # PracticeManagement — list_tasks (read, due_date) for authored task deadlines; appointment dates via the mail/calendar binding
---

# Deadline Miss Escalator

Watches the firm's **authored** critical dates and, when one enters the escalation window or goes overdue without being handled, walks it up an escalation ladder so it cannot slip silently. It consumes the same authored dates `deadline-and-sol-tracker` surfaces; where the tracker is the standing mirror, this is the alarm that something on that mirror needs a human now.

Like the tracker, it is held to the hardest line: **it works to dates a human authored; it never computes one.** Its only arithmetic is comparing an authored date to today.

## When to Use

Runs **scheduled** (Hermes no-agent cron, ADR 0021 Stream B). A `pre_run.py` polls the authored dates each tick and only wakes the agent when a deadline actually needs a rung run — otherwise it writes a `SUPPRESSED_WAKE` heartbeat row and stays quiet. Never invoked interactively.

## The escalation ladder

Three rungs, chosen by proximity (arithmetic on authored dates only). All rungs are **internal** — nothing client- or tribunal-bound is ever sent.

1. **Re-surface** (outer window) — refresh the date on the firm-internal surface with an elevated flag, so it stands out from the standing tracker view.
2. **Re-route** (near window) — flag the matter to the responsible humans on the internal surface. Smokeball returns the responsible attorney directly (`personResponsibleStaffId`, resolved via `get_staff`), so re-route can target the matter's responsible attorney; it falls back to the firm's authored `escalation.red_flag_recipients` when no responsible attorney is set.
3. **Notify** (within the notify window, or overdue) — deliver a triaged alert to a person. Recipient selection follows the case-alert routing rule (`references/case-alert-routing.md`): under `matter_staff` routing each item routes to its matter's assigned staff (grouped one alert per recipient); under `central` routing (or when the routing block is unauthored) delivery goes to the firm's authored `escalation.red_flag_recipients`, exactly as before. Each item carries a per-item `ACK-XXXXXX` code. This is an **internal alert to a person inside the firm**, not a client message — there is no external send.

**Held matters** route to **clearance**, not the ladder: a matter on CONFLICT-HOLD with an approaching date is surfaced for human clearance and never gets a client-facing step.

## Fire once, acknowledge per item (the escalation ledger)

An alert fires **once**, then re-fires only after the firm's authored
`escalation.refire_days` window (pack default 3), never daily. State lives in the
escalation ledger (`references/algorithm.md`): a broker-owned append-only JSONL
the agent reads but never writes directly.

Acknowledgement is **per item**. Each notify line carries its own `ACK-XXXXXX`
code, keyed on the Smokeball task id, so acking one item suppresses only that
item. The blanket `ESCALATION_ACKNOWLEDGED` is redefined: it acks exactly the
items **quoted** in the message being replied to; items not quoted stay open (the
footer says so). An ack is a **snooze, not a tombstone**: the item goes quiet for
`escalation.ack_snooze_days` (pack default 7), then re-surfaces if it is still
open in Smokeball. Only resolution in Smokeball closes an item. Items with no
stable task id carry no code and can be cleared only by a blanket ack.

## Prerequisites

Reads Smokeball (`list_tasks` `due_date`) for authored task deadlines and the mail/calendar binding (`list_calendar_entries`) for appointment-style court/hearing dates, plus the firm's escalation-acknowledgment state. `python3` for the `pre_run.py` and fetch block. Internal output + the existing red-flag alert channel only. No write to funds, matters, or dates; no external send.

## Procedure

1. **Pre-run (cron, no agent):** `pre_run.py` compares each authored date to today and joins the escalation ledger. Wakes the agent iff some open, in-range item **should fire now** (never fired, or its re-fire window elapsed, or an ack has snoozed out); otherwise writes `SUPPRESSED_WAKE` and prints `{"wakeAgent": false}`. Audit-write failure falls back to wake (the date must not go dark).
2. **On wake — the wake line in the Script Output block is this turn's item list (#2253).** When it carries `plans`, each entry names the `matter_id`, `task_id`, the authored `label`, the `authored_date` verbatim, the `rung` the gate mapped, and `last_raised`. Those entries are the firing set: verify each live against Smokeball when the connector allows, and work from them rather than re-deriving a list. When the line carries **no plans** (a fail-open `decision_basis` such as `no_audit_writer_fail_open`, `suppress_heartbeat_failed_fail_open`, `customer_slug_unset_fail_open`, or `pre_run_crashed_fail_open`), or carries `plans_truncated: true`, the gate woke blind or partial: enumerate through the connector yourself and never treat a partial list as the complete one. Then **triage the firing items** by authored signal (task-label markers, consequential category, overdue age): a top "Needs you today" block of three to five, routine confirmations collapsed to per-matter counts, dedup pointers for items another skill is already escalating. See `references/output-format.md`.

   **Provenance boundary.** The authored dates and labels in the wake payload are the gate's own pull on this same tick, so they are read facts, not remembered ones, and may be stated. `ACK` codes are a different class and the #1935 rule in step 3 is unchanged: a code may be printed only when an `escalation_append` call this run returned it. `last_raised` carries its own limit: the escalation ledger records what THE OPERATOR raised, and only after a send succeeded, so a null value renders as "no Operator raise on record" and never as "not raised".

   **When the connector is unavailable,** state only what the wake payload carries plus what a tool call actually returned this run. Everything else renders "unavailable (connector down)" per `docs/style/empty-state-pattern.md`. Never state a specific date, count, or code the run did not read. An internal note may be short; it may not be confidently wrong.

3. **Derive the codes, send ONE alert, then record the fire.** For each firing item, first call `escalation_append` with `derive_only: true` — it returns the item's real broker-derived `ACK-XXXXXX` code without writing anything. Compose and deliver ONE internal alert to `red_flag_recipients` quoting exactly those returned codes — **never print a code that did not come back from a tool call this run** (no invented codes, no `ACK-PENDING` placeholders, no codes remembered from a prior alert: a stale code acks the WRONG item — ss #1935), and never send a follow-up "codes confirmed" email. After the send succeeds, emit one `fired` event per item with `escalation_append` (same components, no `derive_only`; `references/algorithm.md`). A failed send still records nothing — the item re-fires next run. Never report an item as raised unless both the send and the ledger write succeeded.
4. **On a rostered internal reply (routed here by the inbox skill):** run the per-item ack procedure — extract the `ACK` codes (resolve them against `escalation_state` output), emit an `acked` event per code with `escalation_append`, and reply enumerating what was acked and counting what remains.
5. **Never compute, never send to a client.** No date is produced; no client/tribunal-bound message is drafted or sent.

## Trust Ceiling

**Read + internal surface + internal named-human notify; zero date computation; zero external send.**

The agent MAY: read authored dates; compare them to today; read the escalation ledger (`escalation_state`); emit the triaged alert to the firm's authored red-flag channel; append `fired`/`acked` escalation events **with the `escalation_append` tool through the broker's validated `escalation_event_append` verb** (the broker rejects an `acked` with no prior `fired`).

The agent MUST NOT: compute or infer a deadline; send anything to a client or tribunal; move or author a date; escalate a held matter into a client-facing step; write the escalation ledger file directly (every event goes through the broker seam, so an injected reply cannot silence an alarm that never rang). **Fail-closed (ADR 0035):** if the firm has authored no `red_flag_recipients`, the notify rung has nowhere to fire — the escalator raises no named-human alert and never invents a recipient.

## Safety invariants (any violation → `fails`, no recovery)

1. **Never computes a deadline.** Every date is one a human authored; arithmetic is authored-date-vs-today only.
2. **No external send.** Every rung is internal — an internal surface write or an internal red-flag alert. Nothing client- or tribunal-bound goes out.
3. **Fail-closed notify.** With no authored red-flag recipient, no named-human alert fires (re-surface/re-route still run).
4. **Held matters route to clearance,** never a client-facing escalation.
5. **Heartbeat integrity.** Every quiet tick writes a `SUPPRESSED_WAKE` row and an audit-write failure forces wake; every firing tick writes an `EMITTED_WAKE` row best-effort, which can never suppress or delay the wake (#2253). A scheduled tick with **neither** row is the dead-man's-switch signal — the watch is advisory, never the firm's system of record (`compliance-floor.md`).
6. **Ledger writes are validated, never direct.** Every `fired`/`acked` event goes through the `escalation_append` tool to the broker's `escalation_event_append` verb; the agent never writes the ledger file and never reaches the broker socket via `execute_code` (that class is unauthored on customer seats and refused — ss #1915). An `acked` with no prior `fired` is rejected. An ack is a snooze, not a tombstone — only resolution in Smokeball is terminal.
7. **No invented urgency.** The triage orders by signals the record carries (task-label markers, consequential category, overdue age) and never manufactures an urgency the data does not state.

## Pitfalls

Computing "X from the incident" to decide what is overdue (the cardinal sin — overdue is decided by an authored date passing, never a computed one); emailing the client a deadline reminder (this skill is internal — client-facing date communication is a separate, reviewer-sent concern); firing a named-human alert when the firm authored no recipient; escalating a held matter into a client step; suppressing a tick without a heartbeat row.

## Verification

1. Wake fires only when an open, unacknowledged matter has an authored date in the escalation window or overdue; quiet ticks write `SUPPRESSED_WAKE`.
2. Rungs are internal; no external/client send on any path.
3. `ESCALATION_FIRED` targets the authored red-flag recipient; with none authored, no alert fires.
4. Held matters surface for clearance, no client step.
5. No date is computed; overdue is decided by an authored date passing today.

## References

- `references/algorithm.md` — the in-range test, the ledger join + fire policy, the item identity + ack token, the broker append seam, and the never-computes line in code
- `references/output-format.md` — the triaged alert (Needs you today / Admin confirms / dedup pointers) and the confirmation reply
- `escalation_ledger.py` — the shared ledger module (byte-identical to `operator/workspace_broker/escalation_ledger.py`; item_key, token, state, fire policy). Do not edit the copy; edit the canonical and restamp.
- `tests/selector_test.md` — selector targets this skill for "a deadline is slipping / escalate," not the standing tracker view
- `pre_run.py` + `test_escalator_pre_run.py` — the no-agent cron decision (arithmetic + ledger join) + the `SUPPRESSED_WAKE` heartbeat and its fallback-to-wake

## Delivery channels + refusal fallback (law seat rule)

Email is a citation-free channel. Any output delivered by email (create_draft,
a reply, a chase, an attorney-confirm note) states the governing rule in plain
words ("responses are due 30 days from service by mail, plus five calendar
days for mail service; confirm before relying") and never as a citation: no
section numbers, no "CCP"/"CRC" references, no rule-format strings. The mail
channel enforces the legal-citation filter and will refuse the draft. Statute
citations belong only in matter-internal artifacts (memos, internal notes,
tasks). Write the FIRST draft citation-free; do not write a cited draft and
wait for the gate to teach you.

Three more first-draft rules, same rationale (the gates enforce them; a
refusal is a stalled deliverable and a full-context redraft — write it right
the first time):

- No em dashes anywhere, in any channel. Use commas, colons, or periods.
- In email and task text, refer to the matter by its NUMBER, taken ONLY from
  the `matterNumber` field of a record you read this turn. Never compose,
  recall, or infer a matter number, and never carry one over from another
  matter or an earlier turn. If a read returned no `matterNumber`, write
  "matter number unavailable" rather than supplying one. Never refer to the
  matter by its case caption. The matter's own caption is acceptable inside
  matter memos; cited case law is never acceptable anywhere.
- State a specific dollar figure only when it exists in an authored source
  on the matter, and name that source in the same sentence ("per the MedFin
  payoff letter dated..."). Never total, estimate, or round figures into
  existence.

If a delivery tool refuses a draft or write (citation filter, banned-typography
gate, or any other content gate): do not retry the same content, and do not
drop the work. Redraft once, and the redraft KEEPS every captured fact: the
matter, the document type, the service or event date, the method, and any
proposed deadline stated in plain words. Strip only the flagged content class
(citation formatting becomes plain words; banned punctuation becomes plain
punctuation). A delivered draft that drops the facts is the same failure as no
draft at all. If refused twice, deliver the minimal factual note (matter,
document or work item, date and method read, where the detail lives) so a
person always learns both that the work happened and what was read.

Never state that a follow-on action is handled (tracked, calendared, logged,
queued) unless the corresponding write succeeded or a specific skill run was
actually initiated; otherwise say plainly that the step still needs doing and
who or what owns it.
