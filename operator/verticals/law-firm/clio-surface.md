# Clio MCP tool surface — pinned for the law wedge

**Purpose.** Pin the Clio practice-management connector's actual tool contract so the wedge's fixtures and skill bodies are authored against real I/O shapes, not imagined ones (ADR 0038 §3.6 / wedge plan, critique #2). This is the system-of-record connector for every law skill (`vertical.yaml` → `mcp:clio-oktopeak`).

**Source.** Community MCP [`oktopeak/clio-mcp`](https://github.com/oktopeak/clio-mcp), v2.0.0 (2026-05-23), MIT — the connector chosen in [ADR 0020](../../adr/0020-connector-strategy.md). Pinned **read-only from the published repo on 2026-06-03** — no Machine, no live data, no OAuth. ~26 tools across 9 groups. OAuth 2.0 + local AES-256-GCM token store; every tool call appends to a local audit log (`~/.clio-mcp/audit.log`), never uploaded.

> Re-pin this file whenever the connector version bumps. The connect step (ADR 0038 step 5) replaces "published-doc assumptions" here with a real vendor-sandbox round-trip; until then, treat every shape below as the **contract of record but unverified against a live tenant**.

## Tool catalog (read vs. write)

| Group          | Read tools                                                                                    | Write tools                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth           | `auth_status`                                                                                 | `authenticate`, `logout`                                                                                                                                      |
| Matters        | `list_matters(status, limit)`, `get_matter(matter_id)`                                        | `create_matter(client_id, description, status, open_date, practice_area_id, billable, responsible_attorney_id, originating_attorney_id, client_reference)` ⚠️ |
| Contacts       | `search_contacts(query, limit, page_token)`, `get_contact(contact_id)`                        | —                                                                                                                                                             |
| Documents      | `list_documents(matter_id, parent_id, query, limit, page_token)`, `get_document(document_id)` | `upload_document(file_path, matter_id, name, content_type)`                                                                                                   |
| Tasks          | `list_tasks(matter_id, status, due_date_start, due_date_end, limit)`                          | `create_task(...)`, `update_task(...)`, `complete_task(task_id)`                                                                                              |
| Calendar       | `list_calendars()`, `list_calendar_entries(from, to)`                                         | `create_calendar_entry(summary, start_at, end_at, calendar_owner_id, …)` ⚠️                                                                                   |
| Time & Billing | `list_time_entries(matter_id, start_date, end_date, limit)`, `get_billing_summary(matter_id)` | `log_time_entry(...)`, `create_activity(...)`                                                                                                                 |
| Notes          | —                                                                                             | `create_note(matter_id, subject, body)`                                                                                                                       |
| Users          | `list_users(name, subscription_type, enabled, limit)`, `get_user(user_id)`                    | —                                                                                                                                                             |
| Compliance     | `export_audit_log(date_from, date_to, matter_id, limit, offset)`                              | —                                                                                                                                                             |

`search_contacts` / `list_*` return paginated envelopes (`total_count`, `has_more`, `next_page_token`). `get_billing_summary` → `{ total_billed, outstanding_balance, last_invoice_date }`.

## ⚠️ Flagged contract ambiguity — write scope (resolve at connect step)

The README contradicts itself, and it changes how two wedge skills behave:

- The **tool table** lists `create_matter` and `create_calendar_entry` as callable Write tools.
- The **ABA-Opinion-512 statement** says: _"v1 restricts creation to **tasks, notes, and documents only**."_

So it is **unverified** whether `create_matter` and `create_calendar_entry` are actually callable in v1, or are documented-but-gated. **The wedge fixtures assume the conservative (fail-closed) reading:** the agent does **not** create a Clio matter or calendar entry directly. Instead:

- `new-matter-intake` drafts the matter as an **internal artifact for human creation** (a `create_note` log + a drafted acknowledgment), never `create_matter` autonomously.
- `consult-scheduler` proposes times and drafts the confirmation; the **calendar write is surfaced for human confirmation**, not auto-written, until the connect step proves `create_calendar_entry` is callable and authored-on.

This aligns with reviewer-as-sender + no-imposed-defaults ([ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md)): an unverified write capability is fail-closed, not assumed. **Connect-step action:** confirm the real v1 write scope against the Clio sandbox; if `create_matter`/`create_calendar_entry` are callable AND the engagement authors them on, the two skills may graduate from draft-and-surface to autonomous-write.

## ⚠️ Trust funds are NOT in this surface

There is **no trust-account / IOLTA tool** in the Clio MCP. `get_billing_summary` returns AR (`total_billed`, `outstanding_balance`) — **billing, not trust.** Confirms the manifest: `trust-balance-nudge` reads the trust/retainer balance via **`build:lawpay`** (read-only), not Clio. The two must not be conflated; an outstanding AR balance is not a low trust balance.

## Wedge skill → Clio tool dependency map (this phase: reads + conservative writes only)

| Wedge skill                | Clio reads                                                                                                                        | Clio writes (this phase)                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `new-matter-intake`        | `search_contacts` (dedupe **+ conflict detect**), `get_contact`, `list_matters`/`get_matter` (conflict cross-check), `list_users` | `create_note` (internal log) only; **matter is drafted, not `create_matter`** |
| `consult-scheduler`        | `list_calendars`, `list_calendar_entries`, `get_matter`, `list_users`                                                             | none autonomous; calendar entry **surfaced for human confirm**                |
| `engagement-letter-chaser` | `get_matter`, `list_documents` (e-sign status arrives via ESign, fixture-supplied)                                                | `create_note` (log on signature)                                              |
| `matter-status-responder`  | `get_matter`, `list_tasks`, `list_calendar_entries`, `list_documents`                                                             | none                                                                          |
| `trust-balance-nudge`      | **LawPay** (read-only) for balance; `get_matter` for context                                                                      | none — **zero fund-movement, enforced as a `fails` invariant**                |
| `stalled-matter-nudge`     | `list_matters`, `get_matter`, `list_tasks`, `list_calendar_entries` (activity recency)                                            | `create_note` (log the nudge)                                                 |

**Conflict detect-and-halt** (absorbed into `new-matter-intake`, wedge plan / critique #3) is implementable **read-only** via `search_contacts(query)` + `list_matters` name cross-check — no write needed to surface a hit.

## ASSUMED — unverified vs. a live Clio tenant (scope the connect-step diff)

- Exact field names/types of `get_matter` / `get_contact` / `list_tasks` payloads (e.g., the "responsible attorney", "practice area", "open date", last-activity timestamp keys) are **assumed** from the input-parameter names; verify against the sandbox before relying on a specific key in `output-format.md`.
- "Last activity" for `stalled-matter-nudge` has no dedicated read; recency is **inferred** from the most recent of `list_tasks` / `list_calendar_entries` / notes timestamps — confirm there is no first-class `updated_at` on the matter at connect.
- Pagination caps (`export_audit_log` max 1000/page) noted; other tools' default `limit` values unstated — assume small, paginate.

## CONNECT-STEP DIFF — source-level (oktopeak/clio-mcp v2.0.0, read 2026-06-05)

Read the connector's actual tool source (`src/tools/*.ts`) ahead of the live round-trip. This resolves most of the ASSUMED list from the published-doc shapes; the **live-tenant** round-trip (ADR 0038 §3.6) still has to confirm Clio's API returns these fields populated. Three findings carry forward; the rest confirm.

**Finding 1 — `create_matter` AND `create_calendar_entry` ARE registered, callable tools in the v2.0.0 source**, contradicting the README's "write restricted to tasks/notes/documents." The README is **not authoritative**; the code registers both writes. Our fail-closed draft-and-surface posture stays correct as the _default_, but the connect step must **empirically test** whether each write actually succeeds against the sandbox (Clio plan / OAuth-scope dependent) before deciding whether either skill may graduate to autonomous-write. Do not treat "gated" as settled.

**Finding 2 — matter reads carry NO responsible/originating attorney.** `MATTER_DETAIL_FIELDS` = `id,display_number,description,status,client{id,name},practice_area{id,name},open_date,close_date,billable`. `responsible_attorney`/`originating_attorney` are **create-only inputs**, never returned by `get_matter`/`list_matters`. Any skill that needs "who owns this matter" (addressing a status reply, routing a nudge) cannot read it from the matter. Mitigation is a fork/config to widen the field const, or a separate `list_users` association — **not free.** Audit `matter-status-responder`, `stalled-matter-nudge`, `consult-scheduler` output-formats for an attorney dependency before "deliverable."

**Finding 3 (sharpest) — there is no matter-level last-activity signal.** `get_matter` has no `updated_at`; `list_tasks` exposes `due_at` (a _future_ due date, no `created_at`/`updated_at` in `TASK_FIELDS`); calendar entries give `start_at`/`end_at`. So "when did this matter last see activity" is **not cleanly answerable** from the current tool surface. `stalled-matter-nudge`'s trigger is thinner than the fixtures assume — its "gone quiet" detection needs a re-think (e.g. lean on note timestamps via a different read, or accept a weaker heuristic and say so). Flag per ADR 0038 tripwire: a wedge skill whose signal the connector can't supply is a mis-cut to address, not paper over.

**Confirmed (no divergence):**

- `search_contacts` returns the assumed envelope — `{ contacts[], total_count (meta.records), has_more, next_page_token }`; `next_page_token` parsed from `meta.paging.next`.
- `get_contact` carries `created_at`/`updated_at` (matters do not).
- Matter identifier is `display_number`; matter status enum is `open|pending|closed`.
- `list_tasks` status input is Capitalized (`Pending|Complete|In Progress|In Review|Draft`) → mapped to lowercase for the API; `due_date` is `due_at[:10]`.
- `get_billing_summary` → `{ matter_id, bill_count, total_billed, total_outstanding, last_invoice_date }` — note the key is **`total_outstanding`**, not the assumed `outstanding_balance`; filters out `draft`/`void` bills. This is AR, **not trust** (confirms trust rides `build:lawpay`).
- Default `limit` is 25 (max 200) across list tools; 429 rate-limit retry/backoff is built in.
