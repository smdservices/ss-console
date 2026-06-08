---
title: Operator Credential Custody — Delegated by Default, Self-Held for Privacy, Per Connector
date: 2026-06-08
status: accepted
captain: Scott Durgan
related-spec: docs/design/operator/00-foundations.md
related-adr: docs/adr/0010-per-customer-oauth-token-storage.md, docs/adr/0036-oauth-token-relay-fly-secret-restart.md
---

# ADR 0042 — Operator Credential Custody

**Status:** Accepted (Captain decision, 2026-06-08), as the foundation for how clients connect their external systems to the Operator.

## Context

The Operator connects to a client's external systems (practice management, mail/calendar, accounting, payments, etc.).
Someone supplies the credential for each connection. **Who holds that credential is a security and privacy decision**,
not merely a convenience one — and for the privileged-data clients we target (law, finance), "your consultant never
holds your keys" is a real trust differentiator.

Two facts from the locked architecture frame this:

- Per [ADR 0010](0010-per-customer-oauth-token-storage.md), customer OAuth tokens live **only** on the per-customer Fly
  volume, never in a shared store. SMD never holds the OAuth secret. Re-consent is customer-completed in their own
  browser ([ADR 0036](0036-oauth-token-relay-fly-secret-restart.md); the portal callback relays the token via Fly secret
  - Machine restart). So for OAuth, "we never see your credential" is **already** the architecture.
- Static-secret connectors (raw API keys) have no consent flow — a key is entered once and used until rotated.

The open question this ADR answers: across that substrate, **what is the client's custody choice, and what does each
choice mean for who can re-establish a broken connection?**

## Decision

**Credential custody is a per-connector choice with a client-level default, in two modes:**

### Delegated (default)

- **OAuth:** the customer consents (inherent), and **SMD monitors and drives** re-establishment — watches for expiry,
  fires a one-click re-consent link to the right person, removes all friction. SMD still never holds the OAuth secret.
- **Static secret:** the key is stored in the per-customer vault in a way **SMD can read and rotate** without the
  customer.

Delegated is the default because not-fussing-with-connectors is a core part of the Operator value.

### Self-held (opt-in, privacy-maximizing)

- **OAuth:** the customer consents and **monitors/initiates** re-establishment themselves from the portal; SMD does not
  proactively drive it.
- **Static secret:** the key is stored so **only the operator runtime can use it** — SMD cannot read it; only the
  customer can re-enter/rotate.

Self-held is the choice for clients whose privacy posture requires that SMD staff cannot reach the credential value at
all.

### Rules

1. **Default custody is client-level; overridable per connector.** A client may delegate their calendar while
   self-holding their practice-management or banking connector.
2. **Both modes store in the per-customer isolated vault.** Isolation ([ADR 0007](0007-per-customer-machine-isolation.md)/[0009](0009-cross-machine-query-prohibition.md))
   holds regardless. The only axis that moves is whether SMD staff can reach the secret value.
3. **Static-secret client entry is write-only and never transits an SMD-readable surface.** A client-entered key posts
   to an endpoint that injects it directly into the customer's secret store and returns only a masked confirmation; the
   value never lands in the console DB, a log, or a transcript (the client-side analog of the server-side secret-set
   pattern).
4. **The help model differs by mode and is honest.** In delegated mode SMD re-establishes connections for the client
   (one-click for OAuth, full rotation for static keys). In self-held mode SMD **cannot** recover a broken credential —
   it drives the customer through re-entry (sends the link, guides) but cannot paste it back. This boundary is the cost
   of the privacy guarantee and is surfaced to the client at the time they choose self-held.
5. **OAuth re-consent always requires a human click at the provider** when the refresh token dies (revocation,
   credential/MFA change, or idle-TTL expiry). Delegated mode makes this a one-click link; it does not bypass provider
   consent. For actively-used connectors, rolling refresh keeps tokens alive indefinitely, so this is rare.

A per-connector `credential_custody: delegated | self_held` field (default inherited from a client-level
`credential_custody_default`) is added to the connector binding in `customer.yaml` and materialized to
`customer_configs`. Custody is part of the connectors authority domain ([ADR 0041](0041-operator-authority-posture.md)).

## Alternatives considered

- **SMD always holds credentials.** Rejected — removes the privacy option entirely; unacceptable for privileged-data
  verticals.
- **Client always self-holds.** Rejected — kills the hands-off value; most clients want SMD to run connectors.
- **Single client-level mode, no per-connector override.** Rejected — real firms mix (delegate low-sensitivity systems,
  self-hold the bank). Building per-connector costs little and avoids a forced all-or-nothing.
- **Store static secrets in a shared SMD vault for convenience.** Rejected — violates [ADR 0010](0010-per-customer-oauth-token-storage.md)
  isolation; the per-customer vault is the only correct location in either mode.

## Consequences

**Positive.**

- A real privacy differentiator ("we cannot touch your keys") available to clients who need it, with a clean default for
  those who don't.
- Per-connector granularity matches how real firms think about system sensitivity.
- Builds directly on the existing OAuth-on-volume architecture; no new shared trust boundary.

**Negative / accepted.**

- The self-held help model is genuinely more burdensome for the client (they re-establish broken connections). Accepted
  and disclosed at choice time.
- The write-only static-secret client-entry path is a security-sensitive surface that must be built carefully (no DB/log
  leakage). It is the highest-care item in the connectors domain.

## Verification

1. A connector's `credential_custody` resolves from per-connector value → client default → `delegated`.
2. OAuth connect/reconnect lands the token on the per-customer volume in both modes; SMD-readable storage is used only
   for delegated static secrets, and never for any OAuth secret.
3. A client-entered static secret never appears in the console DB, application logs, or any transcript; only a masked
   confirmation is returned (tested explicitly).
4. In self-held mode, no SMD-side code path can read the secret value; re-establishment requires a customer action.
5. Custody choice and its help-model implication are surfaced to the client at selection time and audit-logged.

## References

- [Foundations](../design/operator/00-foundations.md) §5 (credentials sub-model)
- [ADR 0010](0010-per-customer-oauth-token-storage.md) — OAuth tokens on the per-customer volume
- [ADR 0036](0036-oauth-token-relay-fly-secret-restart.md) — re-consent token relay
- [ADR 0041](0041-operator-authority-posture.md) — connectors is an authority domain; custody is its security dimension
- `docs/specs/operator/oauth-lifecycle.md` — the OAuth refresh/re-consent mechanics this builds on
