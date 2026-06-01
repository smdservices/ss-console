# LawPay MCP wrapper

Custom MCP server that wraps the LawPay (now branded "8am") REST API and exposes it as MCP tools for Hermes. Required for the law-firm Operator vertical pack — LawPay is the de facto IOLTA-compliance payment standard for small/mid law firms (60,000+ firms, approved by all 50 state bars + ABA).

Per `docs/strategy/operator-connector-coverage-2026-05-14.md`: Tier-1 BUILD, ~1-2 days, OAuth2 documented at developers.8am.com.

## What this wrapper exposes

The MCP tools provided correspond to the LawPay actions a law-firm Operator actually performs. Read-only by default; write actions are explicitly gated.

### Read tools (autonomous-eligible)

- `lawpay_list_invoices` — list invoices with filters (date range, status, client)
- `lawpay_get_invoice` — single invoice detail by ID
- `lawpay_list_payments` — list payments with filters
- `lawpay_get_payment` — single payment detail
- `lawpay_list_clients` — list clients in the firm
- `lawpay_get_client` — single client detail
- `lawpay_aging_report` — AR aging report (current / 1-30 / 31-60 / 61-90 / 90+)
- `lawpay_trust_balance` — trust-account (IOLTA) balance per client (read-only)

### Write tools (draft-for-review enforced)

- `lawpay_create_invoice_draft` — creates an invoice in DRAFT status (no send)
- `lawpay_send_invoice` — sends an existing invoice to client (gated; requires explicit approval per ACTION_CLASS)
- `lawpay_record_payment` — records a payment received outside LawPay (gated)

### Refused operations (never exposed as MCP tools)

- Issuing a refund (touches money + state-bar trust-account rules — manual only)
- Modifying trust-account ledger entries (IOLTA compliance — never automated)
- Bulk-deleting invoices (irreversible)
- Modifying client billing information (relationship + financial)

## API surface

### Auth

OAuth 2.0 Authorization Code flow per developers.8am.com:

1. Firm logs into LawPay, navigates to API settings, authorizes the SMD application
2. Auth code → access token + refresh token (token endpoint: `https://api.8am.com/oauth/token`)
3. Access token expires in 1 hour; refresh token used to renew

The wrapper stores per-customer tokens in the customer's Fly machine's persistent volume (`/opt/data/lawpay/{customer_id}/tokens.json`). Tokens never leave the customer's machine.

### Base URL

Production: `https://api.8am.com/v1`
Sandbox: `https://api-sandbox.8am.com/v1`

The wrapper selects sandbox vs prod via `LAWPAY_ENV` env var (`prod` default).

## Sandbox-vs-prod gap

| Surface        | Sandbox                                         | Prod                                                                  |
| -------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| Authentication | Test OAuth client created at developers.8am.com | Customer's OAuth client (same flow, different credentials)            |
| Customer data  | Test customers seeded by LawPay's sandbox       | Real customer records — read-only via MCP read tools by default       |
| Invoices       | Sandbox-only test invoices                      | Real invoices; write tools gated draft-for-review                     |
| Payments       | Test payments only — never real money           | Real payments; record_payment is gated; no refund tool exposed at all |
| Trust account  | Sandbox shows synthetic balances                | Real IOLTA balances; read-only access only                            |
| Rate limits    | 60/min                                          | 60/min standard; 600/min available on enterprise tier                 |

Per the plan: sandbox-vs-prod gap doc lives here; first-customer onboarding runs a prod smoke test that calls `lawpay_list_clients` (read-only) on day 1 to surface auth + scope + shape issues before any write capability is enabled.

## Configuration

The wrapper is configured via env vars passed to the MCP server process:

- `LAWPAY_CLIENT_ID` — OAuth client ID (from developers.8am.com)
- `LAWPAY_CLIENT_SECRET` — OAuth client secret
- `LAWPAY_REDIRECT_URI` — Pre-registered redirect URI
- `LAWPAY_ENV` — `prod` (default) or `sandbox`
- `LAWPAY_CUSTOMER_ID` — customer slug for per-customer token storage
- `LAWPAY_TOKEN_STORE_PATH` — path for storing tokens (default `/opt/data/lawpay/{customer_id}/`)

## Running the server

```bash
# Inside the customer container
/opt/hermes/.venv/bin/python -m operator_lawpay.server \
  --transport stdio \
  --customer-id smd

# Or as a network server (for testing)
/opt/hermes/.venv/bin/python -m operator_lawpay.server \
  --transport http \
  --port 8765
```

The Hermes config registers this server in `mcp_servers`:

```yaml
mcp_servers:
  lawpay:
    command: /opt/hermes/.venv/bin/python
    args: [-m, operator_lawpay.server, --transport, stdio, --customer-id, smd]
    env:
      LAWPAY_CLIENT_ID: ${LAWPAY_CLIENT_ID}
      LAWPAY_CLIENT_SECRET: ${LAWPAY_CLIENT_SECRET}
      LAWPAY_ENV: prod
```

## Initial OAuth setup (per customer)

The first time a customer connects their LawPay account:

1. Customer requests OAuth: `python -m operator_lawpay.setup` (prints an authorization URL)
2. Customer visits URL, authorizes the SMD application, gets redirected with an auth code
3. Customer enters the auth code into the setup command
4. The wrapper exchanges code for tokens, stores in the configured token store path

Refresh handling is automatic — the wrapper detects token expiry and refreshes in-process.

## Testing

Tests live at `tests/`:

- `test_oauth_token_flow.py` — token exchange + refresh against LawPay sandbox
- `test_read_tools.py` — list/get for invoices, payments, clients (sandbox data)
- `test_write_tools_gated.py` — verifies draft creation works; send/record refuse without explicit approval flag
- `test_refused_operations.py` — verifies refund + trust-modify tools are not exposed

Run:

```bash
cd operator/connectors/lawpay
uv run --with mcp pytest tests/
```

## Status

- [x] Sandbox API access verified (signed up at developers.8am.com)
- [ ] OAuth flow tested against sandbox
- [ ] Read tools implemented
- [ ] Write tools implemented (draft creation only; send/record gated)
- [ ] Sandbox-vs-prod gap doc finalized after real prod customer onboards
- [ ] Tests covering happy path + refusal cases
- [ ] Integrated into customer container build (Dockerfile adds the wrapper)

Estimate: 1-2 days for end-to-end ready. This README and the scaffolding are the start.
