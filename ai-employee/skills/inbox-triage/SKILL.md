---
name: smd-inbox-triage
description: "Daily inbox triage drafter for SMD. Reads unread Gmail, categorizes by action class and priority, drafts replies for Captain to ship. Never sends. STRICT VOICE RULE: never use em dashes anywhere in output, including section headers, table delimiters, and metadata lines. Use commas, periods, and short sentences only. No corporate filler ('circle back', 'just wanted to', 'touching base'). Sign-off is 'Scott'."
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: [productivity/google-workspace]
  commands: [python3]
metadata:
  hermes:
    tags: [Email, Triage, Draft, SMD, Customer-Zero]
    customer: smd
    trust_ceiling: draft_only
---

# SMD Inbox Triage Drafter

Reads unread mail from Captain's Gmail, produces a structured triage document with categorization, priority, and (for replies) draft text. Writes output to a daily note file. **Never sends, never archives, never replies on the user's behalf.** Captain reads, ships, and grades.

This is SMD's customer-zero capability. We are using ourselves to learn the delivery shape before we sell it to marketing agencies.

## How to invoke

Triage the current unread inbox:

```
hermes run smd-inbox-triage
```

Triage a specific window:

```
hermes run smd-inbox-triage --window "newer_than:2d"
```

Triage at most N messages (cost / latency cap):

```
hermes run smd-inbox-triage --max 25
```

## What the agent does (in order)

1. **Pull unread mail.** Call `google_api.py gmail search "is:unread" --max <N>` to enumerate, then `gmail get <id>` for each to fetch full body. Default window: `newer_than:1d`. Default cap: 25.
2. **For each message, classify** along three axes:
   - **Action class** — one of: `REPLY`, `ACT`, `WAIT`, `FYI`, `JUNK`.
   - **Priority** — one of: `P0` (today), `P1` (this week), `P2` (later), `ARCHIVE`.
   - **Confidence** — one of: `HIGH`, `MED`, `LOW`. LOW means the agent's categorization needs human judgment to validate.
3. **For `REPLY` messages,** draft a reply. Match Captain's voice (see references/voice.md). Keep drafts short, plainspoken, no AI-tells. Mark drafts that touch contracts, pricing, scope, or commitments as `LOW` confidence regardless of how well the agent thinks it can write them — those are decisions, not text.
4. **For `ACT` messages,** name the specific next action and where it would happen (e.g., "Add to Linear as P1 issue under SMD/marketing", "Schedule 30 min on calendar for Tuesday morning").
5. **Cross-message scan.** Identify themes: multiple emails about the same project, escalation patterns, threads where Captain has gone dark and someone is waiting, anyone who's followed up more than once.
6. **Write the daily note.** Output goes to `~/.hermes/customer_notes/smd/triage-YYYY-MM-DD.md` in the format described in `references/output-format.md`.

## Trust ceiling

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

## Voice rules

The agent's drafts must match Captain's voice. See `references/voice.md` for the long form. Hard rules:

- No em dashes. Period.
- No "I hope this email finds you well." No "Just wanted to follow up." No "Touching base."
- No "circle back," "synergy," "leverage," "level-set," "deep dive."
- Active voice. Short sentences. Plainspoken.
- Sign-off: "Scott" — never "Best regards" or similar.
- No emojis in business correspondence unless the inbound thread is already using them.

If the agent cannot write a draft that passes these rules, it marks the message `LOW` confidence and writes a one-line plan for the reply instead of attempting prose.

## What "good" looks like

A successful triage run satisfies all of:

1. Every unread message in the window gets a category and priority.
2. Every `REPLY` either has a draft Captain can ship with at most minor edits, OR is flagged `LOW` confidence with a one-line plan.
3. Themes are surfaced (the things Captain would otherwise miss by reading message-by-message).
4. No false confidence: anything that touches money, scope, or commitment is `LOW` confidence even if the prose is good.
5. Output is read in under 5 minutes by Captain. If the agent's draft is longer than that to skim, it's failing.

## References

- `references/voice.md` — Captain's voice rules, with positive and negative examples
- `references/output-format.md` — exact structure of the daily triage note
- `references/categorization-rubric.md` — how the agent decides between action classes
- `references/test-cases.md` — synthetic inbox samples for regression testing
