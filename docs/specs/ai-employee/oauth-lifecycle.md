# OAuth Token Lifecycle

**Spec for issue #789.** Token storage, refresh, failure handling, re-authorization, and per-connector scope inventory. Without this, no adapter can ship safely; expired tokens silently destroy customer trust at week 3.

## Source

- platform-prd.md §7 (no existing OAuth subsection; this becomes §7.9), §18 (Risks)
- `docs/pm/ai-employee/prd-contributions/round-1/technical-lead.md` Risk 1, Blocking Item #1
- `docs/pm/ai-employee/prd-contributions/round-1/business-analyst.md` EC-004/005/006
- PR #812 `ai-employee/connectors/lawpay/src/ai_employee_lawpay/oauth.py` (file-based reference impl)

## Contract

### Storage

Per [ADR 0010](../../adr/0010-per-customer-oauth-token-storage.md), customer-side OAuth tokens live exclusively on the per-customer Fly volume — never in Infisical, never in a shared store.

| Token kind                      | Location                                                            | Format                                                                                                          | Access                                                |
| ------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| OAuth tokens (access + refresh) | Fly Machine volume: `/opt/data/oauth/{connector}.json` (chmod 0600) | JSON `{ access_token, refresh_token, scopes[], expires_at, obtained_at, provider }` per ADR 0010 §Storage shape | Read on every connector request; rewritten on refresh |
| Provisioning-time consent state | D1 `audit_log` table (`CONNECTOR_CONSENT_GRANTED` events)           | timestamp + scopes granted + user email                                                                         | Captain query via audit-log view                      |

**Why Fly volume only:** ADR 0010 enumerates the tradeoffs in full. Summary: per-customer isolation is architectural (one volume per Machine, not a shared trust boundary); ADR 0009 (cross-Machine query prohibition) aligns naturally with Fly volumes and is in tension with Infisical; refresh latency is sub-ms vs ~50-200ms per Infisical roundtrip; volume loss on decommission is correct semantics (customer ends; data ends). Consent state moves to `audit_log` because it's an event record, not a credential.

### Refresh policy

```
For every connector request:
  tokens = read /opt/data/oauth/{connector}.json
  if tokens.expires_at - now() < 600:   # 10-minute safety margin
    new_tokens = refresh(tokens.refresh_token)
    if new_tokens.ok:
      atomic_write /opt/data/oauth/{connector}.json
    else:
      enter degraded mode (see Failure modes)
```

The 10-minute margin handles tokens with 1-hour TTLs (Microsoft Graph, LawPay, most OAuth 2.0). For tokens with shorter TTLs, adapter declares its margin in `connectors/<system>/refresh_policy.json`.

### Re-authorization (re-consent) flow

When a refresh token itself is revoked or expired (Microsoft: 90 days unused; LawPay: indefinite but revocable):

1. Connector transitions to `auth_expired` (CapabilityError per capability-contracts.md).
2. Runtime marks connector degraded; affected skills produce empty-state drafts per fabrication-filter.md.
3. Audit-log event `CONNECTOR_AUTH_EXPIRED` written with connector, scopes lost, timestamp.
4. Captain alert fired (control plane notification — see Captain alert mechanism below).
5. Captain initiates re-consent: runs `bin/reauth-connector.sh {customer-slug} {connector}` which generates an OAuth authorize URL and emails it to the customer's principal user.
6. Customer clicks the link, completes OAuth consent in their browser. Callback hits `https://portal.smd.services/ai-employee/oauth/{connector}/callback` (portal subdomain; customer-facing). The portal callback handler proxies the OAuth code back to the customer's per-Machine `/opt/data/oauth/` write path via the per-customer Fly internal network. The admin subdomain stays role-gated for SMD operations only.
7. Captain receives confirmation. New tokens written to the Machine's Fly volume at `/opt/data/oauth/{connector}.json` per ADR 0010. Connector status restored.
8. Audit-log event `CONNECTOR_AUTH_RESTORED`.

No silent re-auth. The customer is always in the loop because consent is the legal basis for data access.

### Captain alert mechanism

Alert routing per `customer.yaml` `escalation.failure_recipients`. v1 channel: email via Captain's Resend account, subject `[hermes-{slug}] {connector} auth expired — re-consent required`. v1 dashboard view: Health tab (Phase 4) shows per-connector token status; v1 surfaces in audit log + email only.

### Per-connector OAuth scope inventory

Scopes declared per adapter in `ai-employee/connectors/<capability>/<system>/oauth_scopes.json` (machine-readable, validated at provision time against `customer.yaml.oauth_scopes`).

| Adapter                                                                         | Scopes (v1)                                                                             | Refresh TTL                       | Re-auth interval     |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- | -------------------- |
| microsoft-graph (Email)                                                         | `Mail.Read`, `Mail.ReadWrite`, `MailboxSettings.Read` (NO `Mail.Send` — Pattern A only) | 1 hr access / 90 day idle refresh | At 75 days idle      |
| microsoft-graph (Calendar)                                                      | `Calendars.ReadWrite`, `MailboxSettings.Read`                                           | same                              | same                 |
| microsoft-graph (OneDrive)                                                      | `Files.Read`, `Files.ReadWrite.AppFolder`                                               | same                              | same                 |
| google-workspace (Gmail)                                                        | `gmail.readonly`, `gmail.compose`, `gmail.modify` (NO `gmail.send`)                     | 1 hr / indefinite refresh         | n/a (refresh stable) |
| google-workspace (Calendar)                                                     | `calendar.events`, `calendar.readonly`                                                  | same                              | n/a                  |
| google-workspace (Drive)                                                        | `drive.readonly`, `drive.file`                                                          | same                              | n/a                  |
| docusign (ESign)                                                                | `signature`, `extended`                                                                 | 8 hr / 30 day refresh             | At 25 days idle      |
| lawpay (Payments)                                                               | `invoices.read`, `payments.read`, `clients.read`, `aging.read`                          | 1 hr / indefinite                 | n/a                  |
| quickbooks (Accounting)                                                         | `com.intuit.quickbooks.accounting`                                                      | 1 hr / 100 day refresh            | At 85 days idle      |
| courtlistener (CourtAccess)                                                     | API key only (no OAuth)                                                                 | n/a                               | n/a                  |
| filevine / clio / smartadvocate / casepeer / neos / mycase (PracticeManagement) | per-vendor; see `ai-employee/connectors/practice-mgmt/<system>/oauth_scopes.json`       | per-vendor                        | per-vendor           |
| follow-up-boss / lead-docket (IntakeCRM)                                        | per-vendor read+write to leads                                                          | per-vendor                        | per-vendor           |
| callrail (CallTracking)                                                         | API key only                                                                            | n/a                               | n/a                  |
| slack / microsoft-teams (InternalComms)                                         | `chat:write` (bot scope) for agent persona only                                         | bot token; long-lived             | n/a                  |

## Failure modes

| Failure                                                             | Symptom                              | Behavior                                                                   | Audit event                                            |
| ------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| Access token expired, refresh succeeds silently                     | none visible                         | request retries with new token                                             | `CONNECTOR_TOKEN_REFRESHED` (every 10th, sampled)      |
| Refresh token revoked (admin action upstream)                       | refresh API returns `invalid_grant`  | enter `auth_expired`; alert Captain; re-consent flow                       | `CONNECTOR_AUTH_EXPIRED`                               |
| Refresh token expired (idle TTL)                                    | refresh API returns `invalid_grant`  | same as above                                                              | `CONNECTOR_AUTH_EXPIRED`                               |
| Network failure during refresh                                      | http error                           | retry 3x with exponential backoff (1s/4s/16s); then degraded               | `CONNECTOR_REFRESH_RETRY_EXHAUSTED`                    |
| Fly volume read failure at boot                                     | Machine boot fails                   | exit 4; Captain alerted via Fly health check                               | (no D1 yet — written to platform audit log)            |
| Atomic write of refreshed token fails                               | local file possibly stale            | retry once; on second failure, Captain alerted + connector marked degraded | `CONNECTOR_TOKEN_WRITE_FAILED`                         |
| Customer revokes consent in their own dashboard (Microsoft, Google) | next refresh returns `invalid_grant` | same as auth_expired                                                       | `CONNECTOR_AUTH_EXPIRED` (sub_type=`customer_revoked`) |

## Verification

1. **Unit tests** at `ai-employee/connectors/<system>/tests/test_oauth.py` cover: token storage round-trip, refresh-on-expiry, refresh-failure → degraded mode, re-consent URL generation.
2. **Integration test:** `tests/ai-employee/oauth-degraded-mode.test.ts` provisions a fixture customer, force-expires a token, verifies the connector enters degraded mode within 30s and the audit-log event is written.
3. **Daily probe** (Captain control plane): a scheduled Cloudflare Worker hits `health_check()` on every connector for every active customer; failures emit `CONNECTOR_HEALTH_PROBE_FAILED` audit events and a Captain alert.
4. **Pre-deploy gate:** `provision-customer.sh` step 7 (Composio registration / native OAuth init) runs `health_check()` on every enabled connector. Any failure aborts provisioning.

## Implementation notes

- Reference Python impl at `ai-employee/connectors/lawpay/src/ai_employee_lawpay/oauth.py` already exists in PR #812 and follows the ADR 0010 Fly-volume pattern. No Infisical hook needed.
- New module: `ai-employee/adapter/oauth_lifecycle.py` provides shared `TokenStore` (Fly-volume-backed), `RefreshScheduler`, `ReauthFlow` classes used by all connectors.
- New script: `bin/reauth-connector.sh` (Captain-invoked, generates URL, emails customer).
- Astro route at `src/pages/portal/products/ai-employee/oauth/[connector]/callback.astro` handles OAuth callbacks on the portal subdomain (customer-facing); proxies the code to the per-customer Machine via Fly internal network. Admin subdomain stays role-gated.
- Daily probe Worker: `infra/workers/oauth-probe/worker.ts`; scheduled cron 0 5 \* \* \* (5am UTC, before morning digest at 8am).
- Audit log events live in D1 `audit_log` table per d1-schema.md.

## Resolved decisions

**Composio-managed connectors (Gmail, Slack, GitHub).** Composio handles OAuth refresh inside its own infra; we do not store or refresh those tokens. Each Composio-managed connector adapter wraps Composio's error response and re-raises as `CapabilityError.auth_expired` per `capability-contracts.md`. The Fly-volume token-storage pattern (ADR 0010) applies only to `build:` adapters. Implementation: see `ai-employee/adapter/connectors/composio_*.py` adapter-translation pattern.

**Per-connection isolation enforcement.** Composio's tenant model stages one `COMPOSIO_API_KEY` per fleet and scopes per-customer access by connection ID. A misrouted connection ID would let one Machine read another customer's mailbox through Composio. The runtime backstop is `ai-employee/adapter/connectors/composio_assertion.py::ComposioConnectionGuard` — every Composio API call site MUST wrap its connection ID in `guard.assert_belongs(connection_id)` before dispatching. The customer.yaml validator at `src/lib/ai-employee/customer-yaml/sections-connectors.ts` enforces the same `conn_{customer_id}_{suffix}` shape at authoring time. Both layers exist because the structural per-Machine isolation that ADR 0009 covers does not extend into Composio's managed infrastructure. See issue #850.

**Re-consent callback URL.** Callbacks land on the portal subdomain (`portal.smd.services/ai-employee/oauth/{connector}/callback`), not admin. Customer-facing OAuth flows belong on the portal where the authenticated customer is already operating; the admin subdomain stays role-gated for SMD operations only. The portal callback handler proxies the OAuth code to the per-customer Machine's `/opt/data/oauth/` write path via the Fly internal network. No new attack surface on admin.
