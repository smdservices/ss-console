# Microsoft Graph Azure AD app registration

How to register the SMD Services AI Employee app in Microsoft Entra ID (Azure AD), obtain the client credentials used by the OAuth callback, and grant the Phase-1 scopes that the MS Graph adapter requires.

This runbook is performed **once** by Captain. The resulting `client_id` and `client_secret` are stored in Infisical at `/ai-employee/shared/microsoft-graph/` and pushed to the ss-web Worker as `MICROSOFT_GRAPH_CLIENT_ID` / `MICROSOFT_GRAPH_CLIENT_SECRET`. Per-customer consent (and the resulting per-tenant tokens) is collected separately during customer provisioning — see "Customer onboarding" below.

## Prerequisites

- Azure subscription with rights to register applications in the SMD Services Entra ID tenant.
- `ADMIN_BASE_URL` set in production (`https://admin.smd.services`) and `PORTAL_BASE_URL` set (`https://portal.smd.services`).
- Access to Infisical for the SMD Services workspace.

## App registration steps

1. Sign in to <https://entra.microsoft.com> as a global admin on the SMD Services tenant.
2. Navigate to **Identity → Applications → App registrations** → **+ New registration**.
3. Configure:
   - **Name:** `SMD Services AI Employee`
   - **Supported account types:** _Accounts in any organizational directory (Any Microsoft Entra ID tenant — multitenant)_.
     - Multi-tenant is required because each customer law-firm tenant will consent independently.
   - **Redirect URI:** `Web` → `https://portal.smd.services/ai-employee/oauth/microsoft-graph/callback`
     - This is the customer-facing portal subdomain per [oauth-lifecycle.md](../../specs/ai-employee/oauth-lifecycle.md) "Re-consent callback URL". The admin-subdomain endpoint at `https://admin.smd.services/api/oauth/callback` from PR #936 stays in place as the v1 backstop and may be added as a second registered URI during the transition window.
4. Click **Register**. Record the **Application (client) ID** — this becomes `MICROSOFT_GRAPH_CLIENT_ID`.

## Configure API permissions (Phase 1)

Phase 1 ships read + draft only. `Mail.Send` is intentionally excluded — programmatic send is wave-2 stream #881.

1. **Manage → API permissions → + Add a permission → Microsoft Graph → Delegated permissions**.
2. Add exactly the following delegated scopes:
   - `User.Read` _(default; keep)_
   - `Mail.Read`
   - `Mail.ReadWrite`
   - `MailboxSettings.Read`
   - `Calendars.ReadWrite`
   - `Files.Read`
   - `Files.ReadWrite.AppFolder`
   - `offline_access` _(required to issue refresh tokens)_
3. Do **not** add `Mail.Send`, `Files.ReadWrite`, `Files.ReadWrite.All`, or any `.All` application permission. If one is added by mistake, remove it before saving — leaving it on the registration broadens the consent prompt the customer sees, even if the adapter does not exercise it.
4. Click **Grant admin consent for SMD Services** to pre-consent on the SMD Services tenant only. Customer tenants grant their own consent during onboarding (see below).

## Create a client secret

1. **Manage → Certificates & secrets → + New client secret**.
2. **Description:** `prod-<YYYYMM>` (e.g. `prod-202605`).
3. **Expires:** 12 months.
4. Click **Add** and immediately copy the secret **Value** (not the Secret ID). This value is shown only once.
5. Store the secret in Infisical:
   ```bash
   # Run from a machine with Infisical CLI already authenticated
   pbpaste | infisical secrets set MICROSOFT_GRAPH_CLIENT_SECRET --env=prod --path=/ai-employee/shared/microsoft-graph --plain
   ```
6. Add the client ID to Infisical the same way under `MICROSOFT_GRAPH_CLIENT_ID`.
7. Push to Workers env:
   ```bash
   infisical export --env=prod --path=/ai-employee/shared/microsoft-graph --format=dotenv \
     | npx wrangler secret bulk
   ```

Rotation: schedule the next rotation 30 days before the expiry date. Replace the secret value in Infisical, re-push to Workers, then delete the old secret in Entra after a 24-hour overlap window so in-flight customer consent flows are not interrupted.

## Customer onboarding (per-tenant consent)

When a new customer is provisioned, Captain runs `bin/reauth-connector.sh <customer-slug> microsoft-graph`, which:

1. Issues a signed OAuth state parameter bound to the customer slug and Captain's reviewer ID.
2. Generates an authorize URL of the form `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?...&state=<signed>`.
3. Emails the URL to the customer's principal user listed in `customer.yaml` under `users[].role: principal`.

The customer signs in to their own Microsoft 365 tenant, reviews the requested scopes, and consents. Microsoft Entra redirects to the portal callback at `https://portal.smd.services/ai-employee/oauth/microsoft-graph/callback?code=...&state=...`. The portal handler verifies the state, exchanges the code for tokens via the registered token endpoint, and proxies the resulting `{ access_token, refresh_token, expires_at, scopes }` payload to the per-customer Hermes Machine for atomic write to `/opt/data/oauth/microsoft.json` per [ADR 0010](../../adr/0010-per-customer-oauth-token-storage.md).

If the customer tenant blocks third-party multi-tenant apps, the customer's Microsoft 365 admin must first add the SMD Services AI Employee app from the Entra **Enterprise applications** blade. The error returned in that case is `AADSTS650056` — the portal callback surfaces it back to the customer as a short failure reason.

## Verification

After onboarding a customer:

```bash
# On the customer's Fly machine
fly ssh console -a hermes-<customer-slug>
ls -la /opt/data/oauth/
# Expect: microsoft.json, mode 0600, owned by uid 10000 (hermes)
```

Run the smoke test:

```bash
fly ssh console -a hermes-<customer-slug> -C \
  '/opt/hermes/.venv/bin/python -m ai_employee_ms_graph.smoke'
```

The smoke test calls `GET /me` against Microsoft Graph and prints the principal's `displayName` + `mail` (no token material). A 401 indicates the token is missing or expired; a 403 indicates the customer tenant did not grant a required scope.

## Related references

- [oauth-lifecycle.md](../../specs/ai-employee/oauth-lifecycle.md) — refresh policy, re-consent flow, failure modes
- [ADR 0010](../../adr/0010-per-customer-oauth-token-storage.md) — token storage decision
- [capability-contracts.md](../../specs/ai-employee/capability-contracts.md) — Email / Calendar / DocumentStorage interfaces
- [customer-yaml-schema.md](../../specs/ai-employee/customer-yaml-schema.md) — `connectors.Email/Calendar/DocumentStorage` bindings to the `microsoft-graph` adapter
