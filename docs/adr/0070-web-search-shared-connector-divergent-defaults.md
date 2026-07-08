# ADR 0070: Web search as a shared connector, divergent defaults

**Status:** Accepted 2026-07-07 (Captain decision)

**Amends:** [ADR 0067](./0067-hosted-agent-self-serve-sku.md) (adds a web-research capability to the Hosted Agent SKU). **Leans on:** [ADR 0020](./0020-connector-strategy.md) (MCP-first connector strategy), [ADR 0035](./0035-no-imposed-entitlement-defaults.md) (no imposed defaults; unconfigured is fail-closed), [ADR 0037](./0037-operator-thesis.md) (Tenet 2 configurable substrate, Tenet 4 the moat is never a single feature).

> **Amendment 2026-07-08 — native cut (mechanism change; decision shape unchanged).** The first cut wired Brave through an MCP server (`backend: mcp:brave`, `@brave/brave-search-mcp-server`). On the Hermes upgrade to `v2026.7.1` we found web search is a **first-class native Hermes provider** (`agent/web_search_registry.py`; bundled `plugins/web/*` — `brave-free`, `ddgs`, `exa`, `firecrawl`, plus the Nous Tool Gateway). Per ADR 0020 (leverage native primitives / build only what Hermes won't), MCP-wrapping a native feature was the redundant layer, so the mechanism is now **native**: `backend: native:<provider>` → overlay `translate.py::_materialize_web_search` → config `web.search_backend`; the agent calls the native `web_search` tool (classified READ). Everything else in this ADR stands. Two refinements: (a) the Hosted Agent default is **`native:brave-free`** on Brave's **free** tier ($0, no runaway spend — it rate-limits at quota, never bills — so "your only bill is Anthropic" holds by construction), with paid/customer-owned Brave reserved for a sensitive Operator tier (one party in the query path); (b) altitude in practice is **search only** (`brave-free` is search-only; extract is a separate native provider if ever authored). The Nous Tool Gateway (`web.backend: nous`, Firecrawl-backed) was evaluated and **not** adopted for web search — it adds a second vendor, a Nous Portal dependency, and two parties in the query path; reconsider only if we later want its image-gen/TTS/cloud-browser tools. Shipped: ss-console #1796 (native rework), overlay #150. Superseded first-cut PRs: ss #1797/#1811, overlay #147/#148.

## Context

Neither product ships web search today. Verified 2026-07-07 by grep across every `customer.yaml` on `origin/main` (`_template`, the live `ashton-price` paid seat, `pilot-*`, customer-zero, and `_hosted-template`) plus `docs/specs/operator/customer-yaml-schema.md`: the only connectors authored anywhere are **tenant systems of record** (PracticeManagement, Email, Calendar, DocumentStorage). There is no `WebSearch` connector, no Nous Portal Tool Gateway, no Tavily/Exa/Brave/Linkup wiring, and no slot for one in the schema. Both products are "closed-world" agents: they reason over what is wired in (inbox plus memory, plus the firm's own systems for the Operator). Neither can look anything up on the open web.

This surfaced two problems. First, the Hosted Agent storefront (`/agent`) markets **"research briefs"** as a named day-one job, but the configured product has no research skill and no web access to power one, which is adjacent to the venture's own anti-fabrication doctrine. Second, the Captain asked the parity question directly: if the Operator has web search we should match it, and if it does not, any divergence must be deliberate and reasoned rather than accidental.

The finding reframes the question. There is no inconsistency to reconcile, because both products share the same gap. The decision is therefore not "fix a mismatch" but "choose a single mechanism and a principled default posture for each product."

## Decision

1. **One mechanism for both products.** Web access ships as a `WebSearch` connector (`backend: mcp:<vendor>`) that slots into the identical `connectors{}` block both the Operator and the Hosted Agent already use for Smokeball, mail, calendar, and documents. No divergent code path, no second integration pattern. Because it is an ordinary connector, the search tool is subject to the same entitlement and trust-ceiling machinery as every other connector. The default vendor is **Brave Search API** (`backend: mcp:brave`), chosen 2026-07-07 for its independent index (no Google/Bing reseller dependency) and privacy posture, which fit the firm's trust brand and the Operator's legal-query sensitivity; the connector backend is swappable, with Linkup as the documented fallback.

2. **Capability altitude: search plus extract only.** The connector provides web search and clean page-content extraction with citations. A full driven or cloud browser (login, click, form-fill, JS rendering) is explicitly **out of scope** for both the $79 Hosted Agent seat and the default Operator posture: it is the heaviest resource cost on a `shared-cpu-1x`/1024 MB Machine and the largest prompt-injection surface, which is directly at odds with the fail-closed safety this substrate sells. A driven browser, if ever needed, is a separately authored future Operator-tier capability, not part of this decision.

3. **Divergent default, and only the default.** The single deliberate difference between the two products is the authored default value:
   - **Hosted Agent: default ON.** Open-web research is a marketed core job ("research briefs"); the capability is the product, so it ships enabled in `_hosted-template`.
   - **Operator: authored per engagement (off until a vertical needs it).** The Operator's value is orchestrating the firm's own systems; the open web is incidental to that (verify a court's filing address, look up a rule or statute, confirm a process server). In a regulated vertical, open-web content is also a **lower-trust, injectable source**, which cuts against the Operator's evidence-bound, no-fabrication discipline. Enable it in a customer's `customer.yaml` when a vertical genuinely calls for it.

   This divergence is [ADR 0035](./0035-no-imposed-entitlement-defaults.md) working as designed, not an exception to it: a capability that is core to one product and incidental-and-trust-sensitive to the other **should** be on-by-default in one and authored-on in the other. Same connector, different authored value.

4. **Cost posture.** For the Hosted Agent, search cost is **SMD-absorbed** on an SMD-held vendor key with a fair-use cap, not BYO. A daily research brief plus incidental lookups is on the order of $0.25 to $0.80 per seat per month, a rounding error against $49 to $79, and absorbing it preserves the clean "your only bill is Anthropic" promise while avoiding a second signup step for the aware-but-unwilling-to-operate buyer. For the Operator, search cost rides the engagement like any other connector.

## Deferred (not locked by this ADR)

- **Vendor: settled.** Default is **Brave Search API** (`mcp:brave`), chosen 2026-07-07 for its independent index and privacy posture (fit the trust brand and the Operator's legal-query sensitivity). **Linkup** (highest measured accuracy, cheapest) is the documented swap-in fallback if research-brief quality disappoints, a one-line `backend` change; Tavily (most mature but Nebius-acquired) and Exa (neural index, complex billing) were the other finalists. Confirm Brave's data-processing/retention terms during wiring, especially before enabling it on an Operator legal seat.
- **Schema and template wiring.** Add `WebSearch` to the connector enumeration in `docs/specs/operator/customer-yaml-schema.md` and the validator; add it enabled to `_hosted-template`; leave it unauthored in `_template`.
- **Fair-use cap mechanism.** A per-seat daily search cap, expressed in the `customer.yaml` `safety` block, consistent with the existing cost-breaker pattern.
- **Storefront-copy reconciliation.** Until the connector is wired and live, the `/agent` page must not sell "research briefs." Align the copy to real capability. This truth-in-advertising fix is tracked separately and does not wait on vendor selection.

## Consequences

- Adds a small, bounded COGS line to the Hosted Agent (trivial against the price); the Operator's search cost is per-engagement.
- Introduces one new vendor into the trust surface; keeping the altitude at search-plus-extract (no driven browser) keeps that surface small.
- The Operator default stays fail-closed; there is no change to the A&P seat or any live Operator until web search is explicitly authored for it.
- "Research briefs" remains marketed-ahead-of-capability until the wiring follow-up lands; the interim copy fix prevents that gap from reaching a buyer.

## Verification

- The load-bearing factual claim ("neither product ships web search") was verified by grep over all `customer.yaml` files and the connector schema on `origin/main` (2026-07-07); no web-search, Tool Gateway, or search-vendor wiring was found. Recorded in the verify ledger.
- This ADR is a decision record. The wiring (schema, template, vendor, cap) is a follow-up; its own "done means wired" verification (a live search round-trip on `pilot-smokeball` before any paid seat, per the standing fixtures to pilot-smokeball to paid-seat rule) attaches to that work, not here.
