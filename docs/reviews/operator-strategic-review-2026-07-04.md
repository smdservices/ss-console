---
title: Operator Strategic & Architectural Review (2026-07-04)
---

# The Operator - Strategic & Architectural Review

**Date:** 2026-07-04
**Scope:** Four parallel audits: runtime engineering (`operator/` + `hermes-smd-overlay`), decision spine (`docs/adr/`, `docs/handbook/`), customer-facing surfaces (marketing, portal, admin), and the live competitive market (July 2026). Synthesized into grades, findings, and a recommendation set. Each recommendation is tracked as a GitHub issue; see the Recommendations section for the mapping.

---

## Verdict

**Overall grade: B - an A-grade platform wrapped in a C-grade customer product, with a D-grade commercial layer.** The thesis is validated by the market. The engineering is genuinely rare. The gap: everything a paying customer touches after signing, and everything a buyer's compliance reviewer asks for before signing, is behind the substrate by two quarters.

| Dimension | Grade | Basis |
|---|---|---|
| Architecture & runtime engineering | A- | Code-enforced fail-closed governance, twin-core parity hashing, conformance-as-CI. Deductions: audit ledger not hash-chained, invariant #8 unbuilt, enforcement lives in the overlay repo which this tree can only hash-verify |
| Strategy & thesis (ADR 0037/0040) | A | Survives contact with the market. Research found no like-for-like competitor and confirmed the moat decomposition |
| Marketing & positioning | A- | Sharp, thesis-true, voice-clean. Zero proof elements (deliberate pre-launch, but now the ceiling) |
| Documentation spine | B+ | Best-in-class supersession hygiene; but the two most economically load-bearing decisions (task framework "0050", cost breaker "0062") have no committed ADR, and index.md omits ~10 accepted ADRs |
| Customer product experience | C | Portal renders empty (runtime-read unwired, `loadHomeFeeds` hardcoded `[]`), no conversational surface, "flat monthly subscription" has no recurring billing engine |
| Commercial operations | D+ | No committed price, no SLA, no DPA artifact, no incident runbook, no cancellation/data-return doctrine. Unit economics live in session memory only |

## What we've done well

1. **The thesis is right, and the market proves it.** Nobody sells a cross-system, per-customer-governed, firm-managed AI operations employee to 5-25 person businesses at a salary-referenced price. The field splits into self-serve builders the owner must babysit (Lindy, Relevance), single-function employees (SDR/receptionist/EA), and enterprise-managed at 50-100x our price (Sierra: $200-350k Yr-1). Our $4k + ~$3.5k/mo lands inside the established AI-agency comp band ($3-12k setup, $1-5k/mo retainer) and under a loaded coordinator ($6.7-7.5k/mo): defensible from two directions.
2. **Fail-closed governance in code, not prompts.** Trust-ceiling resolution (most-restrictive-of, no imposed default, taint gate, sticky-stop) is the one thing nothing in the competitive table offers. This is the product.
3. **Substrate humility.** Pin-only fork, plugin-only overlay, trust Hermes. Anthropic Managed Agents now sells sandboxing/permissions/state at $0.08/session-hour; because we never welded ourselves to the substrate, we can migrate onto commodity infra as it improves and keep the authored layer.
4. **Forcing-function culture.** Contract registries, conformance CI, overlay-pair hashing, honesty banners, supersession-with-the-rip. Every past failure became an executable gate. TODO density ~zero across 142 Python files.
5. **Vertical pick.** PI law is exactly where governance-grade audit clears margin: professional-liability exposure makes the audit ledger a feature buyers need, not tolerate.

## What we've overlooked

1. **EvenUp PLAAS is aiming at our pilot vertical with $150M and humans in the loop.** Pre-Litigation-as-a-Service (May 2026): AI plus their own US case-management staff running claim setup, records retrieval, demand prep, lien resolution; more than $10M in subscriptions during early testing. "Nobody does this" is no longer true in PI pre-lit. No ADR addresses them. Our counter-story is real but unwritten: the Operator is the firm's own employee inside the firm's own systems (their Smokeball, their entitlements, their audit trail), not an outsourced vendor you route matters through; and it covers everything PLAAS doesn't (litigation phase, calendaring, vendor chasing, internal coordination).
2. **The product goes quiet the moment the customer signs.** Marketing promises "every action recorded where you can see it." The portal's Activity surface renders "No activity yet" while the operator does live work (`OPERATOR_RUNTIME_READ_URL` unwired; `src/lib/portal/operator/home.ts:59` hardcoded empty). The trust centerpiece is the emptiest screen we ship.
3. **The retainer has no billing engine.** `operator.astro:470-473` sells "flat monthly subscription, no surprise line items"; `src/lib/stripe/client.ts` contains only one-time invoice primitives. MRR is a display number, not a charge.
4. **A PI buyer's compliance reviewer finds nothing.** No product-level DPA (ADR 0057:59 names the obligation, never fulfilled), no security page, no sub-processor list for the Operator stack, no AI-disclosure page. `privacy.astro` covers website cookies. For this vertical that is a sales blocker.
5. **Margin is the tightest constraint in the model.** ~$3.5k/mo cost floor against a $6.7-7.5k/mo salary ceiling leaves thin room, and the mechanism protecting it (cost breaker) plus the pricing analysis exist only in memory/specs.
6. **Claimed breadth outruns built depth.** 12 pack pages, 13 vertical dirs: 1 production-real. 13 typed capability adapters: 1 live connector. Fine pre-launch; dangerous if a second-vertical prospect says yes tomorrow.
7. **"Compliance-grade audit" is per-row-hashed but not hash-chained**: tamper-evident against mutation, not deletion.
8. **Price-anchor exposure.** Owners will ask why an AI employee costs $3.5k/mo when ChatGPT is $20. The decomposition pitch is the weapon: receptionist ($300) + SDR ($1.5k) + EA + legal AI seats still buys zero connective tissue, and the connective tissue is the hire we replace.

## Competitive position

We occupy real whitespace at the delivery-model level, with a 12-24 month clock running. Three fronts:

- **Vertical specialists (EvenUp, Eve):** the sharpest near threat, but they pull work into their platform; we live in the firm's stack. Different physics. Speed to a referenceable A&P proof is the defense.
- **Platform giants:** commoditizing the substrate, not competing for the job. OpenAI's own churn (Operator to Agent to Agent Builder to Workspace Agents in 18 months) shows they ship primitives, not accountability. They are building the channel we occupy: someone still has to discover, configure, govern, and answer the phone when it goes wrong. That someone is us.
- **AI rollups ($3B+ deployed: General Catalyst, Thrive):** validate the economics (AI margin lives in services delivery) and will eventually fund vertical competitors with acquisition capital.

The moat claim (harness + guide + memory, ADR 0037 Tenet 4) survives with one amendment: the harness's generic half (sandboxing, permissions, connector plumbing) commoditizes within ~24 months. What compounds: the guide (accountable human firm), the memory (months of client-specific state = switching cost by construction), and the authored governance (entitlement models, voice, audit emission, packs). Doctrine already points there; investment should follow it.

## Recommendations

Priority order. Every recommendation is tracked as a GitHub issue.

| # | Recommendation | Wave | Issue |
|---|---|---|---|
| 1a | Wire runtime-read into the portal feeds (home, activity, aliveness) | 1 | #1678 |
| 1b | Build Stripe recurring billing for the Operator retainer | 1 | #1679 |
| 1c | Ship product trust pages: security, DPA, sub-processors, AI disclosure | 1 | #1680 |
| 2 | A&P pilot: reprovision with PI v0.2.0 + live lifecycle test (merge landed in #1637) | 1 | #1681 |
| 3a | Commit the pricing + unit-economics ADR (retro-document the cost plane; refs #1659, #1661) | 2 | #1682 |
| 3b | SLA shape + incident-response runbook | 2 | #1683 |
| 3c | Offboarding doctrine: cancellation, deprovisioning, data return | 2 | #1684 |
| 4 | EvenUp counter-positioning: amend ADR 0040 frame + arm the pitch | 2 | #1685 |
| 5a | Hash-chain the audit ledger | 3 | #1686 |
| 5b | Build fabrication filter invariant #8 or downgrade the compliance-grade claim (ref closed #798) | 3 | #1687 |
| 6 | ADR hygiene wave: commit phantom 0050, resolve 0044 collision, regenerate index.md, fix overlay README | 3 | #1689 |
| 7 | Confirm `operator/skills/**` and `operator/verticals/**` trigger substrate CI | 3 | #1688 |
| 8 | Quarterly substrate watch: Anthropic Managed Agents et al. as migration candidates | 3 | #1690 |

**One-sentence summary:** we built the enterprise-grade back half first (correct for a liability-bearing product), but the customer-visible front half and the commercial doctrine are now the whole risk surface, and the market just produced its first funded competitor in our pilot vertical.

---

# Appendix A - Runtime Engineering Audit

## Scope & shape

- `operator/` tree: 142 `.py`, 33 `.yaml`, 16 `.ts`, 14 `.sh`, 10 `.sql`, 243 `.md`. 64 pytest files / 627 test functions. TODO/FIXME density effectively zero (4 hits, all benign): the gaps are structural, not littered.
- Console side: 234 files reference "operator"; `src/lib/operator/` alone is ~55 modules; ~40 vitest suites guard Operator behavior (of 179 total).
- The running agent (Hermes + overlay plugins + skill bodies) lives in `venturecrane/hermes-smd-overlay`: 12 production plugins, ~79k LOC Python, 63 test files, active through overlay#124 (cost breaker). This tree holds the control plane, contracts, connector source, safety-substrate twin, provisioning, and authored config.

## Directory map (maturity)

| Dir | Purpose | Maturity |
|---|---|---|
| `safety-substrate/` | Trust-ceiling/taint/citation/identifier/sticky-stop/invariants | Mature. ~4,000 LOC + heavy tests |
| `adapter/` | Audit log, trust ceiling, namespace assertion, cost ingest/rollup, voice, evidence, inbound envelope | Mature. 2,800 LOC core + subpackages |
| `connectors/` | Author-built MCP connectors (`_sdk`, `_reference`, `smokeball`) | Mature but shallow catalog: 1 real connector |
| `bin/` + `bin/lib/` | Provisioning, decommission, seam-pull, voice-corpus, overlay-drift | Mature. `provision-customer.sh` = 789 lines; `decommission.py` = 1,060 |
| `skills/` | 29 law-firm base skill dirs | Mature for law base |
| `verticals/` | 13 vertical packs; only `law-firm` fleshed out | Uneven |
| `contracts/` | Machine-readable conformance registries | Mature + distinctive: the spine of drift gating |
| `workspace_broker/` | Managed-mailbox DWD broker + durable job ledger + audit ledger | Mature, well-tested |
| `customers/` | 5 seats + `_template` | Config |
| `bundles/`, `grading/` | One bundle yaml; rubrics only | Thin/near-dead |

## Connector architecture

Declaration model is clean and enforced: connectors bind per-seat in `customer.yaml.connectors{}` by backend prefix (`mcp:` / `build:` / `synthetic:`); an unbound connector is inert (never launched, no secrets, no tools). The shared SDK (`_sdk/operator_connector_sdk/`, ~400 LOC) is high quality: `server.py:21` guarantees non-empty `inputSchema` (closing the historical empty-schema bug), and `conformance.py:59` enforces that every live tool is classified in `manifest.toml` or explicitly `expected_unclassified` - a phantom class or ungoverned tool fails CI. Two-repo authority split is deliberate: manifest `tool_classes` checked here, hand-authored `_RAW_TOOL_ACTION_CLASS_MAP` in the overlay is enforcement authority; adding an action-taking tool requires edits in both repos.

Catalog: `smokeball/` is the only fully-built author connector (`server.py`, 641 lines, well-crafted: lazy client, inline action-class documentation per write tool, trust-account fund movement never implemented and hard-banned). `_reference/` is the synthetic self-test connector. `agentmail`, `google`, `clio` MCP servers live in overlay/vendor. Console-side `src/lib/operator/capabilities/` has 13 typed capability adapters (TS-side contracts per ADR 0006, not runtime tool surfaces). Verdict: architecture excellent; catalog thin - platform generality proven by exactly one production connector.

## Safety / governance substrate

The strongest part of the tree. Code-enforced, not prompt-enforced, heavily tested.

- **Trust ceiling** (`adapter/trust_ceiling.py`, 287 lines): six ActionClasses (READ/INTERNAL_WRITE/EXTERNAL_SEND/COMMITMENT/DESTRUCTIVE/CODE_EXECUTION). `resolve_ceiling()` takes most-restrictive of {authored override, unauthored resolution, vertical floor}; floors only narrow. No imposed default (ADR 0035): unauthored EXTERNAL_SEND is fail-closed `refused` (no send, no draft); `draft_for_review` only ever an authored value. Subtle and correctly implemented.
- **Taint gate** (`trust_ceiling.py:169`): a turn that ingested untrusted inbound content cannot fire EXTERNAL_SEND/DESTRUCTIVE/COMMITMENT/CODE_EXECUTION autonomously; READ + drafts pass. Mirrors the overlay's live `pre_tool_call` gate ("the two cores must agree").
- **Sticky-stop breaker** (`safety-substrate/sticky_stop.py`, 861 lines): system-initiated circuit breaker, forward-only WARN<SOFT<HARD, only Captain `clear()` resets. Deployed fleet-wide.
- **Egress/fabrication filters**: `citation_filter.py` (invariant #6: REFUSE any legal-citation-shaped output in law skills), `identifier_filter.py` (481 lines), `fabrication_markers.json`. Invariant #8 (full fabrication filter, `docs/specs/.../fabrication-filter.md`, #798) is spec'd but explicitly unbuilt.
- **Audit ledger** (`adapter/audit_log.py`, 658 lines): ULID + ISO + sha256 payload hash, closed-set `ACCEPTED_ACTION_TYPES`, fail-closed (`AuditWriteError` must not be swallowed). Soft spot: rows carry per-payload `_sha256` but no hash chain / prev-pointer - tamper-evident per row, not as a chain; a gap for "compliance-grade" positioning if a row can be deleted rather than mutated.
- **Grant/kill-switch** (`src/lib/operator/mcp/grant-store.ts`): ADR 0057 `mcp_issued_grants`, bounded TTL (default 30d, max 90d), JIT 7d ceiling + per-customer cap 50, sticky revoke, append-only grant audit.
- **Twin-core parity**: `contracts/overlay-pairs.json` + `bin/verify-overlay-pairs.py` (SEC-32) hash-verify that the tracked Python twins match the overlay at the pinned ref.

## Provisioning / deploy lifecycle

Repeatable and idempotent with a real closed-trap history. `provision-customer.sh` (789 lines): verify R2 creds, validate customer.yaml, split Hermes pin tag/SHA (ADR 0024), upload config to R2 pre-deploy, render fly.toml, idempotent app/volume creation, paste-flow secrets (pbpaste, never echoed), per-customer runtime-read key = HMAC(master, slug), deploy, boot smoke test. OVERLAY_REF pinning is airtight: Dockerfile ARG == contracts manifest ref == recorded twin hashes, asserted by vitest + CI. Rollback: `rollback-skill.sh`, `pause-customer.sh`, `decommission-customer.sh` + tested `decommission.py` (1,060 lines). Residual risk: the chain trusts overlay `validate.py`/`translate.py` to materialize what customer.yaml authored - mitigated by `contracts/customer-yaml-blocks.yaml` (every block classified `implemented|inert` or CI fails), but live materialization is asserted by the runtime-control harness, not proven in this tree.

## Vertical packs & skills

Skills are well-structured: `SKILL.md` frontmatter (trust_ceiling, action_class, connectors) + references + optional `pre_run.py` + tests. `matter-memo-on-update/SKILL.md` is exemplary: exact allowed-tools list with no-retries rationale tied to the connector's circuit breaker, payload-is-untrusted-data framing (ADR 0027), explicitly deferred enhancements. Gating is per-persona exposure x per-skill initiation (ADR 0056). Unevenness: `law-firm` is deep; the other 12 verticals are scaffolds (vertical.yaml + fixtures). At audit time the PI addon in-tree was v0.1.0 (4 skills, bodies in overlay) with no customer.yaml binding; the 19-skill v0.2.0 build landed in PR #1637 (merged 2026-07-03) - reprovision + live lifecycle test remain.

## Test posture

Strong and CI-wired. Python: 627 test functions; `operator-substrate.yml` runs invariants, pytest suites, per-connector isolated uv-venv conformance speaking live stdio MCP, plus the SEC-32 overlay hash drift gate. Contract/forcing-function tests are the standout (`test_customer_yaml_block_conformance.py`, `test_runtime_control_conformance.py`, `test_env_contract_conformance.py`, `test_deploy_ordering.py`). TS: ~40 vitest suites in `verify.yml`. Gap: the CI `paths:` filter does not obviously include `operator/skills/**` or `operator/verticals/**`, so skill-body and vertical changes may not trigger the Python substrate job - skill regressions could merge green.

## Engineering verdict

**B+ / A-.** Disciplined, senior-level systems work with an unusually strong forcing-function culture; nearly every past failure is memorialized as an executable gate. Weaknesses: split-repo trust boundary (running enforcement lives in the overlay; this tree can hash-verify but not execute it), audit ledger not hash-chained, invariant #8 unbuilt, catalog thinness masquerading as breadth. Highest-value follow-ups: skill-path CI coverage, audit hash chain, invariant #8 or claim downgrade, PI addon bound and live-tested.

---

# Appendix B - Decision Spine & Documentation Audit

## ADR inventory highlights

59 ADR files (0001-0060 with gaps). Supersession is aggressively and explicitly marked; chains hang together (0005>0025>0031>0035>0037 entitlements; 0004>0034>0037>0040 SKU>naming>thesis>positioning; 0030>0052 control plane>portal boundary). No silent contradictions found: contradictions are consistently caught and annotated. The risk is omission and phantom-reference, not quiet drift.

**Structural defects:**

- **ADR 0050 is a phantom.** Referenced 8 times as the parent task-execution framework (including by 0051, which cites a nonexistent "0050 amendment of 2026-06-23"). The 6-class taxonomy (N/C/R/D/A/O) that 0051 and multiple specs lean on has no committed decision record.
- **ADR 0044 number collision.** `0044-r2-authoritative-live-reconfig` (accepted, widely cited) vs `0044-static-secret-connector-contract` (proposed, orphaned).
- **No ADR 0062 on disk** despite the cost-plane wave being shipped and live fleet-wide. The cost breaker doctrine lives only in `docs/specs/operator/sticky-stop.md` and `docs/design/operator/b3-sticky-stop-live-wiring-review.md`.
- **`docs/adr/index.md` omits ~10 accepted ADRs** (0041, 0042, 0043, both 0044s, 0048, 0049, 0051, 0054, 0055), including load-bearing ones, and its "substantive corpus" pointer routes to the pre-Operator decision-stack.
- Gaps at 0013, 0014, 0050, 0061, 0062 (no files).

## Strategic spine (summary)

- **ADR 0004:** second front door - flat retainer SKU alongside consulting - without repositioning the firm. Price explicitly deferred pending cost-up analysis.
- **ADR 0037 (Thesis):** competes with a hire; configurable substrate; no imposed defaults; moat = harness + guide + memory; packs make the universal recognizable; market-driven targeting.
- **ADR 0040:** law-first positioning: "runs on your firm's expertise and gets better at your firm every week." Salary is the frame, not the moat. Competitive window called at ~12-18 months.
- **ADR 0056:** entitlement rebuild - persona-level exposure x skill-level initiation, sparse, fail-closed; `read` enforcement-allowed, never customer-authored.
- **ADR 0051:** durable task-execution substrate (B1) with an explicit honesty banner about what is not yet true.
- **ADR 0052:** portal = management console (Direct/Account/Administer), never a data surface; no portal action touches client work; client objects are opaque refs.
- **ADR 0057:** three-layer Claude-connector access (login/authorization/issuance); grant table read live per request = instant kill switch; screening-attestation gate ripped 2026-06-29; console-sole door amendment 2026-07-02 after finding the Machine `/mcp` bypassed the kill switch.

## Handbook

34 pages, CI-enforced integrity (dead links, missing cited sources, em dashes block merge). `operator-platform.md` current and accurate. `adr-index.md` (handbook copy) stale: stops at 0051/0056, references phantom 0050, omits 0057-0060. `pricing-economics.md` current and honest: carries an explicit `TODO(why)` flagging that the $4k/$3.5k baseline exists only in session memory, not a committed artifact.

## Commercial-ops gaps (outside-reviewer view)

| Concern | Status |
|---|---|
| SLA / uptime | Missing as doctrine; ADR 0004 follow-on never closed |
| Incident response / on-call | Missing; flagged in 0004:70 as pre-first-customer requirement |
| DPA / privacy posture | Partial: security overview is Smokeball-scoped; 0057:59 names the DPA obligation, no artifact exists |
| Churn / offboarding | Partial: access offboarding exists (0057); no cancellation/deprovision/data-return runbook |
| Multi-seat scaling | Deferred by design (0029 direction-only; 0011 ships length-1 personas) |
| Unit economics | Missing as committed artifact: the sharpest gap; cost-attribution spec exists, no margin/unit-economics ADR |

## Docs verdict

As an engineering/architecture asset: excellent; a competent successor could rebuild the platform's reasoning. As a business-operating asset: the money layer (price, margin, SLA, incident, cancellation) is under-committed relative to the security/architecture layer. Four highest-leverage fixes: commit phantom 0050, write the cost-plane/unit-economics ADR, resolve the 0044 collision, regenerate index.md.

---

# Appendix C - Customer-Journey Surfaces Audit

## Marketing site: mature, differentiated, zero proof

One-door funnel across `index.astro` (8-beat firm-wraps-flagship spine), `operator.astro` ("Hire Once." + priced-against-a-hire pitch), 12 industry pack pages, honest-broker beat ("Not Every Problem Needs An Operator"). FAQPage + ProfessionalService/Product/Offer JSON-LD. `packs/law-firm.astro` walks a de-identified PI lifecycle in a strict three-line grammar (Operator does / your part / if it stalls) with the guardrail up front ("every piece of work goes to an attorney to review; the Operator never sends to another party and never signs on its own"). Voice compliance clean. Gap: no case study, no testimonial, no client logo, no named pilot - every claim is unbacked assertion.

## Conversion path: consulting funnel wired, retainer funnel not

Shared entry via `book.astro` unified intake. The scope-based consulting funnel is coherent end-to-end: assessment > admin quote draft > portal quote page > embedded SignWell > Stripe one-time invoice (deposit/completion/milestone) > SOW PDF (3-page, authored-content-only). The material gap: `operator.astro:470-473` promises a flat monthly subscription, but `src/lib/stripe/client.ts` exports only one-time invoice primitives (no subscription/recurring/price/checkout anywhere). `api/admin/clients/[id]/operator-price.ts` writes only `services.recurring_price` - an MRR display number. Recurring billing is unbuilt; every month would be a manual invoice.

## Client portal: extensive scaffolding, read-only and runtime-empty

Built to the ADR 0052 vision (Direct/Account/Administer) but gated: `DomainSurface.astro:14-18` renders read+request for every surface at launch (client edits nothing directly; files change requests). Runtime feeds fail closed to empty: `lib/portal/operator/home.ts:59-66` returns hardcoded empty arrays (recentActivity, needsAttentionCount, escalations); `activity-read.ts:58-60` short-circuits when `OPERATOR_RUNTIME_READ_URL` is unset. Result: the Activity & Audit surface - the "you can see and prove everything your operator did" trust surface - renders "No activity yet" even while the operator does live work. No client-facing conversational surface exists (change-request forms only). Portal states are honest by construction (no_subscription/provisioning/paused/no_role/active) and never fabricate; the problem is how much renders as an honest blank.

## Admin console: the most mature surface

Captain launchpad (needs-you-today queue, one-time + recurring revenue shapes, delivery/fleet motion), deep operator fleet console (roster with persona/posture/health/alerts, per-customer overview with 10 drill-ins: config, governance, authority, connectors, runtime, memory, people, lifecycle, cost, config-history), strict ADR 0009 isolation (console-side projections only, never runtime D1 direct, never joins two customers). Plus client hub, engagements, quotes, billing, follow-ups, analytics, and the handbook rendered at /admin/playbook. This surface works today.

## Trust & compliance surface

Marketing makes strong specific claims (`operator.astro:256-295`: isolated infrastructure, vendor-blind, every action recorded, cannot self-escalate) that map accurately to the real architecture. Absent: product-level DPA, security page, sub-processor list, AI-disclosure page (`privacy.astro` is website-cookies only), and the audit trail that would substantiate the claims renders empty in the portal.

## Journey verdict

If an A&P-like owner walked it today: marketing > book shines (they would feel seen); the consulting funnel is polished and complete; the admin console is real infrastructure. Embarrassments: (1) the paying customer's portal is mostly empty or read-only - the headline promise is the emptiest screen; (2) the billing promise has no billing engine; (3) no way to talk to the Operator from the portal; (4) trust claims outrun verifiable backing. The journey is impressive until the customer signs - then the surface they were sold goes quiet.

---

# Appendix D - Competitive Landscape (July 2026)

## Direct competitors: managed/done-for-you AI employees for SMBs

| Vendor | What | Pricing | Managed? |
|---|---|---|---|
| Lindy | Horizontal AI-employee builder | ~$50-200/mo tiers, credit-metered | Self-serve; owner babysits |
| Relevance AI | Multi-agent workforce platform | Free-$349/mo + enterprise | Self-serve; agencies build on it |
| Artisan / 11x / AiSDR / Regie | AI SDRs | $600-5,000/mo; 11x ~$45k median ACV | Single-function |
| Sierra | Enterprise CX agents, outcome-priced | ~$50-200k setup; $200-350k Yr-1; $200M ARR | Fully managed, CX-only, enterprise-only |
| Ema / Marblism / Heyy / Vendasta | Universal/templated AI employees; white-label for agencies | Mostly sub-$500/mo SMB SKUs | Templated, shallow, no per-customer governance |
| Smith.ai | AI + human receptionist (law-firm integrations) | AI from ~$95/mo; hybrid from ~$292/mo | Managed, front-door only |
| Fyxer / Howie | AI EA (email/scheduling) | $25-95/mo | Self-serve, single-function |

Structural read: the market splits into (a) self-serve builders where the owner does configuration and maintenance, (b) single-function employees owning one channel, (c) fully-managed enterprise agents at 50-100x SMD's price. No vendor found sells a cross-system, multi-function, per-customer-governed AI operations employee, managed by an accountable firm, priced against a salary, to 5-25 person businesses. Managed-service setup fees in the SMB agent market run $3k-12k, bracketing SMD's $4k stand-up.

## Legal vertical: what a PI firm on Smokeball can buy today

- **Smokeball Archie** (native): sidebar assistant - summarization, drafting, billing entries; Archie Apps marketplace (TryNovo med chronologies/demand letters). Not an autonomous coordinator.
- **Clio Manage AI**: $49-59/mo add-on copilot inside the PMS. Same shape.
- **EvenUp - the one to watch**: $2B valuation, $150M Series E. Jan 2026: AI Communication Agents for routine PI case admin. May 2026: Pre-Litigation-as-a-Service (PLAAS) - AI + EvenUp's own US-based case-management staff running the full pre-lit lifecycle; >$10M PLAAS subscriptions in early testing. A managed AI-plus-humans operations offering aimed at exactly SMD's pilot vertical.
- **Eve (eve.legal)**: nightly Auditor over active matters + agents drafting demands/discovery, chasing records; ~$100-300/user/mo enterprise. Closest software-only overlap with the coordinator role.
- **Harvey / CoCounsel**: legal-work AI, not ops ($225-640/seat/mo). Complementary, not competitive.
- **Intake AI** (Smith.ai, Gideon, Lawmatics AI Suite): competes for one slice of the coordinator job.

Counter-story vs EvenUp/Eve: they pull work into their platform; the Operator is the firm's own employee inside the firm's existing stack, firm-governed, covering everything outside pre-lit, and configurable across verticals.

## Platform giants

- **OpenAI**: standalone Operator killed Aug 2025; AgentKit/Agent Builder wound down Nov 2026; Workspace Agents in ChatGPT Business ($20/user/mo). Churn = primitives, not accountability.
- **Anthropic**: Claude Cowork GA Apr 2026; Managed Agents public beta (sandboxing, permissions, state, upgrades) at token cost + $0.08/session-hour. The substrate getting radically better and cheaper - an ingredient SMD can adopt.
- **Microsoft**: M365 Copilot Business $18/user/mo (<=300 seats); Copilot Studio agents. Cheapest distribution, but someone must author, govern, maintain: that someone is a partner. The giants create the channel SMD occupies.
- **Google**: Gemini Enterprise Agent Platform (May 2026), enterprise-developer-oriented.

Threat timeline: self-serve single-app workflows genuinely usable within 12 months (already are); multi-system, liability-bearing, vertical-specific stays a services problem. Real platform risk is price anchoring ($20 ChatGPT vs $3.5k Operator): the salary frame and managed-service story must carry the gap.

## Agencies / rollups

AI-automation-agency norms: discovery $1.5-3k; implementation $5-25k; retainers $1-5k/mo (to $15k/mo for optimization tiers). VC-backed AI rollups ($3B+ deployed: General Catalyst's Eudia/Titan/Long Lake, Thrive's Crete at $300M+ revenue across 30+ CPA firms) buy services firms and inject agents - same conviction (AI margin lives in services delivery), heavyweight version. They validate the economics and will eventually produce vertical competitors with acquisition capital; speed to referenceable vertical proof is the defense.

## Pricing landscape

| Item | Price |
|---|---|
| AI receptionist | ~$95-300/mo |
| AI EA | $25-95/mo/person |
| AI SDR | $900-5,000/mo headline; 1.5-2x for data/sending |
| Managed agent deployment (agency) | $3-12k setup + $1-5k/mo |
| Enterprise managed agent (Sierra-class) | $50-200k setup; $200-350k Yr 1 |
| Legal AI seat | Clio +$49-59; CoCounsel $225-400+; EvenUp est. $500-2,000/mo |
| Human ops coordinator (US) | $55-70k/yr salary; ~$80-90k loaded = $6.7-7.5k/mo |
| Human ops manager (US) | $84-107k/yr |

## Technology trajectory

METR 50%-reliability task horizon doubles ~every 7 months; but 2026 reliability research shows super-linear degradation with task complexity - success collapses in the 4-16 hour band. Translation: unattended long-horizon ops work still requires exactly the harness discipline SMD builds. MCP is now shared infrastructure (Linux Foundation, 97M monthly SDK downloads, ~9,650 servers, all three giants standardized); enterprise gaps remain in audit trails, SSO auth, gateway behavior - the exact layer the overlay supplies. 12-24 month projection: connectivity commoditizes fully; generic harness primitives commoditize partially; what compounds and does not commoditize: the guide, the memory, and governance-grade audit in liability-exposed verticals. The moat claim survives only if "harness" is understood as the authored governance on top of the substrate, not the substrate itself.

**Bottom line:** (1) no direct like-for-like competitor at SMD's price point and delivery model as of July 2026; (2) the most dangerous adjacent player for the pilot vertical is EvenUp PLAAS; (3) the platform giants are commoditizing the substrate and creating a partner channel rather than competing for the SMB ops-employee job; (4) pricing is defensible via both agency comps and the salary frame, but the ~$3.5k cost floor vs a $6.7-7.5k/mo loaded coordinator is the tightest constraint in the model.
