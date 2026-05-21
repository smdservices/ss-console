# Round 1 Synthesis — AI Employee Product Review

**Team:** ai-employee-product (5 PMs, one lens each)
**Date:** 2026-05-20
**Source perspectives:** [ux-lead](https://github.com/venturecrane/ss-console/pull/836) · [target-customer](https://github.com/venturecrane/ss-console/pull/837) · [technical-pm](https://github.com/venturecrane/ss-console/pull/838) · [product-strategy](https://github.com/venturecrane/ss-console/pull/839) · [business-analyst](https://github.com/venturecrane/ss-console/pull/840)

---

## Convergent stance

All 5 lenses returned **REFINE** or **LAYER**. No one called RESTART. The architectural primitives in the existing material (reviewer-as-sender, three trust ceilings, per-customer Machine isolation, customer.yaml as single source of truth, closed-loop posture) hold up under all five lenses.

What every lens surfaced — in different language — is the **same underlying gap**: the existing material is architecturally and conceptually correct, but **operationally underspecified and customer-unvalidated**. The PRDs answer "what should this product be" at the spec layer; they don't answer "what does the partner's third Tuesday look like" at the operational layer, and the personas/JTBD haven't been pressure-tested against real customers.

## What each lens uniquely surfaced

| Lens                 | Stance             | Unique findings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ux-lead**          | REFINE_IN_PLACE    | Day-1 walkthrough length will cause abandonment (9 screens for principals). Send-confirmation copy is architecturally wrong ("send to Karen" → actually drops in reviewer's Outlook drafts). Sourcing block ("What Marcus used") collapsed by default, defeating its trust purpose. Regressed morning-digest spec lost per-item phone-scannability. Audit tab built for compliance counsel, not partner.                                                                                                                                                                                                                                                                                                      |
| **target-customer**  | LAYER + correction | Persona 2 is a composite of 3 distinct roles (case manager, office manager, intake coordinator). Two personas missing entirely (associate attorney, firm administrator). Persona 4 (Compliance) is BigLaw-shape — sub-50-attorney PI firms don't have ethics counsel. **Pricing anchor is structurally wrong** — both PRDs anchor on Framing A (substitution: $55-95k loaded paralegal); round-0 partner chose Framing B (incremental-hire-deferred). Zero PI firms interviewed; round-0 is Claude-authored fiction.                                                                                                                                                                                          |
| **technical-pm**     | REFINE             | Hermes adapter `register()` assumes a `tool_router.py` hook that doesn't exist at v2026.5.7 — code-enforced trust ceiling is unwired. Composio per-connection isolation unverified — tenant-wide API key, no connection-ID enforcement; cross-customer leakage vector. Provisioning script doesn't match spec surface — chat-only Hermes container, D1/R2/Vectorize unwired, OAuth callback missing. Recalibrated effort: **60-90 dev-days → 5-7 calendar months** at realistic cadence with bus-factor of one. Recommends Phase 1A (demo-ready, 2-3 weeks) + Phase 1B (paying-customer ready, 8-12 weeks post-meeting) split.                                                                                |
| **product-strategy** | REFINE + cuts      | **Venture-priority drift**: ~6,000 lines of AI Employee doctrine shipped in 8 days; consulting venture (ADR 0004's stated _first_ front door) shipped zero collateral. §0 honored in letter, violated in spirit. **Mono-customer pipeline**: 2026-06-02 meeting is binary, no warm intros documented. **Premature ADR commits**: three of five PR #832 ADRs (0006 capability-adapter, 0008 memory binding, 0009 cross-Machine query prohibition) lock platform-grade abstractions before customer #1 has earned them — recommends reclassify as PRD posture and ship 0005 + 0007 only.                                                                                                                        |
| **business-analyst** | REFINE             | Paralegal non-adoption risk from calibration fatigue (4-6hr §11.9 session collapses at firms that actually sign — $300k-settlement paralegals carry 80-150 active matters). **Connector reality is wrong**: most common state at target buyer profile is **no working PM system at all** (paper + Outlook + Dropbox + PracticeMaster, or Clio-bought-but-unused). Need a "no PM system" demo mode. Two unmodeled workflows: referral-source rule-override exception, paralegal-to-paralegal handoff (most $300k firms have 2-3 paralegals; dashboard is single-operator with no PTO delegation). Morning-digest 8am-from-phone is a knowledge-worker-from-laptop assumption that breaks litigation schedules. |

## Cross-cutting themes (where multiple lenses agree)

### Theme 1: Customer validation has not happened

- **target-customer** loudest: zero PI firms interviewed; round-0 is Claude-authored fiction; PRDs project rather than listen
- **business-analyst** corroborates: "no PM system" reality at buyer profile, calibration fatigue, real workflows missing — all consequences of building from imagined customer
- **product-strategy** corroborates: mono-customer pipeline, binary n=1 validation, day-45 pivot gate
- **ux-lead** corroborates indirectly: sourcing-block hidden by default suggests the spec is optimizing for tidiness rather than trust — a customer-pressure-tested spec wouldn't make that call

**Implication:** more building before talking to real PI firms compounds the projection problem.

### Theme 2: Personas + roles are wrong-shaped for the buyer profile

- **target-customer**: Persona 2 composite, missing associate + admin personas, Compliance role is BigLaw-shape
- **business-analyst**: paralegal-to-paralegal handoffs, multi-paralegal firms, no single operator
- **ux-lead**: audit tab built for wrong persona (Susan-compliance, not Margaret-partner)

**Implication:** UX walkthroughs cannot be authored against the current persona stack.

### Theme 3: Architecture is right; operational specs are thin

- All 5 lenses validate the architectural primitives
- 4 of 5 lenses (all except product-strategy) name specific operational gaps the PRDs/specs don't address
- **technical-pm** quantifies: what's spec'd vs what's actually wired diverges by tens of dev-days

**Implication:** more spec authoring without first addressing operational gaps continues the over-specification pattern.

### Theme 4: Scope/sequencing is unresolved

- **technical-pm**: split into Phase 1A (demo-ready) and Phase 1B (paying-customer ready)
- **product-strategy**: cut 3 ADRs back to PRD posture; address venture-priority drift
- **target-customer**: drop Compliance role from v1 default
- **business-analyst**: add "no PM system" demo mode; handle multi-paralegal handoffs

**Implication:** the team has been building toward an under-defined finish line. Sequencing needs to be Captain-decided before Deliverable 2 (product definition + roadmap) is meaningful.

### Theme 5: The pricing anchor is wrong (target-customer-only finding)

Only **target-customer** caught this, but it's structural: the PRDs anchor on Framing A (AI Employee substitutes for a $55-95k loaded paralegal); the round-0 partner explicitly chose Framing B (I'm not replacing anyone; this defers my next incremental hire). The math is structurally different (cost-replacement vs hire-deferral) and shapes pricing, sales motion, and product positioning. This finding deserves its own Captain decision.

## Top Captain decisions surfaced

Ordered by load-bearingness for the next deliverable (UX walkthroughs):

1. **Customer validation gate** — do we interview 3-5 PI firms before building more, or proceed on Claude-authored personas with the documented projection risk? (target-customer + business-analyst + product-strategy concur this is the upstream gap)

2. **Persona stack revision** — split Persona 2 into 3 distinct roles, add associate + admin personas, drop Compliance from v1 default? (target-customer + business-analyst + ux-lead)

3. **Pricing anchor** — Framing A (substitution) or Framing B (incremental-hire-deferred)? Decides downstream PRD economics, sales script, dashboard ROI signaling. (target-customer)

4. **Sequencing split** — Phase 1A (demo-ready customer-zero for 2026-06-02 meeting) vs Phase 1B (paying-customer-ready), or continue building toward unified Phase 1? (technical-pm)

5. **ADR reclassification** — ship all 5 PR #832 ADRs, or reclassify 0006/0008/0009 as PRD posture (Captain-revisitable) and ship only 0005 + 0007 as locked? (product-strategy)

6. **Venture-priority drift** — is the consulting venture actively backburnered, or does it need parallel attention to stay alive? (product-strategy)

7. **Connector strategy revision** — add "no PM system" demo mode (Outlook + DocuSign + QBO baseline), since most target firms don't have working PM systems? (business-analyst)

8. **Spec corrections** — three specific spec bugs (day-1 walkthrough length, send-confirm copy, sourcing-block default-visible) before UX walkthroughs key off them? (ux-lead)

## Recommendation for next move

Before Deliverable 1 (UX walkthroughs), at minimum **#1 (customer validation gate), #2 (persona stack revision), and #3 (pricing anchor)** need Captain calls. UX walkthroughs are authored _to_ personas and _to_ a pricing posture. Without those resolved, the walkthroughs author themselves into the same projection problem.

Items #4–#8 can be deferred until Deliverable 2 (product definition + roadmap) — they're sequencing/scope questions, not foundational identity.

---

_Synthesis authored by team-lead on 2026-05-20 from the 5 lens-specific perspectives. Each lens's full document is available in its linked PR._
