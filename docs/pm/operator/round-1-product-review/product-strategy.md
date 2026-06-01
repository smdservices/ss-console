# Product Strategy Perspective — Round 1

**Author:** product-strategy (PM lens)
**Date:** 2026-05-20
**Scope:** Platform PRD, law-firm PRD, 13 specs (PR #831), 5 ADRs (PR #832), customer-zero substrate (PR #812), ADR 0004.

---

## Stance on existing material

**REFINE with two non-negotiable scope cuts.** Architecture is sound — two-layer split, reviewer-as-sender, customer-editable memory, Captain ≤2hrs/wk are decisions a thoughtful team would lock. Round 1 already identified the right Phase-1 implementation gaps (OAuth, `customer.yaml`, multi-user roles, capability contracts, COGS); those ship. The problem is the gap between v1 the PRD §0 _commits to in text_ and v1 the corpus _actually builds_: ~2,300 lines of PRDs, 13 specs, 9 ADRs, 296 substrate files, 200 fixtures **before any paying customer exists**, with ADR 0004 positioning AI Employee as a _second_ front door alongside a consulting funnel that has zero clients. The two-layer split was supposed to prevent infrastructure-before-validation drift; it has become the doctrinal cover for the drift it was meant to prevent. Restart is wrong (architecture is right); Layer is wrong (shape is right). **Refine**: keep the architecture, ship Phase 1 narrower, fix the strategic-decision gaps, re-decide platform-vs-vertical investment after customer #1 signs or passes.

---

## What's right

1. **Two-layer PRD split.** Long-form vision earns the demo; narrow v1 earns the code.
2. **Four-pillar moat in synthesis Theme 8 formulation.** "No competitor ships editable customer-owned memory + reviewer-as-sender + flat-per-firm under one identity" survives Eve 2.0, PLAAS, Law Practice AI, Copilot scrutiny. Each pillar is being eroded; the combination is not.
3. **Captain ≤2hrs/wk/customer as hard constraint.** The business-model anchor most managed-AI pitches lack. Makes flat-monthly defensible instead of nights-and-weekends-funded.
4. **Third-rail map.** "Operational supply chain, not judgment-bearing core" is positioning, product, _and_ compliance in one sentence.
5. **PI as first overlay.** PI partners are the cohort most likely to validate compliance architecture (they litigate plaintiff cases; they know what fails in deposition). Easier sales exist; PI produces the more durable proof.
6. **ADR 0005 (reviewer-as-sender) elevation to architectural commitment.** Every other ADR is downstream.

---

## What's wrong

### 1. §0 venture-priority constraint honored in letter, violated in spirit. (CRITICAL)

§0: "No platform work past Phase 1 spine until (a) PI firm signs, (b) consulting signs, or (c) Captain authorizes parallel investment." Corpus ships ~6,000 lines of doctrine, a 17-practice roadmap, 13 specs, 5 ADRs. Past Phase 1 spine. The constraint exists because consulting has zero clients and the in-person motion hasn't been exercised. Every hour on AI Employee doctrine is an hour not on the assessment script, proposal template, or Vistage outreach. AI Employee was decided as the _second_ door because the first is unbuilt — and the second-door work has become the venture's center of gravity in eight days. **Direction:** Captain resolve §0 explicitly — authorize parallel investment with named hours/week, or freeze AI Employee at current corpus until the PI meeting. Status quo is the worst of both.

### 2. PI meeting carries roadmap weight; it is one meeting walked in cold. (HIGH)

Both PRDs pivot on a single partner on 2026-06-02–09. Phase 2, day-45 pivot, fixtures, calibration — all shaped against a binary event. **Mono-customer dependency.** §4 backup-operator gate addresses customer #5 bus factor; nothing addresses _pipeline_ bus factor at customer #0. **Direction:** Land 3-5 warm PI conversations before 2026-06-09 — Vistage, EO Arizona, plaintiff bar. First meeting is then signal, not verdict.

### 3. Multi-vertical platform architecture committed before earning it. (HIGH)

§7 commits per-customer Machine isolation (0007), capability-adapter across 11 interfaces (0006), D1+R2+Vectorize customer-owned memory (0008), cross-Machine query prohibition (0009). Each is sound; collectively they earn abstractions at customer #20+, not #1. §0 says "documentation, not implementation" — but ADRs are commitments. 0006 constrains every connector to a capability interface, wrong for low-volume read-only feeds. 0008 binds memory architecture before customer #1 reveals whether Vectorize is needed. **Direction:** Re-classify three of five PR #832 ADRs as PRD posture:

- **0006** — defer customer-grade commit until customer #2's connectors diverge.
- **0008** — keep _exportability_ (§14 marketing line); defer D1+R2+Vectorize binding until customer #3.
- **0009** — keep the prohibition; defer runtime enforcement to customer #2 (customer #1 has nothing to leak across to).

Ship 0005 and 0007 — load-bearing for the demo's compliance moment.

### 4. Pricing anchored on math the unit economics may not survive. (HIGH)

§15: "$55-95k loaded paralegal salary is the anchor." SKU price deferred to COGS. If Heavy-profile customers cost $3,500/mo, SKU must price at $5,800+/mo to hold 40% margin — _above_ substitution math at honest hour-cost equivalent. Frame collapses; Captain enters with positioning the math won't deliver. **Direction:** Complete §15.1 COGS for Light/Medium/Heavy **before the meeting**. Captain needs (a) a number that fits substitution, (b) a number that doesn't fit and a re-framed pitch, or (c) defensible "five business days post-meeting." None is documented; (c) by default is the worst of three.

### 5. 17-practice roadmap is sequencing pretending to be strategy. (MEDIUM)

Law-firm PRD §13 ranks 17 practice areas with quasi-quantitative overlap percentages. None gated on customer demand. Strategy-by-spreadsheet, not strategy-by-signal. **Direction:** Replace §13 with one gate: _"Overlay #2 ships when (a) beta-1 requests it with willingness-to-pay, or (b) a second-firm warm conversation produced an explicit ask."_

### 6. Framed as productized SKU; built as managed service. (MEDIUM)

ADR 0004 lock 1: "Productize as flat-rate retainer SKU." Productization implies scale-leverage. Corpus describes 4-6hr calibration, Captain-led onboarding, per-customer voice tuning, per-customer compliance packets. **Managed service positioned as product.** **Direction:** Either (a) position as _premium managed service_ with 30-50% margins and $5k-$10k/mo pricing per ADR 0004 reference points; drop productized-SKU language. Or (b) actually productize — self-serve onboarding, customer-grade dashboard. (a) is honest; (b) is much harder.

---

## What's missing

Ordered by criticality.

### 1. Product-level fail-fast criteria, distinct from per-customer kill criteria. (CRITICAL)

PRDs have per-customer kill criteria (§17.2) and platform-level (§17.4 — leakage, churn). No **SMD-level fail-fast criteria for the product itself.** Unanswered: PI passes _and_ Estate+Probate produces no warm conversation by day 60 — continue or freeze? Customer #1 COGS >60% MRR for 30 days — continue or renegotiate? Copilot ships reviewer-as-sender in 2027 — continue platform or pivot to vertical packs? Consulting signs three before AI Employee signs one — freeze AI Employee? PRD answers none. **Direction:** Platform PRD §17.5 — explicit freeze conditions in favor of consulting or pivot.

### 2. What "done" looks like at customer #5 or #10. (CRITICAL)

Phase 4 gate is "≥3 customers." But **what is SMD's strategic shape at customer #5?** Single-operator firm + consulting (Captain ~10hrs/wk AI Employee + everything else)? Multi-operator licensed platform (SMD owns doctrine; others run instances)? Strategic-acquirer target (clean bolt-on for Clio/Filevine/PE roll-up)? Each implies different platform decisions today. Corpus is shaped for "acquirer target" while §0 reads "single-operator + consulting." Not the same product. **Direction:** Captain names the working hypothesis. PRD aligns.

### 3. Competitive-response posture for the 2027 clone. (HIGH)

Four-pillar moat is defensible _now_, not _forever_. Microsoft will ship reviewer-as-sender in Copilot Word; Eve will ship editable memory; Supio is already gesturing. Named branches when a pillar is matched: deepen moat, move layers (operator-of-AI-Employees, not builder), vertical-lock, sell. PRD names none. **Direction:** Platform PRD §6.6 — branches queued (default need not be locked).

### 4. Customer-discovery cadence post-meeting. (MEDIUM)

The meeting is treated as the discovery event. After (sign or pass), what's the discovery posture? §13 sequencing needs _signal_, not _guess_. **Direction:** Operations runbook — quarterly discovery, 5 conversations minimum, mix of PI/adjacent/cross-vertical.

### 5. Skill-quality variance posture across customers. (MEDIUM)

Hermes is one runtime; skills calibrate per customer. §9.6 has voice gates. No posture for **dramatic skill-quality variance** — A's `inbox-triage` reaches 92%; B's reaches 71% and won't climb. **Direction:** Platform PRD §17.6 — per-skill approval-rate floor below which Captain disables (vs. recalibrates, vs. accepts, vs. terminates).

---

## Strategic risks ranked

1. **(P0) Venture-priority drift.** Eight days post-ADR 0004, AI Employee corpus ~6,000 lines; consulting venture has shipped zero collateral. Leading indicator: CLAUDE.md "Priority 1: Collateral" branch produced nothing same window.
2. **(P0) Mono-customer pipeline.** No warm intros behind the cold PI meeting. Day-45 pivot decides venture-grade on n=1.
3. **(P1) Unit-economics mismatch.** Substitution-anchor framing committed before COGS math.
4. **(P1) Premature architectural commits.** ADRs 0006/0008/0009 lock platform-grade abstractions before customer #1 earned them.
5. **(P2) 12-24 month competitive horizon.** Frontier moving at ~6-month intervals. No documented response posture.

---

## Strategic asks of Captain

1. **Resolve §0 venture-priority explicitly.** Name a weekly time split or freeze AI Employee until consulting signs one. Status quo is drift.
2. **Decide the strategic shape at customer #5.** Single-operator + consulting / multi-operator licensed / acquirer target. PRD aligns to whichever you name.
3. **Authorize COGS modeling before the PI meeting.** Unblocks the pricing response.
4. **Build pipeline behind the cold meeting.** 3-5 PI conversations before 2026-06-09. Pipeline bus factor is the largest concentrated risk and is unaddressed in the corpus.
5. **Re-classify ADRs 0006, 0008, 0009 as PRD posture.** Ship 0005 and 0007. Preserves architectural intent without paying premature-abstraction cost.
