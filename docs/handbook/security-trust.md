---
title: Security & Trust
section: operations
order: 6
summary: The two halves of trust - content integrity (no fabricated client-facing content, enforced by tests and merge gates) and Operator runtime security (a maintained threat model verified against the running system)
sources:
  - label: CLAUDE.md - No fabricated client-facing content
    href: https://github.com/venturecrane/ss-console/blob/main/CLAUDE.md
  - label: docs/style/empty-state-pattern.md
    href: https://github.com/venturecrane/ss-console/blob/main/docs/style/empty-state-pattern.md
  - label: tests/forbidden-strings.test.ts
    href: https://github.com/venturecrane/ss-console/blob/main/tests/forbidden-strings.test.ts
  - label: docs/security/operator-threat-model.md
    href: https://github.com/venturecrane/ss-console/blob/main/docs/security/operator-threat-model.md
  - label: docs/security/smd-services-security-overview.md
    href: https://github.com/venturecrane/ss-console/blob/main/docs/security/smd-services-security-overview.md
---

## Two halves of trust

Trust in this venture has two distinct surfaces, and they are protected by different machinery:

1. **Content integrity** - what the software is allowed to *say* to a client. The risk is fabrication: software inventing a commitment, a timeline, or a name that no engagement actually authored.
2. **Operator runtime security** - what an autonomous agent is allowed to *do* on a client's behalf, on their live business data. The risk is an autonomous system taking a consequential action it was never authorized to take, or being driven to do so by malicious input.

This page is the navigable summary of both. It does not re-narrate the controls; it points to where each is owned.

## Content integrity: no fabricated client-facing content

The rule, in full in `CLAUDE.md`: any information shown to a client - timelines, deliverables, pricing, consultant names, dates, scope language, any first-person promise about future business behavior - must come from data authored for that specific engagement (a human-reviewed database column, CMS content, or a Captain-reviewed source file). Violations are P0.

Two failure patterns are prohibited:

- **Pattern A - committed template sentences.** Hardcoded sentences in source that promise specific business behavior the engagement has not contracted, even when they interpolate authored values. The canonical examples (from the 2026-04-15 audit) are sentences like a hardcoded "we will reach out to schedule kickoff" or a baked-in start-window promise. They read as commitments; the firm never made them per-client.
- **Pattern B - runtime fabrication from non-authoritative fields.** Values rendered from sources never authored as client-facing content: placeholder defaults, parsed or derived text, brief-borrowed copy. The canonical example is a SOW signed as "Business Owner" because a contact name fell back to a hardcoded default, or an engagement overview injected from a constant string.

### The empty-state pattern is the sanctioned alternative

When authored data is missing, the rule is: render nothing, or an explicit "TBD in SOW" marker. Never synthesize, never borrow brief copy, never fall back to a sensible default. This is not a style preference - it is the only path the no-fabrication rule permits, and it exists as a documented pattern (`docs/style/empty-state-pattern.md`) specifically because the proposal-page incident (#377, hotfix #378) showed that agents and reviewers will accept fabricated content over a visually empty section unless the right move is made the path of least resistance. The rule prohibits invention; the pattern shows what to do instead. The two work as a pair.

### Adjacent guardrails

Pattern A/B is not the whole policy. The repo also blocks three nearby failure modes (per `CLAUDE.md`):

- **Style markers in shipped copy.** No em dashes, no "coming soon" placeholder copy on any prospect or client surface.
- **Enrichment-prompt drift.** Prompts that enrich a lead must stay extractive and evidence-bound - they must not ask a model to infer management style, personality, communication preferences, or likely objections.
- **Shared-flow drift.** Canonicalized product flows (the shared intake questionnaire) must not drift back into duplicate implementations.

### The enforcement machinery

The policy is not enforced by vigilance alone; it is wired into CI and into tests:

| Mechanism | What it does |
|---|---|
| `tests/forbidden-strings.test.ts` | Regression guard: the historical Pattern A/B phrases, the user-facing style-marker checks (em dash, "coming soon"), and portal registry guardrails must not appear in shipped source. |
| `tests/intake-questionnaire.test.ts` | Shared-surface regression coverage for the canonical intake questionnaire. |
| `.github/workflows/scope-deferred-todo.yml` | Merge gate: blocks a PR that defers an acceptance criterion via a TODO without the `scope-deferred` label. |
| `.github/workflows/unmet-ac-on-close.yml` | Issue-close gate: reopens an issue closed with unchecked acceptance criteria. |

The content-integrity controls also feed the external story: the same fail-closed posture and no-storage architecture are what `docs/security/smd-services-security-overview.md` presents to a partner's security review.

## Operator runtime security

The Operator is an autonomous agent acting on a client's live business data, so its security model is about constraining action, not just constraining output. The full analysis is `docs/security/operator-threat-model.md` - a maintained, adversarially-tested register, not a one-time design doc. Its shape:

- **A strong perimeter, a softer core.** The front door (the capability broker plus authored entitlement ceilings on registered tools) is verified-strong. The historically harder problems were ungoverned code execution defaulting to read, an account-wide secret in the agent's environment, a broker that validated identity but not intent, and an inbound fence that covered the webhook channel but not the managed mailbox. These are tracked as P0/P1 findings with live-exploit verification and a remediation program (see the threat model's "Closed" section for what has been shut, including the broker-owned audit ledger).
- **The verified strengths to protect from regression.** Per-customer Machine isolation, the fail-closed authority model (unconfigured can read but not act), the hard ban on principal-identity send, and the tamper-resistant audit log the agent cannot rewrite. The threat model names these explicitly so a future change does not quietly undo them.

The controls themselves - the action-class ceilings, the capability broker, the inbound-content taint gate, and the fail-closed default - are owned and explained in `/admin/playbook/autonomy-governance`. The secrets and credential-custody side (Infisical, per-customer OAuth tokens, the broker-only secret materialization) is owned by `/admin/playbook/secrets-access`. This page does not duplicate them; it points to them so the two halves of trust read as one map.
