---
name: matter-status-digest
description: Assembles a periodic internal digest of the firm's matters from Clio — open matters by stage, upcoming dates, quiet matters, low-trust and held flags. Reports state; never decides legal next steps.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: [python3]
metadata:
  hermes:
    tags: [Law, Matter, Digest, Internal, DraftForReview]
  smd:
    vertical: law-firm
    skill_type: read + assembly (internal digest)
    trust_ceiling: draft_for_review
    action_class: read + internal_write
    connectors:
      - clio # PracticeManagement — matters, tasks, calendar, billing (read)
      - lawpay # Payments — trust balance (read-only) for the low-trust flag
    # Shared-core candidate. This is law's concrete realization of the status
    # "spine" role. It is NOT the marketing `status-report-assembler` (that skill
    # is `vertical: marketing-agency` — Asana/GA4/paid-media, client-facing
    # weekly reports). The shared digest core is EARNED at vertical-2, not
    # designed up front (ADR 0038 §7). Until then this is the law delta.
---

# Matter Status Digest

Assembles a periodic **internal** digest of the firm's matters from Clio: what's open and where it stands, what's coming due, what's gone quiet, what's low on trust, and what's held for conflict clearance. It is the principal's "state of the practice this week" view. It **reports state; it never decides or recommends a legal next step** — surfacing a quiet matter is connective work, deciding what that matter needs is the lawyer's.

This is the proactive counterpart to the wedge's reactive `matter-status-responder` (which answers one client's "where are we"). Same Clio reads, opposite direction: one client asking outward vs. the principal scanning inward.

## When to Use

A principal running a book of matters loses the forest for the trees: which matters are advancing, which are waiting on the firm, which on the client, which have gone silent, which are running low on retainer. Reconstructing that by clicking through Clio every week is the bottleneck. This skill assembles it — sourced, current, and honest about what Clio can and cannot tell — so the principal reads one digest instead of auditing the system.

Runs on the firm's cadence (e.g., a Monday-morning scan).

## Prerequisites

Reads Clio (`list_matters`, `get_matter`, `list_tasks`, `list_calendar_entries`, `get_billing_summary`) and, for the low-trust flag, the `build:lawpay` read-only balance (trust is NOT in Clio — `get_billing_summary` is AR, not trust; see `operator/verticals/law-firm/clio-surface.md`). Requires `python3` for the fetch block. Internal output only — this digest is for the principal, not a client.

## How to Run

```
hermes run matter-status-digest                  # full scan on cadence
hermes run matter-status-digest --status open
hermes run matter-status-digest --window 7d      # "what changed / came due" window
```

## Procedure

Two phases (ADR 0021 Stream A). The mechanical per-matter Clio fetch runs in one `execute_code` block so per-matter reads never flood context; the sectioning and flagging stay in the agent's reasoning loop.

### Phase 1 — Fetch (single `execute_code` block)

Enumerate matters (`list_matters`, filtered by `--status`), then per matter pull `get_matter` (stage, `updated_at`, responsible attorney — **pending the connector field-widening**, see below), `list_tasks` (open tasks + `due_at`), `list_calendar_entries` (upcoming events), and `get_billing_summary` (AR). Pull the LawPay trust balance per matter for the low-trust flag. Accumulate in-process; `print()` one JSON document. A single matter's read failure is a `parse_failed` row; the scan does not abort.

> **Connector dependency.** `responsible_attorney` and `updated_at` on matters require the matter-field-set widening tracked at the connect step (`clio-surface.md` findings 2–3). Until it lands, the digest omits the attorney column and falls back to calendar-entry recency for the quiet-matter flag, and says so in the header — it does not fabricate either.

### Phase 2 — Reason (agent, in-context)

Per `references/algorithm.md`, assemble the digest:

1. **Group by stage/status** — open matters bucketed by their Clio stage; counts up top.
2. **Upcoming dates** — tasks with a near `due_at` and calendar entries in the window, per matter. Sourced dates only; no invented deadlines.
3. **Quiet matters** — reuse `stalled-matter-nudge`'s recency model (`matter.updated_at` floored by latest calendar entry; the same `updated_at` caveat and fallback apply). Flag matters past the firm's window that are NOT legitimately waiting (open task with a future due date = waiting, not quiet).
4. **Low trust** — matters whose LawPay trust balance is below the firm's floor (read-only; never a fund movement).
5. **Held** — matters on conflict-hold surfaced in their own section (need human clearance, not a status line).
6. **Write the digest** to the firm's internal notes surface per `references/output-format.md`. Internal only.

## Trust Ceiling

**Assemble + surface autonomous; internal-only; `draft_for_review` if ever delivered externally.**

The agent MAY: read Clio + the LawPay trust balance; compute recency and flags; write the digest to the firm-internal notes surface.

The agent MUST NOT: recommend or decide a matter's next legal step; move or touch trust funds; send anything to a client; invent a date, balance, or stage; present a degraded signal as a precise one.

## Safety invariants (any violation → `fails`, no recovery)

1. **Reports, does not decide.** The digest states where matters stand and flags the quiet/low/held ones; it never prescribes the next legal step.
2. **No fabrication.** Every stage, date, and balance traces to a Clio/LawPay read. Missing data is shown as missing, not filled.
3. **Trust read-only.** The low-trust flag reads the balance; zero fund-movement calls, enforced independently of adapter capability.
4. **Held matters gated.** Conflict-held matters are surfaced separately, not folded into the normal status sections.
5. **Internal + privilege.** The digest is for the principal; matter detail stays on firm surfaces.

## Pitfalls

Recommending what a quiet matter needs (flag only); presenting `updated_at` recency as precise when the connector fallback is in effect; conflating AR (`get_billing_summary`) with trust (LawPay); inventing a due date when `list_tasks` is sparse.

## Verification

1. Every open matter appears once, in the right stage bucket.
2. Upcoming dates, quiet flags, low-trust flags, and held matters are each sourced; none invented.
3. No legal-next-step recommendation appears anywhere.
4. The recency signal's precision (full `updated_at` vs. calendar-only fallback) is stated in the header honestly.
5. The principal reads the practice's state in a few minutes without opening Clio.

## References

- `references/algorithm.md` — sectioning rules, the quiet/low/held flag logic, the recency reuse + caveat
- `references/output-format.md` — the digest structure (stage buckets, dates, flags, held) _(parity fast-follow)_
- `references/test-cases.md` — synthetic matter sets (advancing / waiting / quiet / low-trust / held) _(parity fast-follow)_
