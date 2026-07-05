# Paid Acquisition Plan: SMD Services + the Operator

_Status: PROPOSED (awaiting Captain review of budget + launch decisions; the framework and research stand). Authored 2026-07-05 from three parallel research passes (competitor teardown, channel benchmarks, funnel/tracking practices), grounded in the positioning spine (`docs/marketing/positioning-spine.md`), ADR 0037 (Operator thesis), ADR 0063 (Operator pricing), and the CLAUDE.md tone standard._

_Trigger: competitors are actively running Meta/Instagram ads for adjacent offers (observed in-feed 2026-07-05: Smith.ai, Youtiva, RapidDev, Binary Studio, AgentsInstall.com). We enter paid acquisition deliberately, not reactively._

_Benchmark honesty: most public paid-media benchmarks are agency/vendor content. Figures below are directional priors (treat as ±30-50%), cited to the research pass that found them. The only real benchmark is our own test with server-side measurement, which is why Layer 8 ships before Layer 4 spends._

---

## 0. The framework

Every decision sits in one of ten layers. Each layer constrains the ones below it; we never decide a lower layer before settling the one above. Future sessions edit the layer in question instead of re-deriving the stack.

| #   | Layer             | The question it answers                                 |
| --- | ----------------- | ------------------------------------------------------- |
| 1   | Economics         | What is a booked call worth? What can we afford to pay? |
| 2   | Offer & funnel    | What does the ad sell, and where does the click land?   |
| 3   | Audience          | Who sees it, and where (geo + vertical)?                |
| 4   | Channels & budget | Which platforms, in what order, at what spend?          |
| 5   | Message           | Which copy angles are ours, and which are forbidden?    |
| 6   | Creative          | What do the ads look and sound like?                    |
| 7   | Landing surfaces  | What do we build or change on smd.services?             |
| 8   | Measurement       | How does a click become an attributable closed deal?    |
| 9   | Test design       | How long before judging, and what kills a test?         |
| 10  | Operations        | Who does what, in what sequence?                        |

---

## 1. Economics (Layer 1)

All figures internal. Nothing here is ever published (CLAUDE.md pricing rules, ADR 0063).

**What we sell and what it's worth:**

- **Operator retainer:** $5,000/mo + $4,000 stand-up (ADR 0063). Year-one value of one seat: ~$64,000.
- **Consulting engagements:** scoped, $2,500 floor, typically five figures.
- **Paid assessment:** $250, credited toward engagement (first 3 free). The assessment is the single front door (spine §4, decision #3); every funnel converges on it.

**CAC tolerance is the strategic fact.** One Operator seat at ~$64k year-one revenue supports a blended cost-per-closed-deal in the low thousands at under 7% CAC/LTV. We are not Smith.ai chasing cheap CPLs for a $95/mo subscription; we need a small number of qualified conversations. A channel producing two qualified Operator conversations for $1,500 is a good channel. This unlocks channels (LinkedIn, endemic sponsorships) that are uneconomic for the low-ticket advertisers we saw in-feed.

**Category price-frame warning (from channel research).** The "AI receptionist" auction is crowded and cheap: Dialzara from $29/mo, Rosie $49, Goodcall $59, Smith.ai from $95. If Operator ads share those keywords or that framing, buyers anchor to a $400 bot instead of a coordinator hire. The Operator prices against a salary (ADR 0037 Tenet 1); its media plan must never stand in the receptionist aisle.

**Success metric definitions (fixed now so benchmarks mean something):**

- **Lead:** qualified intake submission via `/book`.
- **Booked call:** confirmed assessment slot reserved.
- **Held call:** the call happened. This is the unit we ultimately buy; unmanaged B2B no-show runs up to ~40%, manageable to ~10-20% (funnel research, corroborated).
- **CAC:** computed on closed-won, from the D1 ledger, not from platform dashboards (Layer 8).

## 2. Offer & funnel (Layer 2)

**The ad sells the conversation, not the product.** The site's conversion model is locked: one primary verb, the assessment front door at `/book?interest=<source>` (spine §3). Paid traffic obeys the same law.

**The offer, precisely framed.** Cold ad promises a free, named-outcome diagnostic conversation: the prospect leaves with a clear read on where work is falling through and what we would do about it, whether or not they hire us. Never "free consultation" (reads as a sales ambush; funnel research is unanimous). Never "$250 assessment" in an ad; the paid assessment is sold on the call as the commitment device, not at the click. This matches the dominant converting pattern in the competitor field (free diagnostic call is the funnel entry for every agency-side advertiser) while our version stays honest: "a recommendation, a project, or an Operator."

**Qualification is a feature.** For offers above ~$5k, an application step before the calendar filters tire-kickers and lifts show-rate (funnel research, established pattern: form first, calendar as the reward). Our `/book` intake questionnaire already is this. Paid traffic gets 3-5 qualification fields, then the in-house scheduler.

**Two funnels, one front door:**

| Funnel                     | What the ad argues                                                                                 | Interest tag           | Geo                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| **A. Operator (flagship)** | A new kind of worker fills the gap between your people and your software; managed, governed, yours | `operator` / pack slug | National, vertical-targeted (PI law first) |
| **B. Firm / assessment**   | Objectives-first: we work alongside you to find what needs to change and build the right solution  | `assessment`           | Phoenix metro                              |

**Proof constraint (hard).** No client-facing case studies exist yet. The fabrication policy means we never imply engagements we haven't run. Available credibility levers: recognition-by-vertical (packs), architecture transparency (your accounts, your authority, your memory), Scott's pedigree, owner-does-the-math ROI. Competitor research found proof-led creative is the single biggest unexploited gap in this ad category, which means the moment A&P yields authorized real material, a proof wave becomes our sharpest weapon. Until then, mechanism-led and governance-led creative carries the load, and that is sufficient to launch.

**Risk-reversal decision.** Competitors lean on guarantees (Smith.ai 30-day money-back, Youtiva "results in 90 days or you don't pay", AgentsInstall "if it doesn't pay for itself, you don't pay"). We do not counter with a gimmick guarantee. Our risk reversal is structural and true: the diagnostic itself is the value ("leave with a plan either way"), and the Operator is managed with authored limits. If Captain ever wants a formal pilot-success-criteria guarantee for the Operator, that is a pricing-doctrine change routed through an ADR, not ad copy.

## 3. Audience (Layer 3)

**Funnel A (Operator), national:**

- **Wedge: personal-injury / plaintiff firms.** We know the roles (intake coordinator, case manager), the systems (Smokeball, Clio, Filevine), and the carrying work, from the A&P engagement. Title targeting: managing partner, owner, firm administrator.
- LinkedIn is the only platform with clean "partner/owner at a law firm, US" targeting (channel research).
- Secondary: the 12 pack verticals as creative variants once PI mechanics prove out.
- Geo: national. Metro-limiting a vertical audience starves every channel.

**Funnel B (Firm/assessment), Phoenix:**

- Owner-led businesses, broad metro (~50mi), light filters; stacking metro + B2B + owner-title starves Meta's delivery and spikes CPMs (channel research). Creative and the intake do the qualifying.
- Honest read from the research: at Phase-1 scale, paid is support for the referral/networking motion (Vistage, EO, BNI, accountants), not a replacement. Google Search on local intent carries the intent-capture job.

## 4. Channels & budget (Layer 4)

**Channel roles (from the channel pass, adapted to our economics):**

| Channel           | Role                                        | Why                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LinkedIn**      | Primary for Operator                        | Only clean title/vertical targeting; the one platform showing positive B2B ROAS in 2025 studies; CPL $50-130 (partners $150-250) is fine at our LTV. Practical floor ~$100/day per campaign.                                                                                                                                |
| **Legal-endemic** | Primary-parallel for Operator (non-auction) | Maximum Lawyer + Lawyerist podcasts, ABA TECHSHOW (Mar 2026 passed; next cycle), and above all **Smokeball co-marketing**, since we are already in their ecosystem via the pilot. Incumbents (Clio, Smith.ai×Lawmatics) grow through partnerships and endemic content, not cold social. Rate cards require direct outreach. |
| **Meta (FB/IG)**  | Creative lab + retargeting                  | Volume for creative testing at national vertical scale; weak MQL→SQL (5-10%) means it is never judged on raw leads. Landing pages, not instant forms: lead-form leads look 3x cheaper and convert to appointments at a fraction of the rate ($300/appt vs $106/appt in the researched comparison).                          |
| **Google Search** | Intent capture, both funnels                | Phoenix local-intent terms for Funnel B. For Funnel A, B2B legal-ops terms only (est. $12-25 CPC, must validate in Keyword Planner; consumer-PI terms at $100-400 CPC are a different market we never touch). Avoid the receptionist keyword aisle (price-frame warning).                                                   |
| **YouTube**       | Deferred                                    | Not a cold B2B lead engine; revisit when the explainer cutdowns and a retargeting pool exist.                                                                                                                                                                                                                               |

**Recommended budget (Captain decision #1).** 90-day test window:

- **Recommended: ~$7,500/mo media** for the quarter (~$22.5k media total):
  - LinkedIn (Operator, national PI): $4,000/mo
  - Meta (national PI creative lab + retargeting): $2,000/mo
  - Google Search (Phoenix local intent + validated legal-ops terms): $1,500/mo
  - Endemic: opportunistic, priced on rate-card replies, on top of the above
- **Lean alternative: ~$4,000/mo** (LinkedIn $3k + Phoenix Search $1k, Meta deferred). Slower learning, single-channel risk, but still a real test.
- Frame: one closed Operator seat (~$64k yr-1) pays for the full recommended quarter roughly three times over. The test is priced to be decisively affordable relative to what it proves.

Minimum-signal caveat from the research: below ~$3k/mo/channel, learning phases never complete and results read as noise. Fewer channels funded properly beats all channels starved.

## 5. Message (Layer 5)

**Voice laws applied to ads (non-negotiable, spine §1 + CLAUDE.md):**

- Never disparage people or software. **The Smith.ai format, a mocking "without receptionist vs. with us" table, is forbidden for us verbatim.** Our cost framing is owner-does-the-math: name what the carrying work costs and let the owner conclude.
- No published dollar amounts, ours or implied (ADR 0063).
- No fixed timeframes in marketing (no "2-week POC" claims à la Binary Studio).
- No claimed pre-knowledge of the prospect's business; no fabricated specificity; no invented client results.
- No em dashes; human-written voice; no AI gloss.
- "Managed" is load-bearing. The guide, not a vending machine.

**The white space (competitor pass synthesis).** The observed field splits into cheap receptionist SaaS (cost-vs-hire tables, guarantees, self-serve trials) and free-audit custom agencies (owner-bottleneck copy, Clutch badges, hype). Nobody runs: proof-led storytelling, governance/human-accountability, objectives-first collaboration, or honest "owned, not rented." Three of those four are already our doctrine. We are not inventing a differentiated message for ads; the ads inherit one.

**Angle stack (each becomes a creative concept; ordered by strategic confidence):**

1. **The gap** (category angle, ours alone): symptom-hooked per spine §2. "The follow-up nobody sent. The handoff that stalled. That work falls into the gap between your people and your software. The Operator is a new kind of worker that fills it."
2. **Governed / managed** (the field's blind spot): every competitor sells autonomy and speed; nobody sells the human who stays accountable. "You set the limits. We run it. Someone answers for the line." Especially potent for law firms, where trust is the buying criterion.
3. **Vertical recognition** (PI first): name the carrying work: the intake follow-up, the lien-letter chase, the treatment-gap nudge, the referral update. Packs give us 12 of these. Generalized marketing, never client-contracted promises (spine §4 decision #2).
4. **Competes with a hire, respectfully** (ADR 0037 Tenet 1): "Before you hire the coordinator role, see what an Operator carries." Salary math stated as the owner's own arithmetic, never as a sneer at employees.
5. **Solution-first honesty** (Funnel B lead): "We specialize in AI and will tell you when it isn't the answer." Nobody advertising in this space gives anything up; this angle is credible precisely because it does.

Copy framework for long-form (LinkedIn single-image + primary text, LP hero): PAS with specific named symptoms; PPPP once proof assets exist (funnel research: front-load proof for higher-price offers).

## 6. Creative (Layer 6)

**Formats (funnel research, 2025-26 Meta/LinkedIn):**

- **Founder talking-head video is the highest-fit format** for professional-services authority: 7-15s hooks, 15-30s standard, vertical, native captions (sound-off default). Scott on camera, sign-shop backdrop, plain speech. Scripts are edited Captain voice, not generated copy (voice-sourcing rule).
- **Pattern-naming statics** in the sign-shop system (cream/ink, burnt orange, Archivo Black): one named symptom, one line of resolution, one CTA. These double for LinkedIn sponsored content.
- Screen-adjacent "how it actually works" clips (mechanism demos) once we can record real Operator surfaces without exposing client data; never staged fake UI.
- Explainer motion-piece cutdowns (15/30/60s) join the pool when rendered.

**The visual contrarian bet.** The observed field is uniformly dark, glossy, AI-rendered 3D (orange-glow isometric machines, neon charts). Our system is the visual opposite. In-feed, looking like the only human-made ad in a wall of AI gloss is the differentiation, and it is also simply our existing brand ("win on clarity, substance, credibility, never graphics").

**Volume for a low-volume advertiser (research adaptation):** 4-5 concurrent variants per campaign, refreshed on a calendar (every 2-4 weeks) rather than on fatigue signals we won't have the volume to detect. Creative diversity is the targeting mechanism under Advantage+/Andromeda; we test angles, not micro-audiences.

## 7. Landing surfaces (Layer 7)

Current state (repo recon 2026-07-05): `/book` canonical intake + in-house scheduler (`src/lib/booking/config.ts`, `src/pages/api/booking/*`), accepts `?interest=`; `/operator` and 12 `/packs/*` pages built for warm arrivals; CTA instrumentation via `data-ev`; first-party `page_view`/`cta_click` events into D1 (`src/pages/api/events.ts`) with an admin dashboard; GA4 component present but unconfigured in prod (effectively off).

**Build list:**

1. **Dedicated paid landing pages** (`/lp/*`, noindex, nav-stripped): research is unanimous that removing nav lifts conversion 20-100%, and ~80% read only the headline. Structure per funnel: outcome headline, transformation subhead, credibility block (architecture transparency + pedigree until proof exists), mechanism-as-narrative, price pre-empt in FAQ form, single repeated CTA into the `/book` flow with interest + attribution preserved. This respects the locked single-front-door model: the LP is a pre-frame, not a second door.
2. **`/book` qualification pass for paid traffic:** confirm the intake asks 3-5 qualifying questions before the calendar (form first, calendar as reward), captures a mobile number for reminders, and offers slots within 5 business days (show-rate research: booking beyond 10 days out craters attendance).
3. **Reminder sequence:** confirmation email exists (`api/booking/confirmation-emails.ts`); add 24h and 2-3h reminders. SMS is the researched big lever (~35% no-show reduction) and is a scoped build item (needs a provider decision); email-only is the day-1 floor.
4. **Mobile-first audit of the paid path** (IG/LinkedIn clicks are ~all mobile): thumb-reach CTA, single column, minimal typing.

## 8. Measurement (Layer 8)

Platform reality (channel + funnel passes): Meta retired 7-day-view/28-day windows in Jan 2026; 40-60% of its reported conversions are modeled; Safari expires client-side storage at 7 days. Conclusion: **our D1 is the source of truth; platforms get fed events, they do not keep score.**

**Build list (all on the existing Workers stack, in order):**

1. **Attribution capture:** persist `utm_*`, `fbclid`, `gclid` at first touch (first-party cookie + server-side), carry first-click and last-click through intake and booking into the lead record. Today `src/pages/api/intake.ts` hardcodes `source: 'website_intake'`; that field becomes structured attribution.
2. **Meta Pixel + Conversions API, native Worker implementation:** we are a Workers shop; CAPI is a documented HTTP API. Fire server-side events from our own endpoints with shared `event_id` dedup against the browser pixel. No Stape/Zaraz dependency unless native EMQ proves inadequate (fallback documented: Stape ~$10/mo).
3. **Conversion events at the truth points:** `Lead` on qualified intake submission (the optimization event; high-ticket volume is too sparse to optimize on bookings), `Schedule` server-side in the booking reserve handler, offline upgrades for held-call and closed-won pushed from the admin console. Optimizing toward held calls is the entire game at our volume.
4. **Google side (when Search turns on):** Ads tag + Enhanced Conversions for Leads (hashed email as second match key), offline uploads built on the **Data Manager API** (the June 2026 migration made the old path a dead end).
5. **Admin attribution view:** lead → source/campaign → booked → held → proposal → closed-won in the existing admin analytics surface. CAC per channel computed here, nowhere else.
6. **Analytics stance:** extend the existing first-party D1 events with UTM dimensions. GA4 stays off; no third-party analytics added. Our traffic volume makes GA4 overkill and our first-party pipeline already exists.

**Nothing spends until 1-3 and 5 are live and verified with test events end-to-end** (week 0-1 of the test window). Skipping this is the researched #1 false-negative trap: real bookings report as "Direct" and good campaigns get killed.

## 9. Test design (Layer 9)

**Window:** 90 days from first spend. Pre-committed shape:

- **Weeks 0-1:** instrumentation live + verified (Layer 8 items 1-3, 5). Zero media.
- **Weeks 1-4:** creative-led broad test. 4-5 variants per funnel from the Layer 5 angle stack. Optimize on the qualified-intake `Lead` event. Kill criteria set on spend + upper-funnel CPL only.
- **Weeks 5-8:** promote winning angles, add hook variants, start feeding booked/held offline events to the platforms if volume permits.
- **Weeks 9-12:** shift to ~70/20/10 (proven/scaling/experimental), layer retargeting, judge on cost-per-held-call and show-rate now that n has accumulated.

**Statistical floors (research):** Meta ad sets want ~50 optimization events/week to exit learning, which is why we optimize upstream. No creative judged before ~1,000 impressions. No channel judged before ~10-15 held calls or its full 90-day budget, whichever first.

**Kill criteria (pre-committed, honored without affection):** per-channel "if qualified-intake CPL exceeds $X after $Y spend, pause" thresholds set on day 0 from the first two weeks' observed baseline (the research priors are too vendor-soft to hard-code here). A channel that produces zero held calls on its full test budget is dead regardless of CPL.

**False-negative traps we explicitly guard against:** judging on sparse booking counts (use the proxy event), killing during learning, blaming creative for delivery volatility at low spend, and attribution leakage (instrumentation-first prevents it).

## 10. Operations & execution sequence (Layer 10)

| #   | Workstream            | What                                                                                                               | Owner                                            | Depends on                                                             |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------- |
| WS1 | Tracking foundation   | Layer 8 items 1-3, 5 (attribution capture, native CAPI, conversion events, admin attribution view)                 | Agent (this repo, PRs)                           | Nothing. No-regrets: attribution is valuable even for referral traffic |
| WS2 | Landing surfaces      | `/lp/*` pages, `/book` qualification pass, reminder sequence                                                       | Agent (PRs)                                      | Layer 5 copy approval                                                  |
| WS3 | Creative production   | Static system in sign-shop brand; founder video scripts (Captain voice) + recording session; motion cutdowns later | Agent drafts, Captain voice/face                 | Angle stack approval                                                   |
| WS4 | Accounts & billing    | Meta Business Manager + domain verification, LinkedIn Campaign Manager, Google Ads, payment methods                | Captain (credentials + billing are Captain-only) | Budget approval                                                        |
| WS5 | Endemic & partnership | Smokeball co-marketing conversation; Maximum Lawyer / Lawyerist rate cards                                         | Captain-approved outreach                        | Captain go                                                             |
| WS6 | Launch + cadence      | Campaign build, weekly readout against Layer 9 gates                                                               | Agent builds, Captain approves spend changes     | WS1-4                                                                  |

Sequence: WS1 starts immediately (issues filed with this PR). WS2-3 build in parallel once Captain approves the Layer 5 angle stack. WS4-5 are Captain actions. Launch gate: Layer 8 verified end-to-end.

---

## Open Captain decisions

1. **Budget:** recommended ~$7,500/mo × 90 days (LinkedIn $4k / Meta $2k / Search $1.5k) vs lean $4,000/mo sequenced. See Layer 4 math.
2. **Operator ads before A&P proof:** recommendation is launch now on mechanism/governance/recognition angles (no proof claims), add the proof wave when A&P authorizes real material. Alternative: hold Funnel A until proof exists and run only Funnel B, at the cost of a quarter of learning in the vertical that matters most.
3. **Founder on camera:** the creative plan's highest-conviction format needs Scott's face, voice, and a recording session. Confirm willingness; otherwise statics + motion cutdowns carry launch.
4. **Accounts + billing (WS4):** Captain-only setup.
5. **Endemic outreach (WS5):** greenlight the Smokeball co-marketing conversation and podcast rate-card requests.
6. **SMS reminders:** provider selection (adds a vendor + phone compliance surface) vs email-only at launch.
