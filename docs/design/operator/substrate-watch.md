# Operator Substrate Watch

**Cadence:** quarterly (plus ad hoc on a major platform announcement).
**Origin:** 2026-07-04 strategic review, Rec 8 / issue #1690.
**Why this exists:** the generic half of the harness (sandboxing, permissions, connector plumbing, execution state) is commoditizing. Anthropic Managed Agents sells it at token cost plus $0.08/session-hour; MCP is Linux Foundation infrastructure; every major platform ships adjacent primitives. The pin-only posture (ADR 0015/0024) was designed for exactly this moment: migrate the substrate when a commodity offering clears the bar, keep proprietary investment in the authored layer (the guide, the memory, the governance, the packs — ADR 0037 Tenet 4). This watch keeps the migration option live instead of discovering commoditization from a competitor's price list.

## The rubric

A candidate substrate is evaluated against the current stack (per-customer Fly Machine + Hermes + overlay) on six dimensions. It must clear ALL of the hard gates and win on cost or capability to trigger a migration spike.

| #   | Dimension           | Hard gate | What to check                                                                                                                                                                                                        |
| --- | ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Isolation           | **Yes**   | Per-customer isolation equivalent to the Machine boundary (ADR 0007): dedicated compute + storage, no shared application tier. A logical-tenancy-only model fails regardless of price.                               |
| 2   | Data custody        | **Yes**   | The vendor-blind claim must survive (ADR 0040 pillar): customer OAuth tokens and operational memory must live where the vendor cannot read them, or with contractual + technical guarantees we can put in the DPA.   |
| 3   | Hook surface        | **Yes**   | The overlay's plugin points must be expressible: pre/post tool call, pre/post LLM call, gateway dispatch, session end, plus registered tools. If the twelve plugins cannot attach, the governance layer cannot ride. |
| 4   | Connector transport | **Yes**   | MCP client parity: author-built connectors (ADR 0053) and vendor MCPs must run unmodified or with mechanical porting.                                                                                                |
| 5   | Cost per seat       | Win       | Full seat cost (compute + inference + storage + session pricing) vs the current stack's per-seat cost from ADR 0062 telemetry. A meaningful win is >30% at production load, sustained, not introductory.             |
| 6   | Operational lift    | Win       | Deploy/rollback/pin story vs `provision-customer.sh` + OVERLAY_REF pinning; observability parity (heartbeats, cost attribution, audit emission).                                                                     |

**Tripwires that trigger an out-of-cycle evaluation:**

- Per-seat substrate cost pushes seat COGS toward the ADR 0062 kill criterion (spend > 40% of MRR at the ADR 0063 price, i.e. $2,000/mo) for reasons a commodity substrate would remove.
- A candidate ships per-customer isolation + custody guarantees it previously lacked.
- Hermes upstream stalls (no meaningful release across two pin-cadence reviews, ADR 0024) while a commodity substrate's agent loop reaches parity.
- A direct competitor demonstrably undercuts on price by riding commodity substrate.

**Standing conclusion to re-test each quarter:** the moat is the authored layer, not the substrate. If a quarter's evaluation finds us investing in substrate-shaped code the market now sells, that work should stop and migrate; if it finds the authored layer thinning relative to substrate work, that is the deeper strategy error.

---

## Evaluations

### 2026-07 (first pass): Anthropic Managed Agents vs current stack

Sources: 2026-07-04 strategic review Appendix D (competitive research with citations); Anthropic launch materials (Managed Agents public beta 2026-04-09: cloud-hosted agent infrastructure — sandboxing, permissions, state, upgrades — priced at token cost + $0.08/session-hour; Notion, Rakuten, Sentry, Asana building on it).

| Dimension             | Verdict                             | Notes                                                                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Isolation           | **Unproven**                        | Sandboxing is session-scoped; no public per-customer dedicated-instance model equivalent to the Machine boundary. Needs a direct read of the beta docs next cycle.                                                                                                                 |
| 2 Data custody        | **Fails today**                     | State and tokens live on Anthropic-hosted infrastructure; the vendor-blind pillar does not survive (Anthropic is already our inference sub-processor, but custody of tokens/memory is a different exposure than transient task content). No DPA-grade custody carve-out published. |
| 3 Hook surface        | **Fails today**                     | No public equivalent of the Hermes plugin hook surface; guardrails are platform-level permissions, not authorable per-tool-call interceptors. The twelve overlay plugins cannot attach.                                                                                            |
| 4 Connector transport | **Passes**                          | MCP-native; author-built connectors would port.                                                                                                                                                                                                                                    |
| 5 Cost per seat       | **Likely win on paper, unverified** | $0.08/session-hour + tokens undercuts a dedicated Machine at low duty cycle; at Operator duty cycles (cron wakes + webhook wakes + jobs) the comparison needs real arithmetic against ADR 0062 telemetry. Do the arithmetic next cycle if gates 1-3 move.                          |
| 6 Operational lift    | **Win for them**                    | Upgrades and state managed by the platform; our provision/pin machinery would shrink substantially.                                                                                                                                                                                |

**Conclusion (2026-07):** no migration spike. Hard gates 2 and 3 fail outright; gate 1 is unproven. The offering is exactly the commoditization the thesis predicts, and it is not yet shaped for a governed, vendor-blind, per-customer employee. Re-evaluate next quarter; watch specifically for (a) a customer-managed-key or BYO-storage custody story, and (b) any authorable interceptor/hook surface.

**Action carried:** none required this quarter. The authored-layer investment plan (packs, entitlements, voice, audit emission) is unaffected.
