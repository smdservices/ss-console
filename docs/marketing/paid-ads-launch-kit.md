# Paid Ads Launch Kit — Round One (ADR 0066)

_Status: DRAFT pending Captain approval of the ad copy blocks (§2) and LP specs (§3). Everything here derives from locked sources: [ADR 0066](../adr/0066-paid-acquisition-round-one.md) (posture, budget, copy rules, gates), the [positioning spine](positioning-spine.md) (voice laws, narrative nesting), the law-firm pack page (`src/pages/packs/law-firm.astro`, the vetted copy source), and the research dossier (`docs/research/paid-ads/`)._

_Maintenance: this is the working kit for round one. When a gate's status changes, update §5 in the same PR that changes it._

---

## 1. Round-one shape (fixed by ADR 0066)

- **Vertical:** law-firm operations. **Geography:** US national (Operator), per the two-geography rule.
- **Channels:** Meta (message validation, ~$2,200/mo, one campaign / one consolidated ad set / 4 creatives, optimize to `Lead`), Google Search (demand harvest, ~$800/mo, Search-only, no PMax). Retargeting audiences accumulate from day one.
- **Funnel:** ad → angle-matched LP (no nav) → `/book?interest=law-firm`. Never the home page.
- **Measurement:** north star = cost per booked assessment. Angles judged on CTR + cost-per-lead as leading indicators, cost-per-booked as verdict. Kill/scale rules in §6.
- **UTM convention:** `utm_source=facebook|google`, `utm_medium=paid-social|cpc`, `utm_campaign=law-ops-r1`, `utm_content=<angle key below>`. `utm_content` is the join key from ad to angle everywhere downstream (D1 lead records carry it via the ss_attr cookie).

## 2. The four angles (Meta creatives)

Copy rules in force (ADR 0066 §3): salary-anchored allowed, **no dollar figures**, **no people-vs-AI comparison table**, **no employment framing** ("instead of hiring", "don't hire", "replace your X"). Spine voice laws apply verbatim: never disparage people or software; "managed" is load-bearing; no em dashes; we-voice. Every capability claim below traces to the law pack page or the Operator page; nothing is newly invented.

### Angle A — `angle-salary` (salary-anchored cost/outcome)

- **Headline:** A full caseload of follow-through. A fraction of the cost of a hire.
- **Primary text:** The Operator is a worker you hire, not software you buy. It carries your matters inside the systems your firm already runs: the response deadlines, the documents, the follow-ups, the chase. We build it around how you run and we run it for you, for a fraction of what the equivalent seat would cost. Every piece of work goes to an attorney to review.
- **Description:** The coordinator workload, handled. Start with a conversation.
- **CTA button:** Learn more → LP-A
- **Visual:** editorial typography on brand palette; the "caseload carried" motif (a stack of matter cards settling into order). No people-vs-AI split, no dollar figures, no AI-glow.

### Angle B — `angle-firm` (the human+AI firm; the field's whitespace)

- **Headline:** A new kind of worker. A real firm behind it.
- **Primary text:** Every AI ad you see is faceless. This one is not. We are a Phoenix-based firm that builds the Operator around how your practice runs, and then runs it for you as the field keeps moving. You set the limits. It works inside your case management system, and every piece of work goes to an attorney to review.
- **Description:** Built around your firm. Run by ours.
- **CTA button:** Learn more → LP-B
- **Visual:** a real photograph of Scott (practitioner-firm positioning, About-page pedigree). This is the one angle where the founder's face is the creative. No AI-generated imagery.

### Angle C — `angle-lawops` (law-firm operations lifecycle; uncontested lane)

- **Headline:** The Matter, Carried End To End.
- **Primary text:** Discovery is served. The Operator spots it in the matter, calendars the response dates for attorney confirmation, stages the documents your drafting tool draws from, tracks the client verification, and reads the other side's responses for the closer look. One short summary of what needs you. It never sends to another party and never signs on its own.
- **Description:** Not phone intake. The operational life of the matter itself.
- **CTA button:** Learn more → LP-C (hero identical to the pack hero: perfect message match)
- **Visual:** product-proof lifecycle trace (the pack's Operator-does / your-part / if-it-stalls three-line shape rendered as a clean step diagram). Our version of the Binary Studio pipeline-trace format, with real product truth.

### Angle D — `angle-gap` (symptom to gap; the spine's canonical nesting)

- **Headline:** The follow-up nobody sent. The signature still outstanding.
- **Primary text:** The matter that went quiet is not a people failure, and it is not a software failure. Your people are good and your systems are good. The work falls into the gap between them, the step that is everyone's job and no one's. The Operator is a new kind of worker that fills that gap, managed by us, inside the tools you already run.
- **Description:** Name the gap. Fill it.
- **CTA button:** Learn more → LP-D
- **Visual:** typographic; the two named symptoms large, the resolution line beneath. No gap visual motif (killed twice by Captain decision; typography only).

### Compliance checklist (every creative, before upload)

| Check                                                                                      | Rule source                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| No dollar figures anywhere                                                                 | ADR 0066 §3 / spine                      |
| No people-vs-AI comparison table or Without/With panel                                     | ADR 0066 §3 / spine voice law            |
| No "instead of hiring" / "don't hire" / "replace your X"                                   | ADR 0066 §3 + Meta employment classifier |
| No em dashes in ad copy or LP copy                                                         | spine / forbidden-strings                |
| No fixed timeframes, no published prices                                                   | CLAUDE.md tone standard                  |
| Capability claims traceable to pack/operator page                                          | no-fabrication policy (P0)               |
| Attorney-review / never-sends-to-another-party honesty present where capability is claimed | law pack fail-closed honesty             |
| AI-generated imagery: none in round one; if ever used, Meta AI disclosure on upload        | ADR 0066 gate 6                          |

## 3. Landing pages (#1726 spec)

Four pages on the pack kit, no nav, single repeated CTA:

| LP   | Path             | Hero (mirrors the ad headline)         | Body                                                         |
| ---- | ---------------- | -------------------------------------- | ------------------------------------------------------------ |
| LP-A | `/lp/law/salary` | Angle A headline + lede                | Pack sections 02 (problem) + 03 (what it does) + closing CTA |
| LP-B | `/lp/law/firm`   | Angle B headline + lede                | About-derived firm beat + pack 03 + closing CTA              |
| LP-C | `/lp/law/matter` | Pack hero verbatim                     | The pack lifecycle walk (04) + closing CTA                   |
| LP-D | `/lp/law/gap`    | Angle D headline + gap resolution beat | Spine nesting beats 2-4 + pack 03 + closing CTA              |

- CTA on all four: "Start the conversation" → `/book?interest=law-firm` (ss_attr cookie carries the utm/angle; interest carries the vertical).
- Pages are `prerender = false`, excluded from the sitemap, `noindex` (campaign surfaces, not SEO surfaces).
- Copy must pass the §2 compliance checklist; heroes must match their ad exactly (message-match is the single biggest conversion lever per the dossier).
- Build follows Captain approval of this kit in a code PR (the pack kit components make this mostly composition).

## 4. Google Search campaign (demand harvest)

- **Structure:** one Search-only campaign, 2 ad groups. No Performance Max, no Display Expansion, no Search Partners.
- **Ad group 1 — legal ops support (national):** seed terms shaped like the work, not intake: `paralegal support services`, `litigation support services for law firms`, `law firm case management help`, `legal assistant service for law firm`, `law firm back office support`. Landing: LP-C.
- **Ad group 2 — Phoenix consulting (local, small):** `operations consultant phoenix`, `business process consultant phoenix`, `small business operations help phoenix`. Landing: home or /consulting equivalent per two-geography rule; CTA `/book?interest=consulting`.
- **Deliberate non-targets:** "ai receptionist" / "answering service" terms reach intake buyers we do not serve (the whole legal AI ad lane is intake; our lane is operations). "managed operator" has no volume; do not buy the category name.
- **Negatives (starter):** `jobs`, `job`, `salary`, `hiring`, `career`, `school`, `course`, `certification`, `free`, `software`, `download`, `template`, `diy`.
- **Pre-spend validation (account-side):** run the seed list through Keyword Planner for actual volume/CPC (the dossier's open data gap) before setting bids; expect legal-adjacent CPCs and be willing to prune.
- **Conversion:** import GA4 `book_confirmed` (or gtag conversion) once the account link exists; judge on cost-per-booked, not clicks.

## 5. Launch runbook — the seven gates (ADR 0066 §7)

No spend until every row is checked. Status as of 2026-07-05:

| #   | Gate                                  | Status                                                                                                                                                                                      |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Attribution capture end-to-end        | DONE. #1728 merged; live-verified on prod (vfy_01KWSVG54AW8GARV307C6FA8RW)                                                                                                                  |
| 2   | Meta Pixel + CAPI with event_id dedup | CODE DONE (#1729, fail-closed verified, vfy_01KWSX217NCS636MQ2AW037ZRW). OPEN: Events Manager test-event verification after gate 5 (issue #1723 holds it)                                   |
| 3   | GA4 conversion events                 | CODE DONE (#1730: `lead`, `book_confirmed`). OPEN: mark both as key events in the GA4 UI after property migration                                                                           |
| 4   | Consent hygiene                       | PR #1731 (privacy policy + Your Privacy Choices + GPC). **Sequencing: must be deployed before `PUBLIC_META_PIXEL_ID` is ever set**                                                          |
| 5   | SMD-owned accounts                    | CAPTAIN: Meta Business Manager + ad account + pixel/dataset; domain verification; Google Ads account; migrate GA4 property out of the Venture Crane account; payment methods (Captain-only) |
| 6   | AI-imagery disclosure                 | Round-one posture: no AI-generated imagery (§2 visuals are typography, product-truth diagrams, and a real photo). If that changes, disclose per creative on upload                          |
| 7   | Live-route verification               | After LP deploy: every ad-target path returns 200 on prod and is absent from the middleware retired-path 301 list. Record a crane_verify                                                    |

**Secrets wiring when gate 5 lands (agent-side, one PR + one command):**

1. `PUBLIC_META_PIXEL_ID` → `.env.production` (committed, public by nature) via PR
2. `META_CAPI_ACCESS_TOKEN` (+ optional `META_CAPI_TEST_EVENT_CODE`) → Infisical `/ss` prod → `npx wrangler secret` (never echoed; use the pbpaste flow)
3. Events Manager Test Events: submit a synthetic lead + booking with the test code; confirm `Lead` + `Schedule` arrive from both pixel and CAPI and dedupe on event_id; record crane_verify on #1723 and close it

## 6. Weekly readout + kill/scale rules (ADR 0066 §6)

One row per angle, every week:

| Angle | Spend | Impr | CTR | CPC | Leads | CPL | Booked | Cost/Booked | Held |
| ----- | ----- | ---- | --- | --- | ----- | --- | ------ | ----------- | ---- |

Rules (spend-gated, not day-gated):

- An angle gets roughly 3 to 5 times the target CPL in spend before judgment.
- Kill: weak CTR AND CPL at 2x+ target.
- Healthy CTR with near-zero LP conversion: fix the LP, not the angle.
- Scale winners gradually (20 to 30 percent steps); judge on cost-per-booked and held rate, never raw CPL.
- Once volume exists, feed `assessment_held` / `became_client` back to Meta from D1 (offline conversions) to optimize toward quality. This is the round-two quality lever.

## 7. Open items

- Manual Meta Ad Library pass (Captain's Chrome) to capture competitor creative longevity and impression buckets; sharpens §2 visuals before upload. Dossier flagged this as the one unverifiable research gap.
- Keyword Planner validation of §4 seed terms (needs the Google Ads account).
- LP build PR after Captain approves §§2-3.
