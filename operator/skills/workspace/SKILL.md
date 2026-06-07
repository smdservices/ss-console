---
name: workspace
description: On-demand read + draft for Gmail, Calendar, and Drive/Docs via the operator's scope-limited Google CLIs.
version: 0.1.0
author: SMD Services
license: MIT
platforms: [linux, macos]
prerequisites:
  skills: []
  commands: [python3]
metadata:
  hermes:
    tags: [Email, Calendar, Drive, Docs, Google, SMD, Customer-Zero]
  smd:
    customer: smd
    trust_ceiling: draft_for_review
---

# Workspace (Google) — read + draft on demand

## When to Use

Whenever the principal asks Crane, conversationally, to look at or act on their
Google Workspace: "what's in my inbox?", "what's on my calendar tomorrow?",
"find the Acme proposal in my Drive and summarize it", "draft a calendar hold
for Thursday 2pm", "start a draft doc with these notes".

This is the operator-owned Google path. **Do not reach for the Hermes-native
`google-workspace` or `himalaya` skills — they are disabled for this customer**
(they mint an unscoped, send-capable credential the architecture forbids). The
configured, scope-limited path is the three CLIs below.

## The connectors

All three are thin CLIs on one scope-limited user-OAuth token
(`/opt/data/oauth/google.json`, ADR 0010). Run them via `execute_code`'s
`terminal` so mechanical fetch loops stay out of the conversation context
(ADR 0021), exactly like `inbox-triage`:

```python
PY    = "/opt/hermes/.venv/bin/python3"
GMAIL = f"{PY} /app/connectors/google/crane_gmail.py"
CAL   = f"{PY} /app/connectors/google/crane_calendar.py"
DRIVE = f"{PY} /app/connectors/google/crane_drive.py"
```

**Gmail** (`crane_gmail.py`, scope `gmail.modify` — read/label/archive/draft, **no send**)

- `gmail search "<query>" [--max N]` → message IDs
- `gmail get <id> [--format json|meta]` → one message

**Calendar** (`crane_calendar.py`, scope `calendar.events`)

- `list-events [--time-min T --time-max T --q … --max N]` → events JSON
- `get-event <id>` → one event
- `create-event-draft --title … --start … --end … [--description … --location …] --drafted-by-skill workspace`
  → creates an **unconfirmed** event with **no attendees and no notifications**
  (`sendUpdates=none`). The principal adds external attendees and sends the
  invite from their own calendar client (reviewer-as-sender, ADR 0005).
- `update-event-draft <id> [--title … --start … …]`

**Drive + Docs** (`crane_drive.py`, scopes `drive.readonly` + `drive.file`)

- `list [--folder ID --q "<drive query>" --max N]` → files JSON
- `get <id>` → file metadata
- `export <id> [--mime text/plain]` → Doc/file content as text
- `create-doc --title … --content … [--folder ID] --drafted-by-skill workspace`
  → creates an **app-owned** draft Google Doc. No external sharing.

Each CLI also has a `capabilities` subcommand printing its CapabilitySet
(ADR 0006 disclosure) — useful when asked what it can do.

## Trust posture

Reads are autonomous. Creates (`create-event-draft`, `create-doc`) write to the
principal's **own** Workspace as drafts/unconfirmed items, never to an external
recipient — there is **no send / share / invite verb on any of these CLIs**. The
hard wall is the token scope (Google refuses anything outside it), not these
verbs; that scope is what the principal authored at consent (ADR 0035).

Anything that would notify or share with an external party is out of scope:
surface it as a "recommended action I did not take" with the exact step, the
same way `inbox-triage` does.

## Verification

- A read request returns the actual Gmail/Calendar/Drive data, not a native-skill
  "no OAuth" fallback.
- A "draft a calendar hold" request creates a tentative, attendee-free event and
  reports its ID; no invitation is sent.
- A "start a draft doc" request creates an app-owned Doc and reports its link.
