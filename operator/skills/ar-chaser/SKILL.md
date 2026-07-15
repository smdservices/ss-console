---
name: ar-chaser
description: Drafts AR-aging follow-ups from QuickBooks for owner review.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: []
metadata:
  hermes:
    tags: [Marketing, Agency, AR, Money, DraftForReview]
  smd:
    vertical: marketing-agency
    action_class: read + internal_write
    connectors:
      - quickbooks
      - gmail
      - slack
---

# AR Chaser

Reads aging-receivables data from QuickBooks Online, identifies invoices past 7 / 14 / 30 days, drafts polite follow-up messages, escalates to the owner at 45 days. The agent's drafts are sourced from the AR row — recipient, amount, invoice number, due date, days overdue. Every draft requires owner review before sending.

## When to Use

AR follow-up is the single highest-leverage agency task that owners chronically skip. Every $5K-$15K invoice that lingers past 60 days is a real risk of write-off; clients who pay late once will pay later the next time unless gently corrected. Owners hate doing it because the messages feel pushy and templated; doing them well is judgment work.

This skill reduces it to: every morning, owner reviews 3-8 drafts pre-tuned to the relationship history. Edits 30 seconds each, ships from their inbox. Aging stays under control without the emotional tax.

## Prerequisites

Requires QuickBooks Online (AR data), Gmail (drafts), and Slack (escalations) connectors. See frontmatter.

## How to Run

Daily cadence (8am PT) via cron-skill:

```
hermes run ar-chaser
```

On-demand for a specific client:

```
hermes run ar-chaser --client "Acme Co"
```

## Procedure

The skill runs in two phases. The mechanical per-invoice fetch loop runs inside a single `execute_code` block — intermediate per-invoice QBO + Gmail tool results never enter the conversation context (ADR 0021 Stream A). Cadence decisions, voice matching, draft prose, and relationship-health surfacing stay in the agent's reasoning loop where they belong.

### Phase 1 — Fetch (single `execute_code` block)

Invoke `execute_code` with a Python script that does the mechanical work. The script reads the QBO Aging Detail, then for each overdue invoice cross-checks payment status (defending against drafting a chase on an already-paid invoice — the #1 pitfall in `## Pitfalls` below) and pulls prior Gmail thread context for voice matching:

```python
import json
import shlex

DAYS_OVERDUE_FLOOR = 7   # ignore anything under floor
DAYS_OVERDUE_CEILING = 90  # nothing useful past 90; flag separately

def run(cmd: str) -> str:
    """Call into the Hermes-exposed terminal tool. Strips trailing whitespace."""
    return terminal(cmd).strip()

def safe_json(raw: str, fallback_id: str) -> dict:
    """Parse a connector response; on failure, record + continue rather than abort."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "parse_failed", "fallback_id": fallback_id, "raw_excerpt": raw[:200]}

# 1. Pull QBO Aging Detail, filter by overdue range.
aging_raw = run(
    f'qbo_connector.py aging --min-days {DAYS_OVERDUE_FLOOR} --max-days {DAYS_OVERDUE_CEILING} --format json'
)
aging = safe_json(aging_raw, fallback_id="aging")
invoices = aging.get("invoices", []) if isinstance(aging, dict) else []

# 2. For each overdue invoice, cross-check payment status + pull prior thread context.
invoice_payloads = []
for inv in invoices:
    invoice_id = inv.get("invoice_id")
    client_slug = inv.get("client_slug")

    # Payment status cross-check — defend against chasing an already-paid invoice.
    payment_raw = run(
        f'qbo_connector.py invoice payment-status {shlex.quote(str(invoice_id))} --format json'
    )
    payment = safe_json(payment_raw, fallback_id=f"payment.{invoice_id}")

    # Skip if QBO confirms paid since the aging snapshot.
    if isinstance(payment, dict) and payment.get("status") == "paid":
        invoice_payloads.append({
            "invoice_id": invoice_id,
            "client_slug": client_slug,
            "skipped_reason": "paid_since_snapshot",
            "payment_status": payment,
        })
        continue

    # Prior Gmail thread context — for voice match + payment-promise detection.
    thread_raw = run(
        f'gmail_connector.py threads --client {shlex.quote(str(client_slug))} --limit 5 --format json'
    )
    prior_threads = safe_json(thread_raw, fallback_id=f"thread.{client_slug}")

    invoice_payloads.append({
        "invoice_id": invoice_id,
        "client_slug": client_slug,
        "invoice": inv,
        "payment_status": payment,
        "prior_threads": prior_threads,
    })

# 3. Emit ONE JSON document. This is the only thing that enters context.
print(json.dumps({
    "as_of": aging.get("as_of") if isinstance(aging, dict) else None,
    "overdue_count": len(invoice_payloads),
    "invoices": invoice_payloads,
}, ensure_ascii=False))
```

Only the final `print()` output enters the conversation context — typically ~30-50k tokens for ~5-15 overdue invoices, instead of one tool-call result block per QBO and Gmail call. The per-invoice payment cross-check happens in the child process; invoices that came back paid since the aging snapshot are marked `skipped_reason: paid_since_snapshot` and the agent does NOT draft for them. A single connector failure becomes a `parse_failed` row inside the payload — the batch does not abort.

### Phase 2 — Reason (agent, in-context)

The agent reads the JSON returned by `execute_code` and, per the rules in `references/algorithm.md`, processes each overdue invoice:

1. **Skip paid-since-snapshot invoices.** Any payload entry with `skipped_reason: paid_since_snapshot` is omitted from the day's drafts. These appear in the Slack summary as "skipped (paid since snapshot)" so the owner can see the cross-check fired.
2. **Pick the cadence stage** by days-overdue: 7-13 (gentle reminder), 14-29 (firmer; ask if they need anything), 30-44 (direct; reference payment terms; offer call), 45+ (ESCALATE — no email; Slack-only).
3. **Detect payment-promise context** in `prior_threads`. If the client recently said "payment is in process" or "we'll get to it next week," the draft acknowledges that and offers to follow up at the date they named — it does NOT repeat the dunning sequence.
4. **Voice-match** against the client's prior thread tone (formality, paragraph density, salutation). The AR draft matches the relationship's existing tonality.
5. **Draft per cadence** for invoices in the 7-44 day band. Templates per stage live in `references/output-format.md`; the agent fills them with invoice number, amount, due date, days overdue, and prior-thread acknowledgments where present.
6. **Escalate at 45+ days** via Slack `@<owner>` mention in `ar-drafts`. No email draft is written for 45+ — the owner needs to call or pause services, not send another templated nudge.
7. **Surface relationship-health signals.** A normally-prompt client suddenly 30 days late is flagged in the Slack summary; multiple clients of the same vendor stack going late at once is a market-signal flag. These are anomaly notes, not blockers to drafting.
8. **Write per-invoice drafts** to `customer_notes/drafts/ar/{client_slug}-{invoice_id}-{stage}.md`. Post ONE summary thread to `ar-drafts` listing all drafts written, all escalations, and all anomaly flags.

Detailed cadence-stage thresholds, payment-promise detection rules, voice-matching logic, and anomaly heuristics live in `references/algorithm.md`. The reference is the source of truth for what "good AR chasing" looks like; this procedure is the dispatch shape.

### Trust Ceiling

**draft_for_review** is non-negotiable. AR touches money + client relationships. Even if a customer says "you can send these for me," the SOW does not authorize it and the substrate enforces draft-only on `gmail.send` for this skill.

**Content-sensitivity floor disposition (#1878).** This skill is deliberately NOT
authored floor-clean, unlike the graduatable law-pack chases. An AR chase is money
content by definition (invoice number, amount, due date are the substance of the
message), the ceiling above is non-negotiable draft-only, and the skill writes
drafts rather than issuing a classified proactive send — so the ADR 0031 floor never
gates it and never needs to. Do not strip "invoice"/"payment"/amounts from AR drafts
to chase floor-cleanliness; that would gut the draft a human reviews.

The agent MAY:

- Read QBO Aging Detail and individual invoice records
- Read prior Gmail threads for context (read scope only)
- Write drafts to the drafts folder
- Post Slack alerts in `ar-drafts`
- Tag `@<owner>` on 45+ day escalations

The agent MUST NOT:

- Send any email to a client
- Modify the QBO invoice (mark paid, write off, adjust amount)
- Pause services to a client autonomously (owner-only decision)
- Forecast that "the client will pay tomorrow" — only state what's verifiable

### Voice Rules

- Never adversarial. Even at 45+ days, the draft assumes good faith.
- Never reference legal action, late fees, or "collections" without explicit owner instruction.
- Never apologize for asking. "Just checking in" is fine; "Sorry to bother you, but..." is not.
- Reference the specific invoice (number + date) so the client doesn't have to dig.
- Offer a path: "Let me know if you need a fresh copy / different format / a call."

## Pitfalls

Common failures: drafting on an already-paid invoice (always cross-check QBO payment status), voice mismatch with prior threads, escalating before day 45.

## Verification

1. Every overdue invoice has a draft at the right cadence stage within 30 min of run start.
2. Voice matches the client's prior thread — if past threads were formal, the AR draft is formal; if casual, casual.
3. Escalations at 45+ days are unmissable in Slack (mentions, color, persistent).
4. Anomaly surface: relationship-health signals visible without the owner having to ask.
5. Zero false positives: a draft never goes out for an invoice that's actually paid (cross-check QBO payment status before drafting).

## References

- `references/algorithm.md` — detailed cadence-stage rules, payment-promise detection, voice-matching, paid-invoice cross-check, anomaly heuristics (preserved for graders post-`execute_code` rewrite)
- `references/voice.md` — AR voice (firm + warm; no apology, no threat)
- `references/output-format.md` — template per cadence stage; Slack-post structure
- `references/categorization-rubric.md` — cadence stage thresholds; relationship-health signals
- `references/test-cases.md` — synthetic AR fixtures (varied client tones, varied delay patterns)

## Cost estimate (filled by grading)

Post-`execute_code` rewrite (ADR 0021 Stream A). Per-invoice QBO and Gmail
intermediate results no longer enter the conversation context; only the
single Phase-1 JSON payload does.

- Typical tokens-in per run (5-15 overdue invoices): ~30-50K — one JSON document covering every overdue invoice with its payment-status cross-check and prior-thread context.
- Typical tokens-out per draft: ~500 (one per 7-44-day invoice; 45+ get a Slack escalation instead of an email draft).
- Hermes tool calls per run: 2 (one `execute_code` + one file-write / Slack-post batch). The per-invoice QBO and Gmail calls happen inside `execute_code` and don't count toward conversation context.
- Typical cadence: daily; ~5 drafts/day at a 20-client agency.

Pre-rewrite the parent agent saw ~10-25 separate tool-call result blocks per
run (one `execute_code` block replaces those, and adds the per-invoice
payment-status cross-check at zero conversation-context cost). Token
reduction expected ≥ 50% vs. baseline; grading harness confirms.

Monthly per customer at typical volume: <$2 in tokens, <$0.50 in tool calls.
