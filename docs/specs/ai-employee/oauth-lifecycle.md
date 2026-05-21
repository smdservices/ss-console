# OAuth Token Lifecycle

**Spec for issue #789.** Token storage, refresh, failure handling, re-authorization, and per-connector scope inventory. Without this, no adapter can ship safely; expired tokens silently destroy customer trust at week 3.

## Source

- platform-prd.md §7 (no existing OAuth subsection; this becomes §7.9), §18 (Risks)
- `docs/pm/ai-employee/prd-contributions/round-1/technical-lead.md` Risk 1, Blocking Item #1
- `docs/pm/ai-employee/prd-contributions/round-1/business-analyst.md` EC-004/005/006
- PR #812 `ai-employee/connectors/lawpay/src/ai_employee_lawpay/oauth.py` (file-based reference impl)

## Contract

### Storage

| Token kind                      | Location                                                               | Format                                                                  | Access                                                |
| ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| Long-lived OAuth refresh token  | Infisical: `/ai-employee/{customer-slug}/{connector}/refresh_token`    | encrypted at rest                                                       | Read at Machine boot + on refresh failure             |
| Short-lived access token        | Fly Machine volume: `/data/tokens/{connector}.json` (chmod 0600)       | JSON with `expires_at` (epoch seconds), `access_token`, `refresh_token` | Read on every connector request; rewritten on refresh |
| Provisioning-time consent state | Infisical: `/ai-employee/{customer-slug}/{connector}/consent_log.json` | timestamp + scopes granted + user email                                 | Captain-only read                                     |

**Why both:** Infisical is the durable secret store and survives Machine destruction. The file-based cache (matching PR #812's LawPay impl) keeps hot-path latency low — no Infisical hop per API call. Refresh failure invalidates the local file and falls back to Infisical to re-bootstrap or to surface an alert.

### Refresh policy

```
For every connector request:
  tokens = read /data/tokens/{connector}.json
  if tokens.expires_at - now() < 600:   # 10-minute safety margin
    new_tokens = refresh(tokens.refresh_token)
    if new_tokens.ok:
      atomic_write /data/tokens/{connector}.json
      mirror new_tokens.refresh_token to Infisical
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
6. Customer clicks the link, completes OAuth consent in their browser. Callback hits `https://admin.smd.services/ai-employee/oauth/{connector}/callback`.
7. Captain receives confirmation. New tokens written to Infisical + Machine. Connector status restored.
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

| Failure                                                             | Symptom                              | Behavior                                                                          | Audit event                                            |
| ------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Access token expired, refresh succeeds silently                     | none visible                         | request retries with new token                                                    | `CONNECTOR_TOKEN_REFRESHED` (every 10th, sampled)      |
| Refresh token revoked (admin action upstream)                       | refresh API returns `invalid_grant`  | enter `auth_expired`; alert Captain; re-consent flow                              | `CONNECTOR_AUTH_EXPIRED`                               |
| Refresh token expired (idle TTL)                                    | refresh API returns `invalid_grant`  | same as above                                                                     | `CONNECTOR_AUTH_EXPIRED`                               |
| Network failure during refresh                                      | http error                           | retry 3x with exponential backoff (1s/4s/16s); then degraded                      | `CONNECTOR_REFRESH_RETRY_EXHAUSTED`                    |
| Infisical unreachable at boot                                       | Machine boot fails                   | exit 4; Captain alerted via Fly health check                                      | (no D1 yet — written to platform audit log)            |
| New refresh token issued but Infisical mirror fails                 | local file updated; Infisical stale  | Captain alerted on next boot; manual sync via `bin/reauth-connector.sh --recover` | `CONNECTOR_INFISICAL_DRIFT`                            |
| Customer revokes consent in their own dashboard (Microsoft, Google) | next refresh returns `invalid_grant` | same as auth_expired                                                              | `CONNECTOR_AUTH_EXPIRED` (sub_type=`customer_revoked`) |

## Verification

1. **Unit tests** at `ai-employee/connectors/<system>/tests/test_oauth.py` cover: token storage round-trip, refresh-on-expiry, refresh-failure → degraded mode, re-consent URL generation.
2. **Integration test:** `tests/ai-employee/oauth-degraded-mode.test.ts` provisions a fixture customer, force-expires a token, verifies the connector enters degraded mode within 30s and the audit-log event is written.
3. **Daily probe** (Captain control plane): a scheduled Cloudflare Worker hits `health_check()` on every connector for every active customer; failures emit `CONNECTOR_HEALTH_PROBE_FAILED` audit events and a Captain alert.
4. **Pre-deploy gate:** `provision-customer.sh` step 7 (Composio registration / native OAuth init) runs `health_check()` on every enabled connector. Any failure aborts provisioning.

## Implementation notes

- Reference Python impl at `ai-employee/connectors/lawpay/src/ai_employee_lawpay/oauth.py` already exists in PR #812; extend with Infisical sync hook.
- New module: `ai-employee/adapter/oauth_lifecycle.py` provides shared `TokenStore`, `RefreshScheduler`, `ReauthFlow` classes used by all connectors.
- New script: `bin/reauth-connector.sh` (Captain-invoked, generates URL, emails customer).
- Cloudflare Worker at `src/pages/api/ai-employee/oauth/[connector]/callback.ts` handles OAuth callbacks for Captain-initiated re-auth.
- Daily probe Worker: `infra/workers/oauth-probe/worker.ts`; scheduled cron 0 5 \* \* \* (5am UTC, before morning digest at 8am).
- Audit log events live in D1 `audit_log` table per d1-schema.md.

[AMBIGUITY: Composio-managed connectors (Gmail, Slack, GitHub per PR #812 customer-zero yaml) handle OAuth refresh inside Composio's infra. The spec's local-file + Infisical pattern applies only to `build:` adapters. Confirm Composio's auth_expired surfacing matches our `CapabilityError.auth_expired` shape, or write an adapter to translate Composio errors.]

[AMBIGUITY: Re-consent callback URL `admin.smd.services/ai-employee/oauth/{connector}/callback` requires admin subdomain to be reachable from customer browsers. CLAUDE.md notes admin auth is gated to `admin` role. Either expose a separate unauthenticated callback path or proxy via portal subdomain.]
