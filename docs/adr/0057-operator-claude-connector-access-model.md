---
title: Operator Claude-Connector Access Model — Firm Login, Operator-Owned Grants, the Grant Table Is the Kill Switch
date: 2026-06-27
status: accepted
captain: Scott Durgan
related-adr: 0055-operator-is-an-employee.md, 0037-operator-thesis.md, 0035-no-imposed-entitlement-defaults.md, 0025-autonomy-ceilings-configurable-exposure-vs-initiation.md, 0042-credential-custody-and-data-posture.md, 0044-r2-authoritative-live-reconfig.md, 0007-per-customer-machine-isolation.md
---

# ADR 0057 — Operator Claude-Connector Access Model

**Status:** Accepted (Captain decision, 2026-06-27).

**Source:** Wiring the Claude connector for the Ashton & Price pilot opened the question of how a firm's people reach and direct their Operator through Claude, and — the load-bearing part — how that access is severed when someone leaves. A long alignment pass (and a Devil's-Advocate critique) rejected several over-clever turns and converged on a model built from proven parts. This ADR locks it.

---

## Context

An Operator is an employee ([ADR 0055](0055-operator-is-an-employee.md)). A firm's people must be able to reach it through Claude (a custom connector / remote MCP server), governed the way any employee's access is governed: granted on join, scoped to who they are, severed on leave — **without SMD carrying the offboarding burden**.

Two facts constrain the design. (1) A Claude custom connector authenticates either fully authless or with **per-user OAuth + mandatory user consent** — there is no connector-level shared credential and no machine-to-machine path; authless is unsafe for matter data, so every firm connection is per-user OAuth. (2) Clerk OAuth access tokens are 1-day JWTs and refresh tokens never expire, so a token, once issued, can linger.

Two category errors had to be named and avoided. **The Operator is not a per-user permission proxy** — it authenticates to the firm's systems (e.g. Smokeball) as one firm-level identity and does not inherit each caller's ACLs. That is _distinct from_ ethical screening, which is a real, separate obligation and is **not** excused by "the Operator has firm-wide access and judgment." And **clever beats proven is a trap**: an Operator-minted sign-in ticket threaded into Claude's OAuth flow was demoted to optional sugar in favor of Clerk's documented email-link login, because the bespoke path carried an unproven seam, a spoofable inbound-`From:` surface, and a bearer-token-in-an-inbox risk — all of which the documented path simply does not have.

## Decision

**A firm's people reach the Operator through Claude via three layers, each owned by the party best suited to it. The firm's identity authenticates; SMD's grant table authorizes; the firm's directory becomes the source of truth at the end-state.**

### 1. Login — Clerk per-user OAuth with email-link sign-in to the firm mailbox

The user adds the connector in Claude; Clerk emails a one-time, short-TTL sign-in link to their firm address; clicking it (possession of the live firm mailbox) signs them in. No password, no key. This is the **proven path** — Clerk OAuth already works as a Claude connector on customer-zero; email-link is a Clerk-native sign-in strategy, a configuration toggle. Email possession is the identity, so offboarding rides the firm's mailbox.

### 2. Authorization — SMD's grant table is the authoritative allowance and the kill switch

Login proves _who_; a grant decides _whether, and until when_. Authorization is a row in `mcp_issued_grants` (or an authored `mcp_connector.access[]` entry), **read live on every MCP request** ([ADR 0044](0044-r2-authoritative-live-reconfig.md) live-read posture). Because the grant — not the Clerk token — is the gate:

- **Explicit revoke cuts on the next call, within seconds**, regardless of the 1-day JWT TTL or the never-expiring refresh token. No opaque tokens or token introspection are required.
- **Grants are bounded: `expires_at` is never null. There is no "forever" grant.** Renewal is a fresh email-link re-auth, which a killed mailbox cannot complete, so passive offboarding lapses access within the TTL window automatically. Set the Clerk session lifetime to the grant TTL so re-auth is forced at that cadence.

### 3. Issuance policy — the firm authors who may connect

Per [ADR 0035](0035-no-imposed-entitlement-defaults.md), the firm authors its posture in `customer.yaml`: **allowlist** (default — grants exist only for authored/seeded principals) or **open** (a verified firm-domain identity is JIT-granted on first authenticated connect). The Operator owns issuance policy; Clerk owns token crypto. The Operator-issued one-click sign-in ticket is an **optional, deferred convenience** on top of this login, not a dependency.

### 4. No screening gate — risk is the client's to accept (amended 2026-06-29)

**This section originally made a written no-active-screens attestation a hard, fail-closed precondition to any inbound channel. That is reversed; the gate was ripped out.**

This is a frontier-technology product, used at the client's own risk by nature — not a NASA-grade compliance system. A firm adopting the connector is already choosing to expose its data to Claude; we do not get to tell them "sign this attestation or you cannot connect." We can, and probably should, help a client _understand_ the risks — but we do not gate their access on signed paperwork, and we do not build enforcement of legal/compliance posture into the product.

The connector still **fails closed on authorization** — no grant, no access; the grant table (§2) is the real gate. Documentation, disclosure, and service-agreement work belongs to when there is a product to sell, and is a business decision for the Captain, not an agent-built feature.

### 5. End-state — Enterprise-Managed Authorization / the firm's own IdP

When EMA supports Microsoft Entra / M365 (Okta-only at writing), identity and offboarding move fully into the firm's directory and SMD holds no employee PII. Today's Clerk-email path is the documented bridge into that end-state.

## Consequences

- **The kill switch is real and instant on revoke** because the grant table is the gate, checked per request — this is the central correctness property and must not regress to "the Clerk session/token is the gate."
- **SMD is, in the interim, a processor of firm employee-identity data** (Clerk user records created on email-link login): a DPA and employee-record-deletion duty on revocation / contract-end, retired by the EMA end-state.
- **Implementation surface shrinks to what is ours**: a grant table + live authorization (this ADR's first build), Clerk configuration + a revoke route, a JIT issuance gate, and a `customer.yaml` policy field. No hand-rolled OAuth server, no ticket-threading seam.
- The already-shipped email channel (roster `scope.inbound_allow_from`, [ADR 0055](0055-operator-is-an-employee.md)) is unchanged.

### Implementation status (slices 2a–2e shipped 2026-06-27)

- **2a** — `mcp_issued_grants` table + live-read merge into principal resolution (the kill switch's read side).
- **2b** — admin grant lifecycle (`adminIssueGrant` clears a revocation; `revokeGrant`; `listGrants`) + immutable `operator_mcp_grant_audit` ledger (the mutable grant row is state; the ledger is the record of who changed access, for whom, when). TTL bounded `[1, 90]`, never infinite. Admin route + connectors-page panel.
- **2c** — `mcp_connector.policy` axis (`allowlist` default / `open`), `allowed_domains`, `default_profile`, `ttl_days`, kept distinct from `data_posture`. Validator requires domains + an active `default_profile` for `open`. Pilot ships on `allowlist`.
- **2d — RIPPED OUT (2026-06-29).** Originally a screening-attestation gate (validator authoring gate + runtime freshness + projection + admin surface). Removed in full per the amended §4 — a use-at-your-own-risk product does not block client access on signed paperwork. Migration 0078 drops the projected column.
- **2e** — hardened open-by-domain JIT (firm opt-in; not the pilot path). On `policy: open`, a genuine token whose subject is not yet granted is auto-granted **only** when: the verified **primary** email's flag is true, its exact host is in `allowed_domains` (single-`@`, lowercased, no implicit subdomain), no `revoked_at` row exists for the subject (**sticky revoke** — only an admin re-issue lifts a revocation), and the per-customer active-grant **cap** (`MCP_OPEN_GRANT_CAP`) is not reached. Open grants carry a shorter TTL (`min(ttl_days, MCP_OPEN_GRANT_TTL_DAYS=7)`). Minting + refusals (`jit_revoked` / `jit_cap_exceeded`) are audited.

**Enforcement points (where each property lives):**

- **Sticky revoke** — the explicit-revoke kill is instant (live-read filters `revoked_at`). The open-policy JIT path (slice 2e) MUST refuse to re-issue a `revoked_at` grant, so a revoked user cannot auto-mint their way back; only an admin re-issue lifts a revocation.
- **JIT at the route egress** — open-by-domain minting and the verified-primary-email + exact-host-domain checks live in the route (`handleMcpPost`), where the DB handle and the verified email are available; `validateMcpToken` stays pure.

**Offboarding-backstop reframe (open).** The passive-lapse story holds only if Clerk's refresh-token absolute expiry ≤ the grant TTL; this must be verified empirically. Until verified, the grant `expires_at` + explicit admin revoke is the authoritative backstop, and mailbox-kill passive lapse is secondary. The email in-flow factor uses **OTP code** (not magic link) to keep verification in Claude's OAuth browser — an implementation refinement of "email-link," same mailbox-possession identity.

**Open-by-domain structural-guard finding (2e research).** Under the shared fleet Clerk instance with DCR, **no token claim structurally binds a token to one customer**: Clerk omits a resource-bound `aud` for the MCP/DCR path (#1398), and custom session claims are instance-global (JWT templates), not per-OAuth-app/entry, so they cannot encode the customer the user signed in for. A structural per-customer claim would require per-customer Clerk instances (the heavy onboarding we rejected). Therefore open-by-domain cross-tenant isolation rests on the **compensating controls** — verified primary email + exact firm-domain match + sticky revoke + the per-customer cap + short TTL + the grant table as the authoritative per-request gate — not a structural token barrier. The no-`aud` cross-customer test (a token valid for X presented to Y → 401 because X's subject is absent from Y's grant set) is the guard that proves this holds, and it is exercised for both `allowlist` and `open` policies.

## What this does not decide

- **The EMA/IdP cutover** — adopted when EMA supports Entra/M365; not built now.
- **Ethical screening** — a real obligation, but the **firm's**, not ours to enforce in the product (see the amended §4). If we ever surface risk to a client, it is non-blocking disclosure, decided when there is a product to sell.
- **The optional Operator-issued sign-in ticket** — built only if email-link login proves to carry meaningful friction.
- **SMD-staff-overseer access** (one SMD person driving multiple Operators) — a separate future decision, modeled deliberately, never by loosening the per-customer principal lookup.

## Amendment (2026-07-02): Console-sole Claude door — the Machine has no direct public MCP door

**Source.** A security re-audit found the kill switch (§2) governed only the console route (`smd.services/api/operator/<slug>/mcp`), while the per-customer Machine exposed a **second** public Claude door — `webhook_gate.py`'s `/mcp` (a full synchronous agent turn via `ask_operator`) — that authorized on `mcp_connector.access[]` (and, when Clerk was unconfigured, a single shared static `SMD_MCP_STUB_TOKEN`) and **never read the grant table**. So the advertised "explicit revoke cuts on the next call" did not hold on the Machine door: two doors authorized Claude and the kill switch guarded only one. On the pilot Machine, Clerk was unconfigured, so the live door was the shared static bearer.

**Decision.** There is **one** public Claude door: the console. It authenticates the caller (Clerk), enforces the grant kill-switch **per request** (§2), and then proxies the turn to the Machine's authenticated **`/mcp/turn`** endpoint over the console-proxy bearer (`Bearer WEBHOOK_SECRET_MCP`, the same per-customer derivation as `/webhooks/handoff`). The Machine trusts the console's asserted `principal_subject` because the console is the party that authenticated it and checked the grant. The Machine's **direct public MCP door is retired**: the stub-bearer path and the Clerk-direct authorization path are removed, and `POST /mcp` now returns `410 Gone`. A Cloudflare Worker has no wall-clock cap on an HTTP-triggered request, so the console awaits the synchronous turn; the async `operator_handoff_task` path remains the fallback for long work.

**Consequences.**

- **The kill switch is now the only path.** Every Claude request passes the console's per-request grant read (`revoked_at`/`expires_at` SQL-filtered); revoke cuts on the next call end-to-end. There is no door that bypasses it.
- **Clerk lives only on the console.** Per-Machine Clerk materialization (`SMD_MCP_CLERK_ISSUER` / `SMD_MCP_RESOURCE_URI` / `SMD_MCP_CLERK_ORG_ID`) is no longer required or read by the Machine; those consumes are retired. `SMD_MCP_STUB_TOKEN` is retired and removed from the Machines.
- **`mcp_connector.access[]` is read by the console, not the Machine** — it seeds console-side authorization (authored principals for the grant check). Its meaning is unchanged; only its reader moved.
- **Deferred (follow-up):** the Machine JSON-RPC `job_status` / `job_cancel` verbs, previously reachable via the direct `/mcp`, are retained in the gate but no longer publicly routed; re-expose them as console tools when a caller needs them.

**Ships as:** console `ask_operator` sync-proxy tool + turn transport (ss-console); Machine `/mcp/turn` endpoint + direct-door retirement (hermes-smd-overlay). Deploy is a coordinated `OVERLAY_REF` bump + reprovision, after which the connector target is the console and `SMD_MCP_STUB_TOKEN` is unset on the Machines.
