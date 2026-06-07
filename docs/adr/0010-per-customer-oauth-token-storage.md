---
title: Per-Customer OAuth Token Storage — Tokens Live on the Customer's Fly Volume, Not Infisical
date: 2026-05-20
status: accepted
captain: Scott Durgan
supersedes: none
related-prd: docs/specs/operator/oauth-lifecycle.md
related-issue: https://github.com/venturecrane/ss-console/issues/878
---

# ADR 0010 — Per-Customer OAuth Token Storage

**Status:** Accepted.

**Source:** [#878](https://github.com/venturecrane/ss-console/issues/878). Spec-author ambiguity surfaced: the LawPay connector landed in PR #812 reads tokens from a Fly-volume `tokens.json`, while the OAuth lifecycle spec (#789, now `docs/specs/operator/oauth-lifecycle.md`) referenced Infisical. The first connectors are shipping; a pick is needed before more layer in.

## Decision

**Customer-side OAuth tokens (Gmail, MS Graph, QuickBooks, Clio, etc.) are stored on the customer's per-Machine Fly volume at `/opt/data/oauth/<provider>.json`. They are never stored in Infisical, never copied to a shared store, and never readable from outside the customer's Machine.**

Shared SMD-side secrets (Anthropic API key, Composio API key, AgentMail API key, Fly deploy tokens) remain in Infisical and are pushed to each customer's Fly secrets at provision time by `bin/provision-customer.sh`. The distinction is data ownership: SMD owns the Anthropic API key; the customer owns their Gmail OAuth token.

## Storage shape

```
/opt/data/oauth/
├── google.json         # Google OAuth refresh + access token, scopes, expiry
├── microsoft.json      # MS Graph OAuth (Phase 1 connector — issue #822)
├── clio.json           # Clio MCP OAuth (when wired)
└── lawpay.json         # LawPay OAuth (Phase B BUILD)
```

- File permissions: `0600`, owned by the `hermes` user (uid 10000)
- Filesystem: per-customer Fly volume (already provisioned per ADR 0007)
- Format: JSON `{ "access_token": <str>, "refresh_token": <str>, "scopes": [...], "expires_at": <iso8601>, "obtained_at": <iso8601>, "provider": <str> }`
  - **Amended by [ADR 0036](./0036-oauth-token-relay-fly-secret-restart.md) (2026-06-02):** this shape was aspirational and does not match the connector code. The Google connectors read the file via `google.oauth2.credentials.Credentials.from_authorized_user_file`, so the authoritative on-disk shape is the **google-auth authorized-user JSON**: `{ "token", "refresh_token", "token_uri", "client_id", "client_secret", "scopes": [...], "universe_domain", "account", "expiry": <iso8601> }`. The relay (`src/lib/oauth/store.ts`) emits exactly this. Other providers follow their own client library's on-disk format.
- Never logged. Never echoed. Token reads are recorded in the audit log as `oauth.token_read { provider, scopes, ts }` (no token value).

## Why Fly volume over Infisical

| Property                                        | Fly volume                                                             | Infisical                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Per-customer isolation                          | Native (one volume per Machine, no shared mount)                       | Project/folder-level (shared trust boundary)         |
| Cross-customer leakage risk                     | Architecturally impossible (different volume)                          | Possible (misconfigured ACL, shared service account) |
| ADR 0009 (cross-Machine prohibition) compliance | Aligned                                                                | Tension — Infisical IS a cross-Machine query target  |
| Token refresh writability                       | Native (filesystem write)                                              | Requires write API + auth roundtrip on every refresh |
| Refresh latency                                 | <1ms                                                                   | ~50-200ms per refresh                                |
| Rotation ergonomics                             | One Machine restart per customer                                       | Centralized rotate-all command                       |
| Survives Machine destroy                        | No (volume persists; only destroyed on `bin/decommission-customer.sh`) | Yes                                                  |
| Audit posture                                   | Per-customer audit log + Logpush mirror                                | Infisical audit log (mixed)                          |

The `survives Machine destroy` row is the only one that favors Infisical. We accept that loss because:

1. Volumes persist across Machine restarts and image rebuilds — only `bin/decommission-customer.sh` deletes them, and that is the correct semantics (customer ends; data ends).
2. Token loss on volume deletion is acceptable: the customer re-OAuths, the agent gets a new refresh token, normal operation resumes.
3. The alternative — keeping tokens after the customer terminates — violates ADR 0008 (customer owns the artifact).

## What lives in Infisical

Unchanged from current practice:

- `ANTHROPIC_API_KEY` — SMD-owned
- `COMPOSIO_API_KEY` — SMD-owned (Composio per-connection isolation enforced separately, issue #850)
- `AGENTMAIL_API_KEY` — SMD-owned
- `FLY_API_TOKEN` — SMD-owned (used by `bin/provision-customer.sh`)
- Cloudflare Workers secrets for ss-console portal/admin — SMD-owned
- Any future SMD-shared infrastructure secret

Customer OAuth tokens — Google, Microsoft, Clio, LawPay, QuickBooks, Slack, GitHub, Dotloop, ShipStation, AgentMail per-inbox tokens, etc. — go to the customer's volume.

## What lives in the customer.yaml schema

Per the formal schema (`docs/specs/operator/customer-yaml-schema.md`), `customer.yaml` already excludes literal secret values. The OAuth section declares scopes only:

```yaml
oauth_scopes:
  - https://www.googleapis.com/auth/gmail.readonly
  - https://www.googleapis.com/auth/calendar
```

No tokens. The OAuth callback endpoint (issue #879) writes the resulting tokens to `/opt/data/oauth/<provider>.json` inside the customer's Machine.

## Implementation requirements

This ADR sets the storage shape. Implementation work tracked by:

- [#879](https://github.com/venturecrane/ss-console/issues/879) — OAuth callback endpoint writes `/opt/data/oauth/<provider>.json`
- [#789](https://github.com/venturecrane/ss-console/issues/789) — OAuth lifecycle (refresh, expiry, re-consent) updated to read/write the volume path
- [#822](https://github.com/venturecrane/ss-console/issues/822) — MS Graph OAuth uses the volume path
- All connector wrappers (LawPay already does; ShipStation, Clio, Dotloop, future Tier-1 BUILDs) read from `/opt/data/oauth/<provider>.json`

Existing LawPay implementation is aligned; no migration required.

## Audit

Every read of `/opt/data/oauth/<provider>.json` emits an audit event:

```
{
  "event": "oauth.token_read",
  "customer_id": "<slug>",
  "provider": "google" | "microsoft" | ...,
  "scopes": ["gmail.readonly", ...],
  "skill": "<skill_id>",        // calling skill, if any
  "ts": "<iso8601>"
}
```

Token values are NEVER logged. The audit log lives in the customer's own D1 instance (per ADR 0008) and is mirrored to a customer-scoped Logpush stream for immutability (#892).

## Consequences

- Customer-side OAuth flow writes directly to the Machine — no cross-Machine secret roundtrip required.
- Token rotation is per-customer; there is no "rotate all customers' Google tokens" command. We accept this cost.
- Decommissioning a customer (`bin/decommission-customer.sh`) deletes the volume, deletes the tokens, satisfies right-to-be-forgotten without a separate Infisical cleanup step.
- The customer-yaml-schema and the OAuth lifecycle spec both need their "where do tokens live" sections clarified to point at the volume path. Tracked in #789.

## Pairs with

- [ADR 0007](./0007-per-customer-machine-isolation.md) — deployment-level isolation
- [ADR 0008](./0008-customer-owned-memory-artifact.md) — customer-owned data artifact
- [ADR 0009](./0009-cross-machine-query-prohibition.md) — cross-Machine query prohibition

## Captain's note

The temptation of "centralize secrets in Infisical so we can rotate everything from one place" is real, but it imports cross-customer trust into a layer we have deliberately walled off. Per-customer Fly volume is the simpler, safer, isolation-aligned choice. SMD's own shared infrastructure remains in Infisical where it belongs.
