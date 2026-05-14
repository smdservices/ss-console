# AI Employee Service Name — 2026-05-13

**Issue:** [#774](https://github.com/venturecrane/ss-console/issues/774)
**Authorizes:** Naming convention + Phase 1 vertical-pack name + trademark clearance path
**Inputs:** [Service contract terms](./ai-employee-service-contract-2026-05-13.md), [functional shape research](./ai-employee-functional-shape-2026-05-13.md), [ADR 0004](../adr/0004-productized-ai-employee-offering.md), expert-agent naming research

---

## Adopted

**Naming convention:** **per-vertical role-named persona inside SMD as parent firm-brand.** SMD is the firm; Scott is the founder; the agent is the staff. Same structural template as a law firm with associates or a staffing firm placing named professionals. Future vertical packs each get their own persona name (e.g., one name for insurance CSR, one for legal paralegal, one for real estate transaction coordinator).

**Phase 1 marketing-agencies pack name:** **Larkin** (backup: Calder, if Larkin doesn't clear paid trademark search).

**Public framing:** "SMD builds **Larkin** for marketing agencies — an AI account manager who learns your agency and acts on your behalf for $5K/mo."

Substantive research below.

---

## Market pattern findings

The AI-agent-as-product category has matured enough to read three clear naming patterns:

**Pattern A — Single firm-wide abstract brand.** [Decagon](https://decagon.ai), [Sierra](https://sierra.ai), [Harvey](https://harvey.ai), [Lindy](https://www.lindy.ai). One name covers the whole product regardless of role. Works when paired with sharp positioning ("the AI platform for legal teams"). Compounds brand, trademark, domain, SEO into one mark. Trade-off: the name doesn't tell a buyer what it does — only sharp positioning + heavy marketing fills the gap.

**Pattern B — Persona name as product.** [Fin](https://fin.ai) (Intercom), Alice and Jordan (11x.ai), [Pharmie](https://www.ycombinator.com/companies/playgent), [Eve](https://www.eve.legal). The product IS the person. Intercom literally [renamed the company to Fin](https://www.cxtoday.com/contact-center/intercom-rebrands-to-fin/) when the AI agent became the core business. Short, human-sounding, often gender-balanced or coined. Reads drop-in-coworker. Trade-off: one persona forces one role; cross-vertical expansion needs portfolio expansion or rebranding.

**Pattern C — Per-role / per-vertical persona inside a firm-wide brand.** 11x ships Alice (SDR) + Jordan (phone agent) under the 11x parent. [Sage AI](https://blog.insightfulaccountant.com/sage-annouces-finance-intelligence-agent-as-newest-ai-agent) ships "Finance Intelligence Agent" inside the Sage brand. Lets the firm scale roles without rebranding. Trade-off: double-brand management (customers learn both firm + role names).

**Gender pattern (caveat, not a rule).** [Park Rangers Capital research](https://prc.beehiiv.com/p/the-hidden-gender-rules-of-ai-agents) found that AI agents performing specialized knowledge work tend to receive male names (Harvey, Jordan); agents handling coordination, support, and "invisible labor" overwhelmingly receive female names (Alice, Sierra, Fin-as-feminine, Eve). Not a rule to follow — a bias to be aware of, especially given SMD's SMB-owner buyer base who may carry that bias unconsciously.

**What works in 2026:** short names (1-2 syllables), human-sounding without being on-the-nose ("Alice" works; "Sally the Sales Agent" doesn't), reads drop-in-coworker rather than tool, survives being said aloud in a customer-success call.

**What to avoid:** `-AI`, `-bot`, `-assistant`, `-GPT` suffixes (age out fast, signal tool-not-coworker); overpromise names ("Genius," "Maven"); corporate-AI register ("Cortex," "Synthesis"); names needing a glossary (Decagon works only because Sequoia funded it into recognition — bootstrap brands don't get that runway).

---

## Why Pattern C for SMD

1. **CLAUDE.md is unambiguous.** "AI Employee is the knife; SMD is the chef." SMD is the firm. The AI is the staff. A practitioner firm with named staff per role matches that exactly. Pattern A (single product brand) would compete with SMD itself and pull the firm toward "AI-powered firm" branding — which Captain has explicitly ruled out. Pattern B kills marketing leverage: every case study has to re-explain who the agent is and the firm never accumulates brand equity in the agent name.

2. **The vertical-pack architecture in [ADR 0004](../adr/0004-productized-ai-employee-offering.md) maps cleanly to per-vertical names.** Phase 1 is marketing agencies. Subsequent packs follow as customers arrive (insurance, non-litigation law, real estate, manufacturing, anywhere else). Each pack is a different role with a different persona name. Same template every time.

3. **It future-proofs against the persona-monolith trap.** Fin can't ship a second product without confusing customers. 11x escaped by being multi-persona from day one. Pattern C gives SMD the same multi-persona freedom from launch.

4. **It contains trademark risk.** Pattern A means one trademark battle covers the entire product. Pattern C reduces the surface area of any single trademark battle to one vertical pack at a time. If a future vertical-pack name doesn't clear, the rest of the product is unaffected.

---

## Candidates evaluated for Phase 1 (marketing-agencies AM persona)

Twelve names brainstormed; eight evaluated against trademark. Selection criteria: 1-2 syllables, plainspoken, fits practitioner-firm voice, reads junior-to-mid account manager at a small agency, gender-balanced where possible.

| Candidate   | Voice fit                                                                                                             | Trademark posture (public research, not legal opinion)                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Larkin**  | Two-syllable, soft-hard. Reads young-but-competent. Gender-balanced. No tech register.                                | **Clear.** No direct AI-product collisions surfaced. LARKIN registrations in distant classes (heating, etc.).                                             |
| **Calder**  | Two-syllable, named-feel (Alexander Calder). Reads creative-but-grown-up. Mostly male-coded but workable as balanced. | **Clear.** Mostly clean of AI products. Calder Foundation and others in distant classes.                                                                  |
| **Hollis**  | Two-syllable. East-coast-WASP-junior-AM register. Gender-balanced.                                                    | **Clear.** Holistic AI exists but different mark. Some founder/exec uses, no direct AI-product collisions.                                                |
| **Hayden**  | Two-syllable. Young creative AM register. Slightly more male-coded.                                                   | **Yellow flag.** Hayden AI (traffic enforcement tech) is registered in class 042/009. Different vertical, but literal mark match.                         |
| **Marlowe** | Two-syllable, literary register (Christopher Marlowe, Philip Marlowe). Gender-balanced.                               | **Yellow flag.** Authors.AI's Marlowe (book-analysis AI) is in class 042 since 2020. Different end-market, but same broad class.                          |
| **Briggs**  | One-syllable, crisp. Senior-AM register. Slightly more male-coded.                                                    | **Yellow flag.** Briggsapp.com (Briggs AI — meeting summarization) is small but in adjacent software space.                                               |
| **Sloane**  | One-syllable, sharp. Fashion-adjacent female-coded AM.                                                                | **Red flag, eliminated.** [sosloane.com](https://www.sosloane.com) is an active AI implementation firm for consumer brands — direct competitor collision. |
| **Piper**   | Two-syllable, friendly, slightly feminine-coded.                                                                      | **Red flag, eliminated.** Piper.ai exists; Salesforce Piper is an AI sales agent persona. Multiple collisions.                                            |
| **Mercer**  | Two-syllable, British-consultant register.                                                                            | **Red flag, eliminated.** Mercer Consulting is a $20B firm — trademark battle in business-services classes is unwinnable.                                 |
| **Wynn**    | One-syllable, sharp. Gender-balanced.                                                                                 | **Red flag, eliminated.** Wynn Resorts is a $10B brand. Yellow flag in services classes.                                                                  |
| Rooney      | Two-syllable, warm, irish-coded. Might be too soft for "competent professional" frame.                                | Mostly clear; deprioritized for voice fit.                                                                                                                |
| Holt        | One-syllable, firm, slightly senior-AM. Slightly more male-coded.                                                     | Mostly clear of AI products; deprioritized for voice fit (reads slightly older than the target persona).                                                  |
| Tobin       | Two-syllable, irish-coded, plainspoken.                                                                               | No major AI product collisions; deprioritized for voice fit.                                                                                              |
| Reeve       | One-syllable, old-school. Gender-balanced.                                                                            | Reeve Foundation distant class; deprioritized for voice fit.                                                                                              |
| Ansel       | Two-syllable, creative-leaning. Gender-balanced.                                                                      | Mostly clear; deprioritized for voice fit (slightly too creative-coded).                                                                                  |

**Top three taken to domain check: Larkin, Calder, Hollis.**

---

## Trademark clearance posture

The public-research findings above are not a registrability opinion. Each candidate needs a paid clearance search by trademark counsel (~$1.5K-3K) before final commit and any USPTO filing. The yellow-flag candidates (Hayden, Marlowe, Briggs) all have surfaced AI-product collisions and should not be taken to commit without explicit counsel signoff.

**Path forward on Larkin (recommended):**

1. Register defensive domain cluster immediately (cost <$100 total):
   - `hirelarkin.com` (primary — reads exactly like the "hire your AI employee" framing)
   - `trylarkin.com`
   - `getlarkin.com`
   - `workwithlarkin.com`
   - `larkin.services`
2. Engage trademark counsel for paid clearance in:
   - Class 042 (computer software / AI software services)
   - Class 035 (business services / advertising / consulting)
3. If clearance comes back clean: file intent-to-use application (Section 1(b)) in both classes ($350/class). Goods/services identification: "AI software providing account management services for marketing agencies" (042) and "business consulting services using AI agents" (035). Convert to use-based once the first paying customer signs.
4. If clearance comes back yellow: fall back to **Calder** as Phase 1 name and repeat steps 1-3.

---

## Domain situation

None of the top three has a clean exact-match `.com` available without aftermarket purchase. This is expected for any 5-6 letter dictionary-adjacent `.com` registered since the 1990s.

| Candidate  | `[name].com`                                     | `[name].ai`                             | Best available pattern          |
| ---------- | ------------------------------------------------ | --------------------------------------- | ------------------------------- |
| **Larkin** | Registered since 1995 (IONOS — aftermarket-only) | Registered, returns 405 (parked/unused) | `hirelarkin.com` unregistered ✓ |
| **Calder** | Registered since 1996 (aftermarket-only)         | Registered (parked)                     | `hirecalder.com` unregistered ✓ |
| **Hollis** | Registered (owned, redirects)                    | Registered (403 / parked)               | `hirehollis.com` unregistered ✓ |

The **`hire[name].com` pattern reads exactly right** for SMD's positioning ("Hire Larkin for your agency"). All three primary candidates have this variant unregistered today; standard $12-20/year registration.

**`larkin.ai` is parked.** Possible to acquire via broker outreach in the $1K-10K range if seriously wanted. Defer until Phase 1 has customer traction; the `.com` plus the SMD brand carry the marketing weight at launch.

---

## Future vertical pack names (to be revisited as packs ship)

The Pattern C structural template generates one persona name per vertical pack. These are not committed today; they're shape-of-thing-to-come notes for sequencing reference. Names below are _suggestive_, not adopted — each needs its own research pass when the corresponding vertical pack is built.

| Vertical                                                        | Role being modeled                     | Suggestive shape                                                                        |
| --------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| Marketing agencies                                              | Account manager                        | **Larkin** (adopted)                                                                    |
| Insurance agencies                                              | CSR / account manager                  | Two-syllable, professional, organized register (suggestive: Calder, Reeve, Ainsley)     |
| Non-litigation law (estate, business, real estate transactions) | Paralegal                              | Two-syllable, slightly more traditional (suggestive: Hollis, Branwell, Wren)            |
| Real estate                                                     | Transaction coordinator + lead nurture | Two-syllable, organized-and-friendly (suggestive: Quinn, Avery, Sutton)                 |
| Manufacturers / wholesalers                                     | Inside sales / customer service        | One- or two-syllable, professional (suggestive: Holt, Briggs (pending clearance), Sage) |
| Other verticals                                                 | Per-customer fit                       | Selected per engagement                                                                 |

Each pack ships with its own paid trademark clearance. Total annual trademark-clearance budget at full vertical-pack rollout: ~$10K-15K for legal + USPTO filing fees across 5-6 vertical packs over 18-24 months. Tracked in operating cost; not allocated to a specific customer.

---

## Brand framing for downstream copy

When [#775 copy/surfaces](https://github.com/venturecrane/ss-console/issues/775) drafts landing pages and intake flows, the brand framing is:

**Firm-level frame** (smd.services home, About, firm-level surfaces): SMD Services, solutions consulting, practitioner-firm voice. AI Employee is one named offering within the firm; not the firm identity.

**Product-level frame** (Larkin landing page, vertical-specific surfaces): "SMD builds Larkin for marketing agencies. An AI account manager who learns your agency and acts on your behalf — for $5K/mo." The product is Larkin; the firm is SMD; the buyer is the agency owner.

**SOW / customer-facing contract artifacts**: "SMD Services hereby provides Customer with the Larkin AI Account Manager service..." Trademark notice in footer (™ for intent-to-use phase; ® after registration).

**No "Larkin AI" branding.** The trailing-AI suffix is exactly the register Pattern B/C is designed to avoid. The product is Larkin. The technology underneath is incidental to the buyer.

---

## Status

Naming convention + Phase 1 name adopted as documented. Closes #774. Unblocks #775 (copy/surfaces — uses "Larkin" framing in landing pages and SOW template) and informs #776 (stack build — the agent's identity surfaces in greetings, email signatures, etc.).

Pending: paid trademark clearance on Larkin before any external use of the name. Operating budget allocation: $2-3K. Captain to authorize trademark counsel engagement when ready to commit (this is a real-money external spend — Captain judgment call, not analytical conclusion).

---

## Sources

- [The Hidden Gender Rules of AI Agents — Park Rangers Capital](https://prc.beehiiv.com/p/the-hidden-gender-rules-of-ai-agents)
- [Intercom Rebrands to Fin as AI Agent Becomes the Core Business — CX Today](https://www.cxtoday.com/contact-center/intercom-rebrands-to-fin/)
- [Eve Legal](https://www.eve.legal)
- [Harvey AI platform overview](https://www.harvey.ai/platform)
- [Pharmie AI — Y Combinator](https://www.ycombinator.com/companies/playgent)
- [What are Vertical AI Agents? — Lindy](https://www.lindy.ai/blog/vertical-ai-agents)
- [Trademark Class 42: Computer and Scientific Services — Nolo](https://www.nolo.com/legal-encyclopedia/trademark-class-42-science-technology-services.html)
- [AI Agent Trademark: Racing To Protect Bot Names In 2025 — Tech & Media Law](https://techandmedialaw.com/ai-agent-trademark/)
- [USPTO Trademark Search](https://tmsearch.uspto.gov/)
- [Sloane AI Implementation Partner](https://www.sosloane.com/ai-implementation-partner)
- [Authors.AI — Marlowe](https://authors.ai/marlowe/)
- [Coworker AI](https://coworker.ai/)
- [Functional shape research](./ai-employee-functional-shape-2026-05-13.md) — per-vertical role mapping
- [ADR 0004](../adr/0004-productized-ai-employee-offering.md) — vertical pack architecture
