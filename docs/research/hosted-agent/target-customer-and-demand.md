# Hosted Agent — Target Customer & Demand (research synthesis)

_Date: 2026-07-07. Method: multi-source deep research (fan-out web search → source fetch → 3-vote adversarial verification → synthesis). 24 sources, 107 extracted claims, 74 verification verdicts. This document is reconstructed from the verified claim ledger; claims are separated into **survived verification** vs **refuted**. Confidence is highest on the safe-action-pattern and action-vs-draft-demand findings (heavily corroborated primary sources) and lowest on precise micro-segment sizing (thin, refuted sources)._

## The question

For SMD's Hosted Agent SKU (managed, isolated, always-on Hermes agent, ~$49-79/mo, BYO Anthropic key, safety-first positioning): who is the real target customer, what do they expect the agent to **do**, what will they pay, and how do comparable products deliver **safe action-taking**? Framed demand-first and capability-open — deliberately not assuming a draft-only ceiling.

## Headline

**The market defines a personal agent by what it _does_, not what it drafts.** Microsoft, IBM, MIT Sloan, and the full competitive set frame the 2026 agent as autonomous action-taking ("the shift from reading to acting"). "It drafts, I send" is the entry rung, not the product. **Draft-only as a _ceiling_ is off-market.** The commodity managed host at ~$39/mo already sells "proactively sending messages + autonomous response" — our current draft-only posture ships _less than the commodity floor_.

## What got refuted (do not build on these)

- **"Lindy is draft-and-propose; won't send without approval" — FALSE.** Lindy is autonomous-send **by default** with an _opt-in_ per-action confirmation toggle on side-effectful actions. (Lindy's own docs + multiple corroborations. Note: one Lindy FAQ scoped narrowly to its "assistant" product does say drafts-for-review — but the platform's email/automation products send autonomously; the ceiling-not-default reading is correct.)
- **"Solopreneurs $15-50k/mo revenue; VA is their single largest expense" — REFUTED.** Traces to SEO/vendor marketing blogs with no primary data; VA cost guides put typical spend at $800-3,000/mo, usually not the largest line.
- **"Early adopters concentrated in legal / design / consulting / engineering" — REFUTED/overreach.** HBS working-paper data shows engineers are the _largest_ cluster but adoption is broad across knowledge work; the four-profession concentration is unsupported.
- **"48% of security pros call agentic AI the most dangerous vector" — REFUTED.** Non-scientific Dark Reading reader poll, no methodology/N.

## (a) Who the target actually is

Two coherent framings emerge, and they pull apart:

|                      | **A — Prosumer / technical adopter**                                                                     | **B — Regulated / trust-sensitive professional**                           |
| -------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Who                  | Founders, operators, consultants, chiefs of staff, engineers (largest adopter cluster), "company of one" | Legal, financial, compliance-bound professionals                           |
| Buys on              | Time saved + capability; benchmarks vs. human labor                                                      | Data isolation / safe-run as a **hard procurement filter**, above features |
| Expects the agent to | **Act** on their inbox/calendar/systems                                                                  | Act — but **provably** safely                                              |
| Price reality        | $49-79 is the **commodity floor**; churns fast                                                           | Enterprise pricing (low-five-figure/yr), **not $79**                       |
| Our safety wedge is  | a **nice-to-have** (secondary to capability)                                                             | **the primary purchase driver**                                            |

**The uncomfortable finding:** our "safely-run" wedge is a _purchase driver_ mainly for segment **B** — which is the **Operator**, at Operator prices. For the **$79 self-serve** crowd (segment A) safety is secondary; they buy on **what it can do**. A "$79 safely-run _but draft-only_" agent sells a secondary benefit to a price-sensitive crowd while withholding the primary benefit (action) they came for.

Self-hosted community signal: the self-host runtime community is real and active (Hermes/Nous, OpenClaw); its users are developers who value data sovereignty and pay only for tokens (BYO-key baseline). A managed $49-79/mo SKU must justify itself against that free-runtime baseline — the managed value is eliminating setup/maintenance time, not cash savings (true self-host cost with time ≈ $99-125/mo vs. ~$39 managed commodity).

## (b) Capability map — prepare vs. act

Demand is **overwhelmingly weighted to action-taking**: autonomously respond to inbound, run scheduled tasks, send/update systems, execute multi-step workflows. Prepare-only (digest / research / summarize) is real but **table-stakes** — the free tier of everything already does it. **Action is the paid tier.** Adoption signal: Gartner projects 40% of enterprise apps embed task-specific agents by end-2026 (from <5% in 2025); IDC projects 28.6M agents (2025) → 2.2B (2030).

## (c) Safe action-taking is a solved design space (best-verified cluster)

You are not choosing between "safe" and "capable." The converged 2026 playbook (Microsoft Secure Future Initiative, Microsoft Security Blog 2026-06-30, Lindy docs, arXiv 2604.14723, multiple frameworks) is **autonomy calibrated to reversibility and blast radius**:

- **Tier 1 — read-only** → fully autonomous.
- **Tier 2 — reversible** (drafts, CRM adds, tagging, scheduling) → autonomous **with logging** (soft-delete / undo, audit of prior state), not pre-approval.
- **Tier 3 — external / irreversible-to-others** (send email, post, SMS, third-party API) → **staging queue, dry-run preview, per-action confirmation, rate limit, confidence-based escalation** — a spectrum of controls; irreversibility (not the act) is the concern.
- **Tier 4 — money / contracts / access / delete** → **mandatory human approval** (per-action).

Supporting patterns, all corroborated:

- **Per-action confirmation on the risky subset only** (Lindy): autonomous by default, "Ask for Confirmation" toggle that pauses execution, notifies via email or in-app task menu, then the agent resumes and completes. This is confirm-then-agent-executes, distinct from draft-for-human-to-send.
- **Graduated / learned trust**: start with oversight, remove gates as confidence builds.
- **Least-agency + allowlists + deterministic pre-side-effect validation** ("deny everything by default"; validate tool parameters before execution to defeat hijacking).
- **Resource caps**: per-transaction limits, daily/weekly spend ceilings, rate limits; **time-boxed approval lanes** (e.g. 15s / 2min / 15min by risk) that fail-safe to denied.
- **Credential isolation**: keys held in a separate process, never in model context — emerging 2026 standard, driven by prompt injection (OWASP LLM #1).
- **Human-out / on / in-the-loop** as three coexisting tiers matched per-decision to risk; oversight level is a property of each _decision_, not a product-wide switch. Regulation (EU AI Act Art. 14, NIST AI RMF) now mandates demonstrable, provable human oversight, enforced via identity governance.

Full autonomy (unfettered Level-3) is essentially absent from production; the realistic frontier is **guardrailed / confirmation-based autonomous action**, not draft-only and not unfettered.

## (d) Willingness to pay (the sobering cluster)

- **$49-79 is the commodity floor.** Lindy's entry "Plus" plan is $49.99/mo — the exact bottom of our band — and ladders to Pro $99.99 (adds computer use) and Max $199.99 (7x usage); compliance features (SSO/HIPAA/audit) are Enterprise-custom only. Managed private-assistant SKUs cluster $50-99/mo (Vellum Pro $50, AnythingLLM $50-99).
- In the AI sales-agent market, only 16% of tools start below $49; median cheapest plan is $199/mo, average $428. A $49 price "actively undermines the perception that an AI agent can do meaningful work." Buyers benchmark against **human labor**, not productivity software. Low-priced tools (<$100) are confined to narrow, low-value workflows; **autonomous full-cycle execution commands $500+ on a labor-replacement narrative.**
- **Usage/throughput is the dominant paid-conversion and expansion lever** (96% of tools), far ahead of seats (19%); integrations and AI capability tie at 48%.
- **AI apps churn fast**: 41% more revenue per user but ~30% faster churn (21.1% vs 30.7% annual retention). WTP starts high on "magic" but "novelty-rich, habit-poor" products bleed subscribers; durable retention needs habit-forming, proven value. (RevenueCat State of Subscription Apps 2026; consumer-mobile scope — directional for a hosted-agent SKU.)

## (e) Where security actually ranks

- As a **risk**, security is genuinely top-of-mind: the attack model is "the agent itself is the compromised endpoint"; prompt injection turns a summarizer bias into a real action; the vulnerability lives at the **trust boundary** between connected systems. Credential isolation and mandate-scoping are the recommended controls.
- As a **purchase driver**, it splits by segment: a **hard procurement filter for regulated buyers** (ranks above feature completeness), but **secondary to time-saved/capability for prosumers and solopreneurs** (who frame trust as liability/privacy, not infrastructure isolation).

## Recommendation

**Stop selling a safe agent that does not act. Sell an agent that acts _safely_** — tiered autonomy calibrated to reversibility — and let the trust wedge command real money where it actually drives the purchase: the Operator (segment B, at Operator prices).

Concretely:

1. **Kill draft-only as the ceiling** for both SKUs; adopt tiered, risk-calibrated autonomy as the product model.
2. **Reposition the wedge as "safe action," not "no action"**: _"the agent that actually does things — and can't go rogue."_
3. **Price honestly**: $49-79 is the commodity floor and reads "narrow/low-value"; capability (action-taking) is what unlocks price and retention. Ladder tiers (entry → more autonomy/usage), like Lindy.
4. **Be clear who $79 wins**: the technical/prosumer adopter who wants an always-on agent that _acts_ on their own systems with sane guardrails — not the compliance buyer (that is the Operator). Make security the quiet confidence layer, not the headline.

The product-model translation of this recommendation lives in [`docs/design/hosted-agent/tiered-autonomy-product-model.md`](../../design/hosted-agent/tiered-autonomy-product-model.md).

## Key sources

- Lindy — human-in-the-loop docs (`docs.lindy.ai/testing/human-in-the-loop`), pricing (`lindy.ai/pricing`), email/automation product pages
- Microsoft — Secure Future Initiative, "Reduce autonomous agentic AI risk" (Microsoft Learn, 2026-03); Security Blog, "Securing AI agents: when AI tools move from reading to acting" (2026-06-30)
- arXiv 2604.14723 — "Bounded Autonomy for Enterprise AI: Typed Action Contracts and Consumer-Side Execution" (Sohail & Haider, 2026; single non-peer-reviewed preprint — graded-per-action-autonomy finding used; its "constraint improves capability" framing was refuted as overreach)
- RevenueCat — State of Subscription Apps 2026 (retention/WTP; consumer-mobile scope)
- Bessemer (BVP Atlas) — "Securing AI agents" (autonomy-vs-guardrails framing; the 48% poll figure refuted)
- Self-hosted / managed comparisons — Hermes/Nous and OpenClaw community writeups, managed-vs-self-host cost analyses, AI-sales-agent pricing surveys
