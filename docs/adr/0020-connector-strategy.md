---
title: Connector Strategy — MCP-First Where Vendor or Vetted-Community Server Exists, BUILD Only When No Acceptable MCP, Composio for Long Tail
date: 2026-05-24
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/pm/ai-employee/platform-prd.md §7.2, §7.3
related-spec: docs/specs/ai-employee/customer-yaml-schema.md
related-issue: TBD (filed as follow-on to the locked Hermes-alignment plan dated 2026-05-24)
---

# ADR 0020 — Connector Strategy

**Status:** Accepted (Captain decision, 2026-05-24).

**Source:** The locked Hermes-alignment build plan dated 2026-05-24, §8 (Connector strategy execution). The plan section synthesized a per-vendor audit of MCP availability against our active and planned capability bindings. This ADR records the decision matrix so future connector wiring follows the rule and the rationale is recoverable per vendor.

## Context

The AI Employee touches the customer's external systems through eleven capability interfaces (ADR 0006 rewrite). Each capability resolves at runtime through one of four backend patterns, distinguished by the `customer.yaml.connectors{}.backend:` prefix:

- `mcp:<server>` — Model Context Protocol server (vendor-official or vetted community)
- `build:<vendor>` — Python adapter we maintain in `ai-employee/connectors/<vendor>/`
- `composio:<connector>` — Composio-brokered tool with per-customer connection ID
- `synthetic:<name>` — In-process substrate using per-customer D1+R2 (e.g., `no_pm`)

The MCP ecosystem matured significantly in v0.14.0 of Hermes. The official MCP catalog at `github.com/modelcontextprotocol/servers` plus vendor-maintained servers (Microsoft `microsoft/mcp`, Intuit `intuit/quickbooks-online-mcp-server`, Twilio Labs `twilio-labs/mcp`, ShipStation `shipstation/mcp-shipstation-api`, CourtListener hosted at `mcp.courtlistener.com`) cover a substantial fraction of the vendors we expect to wire. Community MCPs cover others (`oktopeak/clio-mcp` for Clio practice management). For the rest, BUILD adapters or Composio remain the options.

The decision matrix exists because connector choice for each vendor has real tradeoffs (maintainership, license, capability coverage, auth model) and we want the choice to be reasoned, recorded, and consistent across customers.

## Decision

**Vendor-direct MCP first for any system we want to connect to.** Decision order for new connector bindings:

1. **Vendor-direct MCP** — first-party, vendor-maintained, vendor-supported. Default choice when one exists.
2. **Vetted community MCP** — small, focused, securely reviewable, actively maintained (acceptance criteria below).
3. **BUILD adapter** in `ai-employee/connectors/<vendor>/` — when no acceptable MCP exists, or when trust-ceiling enforcement is safer to own end-to-end (e.g., trust-account writes against LawPay).
4. **Composio** — long-tail fallback only when none of the above apply. As of this revision, zero currently planned bindings rely on composio; schema support remains for future long-tail vendors that haven't shipped a first-party MCP.

### Per-vendor decision table

The following table is the canonical wiring for new customer.yaml authoring. Existing bindings can be migrated when the existing home creates more maintenance friction than the migration cost — no pre-scheduled migration.

| Capability                       | Vendor                                   | Decision                                                                                      | Rationale                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email                            | Microsoft 365 (Outlook)                  | `mcp:m365-mail` (hosted at `agent365.svc.cloud.microsoft`, per-tenant)                        | First-party Microsoft. Per-tenant URL: `/agents/tenants/{tenant_id}/servers/mcp_MailTools`. Auth via Microsoft Entra tenant ID — each customer firm is its own tenant.                                                                                                                                         |
| Calendar                         | Microsoft 365                            | `mcp:m365-calendar` (hosted, per-tenant)                                                      | Same hosted pattern: `/servers/mcp_CalendarTools`. Per-tenant Entra auth.                                                                                                                                                                                                                                      |
| DocumentStorage                  | OneDrive / SharePoint                    | `mcp:softeria/ms-365-mcp-server` (community, MIT)                                             | Microsoft has shipped M365 Mail/Calendar/Teams/User/Copilot Chat as first-party MCPs but NOT OneDrive/SharePoint. Migrated to the community MIT server in ADR 0021 Stream F (PR #1081). The prior `build:microsoft_graph` adapter was deleted in #1065. Revisit binding when MS ships a first-party Drive MCP. |
| Email                            | Google Workspace (Gmail)                 | `mcp:google-gmail` (`gmailmcp.googleapis.com/mcp/v1`, **Preview**)                            | First-party Google. Per-user OAuth 2.0 (`gmail.readonly` + `gmail.compose`). **Status: Workspace Developer Preview, not GA** — flag with customer at onboarding.                                                                                                                                               |
| Calendar                         | Google Workspace                         | `mcp:google-calendar` (`googleapis.com/mcp/v1` pattern, **Preview**)                          | Same Preview status, per-user OAuth. Verify exact endpoint slug against Google's `developers.google.com/workspace/calendar/api/guides/configure-mcp-server` before binding.                                                                                                                                    |
| DocumentStorage                  | Google Drive                             | `mcp:google-drive` (**Preview**)                                                              | Same — Preview, per-user OAuth. Same caveat: verify exact endpoint slug.                                                                                                                                                                                                                                       |
| PracticeManagement               | Clio                                     | `mcp:clio-oktopeak` (community, MIT)                                                          | Community MCP at `oktopeak/clio-mcp`, v2.0.0 (2026-05-23) added HTTP transport + 6 tools. Code-review per acceptance criteria before first Clio customer.                                                                                                                                                      |
| PracticeManagement               | Filevine                                 | `build:filevine`                                                                              | No acceptable MCP exists. REST + GraphQL with OAuth client-credentials; clean BUILD shape.                                                                                                                                                                                                                     |
| PracticeManagement               | CASEpeer / SmartAdvocate / Neos / MyCase | `build:<vendor>`                                                                              | Per the PI vertical adapter build priority (ADR 0014).                                                                                                                                                                                                                                                         |
| PracticeManagement               | (none, synthetic)                        | `synthetic:no_pm`                                                                             | For firms without a real PM system. D1+R2 substrate.                                                                                                                                                                                                                                                           |
| ESign                            | DocuSign                                 | `build:docusign` (prod) + `mcp:docusign-official` (**Beta**, pilot in parallel)               | DocuSign official MCP shipped Beta 2026-04-28. Hold build adapter as prod path; pilot the MCP; cut over at GA. Beta endpoint + auth model still unverified — read `developers.docusign.com/platform/mcp-server/` before binding.                                                                               |
| Accounting                       | QuickBooks Online                        | `mcp:quickbooks-intuit` (official Intuit, Apache-2.0)                                         | 144 tools, 29 entities, comprehensive coverage. Gold-standard MCP profile.                                                                                                                                                                                                                                     |
| Accounting                       | Xero                                     | `mcp:xero-official` (`@xeroapi/xero-mcp-server`, MIT, local npx)                              | First-party Xero. Per-organisation OAuth2 Custom Connections, or per-account Bearer Token mode for multi-account runtime.                                                                                                                                                                                      |
| Payments                         | LawPay / 8am.com                         | `build:lawpay`                                                                                | No acceptable MCP. Trust-ceiling enforcement (no refund tool, no trust-ledger modification) baked into our wrapper rather than relying on a community maintainer.                                                                                                                                              |
| Payments                         | Stripe                                   | `mcp:stripe-official` (`mcp.stripe.com` remote, or `@stripe/mcp` local)                       | First-party Stripe. Per-customer OAuth (remote) or per-customer Restricted API Keys (recommended for autonomous agents). Trust-ceiling enforcement continues via plugin layer.                                                                                                                                 |
| Fulfillment                      | ShipStation                              | `mcp:shipstation-official` _when needed_                                                      | LICENSE clarification required before binding any customer; defer until a customer needs ShipStation.                                                                                                                                                                                                          |
| CallTracking                     | Twilio Voice/SMS                         | `mcp:twilio-labs` when needed (Apache-2.0)                                                    | Twilio Labs official; 1,800 endpoints.                                                                                                                                                                                                                                                                         |
| CallTracking                     | CallRail                                 | `build:callrail` if needed                                                                    | No acceptable MCP; defer until a customer needs CallRail.                                                                                                                                                                                                                                                      |
| CourtAccess                      | CourtListener / PACER                    | `mcp:courtlistener` (hosted)                                                                  | Official Free Law Project; hosted; OAuth with Dynamic Client Registration.                                                                                                                                                                                                                                     |
| IntakeCRM                        | HubSpot                                  | `mcp:hubspot-official` (`mcp.hubspot.com`)                                                    | First-party HubSpot. GA 2026-04-13. OAuth 2.1 + PKCE per customer. Read + write across CRM objects; activity objects blocked when sensitive-data flag enabled.                                                                                                                                                 |
| IntakeCRM                        | Salesforce                               | `mcp:salesforce-hosted` (Salesforce-managed endpoint)                                         | First-party Salesforce. GA April 2026. Per-org OAuth via External Client App (`mcp_api` + `refresh_token` scopes + PKCE). **Enterprise Edition+ only.** Exact endpoint URL not in blog — verify before binding.                                                                                                |
| InternalComms                    | Slack                                    | `mcp:slack-official` (`mcp.slack.com/mcp`, plugin config in `slackapi/slack-mcp-plugin`, MIT) | First-party Slack hosted MCP. Per-workspace OAuth. **Workspace admin must approve MCP integration first** — add to customer onboarding checklist.                                                                                                                                                              |
| InternalComms                    | Teams                                    | `mcp:m365-teams` (hosted at `agent365.svc.cloud.microsoft`, per-tenant)                       | First-party Microsoft. URL pattern: `/servers/mcp_TeamsServer`. Per-tenant Entra auth.                                                                                                                                                                                                                         |
| PracticeManagement (real-estate) | Dotloop                                  | `build:dotloop`                                                                               | No acceptable MCP.                                                                                                                                                                                                                                                                                             |

### Acceptance criteria for community MCPs

Before binding a paying customer to a community-maintained MCP server, the overlay maintainer (Captain or designated reviewer):

1. Reads the README and confirms a documented OAuth or API-key auth flow.
2. Reviews the server's source code for: (a) absence of credential-logging patterns, (b) absence of arbitrary-shell-execution in tool handlers, (c) reasonable error handling, (d) license clarity.
3. Confirms maturity signals: star count, recent commit activity, open-issue triage signs.
4. Runs the server's test suite if it has one.

For `oktopeak/clio-mcp` (already chosen for Clio), the review is light — 26 tools, ABA Opinion 512 alignment in the README, OAuth 2.0 + AES-256-GCM token store. Captain confirmed during the audit; review captured in connector docs.

### Composio per-connection runtime guard

**As of this revision, no currently planned binding uses composio** — every prior composio row in the table above migrated to a vendor-direct MCP. The runtime guard described below remains in `hermes-smd-trust` as schema and infrastructure support for any future long-tail vendor that requires composio brokerage. The `composio:` backend prefix in `customer.yaml` continues to be validated.

Composio runs on a tenant-wide API key. Per-customer isolation requires a per-customer `composio_connection_id` and a runtime check that every Composio tool call references the right connection ID. The `hermes-smd-trust` plugin's `composio_guard.py` (ported from `ai-employee/adapter/connectors/composio_assertion.py`) runs via `transform_tool_result` hook on every Composio tool result; mismatch raises before the result reaches the model. This is not theater — Composio's shared-key model has real risk of tenant cross-contamination without it.

### Customer.yaml backend resolution at boot

Per ADR 0019 (customer.yaml → per-profile config translation), the bootstrap CLI resolves backend prefixes at startup:

- `mcp:<server>` → writes `mcp_servers.<server>` entry in the per-profile Hermes config; the MCP server boots as a child process of Hermes per Hermes' MCP integration.
- `build:<vendor>` → the `hermes-smd-trust` plugin (or a dedicated per-vendor sub-plugin in the overlay) instantiates the Python adapter at plugin init and registers its tools via `ctx.register_tool()`.
- `composio:<connector>` → the Composio connection ID is set from `customer.yaml.connectors{}.composio_connection_id`; the guard activates via `transform_tool_result`.
- `synthetic:<name>` → the synthetic substrate's Hermes-registered tools are wired with per-customer D1+R2 bindings via env vars.

## Alternatives Considered

### Pattern 1: BUILD-everything

Build Python adapters for every vendor we wire.

**Rejected.** Maintenance scales with vendors; vendor API changes hit us; we'd duplicate work the official MCP vendors are already doing better.

### Pattern 2: MCP-only

Refuse to BUILD anything; require an MCP for every vendor.

**Rejected.** Several vendors (Filevine, LawPay, Dotloop) have no acceptable MCP. Refusing to wire them blocks customers. Composio covers some of these but with shared-key tenancy risk that BUILD avoids.

### Pattern 3: Decision matrix per vendor (this decision)

Selected. Each vendor's wiring is a reasoned choice from the four options. The default is vendor-direct MCP-first; deviations are documented.

### Pattern 4: Keep composio as the default for vendor-direct-available systems

Continue routing Google, HubSpot, Salesforce, Stripe, Slack, and Xero through composio because the brokered pattern was already wired.

**Rejected.** Where a vendor ships a first-party MCP, brokering through composio adds three costs without commensurate benefit: (a) shared-key tenancy risk that requires the per-connection runtime guard, (b) an additional API surface to maintain, (c) a third-party in the trust chain visible to compliance-audited customers. Vendor-direct MCPs use per-customer OAuth or per-customer API keys as the isolation primitive — its own boundary, matching ADR 0010's per-customer secret storage.

## Consequences

**Positive.**

- New customer onboarding is mostly a `customer.yaml` edit, not a code change. MCP-bound capabilities require no SMD code at all.
- Maintenance burden is bounded: only BUILD adapters and the Composio guard are ours to maintain end-to-end. MCP server maintenance is the vendor's (or upstream community's) problem.
- Per-customer isolation is preserved across all backend patterns. MCP servers run as per-Machine subprocesses; BUILD adapters live in the per-Machine container; Composio uses per-customer connection IDs guarded at runtime; synthetic substrates use per-customer D1+R2.
- Capability-disclosure metadata (the "what Marcus used to write this" sourcing block per ADR 0006 rewrite) works uniformly across backends because the capability-conformance metadata is per-tool, not per-backend.

**Negative / accepted.**

- Community MCPs (Clio for now) require human review before binding paying customers. The review is small (a few hours per MCP) but it's real per-vendor work.
- BUILD adapters carry vendor-API-drift risk that doesn't apply to MCP servers (where the maintainer handles drift). We accept this cost where no MCP exists.
- Composio cost scales with tool calls. Long-term, if a customer's tool-call volume puts us near Composio's pricing cliff, we migrate that vendor to BUILD. No pre-scheduled monitoring; we act when a real customer's volume justifies it.

## Verification

1. **The `customer.yaml` validator accepts and resolves all four backend prefixes** (`mcp:`, `build:`, `composio:`, `synthetic:`). Unknown prefixes fail validation.
2. **The bootstrap CLI generates correct per-profile config** for each backend type. Smoke tests against `_template` customers with one of each backend produce working Hermes configs.
3. **MCP server bindings produce working tool registrations** at Hermes startup. The first agent turn after boot can call a tool from each configured MCP server.
4. **BUILD adapter tool registration via `ctx.register_tool()`** works in `hermes-smd-trust` or per-vendor sub-plugins. Tool calls dispatch to the Python adapter and back.
5. **Composio per-connection guard fires** on every Composio tool result. Mismatch synthetic test (artificial wrong connection ID) raises and the result is rejected.

## References

- Locked Hermes-alignment build plan dated 2026-05-24, §8 (Connector strategy execution)
- [`microsoft/mcp`](https://github.com/microsoft/mcp) — Microsoft's catalog of first-party MCP servers (Azure + Fabric implementations live here; M365 servers are hosted at `agent365.svc.cloud.microsoft` and listed in this catalog's "Microsoft 365" section)
- [Microsoft 365 first-party MCP servers](https://github.com/microsoft/mcp#-which-mcp-servers-are-available-from-microsoft) — Mail, Calendar, Teams, User, Copilot Chat available; OneDrive/SharePoint NOT yet shipped
- [Google Cloud — Google-managed MCP servers GA announcement](https://cloud.google.com/blog/products/ai-machine-learning/google-managed-mcp-servers-are-available-for-everyone)
- [Gmail MCP server configuration guide](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server) — endpoint, OAuth scopes, Preview status
- [HubSpot Remote MCP GA changelog](https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available) — GA 2026-04-13
- [Stripe MCP docs](https://docs.stripe.com/mcp) — remote `mcp.stripe.com` + local `@stripe/mcp`
- [Salesforce Hosted MCP GA blog](https://developer.salesforce.com/blogs/2026/04/salesforce-hosted-mcp-servers-are-now-generally-available) — Enterprise Edition+
- [`XeroAPI/xero-mcp-server`](https://github.com/XeroAPI/xero-mcp-server) — first-party Xero MCP (MIT)
- [`slackapi/slack-mcp-plugin`](https://github.com/slackapi/slack-mcp-plugin) — first-party Slack MCP plugin config; hosted server at `mcp.slack.com/mcp`
- [DocuSign MCP Server (Beta)](https://developers.docusign.com/platform/mcp-server/) — endpoint + auth details require manual read
- [`intuit/quickbooks-online-mcp-server`](https://github.com/intuit/quickbooks-online-mcp-server) — official Intuit MCP
- [`oktopeak/clio-mcp`](https://github.com/oktopeak/clio-mcp) — community Clio MCP
- [`twilio-labs/mcp`](https://github.com/twilio-labs/mcp) — Twilio Labs MCP
- [`shipstation/mcp-shipstation-api`](https://github.com/shipstation/mcp-shipstation-api) — ShipStation MCP (license unconfirmed)
- [CourtListener MCP](https://mcp.courtlistener.com)
- [Composio toolkits](https://composio.dev/toolkits/) — long-tail fallback only; no currently planned binding uses composio
- [ADR 0006 (rewrite)](./0006-capability-adapter-pattern.md) — backend prefix model
- [ADR 0014](./0014-pi-vertical-adapter-build-priority.md) — PI vertical adapter build priority
- [ADR 0015 (rewrite)](./0015-hermes-fork-vs-upstream.md) — plugin-only overlay; the runtime registration happens in plugins
- [ADR 0019](./0019-customer-yaml-to-profile-config-translation.md) — backend resolution at boot
