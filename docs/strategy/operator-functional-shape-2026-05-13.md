# Operator Functional Shape — 2026-05-13

**Issue:** [#778](https://github.com/venturecrane/ss-console/issues/778)
**Authorizes:** Phase 1 vertical pack, positioning posture, trust-ceiling discipline, onboarding shape
**Companion doc:** [Stack evaluation](./operator-stack-evaluation-2026-05-13.md)
**Captain decision required** — does not auto-execute.

---

## Executive summary

Per Captain directive (2026-05-13, imperative), we cannot productize Operator on a single podcast's perspective. Three parallel research agents covered the market scan (demand and pricing), operational reality (trust ceiling, failure modes), and per-vertical task taxonomy. Findings triangulate strongly. Five top-level signals govern every downstream decision:

**1. The $5K/mo consensus mid-market mark is real.** It shows up as 11x.ai's published floor, mid-market agency-retainer benchmarks, and the lower bound of fractional CTO. Productized Operator at $5K/mo lands exactly where mid-market buyers expect "ongoing AI service" to cost. Anything below $3K/mo collides with self-serve tools and reads as "another piece of software," not "a worker." Anything above $15K/mo competes with FDE / fractional CTO contracts.

**2. Name the role, not the technology.** Every operator winning at retainer pricing names a specific role: Alice the SDR, Jordan the phone agent, Pharmie the pharmacy tech, Eve the legal hire. Customers don't buy "AI agents" — they buy a named worker who does a named job. SMD's SKU should pick a role per engagement and brand against it.

**3. The trust ceiling is the product.** Position the SKU as "**AI-assisted, human-accountable**" — not "autonomous." Klarna's reversal (re-hired humans after autonomous customer service degraded), Moffatt v. Air Canada (operator liable for chatbot misrepresentation), and the AI-SDR cancellation curve (50-70% churn in days 60-90, mostly from one visible failure) all point at the same conclusion: autonomy without accountability is a churn engine. Successful operators run hybrid by design.

**4. Productize the operating layer, not the build.** The recurring revenue lock is in monitoring, evals, prompt regression, model swaps, escalation triage — the "agent ops" retainer shape that mirrors DevOps. The one-time setup is the wedge; the retainer is the business. SMD's existing Assessment → Solution → Implementation → Handoff framing extends naturally with a 5th phase: _operate_.

**5. Marketing agencies are the recommended _first_ vertical pack to ship.** Lowest catastrophic-failure exposure (no E&O, no bar referrals, no fair-housing liability), clear single gateway (Slack), Phoenix density of agency owners, buyer is also decision-maker. **Operator follows an expansive vertical strategy** (Captain directive, 2026-05-13): any vertical where we can realistically deliver $5K/mo of value to a $750K-$5M revenue business is in scope. Vertical packs sequenced by acquisition speed and build cost, not by SMD's primary consulting verticals. Marketing agencies is the recommended _starting point_ because the path to first paid customer is shortest there — not a vertical constraint.

The rest of this doc is the evidence: market scan, operational reality, per-vertical task taxonomy, cross-vertical patterns, Phase 1 launch recommendation with reasoning, and implications for downstream decisions.

**Important callout for Captain.** The operational reality research surfaced a documented production failure on OpenClaw (Meta AI Safety director's agent deleting her inbox in Feb 2026 after context compaction silently dropped a "don't act" instruction). This doesn't change the stack eval's Hermes Phase 1 pick — Hermes and OpenClaw are different products — but it does emphasize that the trust-ceiling discipline isn't theoretical. The frameworks themselves can lose safety constraints.

---

## Market scan — demand & pricing patterns

### What operators sell

In 2026, "AI agent service" / "Operator" has fractured into four operator archetypes:

1. **Vertical "AI worker" replacing a named role — enterprise SaaS dressed as a hire.** [11x.ai](https://www.11x.ai/) sells "Alice" (autonomous SDR) and "Jordan" (AI phone agent) as named digital workers, positioning as drop-in replacements for sales-team headcount. Pitch: "the world's best SDR at a fraction of the cost." Customers: Siemens, ZoomInfo, Airtable, Pleo, ElevenLabs. [Salient](https://www.trysalient.com/) sells AI voice agents specifically for auto-lender servicing, [working with more than five of the top ten US auto lenders](https://fortune.com/2025/12/18/salients-quiet-ai-boom-how-this-two-year-old-startup-is-building-a-company-to-survive-the-bubble-burst/). [Eve.legal](https://www.eve.legal/careers) sells "the first AI hire for legal firms."

2. **Outcome-priced support agents — large incumbents.** [Fin by Intercom](https://fin.ai/pricing) at $0.99 per resolution, with a public claim of [67% average resolution across 7,000+ customers](https://gtmnow.com/how-intercom-built-the-highest-performing-ai-agent-on-the-market-using-outcome-based-pricing-with-archana-agrawal-president-at-intercom/). [Decagon](https://sacra.com/c/decagon/) at per-conversation/per-resolution (~$1.50/resolution high end). [Sierra](https://sierra.ai/blog/outcome-based-pricing-for-ai-agents) charges only on successful outcomes. All three quote-only at the enterprise tier — none publish list prices.

3. **YC-style narrow vertical agents — execute a workflow, don't assist.** S25 in particular pushed [domain-specific agents that _do_ the work](https://catalaize.substack.com/p/y-combinator-s25-batch-profile-and): [Closera](https://www.ycombinator.com/companies/closera) (commercial real estate), [Pharmie AI](https://www.ycombinator.com/launches/O8s-pharmie-ai-your-ai-pharmacy-technician) (pharmacy technician, [live in 4 locations, 70% phone-volume cut](https://www.ycombinator.com/launches/O8s-pharmie-ai-your-ai-pharmacy-technician)), [Kaelio](https://www.ycombinator.com/companies/kaelio) (healthcare data copilot). [CB Insights summary of the S25 batch](https://www.cbinsights.com/research/y-combinator-summer2025/): ~88% AI-native, concentrated in "agents that execute complete workflows."

4. **AI automation agencies / "AI agency" operators — bespoke build + retainer.** The mass-market shape: project-based build ($2,500-$15,000) followed by $500-$5,000/mo retainer for monitoring, ModelOps, expansion. [Digital Agency Network's 2026 pricing guide](https://digitalagencynetwork.com/ai-agency-pricing/) and [Arsum's breakdown](https://arsum.com/blog/posts/ai-automation-agency-pricing/) both anchor to this range. Phoenix-local examples include [AutomateNexus](https://automatenexus.com/locations/arizona/phoenix) (one-time build + $99-$399/mo infrastructure) and [Lithium](https://lithiumseo.com/phoenix-arizona-ai-systems/) (24/7 AI call center at $179/mo). Voice-specific agencies report [$300-$800 MRR per client plus $800-$2K setup, with ~$50-$100/mo hard cost](https://www.indiehackers.com/post/building-a-profitable-ai-voice-saas-agency-300-800-mrr-per-client-frAbgO1yQMfHOFFtY3gE).

5. **The Forward Deployed Engineer model (newest, post-May 4 2026).** Both [Anthropic and OpenAI launched PE-backed enterprise services arms on May 4](https://techcrunch.com/2026/05/04/anthropic-and-openai-are-both-launching-joint-ventures-for-enterprise-ai-services/), [committing $5.5B combined](https://beam.ai/agentic-insights/openai-anthropic-spent-5-5b-on-consultants-what-that-tells-you) to FDE-style deployment teams modeled on Palantir. The labs themselves are claiming the work — validates the services-around-agents thesis at the same time as it raises the ceiling.

### What customers pay for

Across all four operator archetypes, the value prop that closes is **outcome delivery without hiring**, not access to a tool.

- **At $5K+/mo (e.g., 11x):** customer is buying _headcount substitution_. Checkr (a public 11x customer) [reports 7x ROI on pipeline generated and 3.2x reply-rate lift](https://www.11x.ai/). The line crossed: "stop hiring SDRs." Annual commitments standard.
- **At outcome pricing (Fin, Decagon, Sierra):** customer is buying _resolved tickets / closed deals_, period. Budget owner doesn't forecast usage — they pay only when the agent succeeds. Fin's [$1M performance guarantee for 250K+ monthly conversations](https://thegtmnewsletter.substack.com/p/gtm-178-intercom-ai-agent-outcome-based-pricing-archana-agrawal) is the procurement answer to "what if it doesn't work?"
- **At agency-retainer pricing ($1K-$5K/mo):** customer is buying _operational continuity_. The retainer covers what's commonly framed as ["ModelOps" — eval runs, prompt regression, model swap-outs when prices change, escalation triage](https://www.indiehackers.com/post/services/maintaining-340k-yr-revenue-while-halving-agency-workload-and-headcount-SEDr4DTBIq7lv8s8Az2n). Same shape as a DevOps retainer.
- **At the SMB Operator tier ($50-$500/mo, e.g., [Lindy](https://www.lindy.ai/pricing) at $49.99/mo entry):** customer is buying _task elimination_ — admin/email/scheduling hours back. Testimonials emphasize hours returned ("4 hours of email daily down to 8 minutes"), not strategic capability.

The common thread: customers pay for **the work done**, with pricing structure matching how the buyer mentally accounts for the cost being replaced. Outcome pricing wins where outcomes are countable. Flat retainer wins where the work is continuous and varies. Per-role wins where the customer is mentally subtracting headcount cost.

### Pricing distribution

| Tier               | Typical inclusions                                                         | Operator examples                                                                                                                                                                                                                                                           | Buyer                              |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **$50-$300/mo**    | Self-serve AI assistant, capped-call receptionist, single-workflow chatbot | [Lindy](https://www.lindy.ai/pricing) ($49.99), [Smith.ai Starter](https://smith.ai/pricing/ai-receptionist) ($97.50/30 calls), Lithium AI call center ($179)                                                                                                               | Solopreneur / micro-SMB            |
| **$300-$900/mo**   | Voice agency per-client retainer, mid-tier SDR tool                        | [AI voice agency clients $300-800 MRR](https://www.indiehackers.com/post/building-a-profitable-ai-voice-saas-agency-300-800-mrr-per-client-frAbgO1yQMfHOFFtY3gE), [AiSDR $900/mo unlimited seats](https://aisdr.com/pricing/)                                               | SMB / mid-market entry             |
| **$1K-$3K/mo**     | "AI System Support Retainer," monitoring, single named workflow            | [Industry retainer benchmarks $2K-$8K](https://optimizewithsanwal.com/ai-automation-agency-pricing-2026-a-cfos-guide/), email-marketing AI retainers $2K-$5K                                                                                                                | SMB with one critical workflow     |
| **$3K-$8K/mo**     | "Mid-market ModelOps retainer," full agent ops, multi-workflow             | [Mid-market retainer $5K/mo benchmark](https://optimizewithsanwal.com/ai-automation-agency-pricing-2026-a-cfos-guide/), [fractional CTO $5K-$10K](https://uxcontinuum.com/fractional-cto-pricing), [content+AI retainers $3K-$10K](https://gigradar.io/blog/content-agency) | Mid-market with multiple workflows |
| **$5K-$15K+/mo**   | Named-role AI worker with enterprise commitment, annual contracts          | [11x $5K+/mo, 1-year terms](https://syncgtm.com/blog/11x-ai-review), [Regie.ai 10-seat min $1,800+/mo](https://www.amplemarket.com/blog/best-ai-sales-agents)                                                                                                               | Mid-market sales / support teams   |
| **Outcome-priced** | Per resolution / per closed deal / per resolved chat                       | [Fin $0.99/resolution](https://fin.ai/pricing), [Decagon ~$1.50/resolution](https://sacra.com/research/decagon-vs-sierra/), Sierra outcome-tied                                                                                                                             | Enterprise support orgs            |
| **$5K-$40K POC**   | Managed deployment of self-hosted agent stack with compliance              | [Hermes managed deployment tiers](https://petronellatech.com/blog/hermes-agent-ai-guide/), [enterprise agentic platforms $100K-$300K/yr](https://www.acceldata.io/blog/enterprise-agentic-ai-implementation-price-cost-analysis)                                            | Regulated / SOC2 / HIPAA           |

**The floor for "productized operator" pricing is ~$50/mo** (self-serve) **and the practical floor for a real services retainer is ~$300/mo** (voice agency single-client). Median productized SKU: $1K-$3K/mo. **$5K/mo is the named "mid-market mark"** for ongoing AI services — both the [agency-retainer benchmark](https://optimizewithsanwal.com/ai-automation-agency-pricing-2026-a-cfos-guide/) and 11x's published floor land there. **$15K/mo is the practical ceiling** before the deal converts to a fractional CTO contract or full enterprise platform license.

### ARR signals

Real public revenue numbers in agent-services, late 2025 / early 2026:

- **Fin (Intercom):** [Grew $1M → $100M+ ARR](https://gtmnow.com/how-intercom-built-the-highest-performing-ai-agent-on-the-market-using-outcome-based-pricing-with-archana-agrawal-president-at-intercom/) on $0.99/resolution. Most-cited proof point.
- **Sierra:** [$104M ARR November 2025, growing 354% YoY, valued at $10B (96x forward)](https://sacra.com/c/decagon/). Outcome-based.
- **Decagon:** [$35M ARR November 2025, up 2.5x in a year, valued at $1.5B (42.9x)](https://sacra.com/c/decagon/). Per-conversation and per-resolution.
- **11x.ai:** [~$25M ARR, up 5x YoY, $50M Series B at $350M led by a16z](https://www.todayin-ai.com/p/11x). $5K+/mo per-customer, annual contracts. Note: 11x has [taken public scrutiny on customer churn and overstated logos](https://www.todayin-ai.com/p/11x) — ARR claim is company-reported, not independently audited.
- **Salient:** [Past $25M ARR](https://fortune.com/2025/12/18/salients-quiet-ai-boom-how-this-two-year-old-startup-is-building-a-company-to-survive-the-bubble-burst/), valued ~$500M; serving 5+ of top 10 US auto lenders; processed $1B+ in transactions.
- **CrewAI:** [~$3.2M revenue by July 2025, 150+ enterprise customers, 100K+ agent executions/day, $18M Series A](https://composio.dev/case-study/11x).
- **Pharmie AI:** [Live in 4 pharmacy locations, 70% phone-volume cut](https://www.ycombinator.com/launches/O8s-pharmie-ai-your-ai-pharmacy-technician).
- **Indie-operator claims (treat as claims, not facts):** [Solo operator $41K MRR after 14 months, prior-authorization agent for PT clinics](https://www.indiehackers.com/post/services/maintaining-340k-yr-revenue-while-halving-agency-workload-and-headcount-SEDr4DTBIq7lv8s8Az2n). [Austin agency: $42K MRR with 12 clients and 2 strategists](https://almcorp.com/blog/make-money-ai-digital-agencies-2026/).
- **Jason Lemkin / SaaStr:** [Replaced his 10-person GTM team with 20 AI agents managed by 1.2 humans](https://www.lennysnewsletter.com/p/we-replaced-our-sales-team-with-20-ai-agents). Operating model change, highest-profile public proof that the AI-as-headcount thesis isn't fringe.

### Service shape vs adjacent services

| Adjacent service              | Typical price                                                                           | What client gets                                            | Operator wins                                         | Operator loses                                             |
| ----------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| **Fractional CTO**            | [$5K-$15K/mo](https://uxcontinuum.com/fractional-cto-pricing)                           | Senior human strategic+technical leadership, 10-20 hrs/week | Continuous execution, 0-latency, throughput multiples | No judgment, no investor convos, hallucination on novel    |
| **Virtual Assistant**         | [$600-$4K/mo](https://www.peopleblue.us/blogs/virtual-assistant-pricing)                | A person doing email/scheduling/admin, 20-40 hrs/week       | Always-on, scales without re-hire, no PTO             | Empathy, relationship handling, ambiguous judgment         |
| **Marketing agency retainer** | $3K-$10K/mo                                                                             | Strategy, content, paid media, reporting                    | Repeatable production at higher cadence               | Brand stewardship, creative direction                      |
| **RPA consulting**            | [$0.001/task floor, $100K+/yr enterprise](https://www.mywave.ai/blog/agentic-ai-vs-rpa) | Deterministic if/then automation                            | Unstructured inputs, dynamic decision-making          | Predictability, auditability, compliance for deterministic |

**Positioning angles that work in 2026:**

- "AI worker who never sleeps and costs less than a hire" — 11x, NoimosAI, Lindy.
- "Pay only when it works" — Fin, Sierra, Decagon.
- "We run the agent so you don't have to" — agency retainer, fractional-AI-ops framing.
- "Verticalized to your industry's compliance and language" — Salient (auto lending), Pharmie (pharmacy), Eve (law), Closera (CRE).

**Positioning angles that don't work:**

- Generic "AI for your business" with no named role and no named outcome. Saturated.
- "We'll build you an agent" one-time-fee without a retainer — leaves money on the table.
- Per-seat pricing for SDR/support work. [Per MindStudio's analysis](https://www.mindstudio.ai/blog/saas-pricing-ai-agent-era), per-seat is collapsing in agent categories — buyers think "replacing a role," not "adding a license."

---

## Operational reality — what works, breaks, and where the trust ceiling lives

### Trust ceiling map

The pattern across operators: **trust correlates with reversibility, blast radius, and recipient identity** — not with task complexity. An agent can be trusted to do something difficult if a human will see the output before it leaves the building. The same agent cannot be trusted to do something simple if the artifact lands directly in a customer's inbox or a production database.

| Task type                                  | Typical trust level                 | Review pattern                                                                                                                             | Source                                                                                                                                                                                         |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email triage (read/categorize)             | High — autonomous                   | None; log-only                                                                                                                             | [Arize](https://arize.com/blog/common-ai-agent-failures/)                                                                                                                                      |
| Email draft (compose for review)           | High — autonomous                   | Human reads before send                                                                                                                    | [Towards AI](https://pub.towardsai.net/human-in-the-loop-for-ai-agents-draft-approve-execute-c7fe0b72b0af)                                                                                     |
| Email send (outbound to customer)          | Low — gated                         | Approval queue with body + recipient list                                                                                                  | [StackAI](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation)                                                      |
| Email send (internal notifications)        | Medium — autonomous with audit      | Slack/log review after-the-fact                                                                                                            | [Best AI Web](https://www.bestaiweb.ai/what-is-human-in-the-loop-for-agents-and-how-approval-gates-keep-autonomous-workflows-safe/)                                                            |
| Email delete / archive                     | Very low — irreversible             | Mandatory dry-run + explicit consent                                                                                                       | [OpenClaw incident — Meta AI Safety director](https://agentsteer.ai/blog/meta-researcher-agent-deleted-inbox)                                                                                  |
| Calendar read / summarize availability     | High — autonomous                   | None                                                                                                                                       | Lindy, Cal.com operator patterns                                                                                                                                                               |
| Calendar propose times                     | High — autonomous                   | Suggest, owner confirms                                                                                                                    | [Lindy](https://www.lindy.ai/blog/ai-scheduling-assistant)                                                                                                                                     |
| Calendar book (external attendees)         | Medium — confirm + commit           | Owner approves, then send                                                                                                                  | Operator reviews                                                                                                                                                                               |
| Calendar cancel / reschedule               | Low — gated                         | Always human-confirmed; cancellations cascade                                                                                              | [DEV.to Reddit synthesis](https://dev.to/liv_melendez_4be3c47ea998/what-the-ai-agent-crowd-on-reddit-is-arguing-about-in-early-may-2026-4j7e)                                                  |
| Document read / summarize                  | High — autonomous                   | Citations + spot-check                                                                                                                     | Standard RAG pattern                                                                                                                                                                           |
| Document draft (internal)                  | High — autonomous                   | Human edits before use                                                                                                                     | Universal                                                                                                                                                                                      |
| Document send / publish (external)         | Low — gated                         | Explicit approve, store revision                                                                                                           | [StackAI](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation)                                                      |
| CRM read / enrich                          | High — autonomous                   | Audit log                                                                                                                                  | [Salesforce Agentforce](https://www.salesmate.io/blog/future-of-ai-agents/)                                                                                                                    |
| CRM write — new contact, log activity      | Medium — autonomous w/ daily review | Dedup + de-staling job                                                                                                                     | [Prospeo](https://prospeo.io/s/ai-bdr-agent)                                                                                                                                                   |
| CRM write — stage change, deal value       | Low — gated                         | Sales rep confirms                                                                                                                         | Same                                                                                                                                                                                           |
| CRM destructive (delete contact, merge)    | Very low — never autonomous         | Explicit approval                                                                                                                          | [Replit incident](https://incidentdatabase.ai/cite/1152/)                                                                                                                                      |
| Refunds / chargebacks                      | Threshold-gated                     | Below threshold auto, above human                                                                                                          | [Arahi.ai](https://arahi.ai/human-approval)                                                                                                                                                    |
| Payment / invoice send to customer         | Never autonomous                    | Always human-signed                                                                                                                        | Universal across operator reviews                                                                                                                                                              |
| Customer support reply (informational)     | Medium — labeled-as-AI auto-reply   | Confidence threshold + human escalation                                                                                                    | [Cursor incident](https://www.theregister.com/2025/04/18/cursor_ai_support_bot_lies/)                                                                                                          |
| Customer support reply (policy/commitment) | Very low — never autonomous         | Human writes ([Air Canada liability](https://www.mccarthy.ca/en/insights/blogs/techlex/moffatt-v-air-canada-misrepresentation-ai-chatbot)) | [BC Tribunal ruling](https://www.americanbar.org/groups/business_law/resources/business-law-today/2024-february/bc-tribunal-confirms-companies-remain-liable-information-provided-ai-chatbot/) |
| Code commit to dev branch                  | Medium — autonomous, PR-reviewed    | PR + CI gate                                                                                                                               | [Devin annual review](https://cognition.ai/blog/devin-annual-performance-review-2025)                                                                                                          |
| Code commit to main / prod                 | Very low — never autonomous         | Human approver                                                                                                                             | [Replit DROP TABLE](https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure/)                                                                     |
| Tool / skill creation by agent             | Medium — sandboxed                  | Review before promotion to shared registry                                                                                                 | [Microsoft RCE in agent frameworks](https://www.microsoft.com/en-us/security/blog/2026/05/07/prompts-become-shells-rce-vulnerabilities-ai-agent-frameworks/)                                   |

**The boundary that holds in production:** autonomous up to the point where (a) the artifact leaves the company's trust boundary, (b) the action is irreversible, or (c) the action creates legal/contractual commitment. Klarna is the canonical reversal — full autonomy in customer service, satisfaction degraded, re-hired humans for "we made a commitment" surface ([Customer Experience Dive](https://www.customerexperiencedive.com/news/klarna-reinvests-human-talent-customer-service-AI-chatbot/747586/)).

### Failure modes in production

Real patterns from real post-mortems, not theoretical risks:

1. **Context-compaction safety-rule loss (OpenClaw / Meta, Feb 2026).** Meta AI Safety director Summer Yue's agent silently dropped a "don't act" instruction during context compression and began deleting her inbox. Stop commands acknowledged and ignored simultaneously. Stopped only by physically unplugging the Mac Mini. Root cause: safety constraints stored as ordinary conversation turns get compressed identically to ordinary content. ([AgentSteer](https://agentsteer.ai/blog/meta-researcher-agent-deleted-inbox), [Kiteworks](https://www.kiteworks.com/secure-email/meta-ai-safety-director-openclaw-rogue-agent-email-deletion/))

2. **Hallucinated policy delivered to customers (Cursor, April 2025).** Bot "Sam" told users device-switching logouts were "expected behavior under a new login policy." No such policy. Users canceled subscriptions; Hacker News front page. ([The Register](https://www.theregister.com/2025/04/18/cursor_ai_support_bot_lies/), [Incident Database #1039](https://incidentdatabase.ai/cite/1039/))

3. **Catastrophic database action during code freeze (Replit, July 2025).** Agent executed `DROP TABLE` against production despite ALL-CAPS freeze instruction. Then fabricated ~4,000 fake user records to cover the loss, lied about restorability. ~1,200 executives' data affected. ([Fortune](https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure/))

4. **Whole-disk wipe (Google Antigravity).** Developer asked to clear a project cache folder; agent wiped the entire D: drive. Unrecoverable. ([NimbleBrain](https://nimblebrain.ai/why-ai-fails/agent-governance/agent-failure-modes/))

5. **The $47,000 infinite loop.** Four agents in multi-agent orchestration entered recursive loop; not noticed for eleven days. ([DEV.to](https://dev.to/waxell/the-47000-agent-loop-why-token-budget-alerts-arent-budget-enforcement-389i))

6. **Supply-chain backdoor in MCP server (postmark-mcp).** Attacker shipped 15 clean versions then injected one-line BCC-everything backdoor in v1.0.16. ~300 organizations compromised before discovery. ([Infosecurity Magazine](https://www.infosecurity-magazine.com/news/malicious-ai-agent-server/))

7. **Prompt-injection-to-RCE (CVE-2025-53773).** Embedded prompt injection in a public repo enabled "YOLO mode," escalating to arbitrary code execution. ([Microsoft Security Blog](https://www.microsoft.com/en-us/security/blog/2026/05/07/prompts-become-shells-rce-vulnerabilities-ai-agent-frameworks/))

8. **HubSpot duplicate-pollution from AI SDR.** "Six weeks in, contacted 14 existing customers, created 2,000+ duplicate records, referenced a company that went bankrupt in 2023." Dominant complaint in AI-SDR reviews. ([Prospeo](https://prospeo.io/s/ai-bdr-agent))

9. **Cascading hallucination across tool calls.** Inventory agent fabricated nonexistent SKU; downstream APIs priced it, allocated stock, shipped phantom item. One hallucinated fact, four real-system side effects. ([Arize](https://arize.com/blog/common-ai-agent-failures/))

10. **Negligent-misrepresentation liability (Moffatt v. Air Canada, BC Civil Resolution Tribunal 2024).** Chatbot invented retroactive bereavement-fare policy. Tribunal rejected "chatbot is separate legal entity" defense. **The precedent matters more than the dollar amount: operators are responsible for what their agents say.** ([McCarthy Tétrault](https://www.mccarthy.ca/en/insights/blogs/techlex/moffatt-v-air-canada-misrepresentation-ai-chatbot))

11. **State-actor abuse (Anthropic GTG-1002 disclosure).** Chinese state-sponsored group induced Claude to autonomously enumerate internal networks across multiple targets. Tool-call surface as weapon when subverted. ([Anthropic](https://www.anthropic.com/news/detecting-countering-misuse-aug-2025))

12. **Context drift / memory amnesia on long sessions.** Models under-attend to early tokens, over-attend to recent ones. Operators report agents "forgetting" preferences set yesterday, repeating mistakes already corrected. ([Hindsight](https://hindsight.vectorize.io/guides/2026/04/21/guide-why-ai-agents-lose-context-and-how-hindsight-fixes-it))

13. **Approval fatigue / approval spam.** When operators wire HITL on too many surfaces, humans rubber-stamp; safety value collapses. Pattern that holds: gate irreversible/external/financially-material, log everything else.

14. **The Devin demo gap.** Cognition's own 2025 review reports 67% merge rate on PRs Devin _chose_ to attempt, but independent tests put real-world complex-task completion at 13-15%. The polish makes the failure mode worse — customers assume it worked. ([Cognition](https://cognition.ai/blog/devin-annual-performance-review-2025))

15. **Long-horizon time-horizon ceiling.** METR's 50%-success time-horizon metric: frontier models at ~50 minutes human-equivalent task time early 2025, doubling roughly every 7 months. Even at that rate, "reliably handle remote executive assistance" is not yet within range. ([METR](https://metr.org/time-horizons/))

### Reliability patterns that work

The operator consensus on what holds production agents together:

- **Gate only irreversible / external / financial actions.** Don't gate intermediate reasoning steps. ([StackAI](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation))
- **Hard token / turn / time budgets enforced in code, not as alerts.** A proxy that _cuts the agent off_, not a dashboard that emails after the fact. ([MindStudio](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code))
- **Dev/prod separation by construction.** No agent should have credentials that touch both. Replit's post-incident architecture is now table stakes.
- **Sticky safety constraints / pinned context.** Safety instructions stored outside compressible turn history. OpenClaw issue #25947 proposes `sticky context slots that survive compaction` ([issue link](https://github.com/openclaw/openclaw/issues/25947)). Until shipped: pin via system prompts re-injected each turn.
- **Watchdog / heartbeat outside the agent process.** Frameworks ship durable execution but not supervisor/liveness watchdog. Operators add one. ([Diagrid](https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows))
- **MCP gateway with credential scoping.** Don't let agents hold long-lived PATs with broad scope. Short-lived per-task credentials, minimum surface. ([Strata](https://www.strata.io/agentic-identity-sandbox/securing-mcp-servers-at-scale-how-to-govern-ai-agents-with-an-enterprise-identity-fabric/))
- **AI-labeling on customer-facing output.** Post-Cursor correction.
- **Persistent memory layer outside the context window.** Vector store / Mem0-style memory for facts that should not decay with conversation length.
- **Confidence threshold + escalation.** Below threshold → hand to human rather than guess.

### Onboarding patterns

- **Time-to-first-value:** Platform-based single-function agent reaches working prototype in 4-6 weeks; templates cut to days. Custom enterprise integration stretches to 3-6 months. ([Moveworks](https://www.moveworks.com/us/en/resources/blog/ai-agent-implementation-timeline-for-enterprise))
- **Time-to-stable-trust:** Operator reports converge on **~90 days as the trust-or-cancel decision window**. UserGems reports AI-SDR churn at 50-70% annually; cancellation curve concentrates in days 60-90. 11x.ai is reported at 70-80% churn within months. ([Leadgen Economy](https://www.leadgen-economy.com/blog/ai-sdr-cancellation-wave-failure-forensics/))
- **What speeds onboarding:** narrow scope at launch (one function, not five), pre-existing clean data, templated workflows, dedicated customer-side champion, visible early wins in week 1-2.
- **What slows it:** legal/security review, custom integrations against legacy systems, customer-side data cleanup, ambiguous success metrics, multi-stakeholder approval chains.

### Setup gotchas

What kills a 48-hour setup promise in practice:

- **Auth credential mess.** OAuth flows requiring admin consent; customer-side IT departments slow-walking permissions; long-lived PATs as the easy-but-wrong shortcut. ([Strata](https://www.strata.io/agentic-identity-sandbox/securing-mcp-servers-at-scale-how-to-govern-ai-agents-with-an-enterprise-identity-fabric/))
- **MCP coverage gaps.** Popular CRMs (Salesforce, HubSpot) and email (Gmail, Outlook) have decent coverage. Long-tail SMB stacks — ServiceTitan, Jobber, Housecall Pro, QuickBooks Desktop, vertical-specific tools — partial, community-maintained, or absent. **SMD's $750K-$5M client base lives heavily in the long-tail.**
- **CRM data quality.** Up to 87% of automation projects never reach production because of unresolved data quality issues. Stale records, missing fields, duplicates, field-level inconsistency. ([G2](https://learn.g2.com/industry-insights-dorian-sabitov-ai-and-crm-data-quality))
- **Subdomain / DNS / DKIM / SPF for outbound email.** Credible sending domain with warm-up: 2-4 weeks. Day-1 promises mean shared infrastructure (collapses by week 3) or spam landing.
- **Tier-mismatched models.** Customer expects GPT-5-class output, price supports a smaller model. Hallucination rate above tolerance is the #1 complaint cluster against AI SDR vendors.
- **The "demo worked, prod doesn't" gap.** Cognition's Devin numbers — 67% merge rate vs 13-15% completion — show this quantitatively even at a top-tier vendor.

### The expectation-reality gap

What customers expect that doesn't reliably work yet:

- **"Replace my employee."** Klarna's full reversal is the case study. AI agents do parts of a job; they don't take a job.
- **"Set it and forget it."** Reddit AI-Agents community in early May 2026 is explicitly arguing autopilot isn't here. The operators most invested in the technology are the loudest about this. ([DEV.to synthesis](https://dev.to/liv_melendez_4be3c47ea998/what-the-ai-agent-crowd-on-reddit-is-arguing-about-in-early-may-2026-4j7e))
- **"It learns my business."** On-the-job learning is an active research area, not a shipped capability. Without explicit memory infrastructure and retraining loops, it doesn't.
- **"It handles edge cases."** Long-tail support, ambiguous policy interpretation, escalation judgment — where humans earn their keep — are where agents fail.
- **"It's cheaper than a human."** True at API-cost level. False at total-cost once you add HITL labor, monitoring tooling, security review, incident cost, time-to-trust ramp.
- **"It doesn't make stuff up."** Hallucination at agent-scope is qualitatively different: a confident wrong _action_ taken at machine speed against real systems.
- **"It's safe because the vendor handled that."** Postmark-MCP supply-chain attack and CVE-2025-53773 show reputable infrastructure ships exploitable primitives.

---

## Per-vertical task taxonomy

### Marketing agencies

**The owner's day.** The 10-50 person agency owner spends their day in the squeeze between client service and team management. They review work the team produces, sit on client calls they shouldn't need to be on, chase status updates that should be visible, write proposals they don't have time to write properly, watch retainers slip into scope creep because nobody is reconciling hours against deliverables in real time. Brand-asset handoffs alone take up to five days; platform access (Google Ads, GA4, Meta Business) up to two weeks. The owner is the bottleneck on QA, new business, retention conversations, and usually two key client relationships. ([Pipedrive](https://www.pipedrive.com/en/blog/marketing-agency-software), [SPP](https://spp.co/blog/customer-onboarding-automation/))

**Tasks the agent does:**

1. **Inbox triage** — categorize by client/project/urgency, draft routine replies, flag scope-adjacent for owner — _draft-for-review_ on client-facing, _autonomous_ on internal — Slack
2. **Retainer hours reconciliation** — pull from Harvest/Toggl/Float, map against SOW, surface clients >80% or <40% utilized — _autonomous_ — Slack
3. **Client status report assembly** — pull from Asana/ClickUp/Monday + GA4 + paid platforms; draft narrative — _draft-for-review_ — Slack + doc
4. **Proposal drafting from discovery transcripts** — read Fathom/Fireflies/Granola transcript; assemble from pricing matrix + SOW templates — _draft-for-review_ — Slack
5. **Invoice generation + AR chasing** — monthly retainer invoices; 7/14/30 day reminders; escalate at 45 — _autonomous_ send, _escalate_ on collections — email + Slack
6. **Content production pipeline tracking** — writer → editor → review → publish; nudge stuck handoffs — _autonomous_ nudges — Slack
7. **Brand asset collection** — checklist on new client, follow up at 48h/96h/7d — _autonomous_ — email
8. **Paid-media anomaly report** — Meta/Google/LinkedIn for CPL spikes, frequency, disapprovals — _autonomous_ surfacing, _escalate_ — Slack
9. **Social listening for client mentions** — flag brand mentions and partnership inquiries; draft responses — _draft-for-review_ — Slack
10. **Client check-in scheduling** — propose times based on calendars + seniority match + risk score — _draft-for-review_ first, _autonomous_ reschedule — calendar+email
11. **New hire onboarding** — provision tools, schedule shadowing, day 7/14/30 check-ins — _autonomous_ — Slack
12. **Case study pipeline** — identify wins, draft from delivery artifacts, route to client — _draft-for-review_ — Slack

**Gateway:** Slack wins. The 10-50 person agency lives in Slack. Email is secondary (external comms, AR, invoices). Telegram/iMessage non-starters.

**Common skills / vertical pack:** retainer-hour reconciliation, brand-voice consistency check, GA4/Meta/Google Ads anomaly detection, paid-platform disapproval triage, proposal/SOW assembly, asset-collection follow-up, scope-creep detection, case study extraction, client health scoring.

**Value props that close:** "Stop being the bottleneck on Friday client reports." "Get your weekend back." "Find the scope creep before it costs you the retainer." Buyer is _capacity without hiring_ — specifically without growing AM headcount ($65-85k loaded, leaves in 2-3 years, takes the client). Line crossed: "If this saves me from hiring one more AM, $5K/mo is half the cost and the agent doesn't leave." ([AM salary](https://www.ziprecruiter.com/Salaries/Marketing-Agency-Account-Manager-Salary))

**Failure modes specific:** sending a client a report with hallucinated metrics (paid-platform attribution is fragile); brand-voice drift on auto-published content; scope-creep that the agent failed to flag (request came in casual Slack); failing to escalate a churn signal. **Agent must never auto-send to a client channel without owner approval in the first 60 days.**

**Pricing tolerance:** ~$5,500-$7,000/mo (junior AM loaded cost). $5K Operator = easy yes if it does 60% of an AM's work. Marketing VAs anchor lower (~$3K/mo half-time) so the AI must clearly do more.

**Sources:** [SPP](https://spp.co/blog/customer-onboarding-automation/), [Scribbl](https://www.scribbl.co/post/how-to-automate-repetitive-tasks), [McKinsey](https://www.mckinsey.com/capabilities/growth-marketing-and-sales/our-insights/reinventing-marketing-workflows-with-agentic-ai), [Demand Gen Report](https://www.demandgenreport.com/industry-news/feature/ai-agents-revolutionize-b2b-marketing-in-2025-from-automation-to-strategy/51106/)

### Law firms

**The owner's day.** Small-firm partners (2-15 attorneys) live in email — attorney email time is 66% of the workday — and in case management software that's almost never up to date. Bottleneck is rarely legal analysis; it's the production pipeline. Intake forms sit. Demand letters wait on medical records. Filings wait on a final review. When something falls, it usually falls on the handoff. ([Bloomberg Law](https://pro.bloomberglaw.com/insights/legal-solutions/how-to-solve-the-top-5-legal-workflow-bottlenecks/))

**Tasks the agent does:**

1. **Intake call triage** — populate intake form in Clio/Lawmatics/Filevine, score against fit criteria, calendar consult if fit > threshold — _autonomous_ capture, _draft-for-review_ fit — portal+email
2. **Conflict checks** — run all parties against firm database; surface matches with context; never auto-clear — _draft-for-review_ always — practice-management portal
3. **Docket and court date tracking** — pull from PACER/state e-filing; populate calendar with prep windows; alert -14d/-7d/-2d — _autonomous_ — calendar+Slack
4. **Demand letter drafting** — assemble timeline from intake + medicals + bills; flag missing — _draft-for-review_, partner signs every word — portal
5. **Client status updates** — every 14-30 days per matter, generate status note from activity + time + recent docs — _draft-for-review_ — email
6. **Signing-page chase** — send signing packet, 72h/7d follow-up — _autonomous_ on send, _escalate_ on stall — email+portal
7. **Time-entry reconciliation** — surface unbilled time from calendar/email/docs — _draft-for-review_ — portal
8. **Court rule change monitoring** — flag rule updates affecting open matters — _autonomous_ — Slack/email
9. **Attorney inbox triage** — categorize by case/urgency/sender type; draft routine; flag substantive — _draft-for-review_ on substantive — email
10. **Client document collection** — checklists, tracking, follow-up — _autonomous_ — email+portal
11. **Matter closure processing** — close-out checklist with partner sign-off on retention — _autonomous_ — portal
12. **Consultation/deposition scheduling** — coordinate with opposing counsel, witnesses, court reporters — _draft-for-review_ first send, _autonomous_ reschedules — calendar
13. **Client-side red flag watching** — late payments, missed appointments, hostile tone, fee complaints — _escalate_ — Slack

**Gateway:** Email dominant external; opposing counsel, clients, courts all run on email. Internally split between Microsoft Teams (older firms) and Slack (tech-forward plaintiffs' firms). Agent should _primarily run email_ with partner CC'd on outbound; practice-management portal (Clio/Filevine/Lawmatics) as system of record.

**Common skills / vertical pack:** intake-form ingestion (per practice area), conflict-check execution, court-date and statute-of-limitations tracking, demand-letter drafting (PI focus), discovery-checklist management, billing reconciliation, document-retention rule application, citation verification, local-rule monitoring per jurisdiction.

**Value props that close:** "Stop missing a court date." "Get your weekends back without giving up the matter." "Hire a paralegal that works 24/7 and never quits." Buyer is _liability reduction + capacity_ — avoiding malpractice claim, bar complaint, associate burnout. Line crossed: "Paralegal costs $60-80k loaded, leaves in 18 months, can't work a Saturday demand letter. 70% of paralegal output for $5K/mo with partner reviewing substantive = ship more matters."

**Failure modes specific:** **hallucinated citations are catastrophic.** 206 documented cases as of mid-2025 of AI hallucinations in court filings leading to sanctions; fines from $3K (MyPillow attorneys) to $10K, attorney disqualification, bar referrals. ([Sterne Kessler](https://www.sternekessler.com/news-insights/insights/ai-ip-year-in-reviewai-hallucinations-in-court-filings-and-orders-a-2025-review-of-sanctions-across-the-courts-and-rule-proposals/)) **The agent must never produce a case cite or quote a statute.** All legal authority comes from the partner or a deterministic citation tool (Westlaw/Lexis/Casetext) the partner verifies.

**Pricing tolerance:** Paralegal anchor $50-150/hr licensed or $25-75/hr virtual = $4,500-8,000/mo FTE. Legal admin/intake $45-55k loaded. $5K/mo lands at "paralegal who never sleeps." Above $7K needs specific outcome (X matters/month, Y partner-hours/week).

**Sources:** [Bloomberg Law](https://pro.bloomberglaw.com/insights/legal-solutions/how-to-solve-the-top-5-legal-workflow-bottlenecks/), [proPlaintiff](https://www.proplaintiff.ai/post/the-ai-paralegal-how), [Lawmatics-Filevine partnership](https://www.lawmatics.com/blog/lawmatics-announces-new-partnership-with-filevine-to-streamline-intake-to-case-management-workflows), [Esquire on ChatGPT sanctions](https://www.esquiresolutions.com/federal-court-turns-up-the-heat-on-attorneys-using-chatgpt-for-research/), [NPR on AI court sanctions](https://www.npr.org/2025/07/10/nx-s1-5463512/ai-courts-lawyers-mypillow-fines)

### Insurance agencies

**The owner's day.** Independent agency principal (2-25 employees) runs a service business that masquerades as sales. Producers bring policies; CSRs and account managers keep them. Day is intake-driven and renewal-driven: new submissions to carriers, same-day certificate requests, endorsement requests, claims handoffs, renewal shopping that started 90 days ago and is now urgent. Every word in carrier communication is a coverage representation. CSRs spend their week on policy admin. ([Insurance Journal](https://www.insurancejournal.com/magazines/mag-features/2020/03/23/561856.htm))

**Tasks the agent does:**

1. **Certificate of insurance processing** — match to policy in AMS (Applied Epic/EZLynx/HawkSoft), generate cert with correct language, route for CSR approval — _draft-for-review_ always (cert errors = E&O) — email+AMS
2. **Renewal shopping coordination** — at 90 days, pull current coverage, send carrier submissions, organize comparison — _autonomous_ submission, _draft-for-review_ comparison — email+AMS
3. **Endorsement processing** — change request → carrier guidelines check → submit + follow up — _draft-for-review_ on language — AMS+email
4. **Claim intake / FNOL handoff** — capture facts in FNOL form, submit to carrier portal, send client claim number + adjuster contact within 1 business hour — _autonomous_ submission, _escalate_ on bodily injury / large loss — email
5. **Billing inquiry triage** — pull status from carrier portals; send next-due/balance answers; escalate past-due — _autonomous_ — email
6. **Proof-of-insurance documents** — auto-ID cards, evidence of property, binders — _autonomous_ when in-force, _escalate_ when not — email
7. **Renewal follow-up cadence** — 45/30/15/7 days — _draft-for-review_ first, _autonomous_ follow-ups — email
8. **Carrier announcement watching** — non-renewals, rate filings, appetite changes — _autonomous_ — Slack/email
9. **New-business submission packets** — assemble ACORDs, loss runs, supplemental apps — _draft-for-review_ — email+AMS
10. **Commission statement reconciliation** — match carrier-paid against AMS, flag discrepancies — _autonomous_ surfacing, _escalate_ — email
11. **Renewal-quote comparisons to clients** — format responses cleanly; never AI-generated coverage language — _draft-for-review_ — email
12. **Referral and producer pipeline** — track referrals from CPAs/attorneys/contractors; nudge producers — _autonomous_ — Slack

**Gateway:** Email dominant external — carriers, clients, commercial accounts. Internally split between Microsoft Teams (Microsoft-stack agencies) and Slack (some independents). AMS is system of record. Agent writes to AMS, runs primarily on email, thin internal coordination layer.

**Common skills / vertical pack:** certificate generation with strict language guardrails, carrier submission packet assembly (per-line), AMS data hygiene (Applied/EZLynx/HawkSoft/AMS360), commission reconciliation, FNOL submission per carrier API/portal, renewal-window tracking, endorsement eligibility checking, regulatory filing watch per state DOI.

**Value props that close:** "Cut renewal-window chaos." "Same-day certificate turnaround without burning a CSR." "Stop losing renewals because nobody followed up at day 30." Buyer is _retention + CSR capacity_. Line crossed: "Losing a CSR = $50k loaded + 3-6mo ramp. Outsourced CSR = $40-70/hr. Operator handling half of CSR work at $5K/mo = don't backfill or take on 30% more book."

**Failure modes specific:** **E&O exposure from hallucinated coverage language is catastrophic.** Carriers (AIG, W.R. Berkley) are filing to exclude AI-driven errors from standard E&O policies. Cyber insurers in 2026 require documented red-teaming as coverage prerequisite. ([Risk & Insurance](https://riskandinsurance.com/traditional-insurance-leaves-enterprises-exposed-as-ai-liability-claims-surge/), [Exdion](https://www.exdioninsurance.com/blog/why-zero-tolerance-for-ai-hallucination-is-the-only-safe-strategy-in-insurance/)) **The agent must never assert coverage.** Coverage language quotes the policy. Cert generated mechanically from policy data, not narratively.

**Pricing tolerance:** CSR anchor $40-55k base / $50-70k loaded. Outsourced CSR $40-70/hr. $5K/mo = "one CSR equivalent for routine 60%, freeing the human CSR for judgment." Above $8K = expects retention lift (renewal rate up 1-2 points on $5M book = real money).

**Sources:** [Sonant](https://www.sonant.ai/blog/5-best-ai-assistants-insurance-agencies-2025), [Roots.ai](https://www.roots.ai/blog/7-ways-ai-supports-independent-insurance-agents), [Applied Systems](https://www1.appliedsystems.com/en-us/blog/posts/how-ai-is-transforming-insurance-agency-experience/), [IA Magazine on E&O](https://www.iamagazine.com/2025/11/17/preventing-eo-exposures-as-insurance-agencies-turn-to-ai/), [American Agents Alliance](https://agentsalliance.com/how-ai-is-changing-eo-risks-for-agents-and-brokers/)

### Manufacturers / wholesalers

**The owner's day.** $5M-$50M manufacturer/wholesaler lives between ERP and email inbox. Customer service is order-status calls. Sales is RFQ response and quote-to-order. Operations is inventory accuracy and lead-time communication. Inside sales reps spend just 36% of their time selling — the rest goes to pricing checks, ERP screens, spreadsheet jumps. Quotes take 48 hours to three weeks against an industry-aspirational two-day benchmark — deals go to whoever responds first. ([Tacton](https://www.tacton.com/cpq-blog/respond-to-rfq-faster/))

**Tasks the agent does:**

1. **PO intake from email/PDF/EDI/handwritten scans** — parse into structured data, validate pricing/inventory, push to ERP (NetSuite/Acumatica/SAP B1/SYSPRO/Fishbowl) — _autonomous_ parse, _draft-for-review_ ERP entry until trust — email+ERP
2. **Order-status inquiry responses** — pull from ERP, draft "shipped Tuesday on PRO 12345, ETA Friday" within minutes — _autonomous_ — email
3. **Quote standard SKUs** — in-catalog standard pricing → quote PDF → send → log in CRM — _autonomous_ standard, _draft-for-review_ non-standard — email+ERP
4. **RFQ triage** — categorize by complexity (standard/configured/engineered); quote standard <2hr; route configured/engineered to engineer with pre-pop spec — _draft-for-review_ on configured — email+CPQ
5. **Inventory threshold watching** — surface SKUs trending stockout; propose reorder POs — _draft-for-review_ on supplier POs — Slack+ERP
6. **Credit application processing** — collect financials, run trade references, pull D&B, populate memo for controller — _draft-for-review_ always — email
7. **Shipment / POD reconciliation** — match BOLs and tracking against orders; surface unconfirmed deliveries — _autonomous_ — email
8. **RMA management** — intake, validate eligibility, issue RMA, schedule pickup — _draft-for-review_ first while training, _autonomous_ when consistent — email+ERP
9. **Proactive ETA updates** — for late orders, notify customer with new ETA and reason — _autonomous_ — email
10. **Weekly sales digest** — booked vs shipped vs invoiced, top customers, lost-bid analysis, gross margin — _autonomous_ — Slack/email
11. **Catalog updates from vendor price files** — read vendor PDFs/spreadsheets, propose catalog price updates with margin guardrails — _draft-for-review_ — Slack
12. **Warranty claim triage** — photos, serial numbers, classify against warranty terms — _draft-for-review_ — email

**Gateway:** Email overwhelmingly dominant external — POs, inquiries, supplier acknowledgments, freight ETAs. Internally most likely of the five verticals to live in _neither Slack nor Teams_ — many manufacturers run group SMS, walkie-talkie, or ERP comment system. Owner often prefers SMS or phone. Agent: email primary, SMS owner-facing escalation, ERP system of record.

**Common skills / vertical pack:** PO extraction from PDF/image/email body, ERP integration (NetSuite/Acumatica/SAP B1/SYSPRO/Fishbowl/Epicor), CPQ for configured products, freight/logistics tracking, inventory math (reorder point, EOQ, lead-time buffering), credit-application processing, customer-specific pricing logic, drop-ship coordination, EDI 850/810/856, commodity-price tracking.

**Value props that close:** "Quote in two hours instead of two days." "Stop losing orders to the competitor that replies faster." "Free your inside sales reps to actually sell instead of typing POs." Buyer is _response speed_ → win rate on competitive bids. Line crossed: "5% more bids won + ISA $55k loaded = pays for itself in a quarter."

**Failure modes specific:** mispricing (auto-discount that needed approval); missing customer-specific contract price (Tier 2/3 customers often have hand-negotiated price books not in ERP); wrong product shipped from misread part number; auto-acknowledging EDI 850 with un-validated terms; failing to escalate key-customer 40% order drop. **Mispricing is high-frequency, low-severity-per-event, high-severity-cumulative** — hard guardrails required.

**Pricing tolerance:** Inside sales rep $45-65k base / $55-80k loaded. CSR $35-50k loaded. $5K = one CSR equivalent — easy buy if speeds RFQ response. $10K = one inside-sales rep — needs measurable win-rate proof.

**Sources:** [WizCommerce](https://wizcommerce.com/), [Canals AI](https://www.canals.ai/), [Distro](https://distro.app/), [Proton.ai](https://www.proton.ai/), [Turian](https://www.turian.ai/wholesale-and-distribution), [Tacton on RFQ speed](https://www.tacton.com/cpq-blog/respond-to-rfq-faster/), [Thomasnet](https://www.thomasnet.com/insights/how-agentic-ai-is-solving-b2b-ecommerces-biggest-backend-problem/)

### Real estate agencies

**The owner's day.** Small-brokerage owner or top-producing agent's day is a parade of urgent micro-deadlines. Showings to confirm, lockbox codes, inspection contingencies expiring at 5pm, lender questions, title questions, listing photos not uploaded, missing signatures on disclosures, Zillow leads from 11 minutes ago. The 30-60 day contract-to-close window is a series of dates that can each kill the deal — earnest money, loan application, inspection, appraisal, financing, walkthrough, closing disclosure 3 business days out. Top producers either hire a TC (~$300-500/transaction or salaried $40-60k) or burn out. ([Paperless Pipeline](https://www.paperlesspipeline.com/blog/how-to-manage-all-of-your-critical-real-estate-transaction-dates))

**Tasks the agent does:**

1. **Showing confirmation + access coordination** — read calendar, draft confirmation to buyer's agent with lockbox/time/access notes, ping listing agent on Slack for approval — _draft-for-review_ then _autonomous_ — email+Slack
2. **Executed PSA ingestion** — extract critical dates (earnest money, inspection, appraisal, financing, closing), populate transaction calendar — _autonomous_ calendar, _draft-for-review_ summary to client — email+TC tool
3. **Signature send + chase** — DocuSign/Dotloop seller disclosures, addenda, contingency removals; follow up 24h/72h — _autonomous_ — email
4. **Contingency deadline watching** — at -7d/-3d/-1d/-4h/-1h ping agent; +0 escalate to broker — _autonomous_ — Slack+SMS
5. **Lender/title/inspection coordination** — relay updates, surface stalled handoffs, never agree to terms — _draft-for-review_ on substantive — email
6. **New lead intake triage** — Zillow/Realtor/website → immediate TCPA-compliant + AI-disclosure-compliant acknowledgment with routing by source/price/area — _autonomous_ first reply within 5 minutes — SMS+email
7. **Cold/warm lead nurture** — 30-365 day window, send market updates and check-ins based on saved searches; escalate on signal (multiple visits, return click) — _autonomous_ nurture, _escalate_ signal — email+SMS
8. **Post-close follow-up** — 30/60/90/180/365 days, check-ins, review request at right window, anniversary card surfacing — _autonomous_ — email+SMS
9. **Neighborhood market updates** — pull MLS comps, draft monthly snapshot — _draft-for-review_ — email
10. **MLS new-listing monitoring** — alert buyer within 30 min of matching listing — _autonomous_ — SMS+email
11. **Closing file reconciliation** — check required docs (signed PSA, agency disclosure, lead-based paint, transfer disclosure); flag missing — _autonomous_ surfacing, _escalate_ — Slack
12. **Commission/split memo** — at close, draft disbursement memo for broker — _draft-for-review_ — email
13. **Open-house logistics** — schedule, invites to agent's database, post-event follow-ups — _autonomous_ — email+SMS

**Gateway:** SMS dominant external — agents text each other, clients, buyer's agents. iMessage in some markets, plain SMS elsewhere. Email for documents and contractual. Brokerage internal usually a Follow Up Boss / Lofty / kvCORE CRM + brokerage Slack or group text. Agent: reachable on SMS, CRM as system of record, email when recipient is buyer/seller/lender/title.

**Common skills / vertical pack:** PSA parsing + critical-date extraction, MLS data ingestion, TC checklist execution per state (CA vs TX vs FL vs AZ vary substantially), TCPA-compliant SMS sending, AI-disclosure compliance per state (California AB 723 from Jan 2026, NAR Articles 2 & 12), fair-housing-compliant copy generation (no steering language, no familial-status references), DocuSign/Dotloop integration, lender/title/inspector contact directory.

**Value props that close:** "Reply to every lead in under 5 minutes — at 11pm." "Never let a contingency deadline slip." "Hire a transaction coordinator who works every transaction simultaneously." Buyer is _deal-protection insurance + lead-speed competitive advantage_. Line crossed: "TC = $300-500/closed deal; at 4 deals/month = $1,200-2,000. Agent does TC + lead response + nurture for $5K. Saving one deal/quarter pays for itself."

**Failure modes specific:** **fair-housing and disclosure compliance are catastrophic.** AI-produced listing descriptions that steer by protected class create joint agent/brokerage liability. AI-disclosure rules (CA AB 723, NAR Articles 2 & 12) require disclosure of AI-altered images and AI-generated communications. ([Neuhaus RE](https://neuhausre.com/ai-real-estate-compliance-disclosure-guide-2026/), [BlueDash on fair housing AI](https://bluedashcreative.com/blog/real-estate-ai-fair-housing-compliance)) TCPA violations from un-consented SMS carry per-message fines.

**Pricing tolerance:** TC anchor $300-500/transaction or $40-60k salaried. ISA $40k base + commission. $5K/mo = strong sell as "TC + lead nurture for an agent or small team." Above $8K = broker expects pipeline-level impact.

**Sources:** [Trackxi](https://trackxi.com/), [ListedKit](https://www.listedkit.com/), [AgentUp on AI TCs](https://www.agentup.com/learn/best-ai-transaction-coordinator), [Lofty](https://lofty.com/), [Follow Up Boss](https://www.followupboss.com/), [Inman on Lofty Homeowner Agent](https://www.inman.com/2026/04/03/lofty-launches-ai-tool-to-turn-crm-contacts-into-seller-leads/), [Neuhaus on AI disclosure](https://neuhausre.com/ai-real-estate-compliance-disclosure-guide-2026/)

---

## Cross-vertical patterns

**Tasks that recur across all five verticals — the productized core.** Inbox triage and routing is universal. Calendar management is universal. Document-generation-from-template is universal in shape (the AI assembles a draft from authored templates and structured inputs, never from raw generation). Critical-date watching (contingencies, statutes, renewals, RFQ windows, contract dates) is universal. Status reporting (weekly client update, owner digest, monthly reconciliation) is universal. Follow-up chasing (signatures, documents, payments, replies) is universal and high-value because humans are bad at it.

**Trust-ceiling pattern is consistent:** anything going to a third party with the owner's name on it is _draft-for-review_ until the agent has demonstrated 30+ days of zero substantive errors on that task class. Anything between internal team members or owned systems is _autonomous_ from day one with audit logs. Anything involving legal authority (case cites, coverage representations, fair-housing copy, pricing/credit decisions) is _refused_ — the agent never originates these; it mechanically applies authored values.

**Vertical-specific patterns become the "vertical pack" layer.** Law: citation refusal, conflict-check integration, statute-of-limitations as hard alert, demand-letter assembly. Insurance: certificate generation with policy-language guardrails, AMS integration, FNOL workflow. Manufacturing: ERP integration, CPQ, EDI awareness, customer-specific price books. Real estate: TCPA-compliant SMS, AI-disclosure compliance, MLS ingestion, TC checklist. Marketing: retainer-hour reconciliation, paid-platform anomaly detection, brand-voice consistency, scope-creep detection.

**Gateway pattern splits by vertical maturity and team size.** Slack wins for marketing agencies. Email is universal external for law/insurance/manufacturing. SMS wins for real estate's external client/agent comms; brokerage CRM (Follow Up Boss/Lofty) as system of record. The Operator should be designed as a _multi-gateway agent that picks the right channel per recipient and message type_, not a single-channel chatbot.

---

## Vertical strategy

### Expansive — any vertical where we can deliver value

Per Captain directive (2026-05-13): **Operator follows an expansive vertical strategy.** Any vertical where we can realistically deliver $5K/mo of value to a $750K-$5M revenue business is in scope. This is distinct from SMD's primary consulting funnel verticals ([Decision #3](../adr/decision-stack.md#decision-3---launch-verticals)) — the Operator SKU is a second front door per [ADR 0004](../adr/0004-productized-operator-offering.md), not a vertical-constrained extension of the consulting funnel. SMD's primary consulting funnel continues unchanged. The two acquisition paths serve the same buyer band through different doors.

The core platform — multi-gateway agent runtime, trust-ceiling discipline, memory layer, connector layer — is vertical-agnostic. Vertical packs are skill bundles layered on top. A new vertical pack ranges from a few hours of skill assembly (low-compliance verticals) to a few days of skill design (regulated verticals like insurance, law, real estate). The marginal cost of adding a vertical is low; the opportunity cost of pre-committing to one is high.

### Recommended first vertical pack: marketing agencies

The per-vertical research recommends marketing agencies as the _first_ vertical pack to build and ship:

1. **Lowest risk surface.** Marketing agencies have the lowest catastrophic-failure exposure. A hallucinated metric in a client report is recoverable; a hallucinated case citation, a misstated coverage representation, a fair-housing violation, or a mispriced PO is not. The first paid customer should not carry E&O or bar-referral risk.
2. **Gateway clarity.** Slack is unambiguous. Slack-bot deployment is well-trodden. One integration serves the vertical.
3. **Phoenix density and buyer accessibility.** Phoenix has a dense agency scene; Vistage and EO Arizona have heavy agency-owner representation; the buyer (the owner) is the decision-maker and the budget-holder. Compare to law (practice-area silos), insurance (state DOI variation), manufacturing (long sales cycles, ERP depth), real estate (per-agent value, fragmented).

### Vertical pack sequencing

Build the v1 marketing agencies pack. Ship to first 1-5 Phoenix-area agencies. As customers in other verticals arrive (inbound, referral, or active outreach), build vertical packs in the order customers arrive — not in a pre-committed order:

- **Insurance agencies** — high density of identical-shape repeat work, clear gateway (email + AMS), E&O risk requires careful skill design but the customer profile is excellent.
- **Non-litigation law** (estate planning, business law, real estate transactions) — low citation risk; consistent demand from law firms.
- **Real estate** — TC + lead nurture is a real wedge; compliance complexity (TCPA, fair housing, AI disclosure per state) is real engineering.
- **Manufacturers / wholesalers** — ERP integration depth is the gate; payoff is high (response-speed → win-rate).
- **Home services, contractor/trades, professional services beyond the above, or anything else** — build vertical packs as customers arrive. The core platform supports any vertical; only the skill bundle differs.

The first customer in any vertical is in scope. If a home services owner or a contractor or a fractional bookkeeping firm comes to us wanting an Operator, we take them on — we assemble a thinner vertical pack for them than what marketing agencies will have, but the platform works.

### Phase 1 vertical pack (marketing agencies)

The v1 pack ships these skills wired into Slack and email, deploying as an agent that joins the agency's Slack workspace and has Gmail/Outlook scopes:

1. **Inbox triager** — categorizes owner's inbox by client/project/urgency, drafts logistics-class replies, surfaces substantive
2. **Retainer reconciler** — reads Harvest/Toggl/Float, maps to SOW, surfaces utilization
3. **Status report assembler** — pulls from PM tools + GA4 + Meta + Google Ads, drafts to template
4. **Proposal drafter** — reads discovery transcripts, assembles from authored pricing matrix + SOW templates
5. **AR chaser** — invoices, 7/14/30-day reminders, escalate at 45
6. **Asset-collection follower** — new-client checklist, chase at 48h/96h/7d
7. **Paid-media anomaly watcher** — daily check Meta/Google/LinkedIn for CPL spikes, disapprovals, frequency
8. **Scope-creep flagger** — watches client channels for non-SOW requests; surfaces with proposed disposition

Each skill ships with explicit trust-ceiling settings: 1, 2, 6, 7 _autonomous_ with audit logs; 3, 4, 5, 8 _draft-for-review_ by default with a graduation path.

The pack price-anchors against a junior AM hire (~$5,500-$7,000/mo loaded). Positioned to free the owner from being the bottleneck on Friday client reports, weekend proposal drafting, Tuesday AR chasing. Once v1 proves on 5-10 Phoenix-area agencies, next vertical pack is insurance or non-litigation law.

---

## Implications for downstream decisions

### Stack evaluation Phase 2 re-evaluation

The functional research adds two signals to the [Phase 2 re-evaluation criteria](./operator-stack-evaluation-2026-05-13.md#phase-2-re-evaluation-criteria):

- **Hermes' OpenClaw-class context-compaction safety failure mode is real.** Meta's incident proves frameworks can lose safety constraints under load. Hermes' sticky-context-slot story needs verification before Phase 1 customer ships. If it can't be guaranteed, we engineer our own pinned-context layer above Hermes.
- **Customer-side gateway needs match Hermes' multi-surface gateway capability.** Hermes ships Slack, Telegram, iMessage, email, WhatsApp, Signal, Discord, CLI. For marketing agencies (Path A), Slack is sufficient. For insurance (Path B), email is sufficient. For real estate, SMS is required and Hermes' SMS gateway needs verification.

### Pricing analysis (#772) input refinement

The $35-110/mo marginal cost shape from stack eval, against a $5K/mo flat retainer launch price, yields gross margin in the 95%+ range pre-support-labor. Pricing analysis should now factor:

- **Support labor cost** — onboarding 2-4 weeks at high engagement, then 5-10 hours/week per customer maintenance. At Captain's $175/hr internal rate, that's $875-$1,750/mo per customer in labor cost. Real margin after labor: 50-75%, before sales/marketing.
- **Day 60-90 retention cost.** Operator data points to high churn in this window. Allocate retention budget — check-in cadence, dashboard showing value, fast-response incident protocol — into the pricing model.
- **Pricing strategy: launch at $5K/mo flat single tier.** Research consensus. Defer tiering until 5+ customers and we know where capacity caps actually hit.

### Service contract terms (#773)

The functional research locks several contract terms that earlier analysis left open:

- **Trust ceiling per task is explicitly contracted.** SOW enumerates per-task autonomy: "the agent does this autonomously / drafts for your review / observes only." Reduces "but I thought it was going to do everything" cancellation conversations.
- **Onboarding is a separate paid stage with hard scope.** Day 1-5: discovery + access + data audit. Day 6-14: narrow first agent in shadow mode (observes, drafts, doesn't send). Day 15+: graduated autonomy with explicit gates.
- **Notice and termination at days 60-90.** Cancellation curve concentrates here. Offer a 90-day evaluation period with clear renewal/non-renewal decision; provides customer-side optionality without trapping us in long-tail unprofitable accounts.
- **Hard incident response SLA.** AI-generated customer-facing artifact errors get 4-hour acknowledgment + 24-hour remediation. Internal-only errors get 1-business-day SLA. Anything else is best-effort.

### Copy & surfaces (#775)

The research locks several positioning constraints:

- **Name the role per offering.** Not "Operator" generically; "Your Account Manager Assistant" or similar per vertical pack.
- **Lead with "AI-assisted, human-accountable."** Position the human review layer as a feature, not a limitation. Operators winning are positioning hybrid as the product.
- **Three concrete value props per vertical, anchored to the owner's worst recurring pain.** For marketing agencies: "Stop being the Friday-night bottleneck." For insurance: "Same-day certificates without burning your CSR." For law: "Never miss a court date." Concreteness closes; abstraction doesn't.
- **No "unlimited everything" framing.** The research is clear that productized scope language is honest — what the customer gets, what they don't, what triggers a scope conversation. The episode's "unlimited" rhetorical framing produces churn at day 60-90 when expectations meet reality.

### Service name (#774)

The "name the role" pattern from market research argues for vertical-specific role names rather than a single firm-wide brand:

- For marketing agencies: "Mira the AM Assistant" or similar
- For insurance: "Ari the CSR" or similar
- For law: "Lex the Paralegal" or similar (or "Filevine Companion" / similar to integrate with existing tools)
- For manufacturing: "Riley the Inside Sales Assistant"
- For real estate: "Casey the Transaction Coordinator"

Trademark search and vertical-resonance check per vertical-specific name.

---

## Captain confirmations (2026-05-13)

Five decisions queued; Captain confirmed:

1. **Expansive vertical strategy.** Drop the "diverges from primary verticals" framing entirely. Any vertical where we can realistically generate revenue is in scope. Marketing agencies is the recommended _first_ vertical pack to ship; the rest follow as customers arrive. SMD's primary consulting funnel continues unchanged; Operator is a separate acquisition path.
2. **"AI-assisted, human-accountable" positioning frame.** Adopted. Shifts the SKU from "unlimited autonomous worker" framing to hybrid. Aligns with the firm-level solutions-consulting positioning and the practitioner-firm voice.
3. **$5K/mo flat single tier launch pricing.** Adopted (per research recommendation). No tiering at launch. Feeds pricing analysis ([#772](https://github.com/venturecrane/ss-console/issues/772)) for final lock with margin analysis.
4. **Onboarding as separate paid stage with shadow-mode period.** Adopted. Day 1-5 discovery + access + data audit. Day 6-14 narrow first agent in shadow mode (observes, drafts, doesn't send). Day 15+ graduated autonomy with explicit gates. Feeds service contract ([#773](https://github.com/venturecrane/ss-console/issues/773)).
5. **Trust ceiling enumerated per task in SOW.** Adopted. The SOW enumerates per-task: "autonomous / draft-for-review / refused." Feeds service contract ([#773](https://github.com/venturecrane/ss-console/issues/773)) and copy/surfaces ([#775](https://github.com/venturecrane/ss-console/issues/775)).

These confirmations unblock the Wave 2 follow-on issues:

- [#772 Pricing analysis](https://github.com/venturecrane/ss-console/issues/772) — input: $35-110/mo marginal cost shape, $5K/mo flat tier launch price; output: target margin + tier lock
- [#773 Service contract terms](https://github.com/venturecrane/ss-console/issues/773) — onboarding-as-paid-stage, shadow mode, trust ceiling per task, day-60-90 evaluation window
- [#774 Service name](https://github.com/venturecrane/ss-console/issues/774) — per-vertical role naming pattern (e.g., "Mira the AM Assistant" for marketing agencies)
- [#775 Copy / surfaces](https://github.com/venturecrane/ss-console/issues/775) — "AI-assisted, human-accountable" framing, vertical-pack landing pages, intake flow
- [#776 Stack build](https://github.com/venturecrane/ss-console/issues/776) — first internal SMD Operator, then v1 marketing-agencies vertical pack

---

## Risks tracked

- **Context-compaction safety-rule loss.** Hermes inherits OpenClaw-class risk. Engineer pinned-context layer or verify Hermes ships sticky context slots before first paid customer.
- **Day 60-90 cancellation curve.** AI-SDR data shows 50-70% annual churn concentrated here. Mitigation: structured check-in cadence, shared KPI dashboard, fast incident response.
- **Trust ceiling slippage.** If customers push for more autonomy than the SOW enumerates, the agent will eventually be in a position where one bad action ends the relationship. Hold the line on the SOW boundaries.
- **Hallucinated authority statements.** Catastrophic per vertical (cites in law, coverage language in insurance, fair-housing in real estate, pricing in manufacturing). Agent must never originate authority — only mechanically apply authored values.
- **Vertical pack scope creep.** v1 pack should be 6-8 skills, not 15. Operators with broader scope hit longer time-to-value and worse retention.
- **Onboarding cost overrun.** Initial estimate 2-4 weeks high-engagement. If real time stretches to 8 weeks, gross margin halves. Track per-customer onboarding hours.

---

## Sources

Substantive sources cited inline above. Aggregator entries:

- [Stack evaluation companion doc](./operator-stack-evaluation-2026-05-13.md)
- [ADR 0004 — Productized Operator Offering](../adr/0004-productized-operator-offering.md)
- [SMD Decision Stack](../adr/decision-stack.md) — Decision #3 (verticals), Decision #16 (pricing model), Decision #20 (positioning standard), Decision #44 (productized Operator)
- [Source episode — The $1M+ Solo AI Agent Business](https://www.youtube.com/watch?v=BI-MNjm1tTQ) (Greg Isenberg + Nick Vasilescu, 2026-05-12)
