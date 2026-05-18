# Dotloop MCP wrapper

Custom MCP server wrapping the Dotloop Public API v2. Required for the real estate vertical pack — Dotloop is the market-leader transaction management platform (10,000+ brokerage partners, ~150M transactions processed; Zillow-owned). Per `docs/strategy/ai-employee-connector-coverage-2026-05-14.md`: Tier-1 BUILD, ~1-2 days, cleanest API of the RE transaction-management set.

## Auth

OAuth 2.0 Authorization Code flow. Customer registers an OAuth app at developer.dotloop.com (or via Zillow's developer portal). Same shape as LawPay's OAuth.

Base URL: `https://api-gateway.dotloop.com/public/v2`

## What this wrapper exposes

### Read tools (autonomous-eligible)

- `dotloop_list_loops` — transactions (called "loops") with filters
- `dotloop_get_loop` — single loop detail (parties, status, documents)
- `dotloop_list_loop_documents` — documents in a loop
- `dotloop_get_document` — single document metadata + download link
- `dotloop_list_loop_tasks` — task list for a loop (deadlines, contingencies)
- `dotloop_list_profiles` — agents/profiles in the brokerage
- `dotloop_get_profile` — single profile

### Internal-write tools (autonomous-eligible)

- `dotloop_add_task` — add a task/checklist item to a loop (internal coordination)
- `dotloop_note_loop` — add an internal note to a loop

### Gated write tools (require explicit approval)

- `dotloop_send_signing_packet` — send documents for signature via Dotloop's e-signing flow
- `dotloop_share_loop` — share a loop with an external party (e.g., opposing agent)

### Refused operations

- Modifying executed (signed) documents
- Deleting loops or documents
- Changing brokerage configuration

## Sandbox-vs-prod gap

Dotloop has a developer sandbox at `api-gateway-sandbox.dotloop.com` with test loops + test agents. Setup tested against sandbox; production uses the customer's real OAuth client.

## Configuration

Env vars:
- `DOTLOOP_CLIENT_ID`, `DOTLOOP_CLIENT_SECRET`, `DOTLOOP_REDIRECT_URI`
- `DOTLOOP_ENV` — `prod` (default) or `sandbox`

Per-customer tokens stored at `/opt/data/dotloop/{customer_id}/tokens.json` (same pattern as LawPay).

## Status

- [x] Public API v2 docs reviewed at dotloop.github.io/public-api/
- [ ] OAuth flow tested against sandbox
- [ ] Read tools implemented
- [ ] Internal-write + gated tools implemented
- [ ] Tests
- [ ] Container integration

Estimate: ~1-2 days for end-to-end.
