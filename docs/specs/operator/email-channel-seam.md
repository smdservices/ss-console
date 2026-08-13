# Email channel seam — provider-neutral operator mail (ADR 0078 build spec)

**Status:** locked 2026-07-24 (Captain delegated technical calls; decisions below are final unless Captain reopens)
**Governs:** issue #1978 and the overlay work it references
**Upstream:** [ADR 0078](../../adr/0078-client-custody-email-channel.md) (custody posture, provider-neutral seam, trust-spine invariance) · 2026-07-24 channel-coupling audit (committed alongside this spec's implementation PRs)

## What this builds

The operator sends and receives email through the **client's own mail system** — first adapter Microsoft 365 (app-only, mailbox-scoped) — behind a provider-neutral seam. AgentMail becomes adapter #1 _behind the same seam_, not a special case. For sensitive-data seats, AgentMail is unbound entirely (ADR 0078 §1).

## Locked decisions

### D1 — Inbound is delta-query polling, not change-notification webhooks

The operator polls its own mailbox via Graph **delta query** (`/users/{mailbox}/mailFolders/inbox/messages/delta`), keeping the `deltaLink` cursor per seat. Poll cadence default 45s, per-seat configurable.

Why this is the durable choice, not the compromise:

- **Self-healing by construction.** The delta cursor resumes exactly where it left off across restarts, deploys, and outages. Push subscriptions have a missed-notification recovery problem that Microsoft's own guidance solves with… periodic delta polling.
- **No lifecycle machinery to rot.** No subscription creation, no ~3-day renewals, no `validationToken` handshake, no `clientState` verification.
- **Smaller attack surface.** No public webhook endpoint for mail at all — content is _pulled_ over an authenticated channel, so delivery provenance is the app's own credential, not a signature on an inbound POST.
- **Latency is a non-issue.** Sub-minute latency serves every routine in the A&P grid. Push is a latency optimization, addable later behind the same seam if a client ever needs it.

The poller **feeds the existing gate→router path** as a stamped source (`source: msgraph`, `event_type: message.received`), so fence/taint/roster apply identically to polled mail. The poller rides the existing no-agent cron machinery (ADR 0021).

### D2 — One normalized inbound shape at the seam

All providers normalize into one `InboundMessage` DTO at the gate/router boundary:

```
InboundMessage {
  provider:        "agentmail" | "msgraph" | ...   # closed vocab, grows by adapter
  mailbox:         str          # the operator identity that received it
  message_id:      str          # provider-native id (reply key)
  thread_ref:      str | null   # provider-native conversation/thread id
  from_addr:       str          # bare lowercased address (roster input)
  to: [str], cc: [str]
  subject:         str
  body_text:       str          # plain-text body (html stripped by adapter)
  received_at:     iso8601
  provider_refs:   dict         # opaque per-provider keys the reply transport needs
}
```

Rules (from ADR 0078 §4):

- Roster, taint, prompts, and skills consume **only** this shape. Nothing downstream of the seam branches on provider.
- `provider_refs` is opaque: only the matching provider's send/reply transport may read it. This carries the Graph message/conversation ids the reply path needs (audit: reply transport depends on inbound-carried ids).
- The AgentMail path is **migrated onto the DTO** (adapter #1). The existing AgentMail-shaped prompt dot-paths (`{message.from}` etc.) are replaced by DTO paths; `_EMAIL_REPLY_ADAPTERS` prose in authored skills becomes provider-parameterized.
- Fail-safe is a requirement: an adapter that can't populate a field required by governance yields quarantine/draft, never a bypass.

### D3 — Trust spine is the only door (fixes audit F1)

The DTO seam is the _single_ entry: a message becomes an agent turn only via the gate→router enqueue that applies envelope/fence/taint. The poller enters there. Structural enforcement: seat validation fails if a bound channel has no seam adapter (a channel that can't be fenced can't be bound — ADR 0078 §3). This closes the native-gateway bypass (audit F1) for email; the same mechanism is the template for messaging channels later.

### D4 — Send surface is an author-built MCP connector (Smokeball pattern, ADR 0053)

`operator/connectors/msgraph-mail/` — no vendor MCP does app-only Graph mail, so BUILD per ADR 0020. Tools (runtime names `mcp_msgraph_mail_*`):

| tool                                                     | action class                                        |
| -------------------------------------------------------- | --------------------------------------------------- |
| `list_messages` / `read_message`                         | read                                                |
| `poll_delta` (poller's primitive; also usable as a read) | read                                                |
| `create_draft`                                           | internal_write                                      |
| `send_message`                                           | external_send (recipient-reclassified per ADR 0072) |
| `reply_message`                                          | external_send (recipient-locked reply path)         |

Auth: app-only client credentials (tenant id + client id + secret), mailbox pinned by config; tenant side is scoped by `ApplicationAccessPolicy` (sandbox-proven 2026-07-24). Client mirrors the Smokeball connector's structure: httpx client with `_mint_token`, `MockTransport` unit tests, conformance oracle entries.

Governance wiring (all fail-closed until added — unmapped tools are refused):

- `shared/action_classes.py`: `mcp_msgraph_mail_*` rows
- `shared/outbound_recipient.py`: tool-name sets **plus** recipient/body shape normalization (Graph nests `toRecipients[].emailAddress.address` and `body.content`; extraction must normalize before classification so INTERNAL sends don't silently degrade to draft)
- Overlay reply relay + confirm dispatch: Graph transports sharing one Graph client (replaces the two AgentMail REST paths for msgraph-bound seats)

### D5 — Config representation

```yaml
connectors:
  Email:
    adapter: msgraph # or agentmail
    backend: mcp:msgraph-mail
    enabled: true
    msgraph_auth:
      tenant_id: '...'
      mailbox: operator@clientdomain.com
      client_id: '...'
      secret_ref: 'fly-secret:MSGRAPH_CLIENT_SECRET' # custody per ADR 0010
    poll_seconds: 45 # delta poll cadence
```

**TWO app registrations are required per seat** (Captain decision 2026-08-13; hard requirement, provisioning refuses without both). `msgraph_auth.client_id` above is the **read-only** app (`Mail.ReadWrite`, no `Mail.Send`) — the only Graph identity the agent process ever holds. The **send-capable** app (`Mail.Send`) never appears in `customer.yaml`: it is staged as `MSGRAPH_SEND_CLIENT_ID__<CID>` / `MSGRAPH_SEND_CLIENT_SECRET__<CID>` in the operator env, materialized to a broker-owned 0600 file, and stripped from the agent's environment before the exec-drop. Both apps are pinned to the one mailbox by an Exchange `ApplicationAccessPolicy`. One registration cannot serve both roles because a Graph app-only token is always `/.default` — every permission the registration holds, with no per-request scope-down — so an app that can read the mailbox can also send from it the moment `Mail.Send` is granted. Setup: [ms-graph-azure-ad-setup.md](../../runbooks/operator/ms-graph-azure-ad-setup.md) ("client-custody app-only registrations"). Proven live on the sandbox seat 2026-08-13 (`vfy_01KZXX523V6JNWEETG4PSZDQY3`): read app refused `sendMail` with `403 ErrorAccessDenied`, send app `202`.

- Schema: `msgraph_auth` block validated when `adapter: msgraph` (tenant id GUID, mailbox address, secret ref shape). Parallel in structure to the existing `google_auth` block.
- `PersonaSendAs.agentmail_identity` generalizes to a provider-neutral send-as identity (`send_identity: { provider, address }`) with a back-compat read of the old field.
- Provisioning: `provision-customer.sh` gains an msgraph branch (stages the client secret per-customer; skips AgentMail secrets when unbound — already conditional).
- **AgentMail OFF** = the Email connector simply isn't bound to agentmail; no shadow binding. Seat validation rejects `webhook_triggers.source: agentmail` when no agentmail binding exists (already enforced).

### D6 — Sequencing (build order, not phases)

Work lands as normal PRs in dependency order, each live-tested on the `smdopslab` sandbox seat as it lands (the sandbox is where the system runs while being built; A&P's tenant is not a dev environment):

1. **Connector** (`msgraph-mail/` in ss-console) — self-contained, mocked tests + live smoke against sandbox.
2. **Config** (schema block + PersonaSendAs generalization + provisioning branch).
3. **Overlay seam** (DTO + AgentMail adapter migration + D3 structural enforcement) — the widest-touch change; golden tests must stay green.
4. **Overlay Graph wiring** (poller, action-class rows, shape normalization, reply/confirm transports) — inbound and reply land together (reply needs inbound-carried ids).
5. **A&P connect** — their mailbox, their consent, ApplicationAccessPolicy, live proof; runbook from the sandbox rehearsal.

## Non-goals here

- Messaging-app + voice channels (parked; D3's seam mechanism is the intended template).
- Google Workspace + IMAP/SMTP adapters (demand-gated per ADR 0078; the seam is designed so each is an adapter, not a rebuild).
- Publisher verification (#1979 — deferred polish).

## Test surface

- Connector: unit (MockTransport, both auth failures and token rotation), conformance oracle, live smoke script.
- Overlay: golden send-governance tests extended with msgraph tool names + Graph-shaped payloads (INTERNAL send must classify INTERNAL — the shape-normalization regression is the dangerous silent one: it degrades to draft, which reads as "operator stopped working").
- Seam: regression test that an unfenced channel binding fails seat validation (D3).
- End-to-end on sandbox: inbound mail → fence → roster classify → skill turn → governed reply landing in the sandbox inbox, both for a rostered sender (real reply) and a stranger (draft + quarantine).
