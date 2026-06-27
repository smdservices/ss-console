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

### 4. Ethical screening is a required, fail-closed capability — not "judgment"

An LLM cannot be relied on to refuse data it has been handed. Until authored screening exists, the connector — on **any** channel, email included — ships only to firms that **attest in writing they have no active screens or ethical walls**. This is a hard precondition to authoring a live customer's access.

### 5. End-state — Enterprise-Managed Authorization / the firm's own IdP

When EMA supports Microsoft Entra / M365 (Okta-only at writing), identity and offboarding move fully into the firm's directory and SMD holds no employee PII. Today's Clerk-email path is the documented bridge into that end-state.

## Consequences

- **The kill switch is real and instant on revoke** because the grant table is the gate, checked per request — this is the central correctness property and must not regress to "the Clerk session/token is the gate."
- **SMD is, in the interim, a processor of firm employee-identity data** (Clerk user records created on email-link login): a DPA and employee-record-deletion duty on revocation / contract-end, retired by the EMA end-state.
- **Implementation surface shrinks to what is ours**: a grant table + live authorization (this ADR's first build), Clerk configuration + a revoke route, a JIT issuance gate, and a `customer.yaml` policy field. No hand-rolled OAuth server, no ticket-threading seam.
- The already-shipped email channel (roster `scope.inbound_allow_from`, [ADR 0055](0055-operator-is-an-employee.md)) is unchanged; the screening attestation gate applies to it too.

## What this does not decide

- **The EMA/IdP cutover** — adopted when EMA supports Entra/M365; not built now.
- **The ethical-screening build** — a required capability and a separate effort; gated behind the written attestation until it exists.
- **The optional Operator-issued sign-in ticket** — built only if email-link login proves to carry meaningful friction.
- **SMD-staff-overseer access** (one SMD person driving multiple Operators) — a separate future decision, modeled deliberately, never by loosening the per-customer principal lookup.
