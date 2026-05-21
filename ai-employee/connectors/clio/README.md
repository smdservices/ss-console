# Clio integration — community MCP pilot results

Status: **oktopeak/clio-mcp selected as primary integration.** Supplemental `protomated/legal-context-ce` available for document semantic search (Phase F1 talk-track or beta-week-1 add-on).

## Pilot summary

Two community MCPs evaluated for the PI law-firm demo:

| MCP                                                                           | Stars | Last push  | Tool count | Verdict                                                |
| ----------------------------------------------------------------------------- | ----- | ---------- | ---------- | ------------------------------------------------------ |
| [oktopeak/clio-mcp](https://github.com/oktopeak/clio-mcp)                     | 11    | 2026-05-05 | 15         | **Selected** — covers all 5 Clio-dependent skills      |
| [protomated/legal-context-ce](https://github.com/protomated/legal-context-ce) | 25    | 2026-05-01 | 4          | Supplemental only — documents-only via semantic search |

### oktopeak/clio-mcp tool surface (15 tools, OAuth 2.0)

| Domain         | Tools                                      | Used by which PI skills                                                                                                           |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Auth           | `authenticate`, `auth_status`, `logout`    | (all — connector setup)                                                                                                           |
| Matters        | `list_matters`, `get_matter`               | intake-triage, conflict-check, status-update, attorney-inbox-triage, time-entry-reconciliation, doc-collection, red-flag-watching |
| Contacts       | `search_contacts`, `get_contact`           | intake-triage, conflict-check                                                                                                     |
| Documents      | `list_documents`, `get_document`           | doc-collection                                                                                                                    |
| Tasks          | `list_tasks`, `create_task`                | status-update, doc-collection, red-flag-watching                                                                                  |
| Calendar       | `list_calendar_entries`                    | time-entry-reconciliation, intake-triage (scheduling)                                                                             |
| Time & Billing | `list_time_entries`, `get_billing_summary` | time-entry-reconciliation, red-flag-watching                                                                                      |
| Notes          | `create_note`                              | status-update, red-flag-watching                                                                                                  |

**Write coverage:** read-mostly. Write-limited to `create_task` and `create_note` in v1 (per maintainer's "v1 scope" note). Acceptable for our trust ceilings — none of our 8 Track-1 skills are autonomous-write to Clio. The two writes that fit our model (task + note) are both autonomous-internal-write per our ActionClass.

**Auth flow:** OAuth 2.0, browser-launched `authenticate` tool, tokens encrypted at rest (AES-256-GCM, `~/.clio-mcp/tokens.enc`). Audit log in JSON Lines. Regional support via env vars (`CLIO_API_BASE`, `CLIO_AUTH_URL`, `CLIO_TOKEN_URL`).

### protomated/legal-context-ce (supplemental, not primary)

4 tools, documents-only via LanceDB semantic vector search. Free-tier limited to 100 indexed documents + 50 queries/day. Does NOT cover matters, contacts, calendar, billing. Useful for the `law-client-document-collection` skill if a firm has a large internal document corpus and wants semantic search across it. **Not in Track 1 critical path** — protect the demo by keeping the primary Clio integration on oktopeak, mention legal-context as an add-on capability in the stack-swap talk track.

## Skill-by-skill Clio dependency map

| Skill                          | Tools needed                                                                    | Coverage by oktopeak                                                 |
| ------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| law-pi-intake-triage           | `search_contacts`, `list_matters`, `create_task` (assign to intake coordinator) | ✓ Full                                                               |
| law-conflict-check             | `search_contacts`, `list_matters`, `get_contact`, `get_matter`                  | ✓ Full                                                               |
| law-client-status-update       | `get_matter`, `list_time_entries`, `list_calendar_entries`, `create_note`       | ✓ Full                                                               |
| law-attorney-inbox-triage      | `list_matters`, `get_matter` (matter lookup from email subject/sender)          | ✓ Full                                                               |
| law-signing-page-chase         | DocuSign-side; no Clio dependency                                               | n/a                                                                  |
| law-time-entry-reconciliation  | `list_time_entries`, `list_matters`, `list_calendar_entries`                    | ✓ Full                                                               |
| law-client-document-collection | `list_documents`, `get_document`, `create_task`                                 | ✓ Full (supplemented optionally by legal-context-ce semantic search) |
| law-red-flag-watching          | `get_matter`, `list_time_entries`, `get_billing_summary`, `create_note`         | ✓ Full                                                               |

**Conclusion:** oktopeak covers 100% of our Track-1 demo capability needs. No custom thin Clio wrapper required.

## What's NOT in oktopeak's surface (acknowledged gaps)

- **Custom matter fields.** Clio supports tenant-defined custom fields (e.g., "Case Value," "Insurance Carrier ID"). oktopeak's `get_matter` returns standard fields; custom-field access is not documented. If the firm uses custom fields for PI case tracking (likely), we either (a) read them via the Clio API directly through a thin extension to oktopeak, (b) demo without them and narrate. Decision deferred until meeting.
- **Trust account operations.** Trust deposit, trust withdrawal, trust ledger. oktopeak does not expose. PI firms care about trust accounts a lot. **Out of scope per PI safety policy** (we don't touch trust accounts; LawPay handles deposits, firm handles disbursements).
- **Email integration inside Clio.** Clio has its own Outlook-style email module; oktopeak doesn't expose it. Our skills route email via Gmail/Composio, not Clio. Mention in stack-swap talk track for firms that route everything through Clio's email.
- **Document upload / version creation.** `list_documents` and `get_document` are read-only. Document collection skill posts back to the matter via `create_note` ("requested medical records on May 19") rather than uploading documents directly.

## Sandbox-vs-prod handling

See `SANDBOX_VS_PROD.md`.

## Status

- [x] Repos evaluated — tool surface mapped
- [x] Skill dependency mapping complete — 100% coverage
- [ ] **Captain action required:** Create Clio Developer Application at https://app.clio.com/settings/developer_applications (or sandbox equivalent). Capture `client_id` + `client_secret`. Paste via pbpaste into `fly secrets set` for `hermes-demo-law`.
- [ ] Live OAuth round-trip against Clio sandbox
- [ ] Add oktopeak/clio-mcp install to `hermes-demo-law` bootstrap
- [ ] First `list_matters` round-trip from inside the container

## Decision rationale

**Why oktopeak over protomated as primary:** oktopeak covers matters/contacts/calendar/billing/tasks/documents/time — the full operational surface a PI firm runs on. protomated is documents-only via semantic search; useful but narrow.

**Why not BUILD a custom Clio wrapper from scratch:** oktopeak's 15 tools cover 100% of Track-1 demo needs. Building a custom wrapper duplicates ~1-2 days of work the maintainer has already done, in a more battle-tested form. The cost (community-maintained, no vendor SLA) is acceptable for a demo + early beta. If we hit production scale with a regulated customer, we revisit.

**Why use both:** oktopeak for the operational surface (Phase F1 demo critical path). legal-context-ce as a supplemental capability mentioned in the talk track for firms with deep document libraries who want semantic search ("we add this on in week 2 of beta if you have a doc corpus").
