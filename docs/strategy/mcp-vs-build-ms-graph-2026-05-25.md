---
title: MCP vs BUILD — `ms_graph` connector retirement decision packet
date: 2026-05-25
captain: Scott Durgan
related-adr: docs/adr/0020-connector-strategy.md, docs/adr/0021-leverage-hermes-native-primitives.md
related-issue: https://github.com/venturecrane/ss-console/issues/1051
deliverable: Recommendation — RETIRE
---

# MCP vs BUILD — `operator/connectors/ms_graph/` retirement evaluation

Per ADR 0020's MCP-first directive and ADR 0021 Stream F. Evaluates whether to
retire the BUILD `ms_graph` connector in favor of available Microsoft Graph
MCP servers. Read-only research; the migration PR and removal PR ship
separately if Captain accepts this recommendation.

## TL;DR

**Recommendation: RETIRE.** Migrate Email + Calendar to Microsoft's
first-party MCP servers (`mcp:m365-mail`, `mcp:m365-calendar`) and
DocumentStorage to `mcp:softeria/ms-365-mcp-server` (community MIT,
already referenced in our test fixtures and ADR 0020). Delete the BUILD
adapter entirely.

The 48-hour customer-zero parallel-run gate the original ADR 0021 plan
contemplated is **not required** — customer-zero (SMD's own synthetic
fixture at `operator/bin/fixtures/smd/customer.yaml`) binds Email to
`adapter: synthetic, backend: synthetic:fixture`. There is no production
usage of `build:ms-graph` to coordinate around.

## 1. Current BUILD adapter surface

The connector at `operator/connectors/ms_graph/` is 2,456 lines of
Python across 8 files implementing three capability interfaces from
`docs/specs/operator/capability-contracts.md`:

| File                  | LoC      | Owns                                                                                                                                                                                                                                                                 |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mailbox.py`          | 526      | `MSGraphMailbox` — `Email` capability: read messages, list mail folders, create drafts                                                                                                                                                                               |
| `calendar_adapter.py` | 572      | `MSGraphCalendar` — `Calendar` capability: read events via `/me/calendarView`, manipulate events via `/me/events`, scheduling availability via `/me/calendar/getSchedule`                                                                                            |
| `drive.py`            | 273      | `MSGraphDrive` — `DocumentStorage` capability: read from `/me/drive`, write confined to `/me/drive/special/approot` (the agent's AppFolder)                                                                                                                          |
| `send.py`             | 245      | `MSGraphMailSend` — Mail.Send adapter. **Currently NOT wired** per Phase 1 scope rules (issue #881 wave-2 follow-on). The `MSGraphOAuth` constructor refuses to ship if `Mail.Send` appears in the requested scope list — defense-in-depth against accidental drift. |
| `oauth.py`            | 426      | OAuth token lifecycle. 10-minute refresh safety margin. `invalid_grant` → `AdapterError(code="auth_expired")`. Token storage per ADR 0010: `/opt/data/oauth/microsoft.json`, `0600` mode, owned by uid 10000.                                                        |
| `_client.py`          | 143      | Base Graph REST client (HTTP, retries, error mapping)                                                                                                                                                                                                                |
| `_types.py`           | 227      | Domain models                                                                                                                                                                                                                                                        |
| `__init__.py`         | 44       | Module exports                                                                                                                                                                                                                                                       |
| `tests/`              | (varies) | Lifecycle: storage round-trip, refresh on expiry, `invalid_grant` mapping, 0600 mode, scope-set integrity, no `Mail.Send` leakage                                                                                                                                    |

Phase 1 delegated scopes (`oauth.PHASE_1_SCOPES`):

- `offline_access` — required for refresh token
- `User.Read`
- `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.Read`
- `Calendars.ReadWrite`
- `Files.Read`, `Files.ReadWrite.AppFolder`

Notably absent: `Mail.Send`. The Phase 1 safety property: even if a skill's
trust ceiling escalated, the OAuth grant doesn't carry send permission, so
nothing can leave the customer's mailbox via this connector.

## 2. Per-skill capability usage

SMD skills reference capability interfaces (`Email`, `Calendar`,
`DocumentStorage`), not the `ms_graph` adapter directly. The capability →
adapter binding lives in `customer.yaml.connectors[].adapter`. This
abstraction means a retire-to-MCP migration is a customer.yaml change,
not a skill-source change.

Grep confirms no skill SKILL.md or skill code references `ms_graph` by
name. The only references in `operator/` outside `connectors/ms_graph/`
itself:

- `operator/customers/_template/customer.yaml` — example placeholders
  showing `adapter: '[gmail / microsoft-graph / synthetic]'` and
  `backend: '[composio:gmail / build:ms-graph / synthetic:fixture]'`
- `operator/templates/customer-no-pm-system.yaml` — has a `token_ref`
  for `microsoft-graph-oauth-refresh` (relic from when the no-PM-system
  template assumed M365)

**Customer-zero impact: none.** SMD's fixture binds Email to synthetic.
The ms_graph adapter exists for future small-firm customers running on
Microsoft 365, none of whom are currently provisioned.

## 3. Microsoft Graph MCP server inventory

Per ADR 0020's per-vendor decision table and a fresh 2026-05-25
verification pass against `github.com/microsoft/mcp`:

### First-party (Microsoft-maintained)

| Server              | Capability                            | Host                                                                            | Auth                       | Maturity                                                                                                   |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `mcp:m365-mail`     | Email (Outlook)                       | `agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_MailTools` | Per-tenant Microsoft Entra | Production (per ADR 0020 §"Microsoft 365 first-party MCP servers"); covers Mail.Read, Mail.ReadWrite       |
| `mcp:m365-calendar` | Calendar                              | Same host pattern, `/servers/mcp_CalendarTools`                                 | Per-tenant Entra           | Production                                                                                                 |
| `mcp:m365-teams`    | InternalComms (Teams)                 | Same host pattern, `/servers/mcp_TeamsServer`                                   | Per-tenant Entra           | Production (not relevant to this retirement; SMD doesn't currently use Teams)                              |
| (none)              | DocumentStorage (OneDrive/SharePoint) | —                                                                               | —                          | **NOT YET SHIPPED.** Microsoft has not released a first-party OneDrive or SharePoint MCP as of 2026-05-25. |

Microsoft's auth model differs from our current per-customer delegated
OAuth: each customer is a Microsoft 365 tenant, the MCP server URL is
per-tenant, and authentication is Entra tenant-based. The Fly volume
token storage (ADR 0010) is replaced by per-tenant server URLs configured
in `customer.yaml.connectors[].backend`.

### Community (third-party-maintained)

| Server                           | Capability                                    | License                          | Auth                                          | Maturity                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------- | -------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `softeria/ms-365-mcp-server`     | Mail + Calendar + OneDrive/SharePoint + Excel | MIT                              | Delegated OAuth (matches our current pattern) | Actively maintained per `github.com/softeria/ms-365-mcp-server`. Already referenced in `tests/customer-yaml-validator.test.ts` fixture as `mcp:softeria/ms-365-mcp-server`. |
| `MartinM85/mcp-server-graph-api` | Broad Graph API                               | (verify license before adoption) | Varies                                        | C# implementation. Lower priority — softeria covers what we need.                                                                                                           |
| `merill/lokka`                   | Broad Graph API                               | (verify license before adoption) | Varies                                        | General Graph API exposure. Lower priority.                                                                                                                                 |

`softeria/ms-365-mcp-server` is the obvious community choice: MIT,
already in our config namespace, covers the three capabilities we wire,
delegated-OAuth model matches our existing token-storage architecture.

## 4. Coverage-parity matrix

Per-method coverage of the BUILD adapter's surface against the proposed
target backends. ✓ = covered; ✗ = gap.

### Email (currently `MSGraphMailbox`)

| Method                                    | BUILD `mailbox.py`                       | `mcp:m365-mail`                               | `mcp:softeria`                                |
| ----------------------------------------- | ---------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `list_messages(folder, since, page_size)` | ✓                                        | ✓                                             | ✓                                             |
| `get_message(message_id)`                 | ✓                                        | ✓                                             | ✓                                             |
| `list_mail_folders()`                     | ✓                                        | ✓                                             | ✓                                             |
| `create_draft(to, cc, subject, body, …)`  | ✓                                        | ✓                                             | ✓                                             |
| `update_draft(draft_id, …)`               | ✓                                        | ✓                                             | ✓                                             |
| `delete_draft(draft_id)`                  | ✓                                        | ✓                                             | ✓                                             |
| `send_message(...)`                       | **deliberately absent** (#881 follow-on) | available but not exposed via our scope grant | available but not exposed via our scope grant |

**Verdict: full coverage.** The send-blocking safety property is
preserved by the OAuth scope grant (`Mail.Send` not requested) regardless
of whether the BUILD adapter or the MCP server invokes the API.

### Calendar (currently `MSGraphCalendar`)

| Method                                     | BUILD `calendar_adapter.py` | `mcp:m365-calendar` | `mcp:softeria` |
| ------------------------------------------ | --------------------------- | ------------------- | -------------- |
| `list_events(window_start, window_end, …)` | ✓                           | ✓                   | ✓              |
| `get_event(event_id)`                      | ✓                           | ✓                   | ✓              |
| `create_event(...)`                        | ✓                           | ✓                   | ✓              |
| `update_event(...)`                        | ✓                           | ✓                   | ✓              |
| `delete_event(event_id)`                   | ✓                           | ✓                   | ✓              |
| `get_schedule(emails, window)` (free/busy) | ✓                           | ✓                   | ✓              |

**Verdict: full coverage.**

### DocumentStorage (currently `MSGraphDrive`)

| Method                                                                | BUILD `drive.py` | First-party       | `mcp:softeria`                                               |
| --------------------------------------------------------------------- | ---------------- | ----------------- | ------------------------------------------------------------ |
| `list_children(path)`                                                 | ✓                | **NOT AVAILABLE** | ✓                                                            |
| `read_file(path)`                                                     | ✓                | **NOT AVAILABLE** | ✓                                                            |
| `write_file(path, content)` — confined to `/me/drive/special/approot` | ✓                | **NOT AVAILABLE** | ✓ — confinement enforced by OAuth scope, not endpoint choice |
| `create_folder(path)`                                                 | ✓                | **NOT AVAILABLE** | ✓                                                            |
| `share_link(path, scope)`                                             | ✓                | **NOT AVAILABLE** | ✓                                                            |

**Verdict: full coverage via softeria; no first-party option.** The
AppFolder-confinement safety property is preserved via OAuth scope
(`Files.ReadWrite.AppFolder`, not `Files.ReadWrite`) regardless of which
endpoint the MCP hits. Microsoft's permission model rejects writes
outside the AppFolder if the only granted scope is `Files.ReadWrite.AppFolder`.

## 5. Auth migration path

The current model:

- Per-customer Azure AD app registration consents during `bin/reauth-connector.sh`.
- Refresh token lands on Fly volume at `/opt/data/oauth/microsoft.json` (`0600`, uid 10000).
- `MSGraphOAuth.get_valid_tokens()` refreshes with a 10-min safety margin.
- Token JSON shape matches ADR 0010 § Storage shape.

**For `softeria/ms-365-mcp-server`**: same pattern. The MCP server is a
local subprocess; it reads OAuth tokens from environment variables or a
configured path. We point it at the same Fly-volume location. The
`provision-customer.sh` flow continues to handle consent and refresh.

**For Microsoft's `mcp:m365-mail` / `mcp:m365-calendar`**: per-tenant
Entra auth replaces delegated OAuth. Migration requires:

- Each customer M365 tenant added to our Azure AD multi-tenant app
- `customer.yaml.connectors[].backend` carries the per-tenant URL:
  `mcp:m365-mail+tenant_id={tenant_id}` (exact syntax follows the ADR 0020
  pattern documented in §"Per-vendor decision table")
- The Fly-volume token file is no longer used for these capabilities
  (Microsoft's MCP handles token lifecycle on its side)

Migrating Email + Calendar to first-party is the larger lift; migrating
DocumentStorage to softeria is a direct slot-in.

## 6. Recommendation

**RETIRE.** Two-step migration:

### Step A — Migration PR (Wave 3 F.1)

Update three configurations:

1. `operator/customers/_template/customer.yaml` — change example
   bindings:

   ```yaml
   Email:
     adapter: microsoft-graph
     backend: 'mcp:m365-mail+tenant_id=[CUSTOMER_M365_TENANT_ID]'
   Calendar:
     adapter: microsoft-graph
     backend: 'mcp:m365-calendar+tenant_id=[CUSTOMER_M365_TENANT_ID]'
   DocumentStorage:
     adapter: microsoft-graph
     backend: 'mcp:softeria/ms-365-mcp-server'
     scopes:
       - https://graph.microsoft.com/Files.Read
       - https://graph.microsoft.com/Files.ReadWrite.AppFolder
   ```

2. `operator/templates/customer-no-pm-system.yaml` — same change to
   the live binding (currently `backend: build:ms-graph` for all three).

3. `operator/bin/provision-customer.sh` — drop the `MSGraphOAuth`
   consent step from the boot sequence for `mcp:m365-mail` / `mcp:m365-calendar`
   bindings; keep it for `mcp:softeria` (which still uses delegated OAuth).

4. `operator/connectors/ms_graph/README.md` — add a deprecation banner
   pointing at this decision packet and the removal PR (next step).

No customer-zero coordination needed (synthetic Email binding).

### Step B — Removal PR (Wave 4 F.2)

Once the migration PR lands and the safety substrate test battery
(`run_invariants.py`) passes against the new bindings on any test
customer, delete the BUILD adapter:

1. `rm -rf operator/connectors/ms_graph/`
2. Update `docs/adr/0020-connector-strategy.md` — record the retirement
   (under the "Retired connectors" section, which doesn't exist yet; add
   it as part of this PR)
3. Update `docs/adr/0021-leverage-hermes-native-primitives.md` Stream F
   acceptance — confirm RETIRE recommendation was approved
4. Remove the `microsoft-graph-oauth-refresh` `token_ref` from
   `customer-no-pm-system.yaml` (per-tenant Entra auth replaces it)

### Step C — Future hook for first-party OneDrive MCP

When Microsoft ships a first-party OneDrive/SharePoint MCP (currently
absent per ADR 0020), file a follow-on issue to migrate DocumentStorage
from `softeria` to the first-party server. Annual re-evaluation per ADR
0020's connector audit cadence.

## 7. What this packet does NOT recommend

- **PARTIAL_RETIRE keeping DocumentStorage on BUILD.** Considered;
  rejected. The AppFolder safety property is preserved by OAuth scope, not
  by endpoint choice. Keeping 273 LoC of `drive.py` plus the 569 LoC of
  shared infrastructure (`_client.py`, `oauth.py`, `_types.py`) to host
  one capability is a maintenance tax we don't need to pay.

- **KEEP_BUILD wholesale.** Considered; rejected. ADR 0020's MCP-first
  rule is explicit. The BUILD adapter exists because it predated the
  first-party MCP. The maturity gap is closed for two of three
  capabilities, and the third (DocumentStorage) has a vetted MIT
  community option.

- **Migrate to `MartinM85/mcp-server-graph-api` or `merill/lokka`.** Both
  cover broad Graph API surface, but softeria is already in our config
  namespace, already MIT, already covers what we need, and is more
  capability-scoped (Mail + Calendar + OneDrive specifically vs. generic
  Graph). Lower switching cost.

## 8. Cross-references

- ADR 0020: `docs/adr/0020-connector-strategy.md` — MCP-first directive,
  per-vendor decision table including the Microsoft 365 first-party
  entries.
- ADR 0021: `docs/adr/0021-leverage-hermes-native-primitives.md` —
  Stream F (this packet's parent stream).
- ADR 0010: `docs/adr/0010-per-customer-oauth-token-storage.md` —
  per-customer Fly-volume OAuth model (preserved for softeria, retired
  for first-party Microsoft MCPs).
- ADR 0007: `docs/adr/0007-per-customer-machine-isolation.md` —
  per-customer Machine isolation (unaffected by this migration; both
  BUILD and MCP variants run inside the customer's Machine).
- Issue #881: Wave-2 Mail.Send follow-on — when this lands, it lands on
  `mcp:m365-mail` (with `Mail.Send` scope grant), not on a resurrected
  BUILD adapter.
- Hermes MCP docs:
  [user-guide/features/mcp](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp),
  [reference/mcp-config-reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference).

## Sources

- [Get Started With the Microsoft MCP Server for Enterprise — Microsoft Learn](https://learn.microsoft.com/en-us/graph/mcp-server/get-started)
- [Overview of Microsoft MCP Server for Enterprise — Microsoft Learn](https://learn.microsoft.com/en-us/graph/mcp-server/overview)
- [GitHub — microsoft/mcp (catalog of first-party MCP servers)](https://github.com/microsoft/mcp)
- [GitHub — Softeria/ms-365-mcp-server](https://github.com/softeria/ms-365-mcp-server)
- [GitHub — MartinM85/mcp-server-graph-api](https://github.com/MartinM85/mcp-server-graph-api)
