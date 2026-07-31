# Prior Art: Agent-Substrate Web Apps, Generative UI, and Interface Densification

Research date: 2026-07-31. Every claim below carries a source URL.
**VERIFIED** = read from a primary source and quoted/extracted. **INFERRED** = my reading, not stated by the source. **NO EVIDENCE FOUND** = searched, nothing located.

---

## 0. Executive orientation

The architecture under consideration — bounded authored view classes, model routes intent to (capability, view) pairs, model never emits markup — is **not novel as an architecture**. It was standardized by Google as **A2UI** (Dec 2025) and by the Model Context Protocol as **MCP Apps** (Jan 2026), and it is the explicit design of the **Flutter GenUI SDK**. Both standards independently arrived at the identical core security argument: _UI as data, not code; the agent may only reference a client-controlled catalog._

What is **not** settled prior art is the **densification** idea (repeated intents crystallizing into durable affordances). The adjacent research literature is 20+ years old, is largely negative, and has a specific, well-replicated result that constrains the design.

---

## 1. Generative UI / AI-composed interfaces (state of the field, mid-2026)

### 1.1 The field has split into two architectures

**VERIFIED.** There are two distinct approaches, and they have different failure profiles. Conflating them is the most common error in the discourse.

|             | **Code generation**                                        | **Catalog selection**                         |
| ----------- | ---------------------------------------------------------- | --------------------------------------------- |
| Model emits | HTML/CSS/JS, or React                                      | JSON referencing named components             |
| Examples    | Google Generative UI, Claude Artifacts, v0, Stanford GenUI | A2UI, MCP Apps, Flutter GenUI, Adaptive Cards |
| Latency     | "a minute or more"                                         | Bounded by data fetch                         |
| Security    | Sandboxing required                                        | UI is data; no arbitrary script               |
| Ceiling     | Higher (approaches expert design)                          | Capped at what was authored                   |

The proposed architecture is squarely in the **right-hand column**.

### 1.2 A2UI (Google) — the closest match to the proposed architecture

**VERIFIED.** Announced 2025-12-15, at v0.8, led by Google with CopilotKit as launch/design partner.
Source: [Google Developers Blog](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/), [a2ui.org](https://a2ui.org/), [github.com/google/A2UI](https://github.com/google/A2UI/blob/main/specification/v0_8/docs/a2ui_protocol.md)

Stated design principles, quoted:

- **"Security first"** — "A2UI is declarative data, not executable code," reducing UI injection risk.
- **"LLM-friendly and incrementally updateable"** — uses "a flat list of components with ID references which is easy for LLMs to generate incrementally."
- **"Framework-agnostic and portable"** — same JSON renders on web (Lit/Angular/React), Flutter, SwiftUI, Jetpack Compose.

The client maintains a **"catalog" of pre-approved UI components** (Card, Button, TextField). Agents may only request rendering from that catalog. User actions return to the agent as events; the agent may respond with new A2UI messages that update the existing interface.

Google states it is "currently at `v0.8` because we have been through many rounds of battle hardening and testing." Partners: Google Opal, AG-UI/CopilotKit, Flutter GenUI SDK, Gemini Enterprise.

**This is, to a first approximation, the architecture described in the brief.** The one meaningful difference: A2UI's catalog is _component-level_ (Card, Button, Row); the proposal is _view-class-level_ (document, table, diff, timeline). That is a coarser, more opinionated grain — see §7.

### 1.3 MCP Apps — the same idea, now an official MCP extension

**VERIFIED.** Announced 2026-01-26 as "the first official MCP extension," described as **production-ready**, with support live across Claude, Goose, VS Code Insiders, and ChatGPT.
Source: [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)

Mechanism: tools carry a `_meta.ui.resourceUri` field pointing to a UI resource served via the `ui://` scheme; hosts fetch, render in **sandboxed iframes**, and communicate bidirectionally via JSON-RPC over `postMessage`.

Security model, quoted: "Iframe sandboxing: All UI content runs in sandboxed iframes with restricted permissions," plus **pre-declared templates for host review before rendering**, auditable JSON-RPC messaging, and optional explicit user approval for UI-initiated tool calls.

Authorship: Ido Salomon and Liad Yosef (MCP-UI foundation), Nick Cooper (OpenAI Apps SDK), with production delivery by Sean Strong, Olivier Chafik, Anton Pidkuiko, Jerome Swannack (Anthropic).

**Note the convergence:** _pre-declared templates reviewed by the host before rendering_ is precisely "a bounded set of authored views the agent selects among." Two independent standards bodies reached it within six weeks of each other.

### 1.4 Vercel AI SDK — and the important negative signal

**VERIFIED.** Vercel introduced generative UI in AI SDK 3.0 ([Vercel blog](https://vercel.com/blog/ai-sdk-3-generative-ui)). The SDK is widely adopted — reported at ~11.5M weekly npm downloads as of April 2026 ([ai-sdk.guide](https://ai-sdk.guide/), secondary source, treat the figure as approximate).

**The negative signal is the important part.** AI SDK RSC — the package that streams React Server Components as generative UI — carries this status, quoted from the docs:

> "AI SDK RSC is currently experimental. We recommend using AI SDK UI for production."
> ([ai-sdk.dev/docs/ai-sdk-rsc/overview](https://ai-sdk.dev/docs/ai-sdk-rsc/overview))

And from the migration guide:

> "AI SDK RSC currently faces significant limitations that make it unsuitable for stable production use."
> ([ai-sdk.dev/docs/ai-sdk-rsc/migrating-to-ui](https://ai-sdk.dev/docs/ai-sdk-rsc/migrating-to-ui))

Enumerated limitations, quoted:

1. "It is not possible to abort a stream using server actions."
2. "Components remount on `.done()`, causing them to flicker."
3. "Many suspense boundaries can lead to crashes."
4. "Using `createStreamableUI` can lead to quadratic data transfer."
5. "Closed RSC streams cause update issues."

The docs note these are framework-level constraints (React/Next.js), not SDK design decisions.

**INFERRED:** The most ambitious "stream live React components from the model" approach is the one that got walked back. The industry's surviving answer is the more conservative one: send _data_ describing which pre-built view to render, and let the client render it. This directly validates the proposed architecture's core constraint.

### 1.5 Thesys C1

**VERIFIED (thin).** Launched 2025-04-18 as "the world's first generative UI API," positioned as a drop-in LLM replacement that returns interactive UI (charts, forms, cards) instead of text, via its Crayon React framework. Claimed adoption: "more than 300 teams."
Sources: [InfoWorld](https://www.infoworld.com/article/3971182/thesys-introduces-generative-ui-api-for-building-ai-apps.html), [thesys.dev](https://www.thesys.dev/), [Businesswire](https://www.businesswire.com/news/home/20250418761213/en/Thesys-Introduces-C1-to-Launch-the-Era-of-Generative-UI)

**NO EVIDENCE FOUND:** independent verification of the 300-teams figure, any named production customer, retention data, or any published post-mortem. The "300 teams" number is vendor-reported. Treat Thesys as unproven.

### 1.6 AG-UI

**VERIFIED.** An open, event-based protocol from CopilotKit for the agent↔frontend layer: front-end POSTs the prompt/state, then listens to an SSE stream of typed events. Framework support includes LangGraph, Mastra, Pydantic AI. Oracle adopted it for Agent Spec.
Sources: [docs.ag-ui.com](https://docs.ag-ui.com/), [copilotkit.ai/ag-ui](https://www.copilotkit.ai/ag-ui), [Oracle blog](https://blogs.oracle.com/ai-and-datascience/announcing-agent-spec-for-a2ui-copilotkit-ag-ui)

AG-UI is the **transport/event layer**; A2UI is the **UI description layer**. They compose — CopilotKit ships A2UI support _through_ AG-UI. Positioning: MCP handles context, A2A handles agent-to-agent, AG-UI handles agent-to-user.

### 1.7 Microsoft Adaptive Cards — the 8-year-old precedent nobody cites

**VERIFIED.** Adaptive Cards is the same idea shipped in 2017: author a card once as JSON schema, hosts render with native components.
Source: [Microsoft Learn](https://learn.microsoft.com/en-us/adaptive-cards/), [Copilot Studio docs](https://learn.microsoft.com/en-us/microsoft-copilot-studio/adaptive-cards-overview)

**The lesson is the failure mode, and it is a version/capability fragmentation problem:**

- Copilot Studio supports schema ≤ 1.6
- Bot Framework Web Chat supports 1.6 but **not** `Action.Execute`
- The live chat widget is limited to 1.5
- Teams is limited to 1.5
- **Teams mobile supports only up to 1.2**, and "cards that use schema versions later than 1.2 might not render correctly or might have limited or inconsistent functionality"

Plus hard scale limits: Teams displays only 15–20 conversations once a card with 30+ is sent; a max of 60 users can see a differentiated card version; guidance to avoid ColumnSets with >3 columns.

**INFERRED, and this is the single most transferable engineering lesson in this document:** "author once, render everywhere" degrades into a capability matrix. The moment you have more than one renderer (web, mobile, email digest, PDF export), your bounded view-class set becomes a _versioned contract_ whose weakest renderer defines the real ceiling. A single-renderer system avoids this entirely — and that is a strong argument for keeping the number of render targets at exactly one for as long as possible.

### 1.8 Claude Artifacts / v0 / Canvas

**VERIFIED (as category).** These are code-generation tools that produce a document/app in a side panel; they are cited as prior work in the academic literature ([Stanford GenUI paper](https://arxiv.org/pdf/2508.19227) cites OpenAI Canvas 2024b and Anthropic Artifacts 2024). They are **not** the proposed architecture — the model writes the code.

Useful empirical datum from that paper: when Claude 3.7 was run as a plain conversational interface, **26% of responses spontaneously included artifact generation**, which the researchers had to strip for a fair comparison. **INFERRED:** models already reach for UI unprompted when the task warrants it; the question is whether you let them improvise it or constrain them to your catalog.

---

## 2. Who has actually shipped a real product on this

### 2.1 Google — the largest real deployment

**VERIFIED.** Google shipped generative UI into two production surfaces:

1. **Gemini app** — via "dynamic view" and "visual layout"
2. **Google Search AI Mode** — for Google AI Pro and Ultra subscribers in the U.S.

It "dynamically creates immersive visual experiences and interactive interfaces — such as web pages, games, tools, and applications — that are automatically designed and fully customized in response to any question, instruction, or prompt."
Source: [Google Research blog](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/)

**Stated limitation, quoted verbatim — this is the most important sentence in this whole document:**

> "our current implementation can sometimes take a minute or more to generate results, and there are occasional inaccuracies in the outputs; these are areas of ongoing research."

Also: Google used A2UI + Flutter GenUI to build adaptive interfaces for **I/O 2026** applications, "replacing static forms with dynamic user interactions" ([blog.google](https://blog.google/innovation-and-ai/technology/ai/io-2026-google-ai/)).

**Google Opal** (Labs, launched July 2025, expanded to 160+ countries by November, now accessible in the Gemini dashboard) is explicitly framed as **experimental**, "rather than a production-ready platform" ([buildfastwithai](https://www.buildfastwithai.com/ai-tools/opal-google), secondary).

### 2.2 OpenAI — Apps SDK / ChatGPT Apps

**VERIFIED.** Components run in an iframe inside ChatGPT, communicating over the MCP Apps bridge (JSON-RPC over postMessage), rendering inline in the conversation. OpenAI shaped the MCP Apps standard from ChatGPT Apps before moving capabilities into the MCP spec.
Sources: [developers.openai.com/apps-sdk](https://developers.openai.com/apps-sdk/plan/components), [MCP Apps in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)

**NO EVIDENCE FOUND:** published usage/retention numbers for ChatGPT Apps, or evidence about whether users actually engage with the embedded UIs versus continuing in text.

### 2.3 Did anything fail publicly?

**Important honesty note.** The famous 2025 AI failures — **Humane AI Pin** and **Rabbit R1** — are frequently invoked in this discussion but **they are not evidence about generative UI**. Their documented causes were different:

- **Humane**: shut down servers 2025-02-28, bricking devices; raised $230M, sold to HP for $116M, shipped fewer than 10,000 units. Cited causes: slow/unreliable assistant, unreadable laser projector, and the category itself — the smartphone was adequate.
- **Rabbit R1**: ~5,000 daily active users out of the first 100,000 units; mass returns. Cited cause: the "Large Action Model" barely worked — a gap between demo and delivery.

Sources: [TechRadar](https://www.techradar.com/computing/artificial-intelligence/with-the-humane-ai-pin-now-dead-what-does-the-rabbit-r1-need-to-do-to-survive), [digitalapplied](https://www.digitalapplied.com/blog/ai-product-failures-2026-sora-humane-rabbit-lessons)

Both are **hardware + capability** failures, not interface-architecture failures. The one genuinely transferable lesson: _both shipped a natural-language front door over capabilities that did not reliably work, and the interface could not compensate._ An NL front door amplifies backend unreliability rather than hiding it.

**NO EVIDENCE FOUND:** any product that publicly failed _because_ a model assembled its UI from a bounded catalog. The architecture is too new (both standards are <8 months old) for post-mortems to exist. **This is itself a finding: there is no negative production evidence, and no positive longitudinal evidence either.**

---

## 3. The academic lineage — and the result that matters most

### 3.1 Findlater & McGrenere, CHI 2004 — _A Comparison of Static, Adaptive, and Adaptable Menus_

**VERIFIED — full paper read.** Source: [ACM DL](https://dl.acm.org/doi/10.1145/985692.985704), [UBC copy](https://www.cs.ubc.ca/labs/imager/tr/2004/findlater04menus/)

Design: N=27, within-subjects 3×3 (menu condition × scheme), split menus with a 4-item top partition, task built from 20 weeks of real MS Word 2000 logs (1,387 menu selections), 200-item selection blocks.

Three conditions:

- **Static** — the 4 most frequently occurring items, fixed. Note: this is an _oracle-optimal_ static menu; the frequencies came from the actual task sequence.
- **Adaptive** — system-controlled; 2 frequency items + 2 recency items, repartitioned continuously.
- **Adaptable** — user-controlled; top partition starts **empty**.

**Results (speed):**

- Significant main effect of menu type: _F_(1.44, 34.64) = 12.54, _p_ < .001, η² = .343
- Significant Order × Menu interaction: _F_(2.89, 34.64) = 6.14, _p_ = .002, η² = .338
- **Static was significantly faster than adaptive in all three orders** (_p_ = .002, _p_ < .001, _p_ < .001); mean differences of 20.8s, 29.5s, 25.0s over a 200-selection block.
- Block 2 means (all 27): Static 306.51s, Adaptable 318.80s, Adaptive 331.62s.
- Block 2 means (**the 22 who actually customized**): Static 301.76s, **Adaptable 300.72s**, Adaptive 326.86s — adaptable is _statistically indistinguishable from the oracle-optimal static menu_.
- Error rates: 6.8 / 6.6 / 6.9 — no significant pairwise differences.

**Results (preference), ranked first, N=27:**

| Measure           | Static | Adaptive | Adaptable | χ²(2,27) | _p_         |
| ----------------- | ------ | -------- | --------- | -------- | ----------- |
| Preferred overall | 4      | 8        | **15**    | 6.89     | .032        |
| Most efficient    | 6      | 5        | **16**    | 8.22     | .016        |
| Most frustrating  | 10     | **15**   | 1         | 11.62    | .003        |
| Initially easiest | 5      | 4        | **17**    | 12.08    | .002        |
| Fewest errors     | 9      | 6        | 10        | 1.04     | .595 (n.s.) |

55% preferred adaptable, 30% adaptive, 15% static. **Six subjects explicitly complained about the _inconsistency_ of the adaptive menus.**

**The authors' conclusion, quoted verbatim:**

> "Results show that optimal static split menus are significantly faster than adaptive menus. When subjects were guided by example, i.e., they had seen the static or adaptive menus first, they were better able to understand the value of customization. Under those circumstances, the adaptable menus were faster than the adaptive ones, and the static and adaptable menus were not significantly different, showing that users can customize effectively."

**The finding that bears directly on densification — "Need to Guide by Way of Example":**
Only **22 of 27 subjects customized at all**. Average time spent customizing: 142 seconds. And critically: **four of the five subjects who did not customize had been given the adaptable condition first.** Quoted:

> "This suggests that some users do not recognize the value of customizing, even when the customization mechanism is easy to use... For effective customization, we may also need to guide users by providing examples."

Also verified: the _non-customized_ adaptable menu (equivalent to the plain static MS Word menu) was **20% slower** than the static split menu.

The authors' own proposed future direction — **mixed-initiative** — is quoted:

> "One possibility would be to have the system periodically suggest additions/deletions to the top partition of a user's split menu."

**This is exactly the densification design.** The 2004 paper proposes it as future work and does not test it.

**What this means for densification, stated plainly:**

1. **System-controlled adaptation lost on both axes** — slowest _and_ rated most frustrating (15/27). If densification silently promotes affordances based on inferred repetition, that is the adaptive condition, and the literature says it will be both slower and disliked.
2. **User-controlled adaptation matched an oracle-optimal static layout and was preferred 15/27.** Densification should therefore be _proposed and confirmed_, not applied.
3. **Users do not spontaneously customize.** 5/27 never did. Densification must be seeded by example, not left latent.
4. **Perceived ≠ measured.** 16/27 rated adaptable "most efficient" when in some orders it was not. **Do not evaluate densification by preference survey alone** — see §3.4, where this cuts against the modern generative-UI evidence base.

### 3.2 Gajos et al., CHI 2008 — _Predictability and Accuracy in Adaptive User Interfaces_

**VERIFIED (abstract-level; full PDF was not machine-readable).** Sources: [Microsoft Research](https://www.microsoft.com/en-us/research/publication/predictability-and-accuracy-in-adaptive-user-interfaces/), [Harvard/Gajos](https://www.eecs.harvard.edu/~kgajos/papers/2008/gajos08predictability.shtml), [ACM](https://dx.doi.org/10.1145/1357054.1357252)

Findings: increasing **both** predictability and accuracy strongly improved satisfaction; increasing **accuracy** also improved performance and utilization. Contrary to the authors' expectations, **accuracy mattered more than predictability** for performance, utilization, and several satisfaction ratings. Accuracy levels tested: **50% and 70%**.

**INFERRED:** the practical reading is that a router which is right ~50% of the time will be actively rejected, and even 70% is at the low end of what was studied as acceptable. This sets a rough floor for intent→(capability, view) routing accuracy. I could not verify a specific published threshold above which adaptation becomes net-positive — **NO EVIDENCE FOUND** for a clean numeric cutoff.

### 3.3 Findlater et al., CHI 2009 — _Ephemeral Adaptation_ — the positive result

**VERIFIED.** Source: [ACM](https://dl.acm.org/doi/10.1145/1518701.1518956), [UBC PDF](https://www.cs.ubc.ca/~joanna/papers/CHI2009_Findlater.pdf)

Mechanism: predicted items appear **abruptly** when the menu opens; non-predicted items **fade in gradually**. Nothing moves. Spatial layout is fully preserved.

Results: two experiments, 48 users total. Ephemeral adaptive menus were **faster than static menus when accuracy is high, and not significantly slower when accuracy is low**, and faster than adaptive highlighting.

**This is the design key, and it resolves the tension in §3.1.** The 2004 failure was not "adaptation" — it was **spatial instability**. Adaptation that changes _emphasis_ while preserving _position_ wins; adaptation that changes _position_ loses. A densification design that adds a durable affordance in a stable location (and never reorders existing ones) is on the right side of this result. A design where the affordance bar reshuffles by recency is on the wrong side.

### 3.4 The methodological gap between the old literature and the new

**INFERRED, and I regard this as the most important analytical point in this document.**

The 2004/2008/2009 studies measured **task completion time under controlled conditions**. The 2025/2026 generative-UI studies measure **pairwise preference on one-shot outputs**. These are not the same claim, and Findlater specifically found they can diverge — 16/27 users rated adaptable "most efficient" when measurement showed otherwise.

Concretely: the Stanford GenUI paper (§5) reports an 84% win rate. It does **not** report task completion time, error rate, or any longitudinal measure. **NO EVIDENCE FOUND**: any longitudinal or timed study of generative UI. The entire modern evidence base is first-impression preference.

### 3.5 Programming by demonstration — the densification ancestor

**VERIFIED.** Allen Cypher's **Eager** (CHI 1991) is a "smart macro recorder" that "constantly monitors the user's activities, and when it detects an iterative pattern, it writes a program to complete the iteration."
Sources: [ACM DL](https://dl.acm.org/doi/10.1145/108844.108850), [acypher.com/Eager](https://acypher.com/Eager/), [Watch What I Do ch.9](https://acypher.com/wwid/Chapters/09Eager.html)

Eager's key interface technique is **anticipation**: when it detects a repetitive activity, it **highlights** menus and objects to show what it expects the user to do next. Generalizations are communicated through **instantiations** — showing the user the concrete next step so they can recognize whether the system generalized correctly.

**This is directly applicable.** Eager solved the "how does the user know what the system inferred?" problem by _showing the inference as a concrete prediction the user can accept or ignore_, rather than by silently acting. That is the same shape as ephemeral adaptation (§3.3): surface the inference without committing to it.

**NO EVIDENCE FOUND:** a documented account of _why_ Eager did not achieve adoption. I searched specifically and found descriptions of the system but no post-mortem. Do not repeat the common claim that "PBD failed because inference was unreliable" as though it were sourced — I could not verify it.

### 3.6 Malleable software (Ink & Switch, June 2025)

**VERIFIED (thin).** A research track on "tools that users can reshape with minimal friction... where modification becomes routine, not exceptional." Three design patterns: **a gentle slope from user to creator** (Excel, HyperCard as exemplars), **tools not apps** ("a kitchen knife, not an avocado slicer"), and **communal creation**.
Sources: [inkandswitch.com/essay/malleable-software](https://www.inkandswitch.com/essay/malleable-software/), [Geoffrey Litt](https://geoffreylitt.com/2023/03/25/llm-end-user-programming.html)

**INFERRED:** "gentle slope from user to creator" is the closest existing articulation of densification's _intent_. But Ink & Switch frames it as **user-initiated** reshaping, not system-initiated crystallization — consistent with the adaptable-beats-adaptive result.

---

## 4. The case against chat as an interface

### 4.1 Nielsen's own position is a hybrid — which supports the proposal

**VERIFIED.** In _AI: First New UI Paradigm in 60 Years_, Nielsen frames AI as **intent-based outcome specification** — the third paradigm after batch and command-based interaction. It "completely reverses the locus of control," shifting responsibility from user to system.
Source: [nngroup.com/articles/ai-paradigm](https://www.nngroup.com/articles/ai-paradigm/)

His stated drawbacks:

- AI is "prone to including erroneous information in its results," and when "users don't know how something was done," identifying and correcting problems becomes difficult.
- **"half the population in rich countries is not articulate enough to get good results"** — an articulacy barrier, not a technology barrier.
- He is skeptical that intent-based systems alone reach high usability, predicting **"future AI systems will likely have a hybrid user interface"** combining intent-based and command-based elements.

**The proposed architecture _is_ Nielsen's predicted hybrid.** Chat routes; authored deterministic views render; densified affordances are the command-based half accreting over time. This is the strongest single piece of external validation available.

### 4.2 NN/g on generative UI specifically — the warnings

**VERIFIED.** NN/g defines genUI as "a user interface that is dynamically generated in real time by artificial intelligence to provide an experience customized to fit the user's needs and context."
Source: [nngroup.com/articles/generative-ui](https://www.nngroup.com/articles/generative-ui/)

Warnings, quoted:

- "Generative AI's problems are GenUI's problems" — hallucinations and biases propagate into the interface.
- Personalization requires "a deep understanding of the individual user," involving "substantial risks to individual privacy and security."
- **"Constantly changing UIs will cause usability problems"** — users face "a different UI every time you use a website."
- Designers must "balance the gains from a completely customized experience with the losses incurred by the lack of UI consistency and predictability."

On timeline: NN/g says it's "quite unclear when genUIs become widely available," potentially "years, maybe decades."

**INFERRED:** NN/g's central objection — _inconsistency_ — is precisely what a bounded authored view-class set neutralizes. A table always looks like the table. This is the proposal's strongest defensive property, and it should be stated as such: the architecture is not "generative UI with guardrails," it is a _different thing_ that shares a router with generative UI but has a fixed visual vocabulary. Only the _selection_ is generative.

### 4.3 Other chat critiques

**VERIFIED (secondary).** NN/g analyzed 425 interactions across ChatGPT, Bard, and Bing Chat and found **six distinct conversation types**, concluding different types "serve distinct information needs and require varied interfaces." Also observed: chatbots "rely on linear flows and struggle when users deviate," and ChatGPT's chat "does not allow for smooth interruptions."
Source: [nngroup.com/articles](https://www.nngroup.com/articles/) (index; specific article titles not individually verified)

**How much does the hybrid address?**

| Critique                                    | Addressed by chat-routes-authored-views-render?                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Inconsistent UI every visit                 | **Yes, fully.** Fixed view vocabulary.                                                                          |
| No affordance discovery / blank-box problem | **Partially.** Densified affordances address it directly; this is arguably densification's real justification.  |
| Articulacy barrier (Nielsen)                | **Partially.** Clickable affordances bypass it once they exist; the first-run experience still requires typing. |
| Linear flow, poor deviation handling        | **Not addressed.** Still a conversation.                                                                        |
| No smooth interruption                      | **Not addressed.** Streaming + abort must be built.                                                             |
| Hallucination in content                    | **Not addressed by view selection.** A correctly-chosen table full of wrong numbers is still wrong.             |

**The last row deserves emphasis.** Bounding the view class bounds _presentation_ risk, not _content_ risk.

---

## 5. Empirical evidence that this actually works

### 5.1 Stanford / Georgia Tech — _Generative Interfaces for Language Models_ (arXiv 2508.19227v3, 1 May 2026)

**VERIFIED — paper read directly.** Chen, Zhang, Zhang, Shao, Yang. [arXiv:2508.19227](https://arxiv.org/abs/2508.19227), code at [github.com/SALT-NLP/GenUI](https://github.com/SALT-NLP/GenUI)

Architecture — note this is a **hybrid** of the two approaches in §1.1:

- Query → **requirement specification** → **structured interface-specific representation** (interaction flows as a directed graph 𝒢 = (𝒱, 𝒯) + per-component **finite state machines** ℳ = (𝒮, ℰ, δ, s₀)) → HTML/CSS/JS synthesis.
- Critically: "we build a complementary **codebase containing reusable implementations of common UI elements** (_e.g._, clock, map, calculator, video player, code viewer, and chart)." **So even the code-generation approach fell back on a component catalog.**
- **Iterative refinement**: an LLM-generated, query-specific reward function scores candidates 0–100; regenerate until score ≥ 90 **or 5 iterations**.

Evaluation: 100 queries (UIX suite) across the 10 Clio domains, pairwise comparison, 428 unique annotators on Prolific at $16/hr, 3 annotators per instance, majority vote.

**Results (Table 1, win/tie/loss vs GenUI):**

| Baseline                                           | Loses | Ties | GenUI wins |
| -------------------------------------------------- | ----- | ---- | ---------- |
| ConvUI (Claude 3.7)                                | 12%   | 4%   | **84%**    |
| ConvUI (GPT-4o)                                    | 30%   | 1%   | **69%**    |
| IUI (Claude artifacts, explicitly prompted for UI) | 17%   | 8%   | **75%**    |

Abstract claims "up to a 72% improvement in human preference."

**By domain (Table 2):** Data Analysis & Visualization 93.8%, Business Strategy & Operations 87.5%, Language Translation 87.5%, Education & Career 83.3%, Academic Research 79.2%, Content Creation 75.0%, Digital Marketing 75.0%, DevOps 75.0%, Web/Mobile Dev 70.8%, **Advanced AI/ML 50.0%**.

By query type: interactive tasks 80.0%; general conversation 73.0% vs 23.0%; detailed queries 80.0% vs concise 73.0%.

**Caveats I consider material, and which the win rates obscure:**

- **Fleiss' κ = 0.525** — only _moderate_ inter-annotator agreement. The authors acknowledge "the inherent subjectivity of interface evaluation."
- Advanced AI/ML sat at exactly 50% — "traditional linear text explanations remain effective in math-heavy contexts." **Not every domain benefits.**
- A dissenting user quote the authors reproduce: _"Chatbot interface is most people know already, while GenUI is a somewhat complex and unfamiliar app."_
- Concise queries benefit less: "simple conversational responses sometimes sufficiently address short queries, whereas GenUI may introduce unnecessary complexity."
- **No timing data. No error rates. No longitudinal use.** This is a first-impression study.

**INFERRED:** the up-to-5-iteration refinement loop is a latency catastrophe for interactive use and is the clearest reason this specific pipeline is a research artifact rather than a shippable design.

### 5.2 Google — _Generative UI: LLMs are Effective UI Generators_ (arXiv 2604.09577)

**VERIFIED.** Leviathan, Valevski et al. [arXiv:2604.09577](https://arxiv.org/html/2604.09577v1), [project page](https://generativeui.github.io/static/pdfs/paper.pdf)

Approach: full HTML generation with system instructions covering "core philosophy, planning guidelines, examples, and technical specifications," plus tools (image generation, search) and **post-processors to fix common issues**.

Claim: "When properly prompted and equipped with the right set of tools, a modern LLM can robustly produce high quality custom UIs for virtually any prompt."

Evaluation: 100 prompts from LMArena + a custom information-seeking set; five formats compared (expert-created websites, Generative UI, markdown, search results, plain text); two raters each, 3-point scale.

**Results:**

- vs markdown: "**Generative UI is preferred 82.8% of the time**"
- vs human experts: "at least comparable in **50%** of cases"
- ELO: Generative UI **1736.2** vs expert sites **1800.3**
- Model-capability effect is large: Gemini 3 at 1706.7 vs Flash-Lite at 1183.0

**Limitations, quoted:** "One primary limitation and an important area for future research is the **slow generation speed, which can often take a minute or two**." Also occasional JS/CSS/HTML errors requiring post-processing.

**INFERRED:** two independent groups converged on ~80%+ preference over text. That is a real, replicated signal that _some_ structured visual output beats prose. Neither study isolates whether the gain comes from _bespoke_ generation or merely from _structure_ — **NO EVIDENCE FOUND** for a study comparing model-generated UI against a well-chosen fixed template. **That is the single most valuable missing experiment for this decision, and it is cheap to run.**

---

## 6. Intent routing reliability

### 6.1 ReliabilityBench (arXiv 2601.06112)

**VERIFIED.** [arXiv:2601.06112](https://arxiv.org/html/2601.06112). Evaluates agents on a "Reliability Surface" R(k, ε, λ): consistency (pass@k), robustness (ε = perturbation), fault tolerance (λ = injected faults). Four domains (scheduling, travel, support, e-commerce), 1,280 episodes.

- **"96.9% pass@1 at ε=0 drop to 88.1% at ε=0.2"** — an 8.8-point fall from **task paraphrasing alone**. Authors: "pass@1 metrics on clean data provide dangerously optimistic estimates."
- Under medium fault injection (λ=0.2): rate limiting 93.75%, partial responses 97.50%, transient timeouts 98.75%.
- **Simpler ReAct agents outperformed more complex Reflexion architectures** — 2.5% higher surface volume, and better fault recovery (80.9% vs 67.3%).
- GPT-4o cost "82× more than Gemini 2.0 Flash with comparable reliability (−0.6% difference)."

**The paraphrase-sensitivity number is the one to internalize.** Users will phrase the same intent many ways. An 8.8-point drop from paraphrasing is the routing tax.

### 6.2 Failure-mode taxonomy (arXiv 2511.19933)

**VERIFIED (abstract only — full taxonomy not retrieved).** [arXiv:2511.19933](https://arxiv.org/abs/2511.19933). Claims fifteen hidden failure modes in real-world LLM applications. Named in the abstract: **multi-step reasoning drift, latent inconsistency, context-boundary degradation, incorrect tool invocation, version drift, cost-driven performance collapse.** Addresses "observability limitations, cost constraints, and update-induced regressions."

**NO EVIDENCE FOUND** for the remaining nine modes — I did not retrieve the full paper.

**Two of the named modes are direct threats to this architecture:**

- **Version drift** — the router's behavior changes when the model is upgraded, silently. Any (capability, view) routing table needs a pinned regression suite, or a model upgrade becomes a UI regression.
- **Latent inconsistency** — the same intent routes to different views across sessions, which reproduces exactly the inconsistency NN/g warns about (§4.2) _despite_ the bounded view set. **Bounding the view vocabulary does not bound routing variance.**

### 6.3 What is missing

**NO EVIDENCE FOUND:** any published benchmark for intent→(capability, view) routing specifically; any standard eval harness for view selection; any reported accuracy figures for view-class routing in production. This is an unmeasured area. **INFERRED:** it is also the easiest part to make testable — view selection is a small closed-set classification problem, so a golden set of (utterance → expected view) pairs with paraphrase variants is straightforward and should be built before the router is trusted.

---

## 7. Latency

### 7.1 The canonical thresholds still apply

**VERIFIED.** [nngroup.com/articles/response-times-3-important-limits](https://www.nngroup.com/articles/response-times-3-important-limits/):

- **0.1s** — "about the limit for having the user feel that the system is **reacting instantaneously**." No special feedback needed.
- **1.0s** — "about the limit for the **user's flow of thought** to stay uninterrupted." User notices the delay; indicate the system is working beyond this.
- **10s** — "about the limit for **keeping the user's attention** focused on the dialogue." Beyond this: percent-done indicator, a clearly marked interruption option, and assume the user needs reorientation on return.

### 7.2 The collision

**This is the sharpest tension in the whole proposal.**

- Google's shipped generative UI: **"a minute or more."**
- Stanford's pipeline: up to 5 generate-evaluate iterations.
- NN/g's attention limit: **10 seconds.**

Code-generating architectures are **6× or more over the attention threshold**. They are viable only for one-shot, high-value, expected-to-be-slow requests (a research answer, a report) — not for interactive application use.

**INFERRED, and this is the strongest argument in favor of the proposed architecture:** catalog selection is the only variant of this idea that can land inside the interaction budget, because the model emits a short routing decision plus a data payload rather than a page of markup. Its latency floor is _the data fetch_, not _the generation_. Choosing the bounded-catalog approach is not a conservatism tax — it is the only thing that makes the interaction loop feasible at all.

### 7.3 Practical mitigations

**VERIFIED (secondary sources; treat figures as indicative, not authoritative):**

- TTFT targets under 800ms; typically 200–500ms with streaming.
- "What kills perceived performance is a blank screen for two seconds before anything happens, not the total duration."
- Optimistic rendering of the user's own message saves 100–300ms of perceived latency.
- Skeleton screens can make waits feel ~30% faster than a spinner and prevent reflow when content arrives.
  Sources: [Setproduct](https://www.setproduct.com/blog/ai-chat-interface-ui-design), [thefrontkit](https://thefrontkit.com/blogs/what-is-streaming-ui-in-ai-applications), [AI UX Playground](https://www.aiuxplayground.com/pattern/streaming/)

**INFERRED:** a bounded view-class set is unusually well-suited to skeletons — because the view is chosen _before_ the data arrives, you can render the correct skeleton (a table skeleton, a timeline skeleton) the instant routing resolves. That is a genuine architectural advantage over code generation, where the shape is unknown until generation completes. Routing should therefore be a **separate, fast, cheap call** whose result is committed to the UI immediately, with data streaming in after.

---

## 8. What is genuinely novel vs. already done

**Already done, well-specified, don't rebuild:**

- Agent selects from a client-controlled catalog; UI as data not code → **A2UI**, **MCP Apps**
- Event transport between agent and frontend → **AG-UI**, MCP Apps JSON-RPC bridge
- Host-side render of an authored schema → **Adaptive Cards** (since 2017)
- Structured intent representation before UI resolution → Stanford GenUI's interaction-flow graph + FSMs

**Genuinely underexplored:**

1. **View classes at a coarse semantic grain** (document / outline / list / table / diff / timeline / metric / form) rather than component primitives (Card / Row / Button). Every shipped catalog I found is component-grained. **NO EVIDENCE FOUND** of a system with a small closed set of ~8 semantic view classes. A coarser grain means a smaller decision space, which should mean better routing accuracy — but I found no one who has measured this.
2. **Densification / crystallization of repeated intents into durable affordances.** The 2004 paper proposes mixed-initiative suggestion as _future work_ and does not test it. Eager (1991) is the nearest implementation and predates LLMs. **NO EVIDENCE FOUND** of an LLM-era system that does this with published results. **This is the actually novel part of the proposal.**
3. **Deterministic, testable view routing as a first-class product property.** §6.3 — nobody publishes numbers here.

---

## 9. Design conclusions the evidence supports

1. **Adopt A2UI or MCP Apps as the wire format** rather than inventing one. Both are open, both have the same security posture, MCP Apps is production-live in Claude/ChatGPT/VS Code.
2. **Keep exactly one renderer for as long as possible.** The Adaptive Cards capability matrix (§1.7) is what multi-renderer looks like at year eight.
3. **Densification must be adaptable, not adaptive** — propose, let the user confirm, never silently promote. Findlater 2004: system-controlled was slowest _and_ most frustrating (15/27); user-controlled matched an oracle-optimal static layout and was preferred (15/27).
4. **Never reorder.** Ephemeral adaptation (2009) shows emphasis-change wins where position-change loses. Densified affordances append in stable positions.
5. **Seed by example.** 5/27 users never customized, and 4 of those 5 were shown the customizable version _first_. Densification will not bootstrap itself.
6. **Route in a separate fast call; render the skeleton on routing, not on data.** §7.3.
7. **Build the (utterance → expected view) golden set with paraphrase variants before trusting the router,** and re-run it on every model upgrade (version drift, §6.2). Expect ~9 points of loss from paraphrasing alone (§6.1).
8. **Run the missing experiment** (§5.2): model-generated UI vs. a well-chosen fixed template, on the same prompts. Nobody has published it, it is cheap, and it directly tests the proposal's central bet.
9. **Do not claim the bounded view set solves hallucination.** It bounds presentation risk only (§4.3).

---

## 10. Explicit gaps — what I could not find

- Any post-mortem explaining why **Eager**/PBD did not achieve adoption.
- Any **longitudinal or timed** study of generative UI. All modern evidence is one-shot preference.
- Any study comparing **model-generated UI vs. a fixed well-chosen template**.
- Any published **intent→view routing** benchmark or accuracy figures.
- Independent verification of **Thesys**' "300 teams," or any named production customer.
- Usage/retention data for **ChatGPT Apps** embedded UIs.
- A clean numeric **accuracy threshold** above which adaptation becomes net-positive (Gajos tested only 50% and 70%).
- The remaining nine of the fifteen failure modes in arXiv 2511.19933.
- Any product that failed **because** a model assembled its UI from a bounded catalog. The standards are <8 months old.
