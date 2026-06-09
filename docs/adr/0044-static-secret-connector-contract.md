---
title: Static-Secret Connector Contract — Per-Connector Descriptor, Multi-Field, Custody-Enforced
date: 2026-06-09
status: proposed
captain: Scott Durgan
related-adr: 0042-operator-credential-custody.md, 0036-oauth-token-relay-fly-secret-restart.md, 0020-connector-strategy.md, 0007-per-customer-machine-isolation.md
related-spec: docs/design/operator/00-foundations.md
---

# ADR 0044 — Static-Secret Connector Contract

**Status: PROPOSED.** This ADR captures the design for relaying a client-entered
**static secret** (a raw API key, not an OAuth token) to a connector's per-customer
Machine. **It is not launch-blocking** — the law wedge's connectors are OAuth
(already handled by [ADR 0036](0036-oauth-token-relay-fly-secret-restart.md)), so
no static-secret relay ships at launch. The relay **build waits on Captain
sign-off of this contract.** It is written now because the context (what is
defined vs. undefined across the connector substrate) is fresh.

## Context

[ADR 0042](0042-operator-credential-custody.md) decided _who holds_ a credential
(delegated vs self-held, per connector). It did **not** decide the mechanics of a
static secret entered in the portal. Today that path is a deliberate no-op: the
endpoint (`src/pages/api/portal/products/operator/connectors/[connector]/secret.ts`)
gates on `isSecretTransportConfigured(env)`, which is false, and returns an honest
`not_enabled`. The seam (`src/lib/operator/credential-secret-transport.ts`) carries
a throwing `createSecretWriter` with an `INTEGRATION STEP` comment.

Three facts make the current shape under-specified — building the relay against it
would force invention:

1. **No generic capability→secret mapping exists.** Connectors read their static
   secrets from **bespoke env vars** the adapter names itself — `LAWPAY_CLIENT_SECRET`,
   `FILEVINE_REFRESH_TOKEN`, `CLIO_CLIENT_SECRET`, etc. — resolved today from a
   `token_ref` (an Infisical reference authored in `customer.yaml`) and injected as a
   Fly secret by `operator/bin/provision-customer.sh`. There is no
   `SMD_CONNECTOR_<CAP>_SECRET` convention the relay could target generically.
2. **The portal models one "secret" per connector.** Several real adapters need
   **multiple** fields (e.g. LawPay: client_id + client_secret + redirect_uri). A
   single-field write cannot express them.
3. **`OPERATOR_SECRET_RELAY_URL` is a phantom.** Its name implies a separate relay
   _service_ the console POSTs to. [ADR 0036](0036-oauth-token-relay-fly-secret-restart.md)
   already decided **against** a Machine HTTP write endpoint and settled the
   credential relay onto the **direct Worker→Fly** path (`setSecrets` + Machine
   restart; the boot-decode writes the volume). A future builder reading the
   current contract could wire a relay URL that should not exist.

## Decision (proposed)

### 1. Per-connector secret-field **descriptor**, authored as data

Each static-secret connector declares its secret fields as **data, not a
hand-maintained TS pack mirror** — mirroring the existing `oauth_scopes.json` /
`token_ref` convention that already lives per connector under
`operator/connectors/<name>/`. Proposed location:
`operator/connectors/<name>/static_secrets.json`, shape:

```json
{
  "capability": "Payments",
  "fields": [
    {
      "key": "client_id",
      "env": "LAWPAY_CLIENT_ID",
      "label": "Client ID",
      "required": true,
      "secret": false
    },
    {
      "key": "client_secret",
      "env": "LAWPAY_CLIENT_SECRET",
      "label": "Client secret",
      "required": true,
      "secret": true
    }
  ]
}
```

- `env` is the **exact Fly-secret env var the Machine adapter reads** — the single
  source of truth that today is implicit in each adapter. Authoring it as data
  removes the invention.
- The console reads the descriptor through the **same projection the rest of the
  connector data already uses** to reach the Worker (CI/build materialization),
  **not** a TS constant duplicated by hand. (Resolves the runtime-can't-read-disk
  problem the same way `VERTICAL_FLOORS` and the OAuth provider data do, without a
  drift-prone manual mirror.)

### 2. Multi-field secrets

The descriptor's `fields[]` is the contract. The portal renders one input per
field (label + `secret` flag for masking); the endpoint validates all `required`
fields are present, then relays **each** field to its named Fly secret in a single
`setSecrets` call, followed by **one** Machine restart. `secret: false` fields
(e.g. a client_id, a redirect_uri) are non-sensitive but still authored per
engagement; they ride the same write.

### 3. Custody enforcement (the part to review)

Custody ([ADR 0042](0042-operator-credential-custody.md)) governs **whether SMD
can reach the value**, enforced at write time:

- **`self_held` (privacy-maximizing): Fly-secret-only, SMD-unreadable.** The value
  is relayed straight to the Machine's Fly secret (Worker→Fly `setSecrets` +
  restart) and is **not** mirrored anywhere SMD can read. `smdCanReachSecret('self_held')`
  is already `false` (`src/lib/operator/credential-custody.ts`); the relay must
  honor it by writing **only** the Fly secret. SMD has no read or rotate path — only
  the client can re-enter/rotate from the portal.
- **`delegated` (default): Fly secret + Infisical mirror for rotation.** The value
  is relayed to the Fly secret **and** mirrored to the per-customer Infisical path
  so SMD can rotate without the client (the not-fussing-with-connectors value).
  `smdCanReachSecret('delegated')` is `true`.

Both modes store the runtime copy in the per-customer isolated vault (the Fly
volume via boot-decode); isolation ([ADR 0007](0007-per-customer-machine-isolation.md))
holds regardless. **The only axis custody moves is whether a second, SMD-readable
copy exists in Infisical.** The write path must branch on resolved custody
**before** any Infisical write, and must fail closed (write nothing) if custody is
unresolved — never default to the SMD-readable mode.

### 4. Retire the phantom `OPERATOR_SECRET_RELAY_URL`

The relay reuses the [ADR 0036](0036-oauth-token-relay-fly-secret-restart.md)
machinery (`setSecrets` + `restartFlyMachines` + the shared
`customer_id→Fly app` registry), gated on **`FLY_API_TOKEN`** — exactly as
`getDefaultTokenStore` already gates the OAuth relay. Concretely, when the relay
is built:

- `isSecretTransportConfigured(env)` keys on `FLY_API_TOKEN` (+ a resolvable
  descriptor for the connector), **not** `OPERATOR_SECRET_RELAY_URL`.
- `createSecretWriter` calls the Fly path (sharing `store.ts`'s machinery), **not**
  an HTTP relay service.
- `OPERATOR_SECRET_RELAY_URL` is **removed** from `env.d.ts` /
  `credential-secret-transport.ts` so no future builder wires a service that
  [ADR 0036](0036-oauth-token-relay-fly-secret-restart.md) decided against.

The no-leak core above the seam (`handleSecretWrite`, the audit sink with no value
column) is unchanged — it is frozen and tested.

## Consequences

- A static-secret connector becomes a **data** change (a `static_secrets.json`) +
  the descriptor projection, not bespoke per-connector console code.
- The relay build (when signed off) is small: descriptor lookup → validate fields →
  custody branch → reuse `store.ts` Fly machinery → audit. No new service, no
  Machine endpoint, no phantom URL.
- Until built, the path stays the honest `not_enabled` it is today.

## Verification (when the relay is built, not now)

- Descriptor validity test: every `static_secrets.json` parses; `env` names are
  unique per connector; `capability` is an accepted capability.
- Multi-field relay: a 2-field descriptor writes both Fly secrets in one
  `setSecrets` + one restart; missing `required` field → rejected, nothing written.
- Custody: `self_held` writes the Fly secret and performs **no** Infisical write
  (asserted); `delegated` writes both; unresolved custody → fail closed.
- No-leak: the value never appears in a log, the response, or the audit row
  (the existing `connector_secret_audit` has no value column).
