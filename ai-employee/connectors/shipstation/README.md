# ShipStation MCP wrapper

Custom MCP server wrapping the ShipStation V2 API. Required for any manufacturing or DTC customer that ships — ShipStation is the dominant SMB multi-carrier layer (~3% global shipping-and-fulfillment market share; 500M+ shipments/year). Per `docs/strategy/ai-employee-connector-coverage-2026-05-14.md`: Tier-1 BUILD, ~1 day, clean REST API.

## Auth

API key only (no OAuth). The customer generates an API key at ShipStation Settings → Account → API Settings. The key goes into the customer's Fly secrets as `SHIPSTATION_API_KEY`.

Base URL: `https://api.shipstation.com/v2` (V2 has Bearer-style auth with the API key).

Header: `API-Key: <key>` per V2 docs. V1 used Basic Auth; V2 simplified to a single API key header.

## What this wrapper exposes

### Read tools (autonomous-eligible)

- `shipstation_list_orders` — orders with filters (status, date range, store, customer email)
- `shipstation_get_order` — single order detail by ID
- `shipstation_list_shipments` — shipments with filters (carrier, date range, tracking status)
- `shipstation_get_shipment` — single shipment detail (includes tracking number)
- `shipstation_track` — current tracking status for a tracking number
- `shipstation_list_warehouses` — list of warehouses configured for the account
- `shipstation_list_carriers` — list of carriers + services available
- `shipstation_get_rates` — get shipping rates for a hypothetical shipment (read-only quote)

### Gated write tools (require explicit approval)

- `shipstation_create_label` — generates a shipping label (charges the carrier account)
- `shipstation_void_label` — voids a previously created label (refund eligibility varies by carrier)

### Internal-write tools (autonomous-eligible)

- `shipstation_tag_order` — add internal tag to an order (no external blast radius)
- `shipstation_note_order` — add an internal note to an order

### Refused operations (not exposed)

- Modifying customer billing info
- Bulk-deleting orders or shipments
- Modifying carrier credentials

## Sandbox-vs-prod gap

ShipStation does NOT have a separate sandbox endpoint. Test API keys are generated against the live API but charge nothing if you don't actually print a label. Recommended practice:

- Read tools: safe to call against prod with a real key (read-only, no charges)
- Label creation: ALWAYS test in a "test mode" account separate from the customer's production ShipStation account, OR carefully use `shipstation_get_rates` first to validate the shipment shape before creating a label

The wrapper's prod-smoke-test calls `shipstation_list_warehouses` and `shipstation_list_carriers` — both read-only — to verify auth + scope on day 1.

## Rate limits

ShipStation V2: 200 requests per minute per API key. Burst tolerance ~40/sec. The wrapper does NOT implement client-side rate limiting (V2 returns 429 with Retry-After; httpx handles); customer workloads at typical SMB scale (<1000 shipments/day) don't approach the limit.

## Configuration

Env vars:

- `SHIPSTATION_API_KEY` — required
- `SHIPSTATION_BASE_URL` — defaults to `https://api.shipstation.com/v2`; override only for local testing

## Hermes config

```yaml
mcp_servers:
  shipstation:
    command: /opt/hermes/.venv/bin/python
    args: [-m, ai_employee_shipstation.server, --transport, stdio]
    env:
      SHIPSTATION_API_KEY: ${SHIPSTATION_API_KEY}
```

## Status

- [x] V2 API docs reviewed at docs.shipstation.com
- [ ] API key flow tested against real account
- [ ] Read tools implemented
- [ ] Gated write tools implemented (create/void label require approval sentinel)
- [ ] Tests covering happy path + refusal cases
- [ ] Container integration

Estimate: ~1 day for end-to-end ready.
