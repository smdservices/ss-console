---
title: Operator-Led Assessment Funnel — Voice-Capable Interview Operator as Front-of-Funnel, Human-Owned Close
date: 2026-06-05
status: accepted
captain: Scott Durgan
related-adr: 0002-outside-view-unified-diagnostic.md, 0004-productized-operator-offering.md, 0022-vertical-pack-architecture.md, 0027-inbound-trust-boundary.md, 0028-outbound-integrity-gates-provenance-and-voice.md, 0034-operator-product-naming.md, 0035-no-imposed-entitlement-defaults.md, 0037-operator-thesis.md, 0038-operator-vertical-delivery-method.md
related-issue: '#1219'
---

# ADR 0039 — Operator-Led Assessment Funnel

**Status:** Accepted (Captain decision, 2026-06-05).

**Validation status.** The decision to build the voice-capable assessment interview operator is **accepted**. The funnel model around it — report-in-portal enticement, human-owned close, the conversion economics — is a **hypothesis** until it runs real prospects. It carries an explicit success metric and reversal triggers below, and should be revisited, not assumed settled, until live prospects validate it.

**Purpose.** The citable answer to: _what is SMD's front door, how does a prospect travel from an ad click to a closed engagement, and what exactly are we building first._ Supersedes the VCMS draft note "Operator-Led Assessment Funnel — Course Map Draft (for hardening)," which was the scaffold this ADR hardens.

> **Forward-note (2026-07-13).** The **entry mechanism** this ADR leaves deferred (how prospects arrive at the funnel) is now owned by [ADR 0066](./0066-paid-acquisition-round-one.md) (Paid Acquisition Round One): ad → message-matched pack LP → `/book`. This ADR governs the funnel from `/book` inward; 0066 governs how traffic reaches it.

## Context

We are pre-launch. Nothing has been sold. The immediate need is **volume + proof + case studies**, not margin.

We have an Operator product ([ADR 0004](./0004-productized-operator-offering.md), [ADR 0037](./0037-operator-thesis.md)) and a vertical delivery method to make it deliverable to clients ([ADR 0038](./0038-operator-vertical-delivery-method.md)). What we do **not** have is a front door — a way for a prospect to discover SMD, experience the caliber of the work, and convert. This ADR is that front door.

The design resolves a real trust problem. The BCG finding is that an "AI employee" framing _lowers_ trust and raises replacement fear. The defeat for that is not a disclaimer — it is a live, genuinely excellent assessment the prospect experiences firsthand. The demo _is_ the product, and the assessment _is_ the demo.

**Historical lineage (resolved, do not re-litigate).** This is the evolution of Outside View's D2 (agent conversation) and D3 (human assessment) from [ADR 0002](./0002-outside-view-unified-diagnostic.md). D1 (public-footprint scraping) was dropped because scraping surfaced nothing useful (retired in PRs #702/#703; ADR 0002 superseded). This circles back to the original owner-sourced "tell us about your business" instinct — now delivered by a voice operator instead of a static form or a scraper. **The dead incarnation must not pollute the live design.** The only genuine carry-over is the no-dollarize-the-pain framing (give solvability and the shape of the fix; the owner does the math against their own numbers), which is already our P0 anti-fabrication law.

**The dogfood loop.** This front-of-funnel operator is, in one build, four things: SMD's lead-generation engine, its customer-zero ([ADR 0004](./0004-productized-operator-offering.md) eat-our-own-cooking), the live demo that defeats the AI-employee trust problem, and the reference implementation for the universal intake / front-desk pack ([ADR 0022](./0022-vertical-pack-architecture.md)). Running the funnel and building the flagship pack are the same cost.

## The flow

Ad click → **[1]** web-widget operator runs the assessment (discloses it is AI; qualifies in-conversation) → **[2]** operator drafts findings (evidence-bound; seeds `customer.yaml`) → **[3]** findings render to a premium report in the client portal → **[4]** the report entices a follow-up call → **[5]** the human joins to deliver the read and close → branch: scoped consulting engagement **or** operator implementation.

## Decision

### 1. The load-bearing seam — operator captures and drafts, human owns the read and the close

- The **operator** owns capture and logistics: interview, qualify, draft, render, book, nurture.
- The **human** owns judgment and the close: the verdict, the prioritization, the relationship, the sale.
- The operator **drafts real findings** — a first-pass diagnosis, evidence-bound — but it is a _draft the human sharpens live_, not a delivered verdict. This is the corrected frame: "findings" are not forbidden to the operator; a junior analyst drafts findings and the partner owns and delivers them. The operator producing findings from a live conversation is **authoring real data for a real engagement**, not fabrication. The anti-fabrication P0 law governs _invented content when authored data is missing_ — it does not bar an operator from analyzing a conversation it actually had.
- **Automate the data layer, amplify the human layer, never the reverse.** This seam is what keeps the funnel premium rather than a commodity audit-bot. It is also the conversion engine (§4).

### 2. The interview is the product — caliber must be reliable, not lucky

This is the **build spearhead**. The operator must run a top-caliber assessment conversation: a real conversation, knowing where to probe deeper, never guessing, leading without getting sidetracked. A shallow interview is fabrication risk in every node after it — caliber here bounds the quality of the entire funnel.

Reliability does not come from a clever system prompt (which buys a great demo and an unpredictable tenth call). It comes from four mechanisms working together:

- **Coverage model, not a script.** The operator drives toward _coverage_ across the five observation domains (`process_design`, `tool_systems`, `data_visibility`, `customer_pipeline`, `team_operations` — `src/portal/assessments/extraction-schema.ts`) plus whatever surfaces, tracking live which areas are deep, thin, or untouched. A script interrogates; no spine rambles; a tracked coverage model lets the operator follow the owner's energy and always find its way back. Sidetracks get an explicit acknowledge → bridge → redirect move against an attention budget it knows it is spending.
- **Probe repertoire.** The consultant's instinct for _where to dig_ is encoded as classes of owner statement mapped to proven follow-ups ("show me how you do that," "walk me through the last time it broke," "who else touches this"). Not a script — a repertoire the operator reaches for. This is what Hermes skills are for, and it is where the **vertical packs differentiate**: a plumber's tells are not a law firm's tells.
- **Teach-back (confirm-before-proceed).** "Ask, don't assume" is a _structural conversational move_, not a hope. The operator periodically reflects back what it heard and confirms. Teach-back does triple duty: it catches misunderstanding, it makes the owner feel heard (which opens them up), and it produces clean evidence-bound capture for the report. This is the legitimate application of the anti-fabrication instinct — in the conversation, not the codebase.
- **Two loops — a talker and a supervisor.** The voice agent runs the conversation fast and warm. A second, slower reasoning pass watches the transcript, holds the coverage state, and flags dropped threads ("the scheduling thread was abandoned — go back"). The supervisor runs between turns or on natural pauses, never blocking the real-time latency budget. This is the difference between "smart on a good day" and "thorough every time."

And the mechanism that makes caliber a fact rather than a claim:

- **Evals.** A graded eval set of simulated owner personas (the rambler, the evasive one, the owner who does not know his own numbers, the defensive one) scored against a rubric: did it achieve coverage, catch the high-signal tells, confirm instead of assume, stay on spine. Run continuously as the skills and prompts are tuned, riding the grading-fixture pattern that lives in `operator/`. Dogfooded against Scott's own voice first. **Reliability is a number you watch climb, not a quality you assert.**

The framing that makes the goal achievable: we are engineering a reliably top-caliber **interviewer**, not a top-caliber **diagnostician**. The genius read is the human's job at the close (§1). We do not need the operator brilliant; we need it thorough, disciplined, warm, and incapable of guessing.

### 3. Channel — web widget

Paid ads (social and other channels) drive prospects to the operator on the **web**. Voice runs through ElevenLabs with bring-our-own-LLM on Anthropic. No telephony for now — no Twilio, no PSTN, **no TCPA surface** — which also simplifies the first build. Cold outbound voice is explicitly out of scope and out of bounds (a trust and TCPA hazard); the operator is aimed at inbound, warm-first contact.

### 4. The report lives in the portal, and the withheld read is the conversion engine

- Findings render to a **premium report available in the client portal** (not emailed). A render tool (Gamma or equivalent) does **layout and design only, never content invention** — if it ever fills a gap with plausible copy, that is Pattern-B fabrication. It takes authored findings in and styles them, full stop ([ADR 0028](./0028-outbound-integrity-gates-provenance-and-voice.md), anti-fabrication P0).
- The report is the **X-ray**; the human-delivered read is the **radiologist**. It deliberately stops at "here is your operation, clearly, and here is where it strains," and **withholds the verdict, the prioritization, and the fix.**
- This is not stinginess. The read genuinely _is_ the human's premium judgment, and withholding it from the report is precisely what makes the prospect book the call. **The seam (§1) and the conversion mechanic are the same line.** A defector cannot substitute the report for the call by construction — the report is built to create the itch, not scratch it.
- **The give-away risk is worth taking.** Sharing the report carries the risk that a prospect takes it to another agency to implement. Accepted, because: the report is inert without us (a diagnosis, not an implementation); every report circulating is a live demo of operator caliber; and the prospect has no trusted alternative agency in hand — they have just been proven to by the firm that ran them through the experience.

### 5. The bottleneck is the human close, not the assessment — ration accordingly

- The operator assessment scales at a few dollars per call (full intake ~$4–8). The **human close call does not scale** — Scott's close calendar is the scarce resource.
- Therefore: **cast assessments wide; ration the close.** Design the portal and report to rank and nurture so the scarce human hour lands on the highest-intent leads first. The operator works the nurture queue itself — reminders, "ready when you are" nudges — which is logistics, inside the seam.
- "We need volume" is true, but the binding number is not raw leads (leads are cheap). It is **close-calls per week** and **conversions per close-call**. The design problem is ranking the flood for the scarce close, not generating the flood.

### 6. Pricing is a filter dial, not a revenue play — set by capacity

- The assessment fee is a **throttle on the scarce end**, not a profit center. **Credit-back** (the fee applied toward any solution the client purchases) makes any number a pre-payment instead of a cost, so raising it does not add the friction a pure fee would.
- Volume-first (now): low / first-N-free / the existing $250 — fill the portal, build case studies. As the close calendar fills, **raise the gate** (toward the $999 observed in the wild) to filter for intent and protect the scarce hour.
- Credit-back implies assessment _revenue_ is essentially the non-converters — which is fine; the assessment funds the **filter**, not the margin.
- Build tier and price as **config**, not as hardcoded constants ([ADR 0035](./0035-no-imposed-entitlement-defaults.md) posture: configurable substrate, no imposed defaults), so the phase shift from "free for volume" to "$999 to ration" is a dial you turn, not a rebuild.

### 7. Assessment depth is a configurable spectrum, not two fixed SKUs

- The architecture must accommodate a **range of scope-and-cost** (e.g., a light ~15-minute touch and a full ~45-minute premium assessment), but must **not hardcode two tiers**. Depth is an authored dial; the specific shapes inform the design without constraining it.
- **Hard rule: light ≠ sloppy.** The light tier covers _fewer domains at the same caliber_, never lower caliber. A bad cheap assessment inverts the demo — it proves the operator is mediocre, which is anti-marketing. Same interviewer, same reliability engineering (§2); narrower coverage.

## Build scope — this ADR's spearhead

The mission is narrowed to one thing: **design and stand up the voice-capable assessment interview operator.** The surrounding funnel (report render, portal, close, branch) is the committed frame; the build is the interview operator. Proposed sequence (carried from the scaffold, not locked):

1. **Prove the loop without voice** — coverage model and probe repertoire as skills on the existing operator substrate; the findings draft; the report rendered by hand; the human books and closes. Stand up the **simulated-owner eval harness** and dogfood it against Scott's own voice. This is where caliber starts becoming a number.
2. **Add the web-widget voice channel** — ElevenLabs, inbound.
3. **Automate the seams** — portal report render and booking.
4. **Productize** as the universal intake / front-desk pack (the reference implementation).

Infra is pulled by need, consistent with [ADR 0038](./0038-operator-vertical-delivery-method.md) §3 — the interview skills earn their caliber on the eval harness before any voice channel or render automation is built.

## Non-goals

This ADR is **not**:

- the **entry mechanism** — what drives prospects to the assessment (ad strategy, channels, creative) is out of scope this pass;
- **telephony or outbound voice** — web widget only; cold outbound voice is out of bounds;
- the **setter-hire reshaping** — how inbound qualify-and-book changes the appointment-setter ads is on the back burner;
- an automation of the **verdict, prioritization, or close** — the seam (§1) forbids it; the human owns the read;
- a **fixed two-tier SKU model** — depth is a configurable spectrum (§7);
- a **portal / CRM specification** — lead management depth lives in the portal deep dive (#1219), not here.

## Consequences

- **Enables** a front door that is simultaneously lead-gen, live demo, customer-zero, and the intake-pack reference implementation — one build, four payoffs.
- **Accepts** that caliber is _earned_ through evals and dogfooding, not asserted, and that the interview's reliability bounds the whole funnel's quality.
- **Accepts** the give-away risk on the portal report as worth taking (§4).
- **Defers** the entry mechanism, telephony, the setter-ad reshaping, and portal/CRM depth.
- **Depends on** the Operator substrate (Hermes), ElevenLabs voice, the client portal, and the eval/fixture harness pattern in `operator/`.

## Success metric

Falsifiable, stated directionally (concrete thresholds set once it runs real prospects, not invented now): the interview operator **reliably** completes a top-caliber assessment — the eval rubric scores hold across adversarial simulated personas _and_ real prospect calls; the withheld-read report entices booked close calls at a rate that justifies the funnel; and the human's live sharpening is _light_ because the draft is good. If the interview cannot be made reliably top-caliber, the **model** is wrong, not merely the execution.

## Reversal triggers — conditions that reopen this ADR

- The interview cannot be made reliably top-caliber on evals plus real calls (the foundation does not hold).
- The withheld-read report fails to entice close calls (the conversion mechanic in §4 is wrong).
- Prospects routinely defect with the report (the give-away risk in §4 was mispriced).
- The two-loop / latency design cannot deliver a conversation that _feels_ top-notch (a voice-caliber ceiling no amount of content quality clears).
- The configurable depth spectrum (§7) cannot hold caliber at the light end (light collapses into sloppy in practice).

## Quality bar

Captain's standard governs every step above: build smart, think ahead to inform design, implement cleanly, learn as we go, no corners. The interview must be **genuinely excellent before it fronts the firm** — a mediocre assessment operator is anti-marketing, and the whole thesis of this funnel is that the demo is the product.
