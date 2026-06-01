---
name: inbox-triage
description: Daily Gmail triage with categorized reply drafts for owner.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: [python3]
metadata:
  hermes:
    tags: [Email, Triage, Draft, SMD, Customer-Zero]
  smd:
    customer: smd
    trust_ceiling: draft_for_review
---

# SMD Inbox Triage Drafter

## When to Use

Reads unread mail from Captain's Gmail, produces a structured triage document with categorization, priority, and (for replies) draft text. Writes output to a daily note file. **Never sends, never archives, never replies on the user's behalf.** Captain reads, ships, and grades.

This is SMD's customer-zero capability. We are using ourselves to learn the delivery shape before we sell it to marketing agencies.

## Prerequisites

Requires Google Workspace skill (`productivity/google-workspace`) and `python3`. See frontmatter.

## How to Run

Triage the current unread inbox:

```
hermes run inbox-triage
```

Triage a specific window:

```
hermes run inbox-triage --window "newer_than:2d"
```

Triage at most N messages (cost / latency cap):

```
hermes run inbox-triage --max 25
```

## Procedure

The skill runs in two phases. The mechanical fetch loop runs inside a single `execute_code` block — intermediate per-message tool results never enter the conversation context (ADR 0021 Stream A). Classification, drafting, and the cross-message theme scan stay in the agent's reasoning loop where they belong.

### Phase 1 — Fetch (single `execute_code` block)

Invoke `execute_code` with a Python script that does the mechanical work. `crane_gmail.py` is the SMD-maintained Gmail reader (reads the principal's inbox via a user-OAuth token on the volume, ADR 0010; scope `gmail.modify` — read/archive/trash/draft, never send); `terminal` is exposed by `execute_code` (foreground mode only — see Hermes' code-execution docs):

```python
import json
import shlex

WINDOW = "newer_than:1d"   # override per `--window` arg
MAX_MESSAGES = 25          # override per `--max` arg
GMAIL = "/opt/hermes/.venv/bin/python3 /app/connectors/google/crane_gmail.py"

def run(cmd: str) -> str:
    """Call into the Hermes-exposed terminal tool. Strips trailing whitespace."""
    return terminal(cmd).strip()

# 1. Enumerate unread messages in the window.
search_query = f'is:unread {WINDOW}'
ids_raw = run(
    f'{GMAIL} gmail search {shlex.quote(search_query)} --max {MAX_MESSAGES}'
)
message_ids = [line.strip() for line in ids_raw.splitlines() if line.strip()]

# 2. Fetch full body for each. Accumulate; do NOT print per-message.
messages = []
for mid in message_ids:
    raw = run(f'{GMAIL} gmail get {shlex.quote(mid)} --format json')
    try:
        messages.append(json.loads(raw))
    except json.JSONDecodeError:
        # A single bad message must not abort the batch — record + continue.
        messages.append({"id": mid, "error": "parse_failed", "raw_excerpt": raw[:200]})

# 3. Emit ONE JSON document. This is the only thing that enters context.
print(json.dumps({
    "window": WINDOW,
    "fetched": len(messages),
    "messages": messages,
}, ensure_ascii=False))
```

Only the final `print()` output enters the conversation context — typically ~15-25k tokens for 25 messages instead of ~100 separate tool-call result blocks. The per-message body parsing and accumulation happens in the child process and stays there.

### Phase 2 — Reason (agent, in-context)

The agent reads the JSON returned by `execute_code` and, per the rules in `references/algorithm.md`:

1. **Classify each message** along three axes — `action_class`, `priority`, `confidence`. See `references/categorization-rubric.md`.
2. **Draft replies** for `REPLY`-classified messages, matching Captain's voice per `references/voice.md`. Drafts touching money / scope / commitment are forced `LOW` confidence regardless of prose quality.
3. **Name the next action** for `ACT`-classified messages — the specific tool/surface and the concrete step.
4. **Cross-message theme scan** — escalation patterns, gone-dark threads, repeated follow-ups, vendor/contract milestones.
5. **Write the daily note** to `~/.hermes/customer_notes/smd/triage-YYYY-MM-DD.md` per `references/output-format.md`.

Detailed per-axis rules and cross-message scan heuristics live in `references/algorithm.md`. The reference is the source of truth for what "good triage" looks like; this procedure is the dispatch shape.

### Trust Ceiling

Customer-zero ceiling for SMD: **draft only.**

The agent MAY:

- Read mail (`gmail.readonly`).
- Write to the local file system inside `~/.hermes/customer_notes/smd/`.
- Use `gws` calendar lookups in read-only mode to check Captain's availability before suggesting meeting times.

The agent MUST NOT, without explicit Captain instruction in the current invocation:

- Send mail (`gmail.send`).
- Reply to mail (`gmail.reply`).
- Modify labels, archive, or delete (`gmail.modify`).
- Create calendar events.
- Modify any file outside `~/.hermes/customer_notes/smd/`.

If the agent infers it would help to do one of these, it MUST instead include a "Recommended action that I did not take" note in the daily triage with the exact command it would have run.

### Voice Rules

**Two distinct identities — never conflate them:**

**1. Draft replies** (replies the agent prepares for Captain to send to third parties). These go out AS Captain, in Captain's voice. See `references/voice.md` for the long form. Hard rules:

- No em dashes. Period.
- No "I hope this email finds you well." No "Just wanted to follow up." No "Touching base."
- No "circle back," "synergy," "leverage," "level-set," "deep dive."
- Active voice. Short sentences. Plainspoken.
- Sign-off: "Scott" — never "Best regards" or similar.
- No emojis in business correspondence unless the inbound thread is already using them.

If the agent cannot write a draft that passes these rules, it marks the message `LOW` confidence and writes a one-line plan for the reply instead of attempting prose.

**2. The triage report itself** (the note/email the agent sends to Captain or `team@`). This is **Crane's own communication to its principal**, sent from Crane's own identity (`smdcrane@agentmail.to`) — Chief-of-Staff voice: plainspoken, direct, executive-summary first. It is authored AS Crane.

- **NEVER sign the report "Scott."** Crane is not the principal; signing as Scott is an identity error. Sign as "Crane" or use no sign-off.
- The same em-dash / no-AI-tell discipline applies.
- The "Sign-off: Scott" rule above governs the embedded draft _replies_ only, never the report envelope.

## Pitfalls

Common failures: high confidence on drafts that touch money/scope/commitment (these must be LOW even if prose is good); AI-tells leaking through; missing cross-message themes.

## Verification

A successful triage run satisfies all of:

1. Every unread message in the window gets a category and priority.
2. Every `REPLY` either has a draft Captain can ship with at most minor edits, OR is flagged `LOW` confidence with a one-line plan.
3. Themes are surfaced (the things Captain would otherwise miss by reading message-by-message).
4. No false confidence: anything that touches money, scope, or commitment is `LOW` confidence even if the prose is good.
5. Output is read in under 5 minutes by Captain. If the agent's draft is longer than that to skim, it's failing.

## References

- `references/algorithm.md` — detailed per-message classification, draft, and cross-message theme rules (ADR 0021 Stream A — extracted from the prior `## Procedure` section so the prose stays available for graders after the `execute_code` migration)
- `references/voice.md` — Captain's voice rules, with positive and negative examples
- `references/output-format.md` — exact structure of the daily triage note
- `references/categorization-rubric.md` — how the agent decides between action classes
- `references/test-cases.md` — synthetic inbox samples for regression testing
