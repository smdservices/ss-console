# AI Employee — Technical Specs

Formal specs extending the platform PRD ([docs/pm/ai-employee/platform-prd.md](../../pm/ai-employee/platform-prd.md)) and law-firm vertical PRD ([docs/pm/ai-employee/law-firm-prd.md](../../pm/ai-employee/law-firm-prd.md)). Each spec is the implementation contract for one P0/P1 issue from the [PRD critique batch](https://github.com/venturecrane/ss-console/pull/813).

Build agents consuming these specs should treat the PRDs as **vision/doctrine** and these specs as **implementation contracts**. Where a spec extends or refines PRD text, the spec is authoritative for that area.

## P0 — Phase 1 blockers (build cannot start without these)

| Spec                                               | Issue                                                         | Scope                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [customer-yaml-schema.md](customer-yaml-schema.md) | [#790](https://github.com/venturecrane/ss-console/issues/790) | Formal schema, secret-exclusion enforcement, pre-commit validation hook            |
| [capability-contracts.md](capability-contracts.md) | [#791](https://github.com/venturecrane/ss-console/issues/791) | TypeScript signatures for all 11 capability interfaces; Email Pattern A/B decision |
| [oauth-lifecycle.md](oauth-lifecycle.md)           | [#789](https://github.com/venturecrane/ss-console/issues/789) | Token storage, refresh, failure handling, re-authorization, per-connector scopes   |
| [dashboard-roles.md](dashboard-roles.md)           | [#788](https://github.com/venturecrane/ss-console/issues/788) | Principal + Operator + Compliance role schema; permission matrix                   |

## P1 — Beta-1 dependencies

| Spec                                                           | Issue                                                         | Scope                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [d1-schema.md](d1-schema.md)                                   | [#800](https://github.com/venturecrane/ss-console/issues/800) | 11 D1 tables; per-customer isolation via binding layer                                                   |
| [r2-vectorize-naming.md](r2-vectorize-naming.md)               | [#801](https://github.com/venturecrane/ss-console/issues/801) | Per-customer R2 + Vectorize naming; invariant #7 boot-check                                              |
| [voice-gate-fallback.md](voice-gate-fallback.md)               | [#797](https://github.com/venturecrane/ss-console/issues/797) | Pass / Near-pass / Fail states; internal-drafts-only mode                                                |
| [fabrication-filter.md](fabrication-filter.md)                 | [#798](https://github.com/venturecrane/ss-console/issues/798) | Invariant #8 as runtime pre-output filter; `client_facing_fields` skill anatomy                          |
| [mobile-approval-flow.md](mobile-approval-flow.md)             | [#799](https://github.com/venturecrane/ss-console/issues/799) | V1 mobile screen sequence; 60-second partner loop                                                        |
| [compliance-evidence-packet.md](compliance-evidence-packet.md) | [#802](https://github.com/venturecrane/ss-console/issues/802) | Susan-readable compliance packet contents                                                                |
| [day-1-onboarding.md](day-1-onboarding.md)                     | [#803](https://github.com/venturecrane/ss-console/issues/803) | First-hour dashboard walkthrough screens                                                                 |
| [cost-telemetry-events.md](cost-telemetry-events.md)           | [#804](https://github.com/venturecrane/ss-console/issues/804) | Per-customer cost emission for all 9+ drivers                                                            |
| [decommission-drain.md](decommission-drain.md)                 | [#805](https://github.com/venturecrane/ss-console/issues/805) | 60s drain window before substrate deletion                                                               |
| [decommission-customer.md](decommission-customer.md)           | [#820](https://github.com/venturecrane/ss-console/issues/820) | Full per-customer off-boarding pipeline; 9 idempotent steps                                              |
| [sticky-stop.md](sticky-stop.md)                               | [#843](https://github.com/venturecrane/ss-console/issues/843) | System-initiated circuit breaker for runaway agent loops (WARN/SOFT/HARD)                                |
| [safety-invariants.md](safety-invariants.md)                   | [#865](https://github.com/venturecrane/ss-console/issues/865) | Invariants #6 (citation enforcement on fact-bearing fields) and #7 (cross-Machine query prohibition)     |
| [refusal-handling.md](refusal-handling.md)                     | [#866](https://github.com/venturecrane/ss-console/issues/866) | Runtime semantics when `trust_ceiling.enforce()` returns `refuse` (abort + notification + cascade alert) |
| [calibration-session.md](calibration-session.md)               | [#867](https://github.com/venturecrane/ss-console/issues/867) | Four 90-minute calibration sessions over two weeks; portal surface + integration seams                   |
| [audit-log-immutability.md](audit-log-immutability.md)         | [#892](https://github.com/venturecrane/ss-console/issues/892) | Worker-layer enforcement, Logpush mirror protocol, integrity check, Captain exception process            |

## Open ambiguities requiring Captain decision

These were flagged as `[AMBIGUITY: ...]` markers in the specs. Listed here for triage:

1. **OAuth token storage convergence** (customer-yaml-schema.md, oauth-lifecycle.md) — PR #812's LawPay impl stores tokens in a Fly volume `tokens.json`; spec assumes Infisical. Reconcile: Infisical as source of truth with local cache, or local-file-only?
2. **TypeScript vs Python adapter layer** (capability-contracts.md) — PR #812 ships Python adapters; capability interfaces are spec'd in TypeScript. Dual-language with re-declaration, or convergence?
3. **Calendar RSVP draft pattern** (capability-contracts.md) — `respond_to_invitation_draft` returns `DraftRef` but most calendar systems treat RSVP as a single API call. Confirm shape.
4. **Re-consent callback URL** (oauth-lifecycle.md) — `admin.smd.services/ai-employee/oauth/{connector}/callback` requires admin subdomain be reachable from customer browsers; admin auth is role-gated. Resolve with unauthenticated callback path or portal-subdomain proxy.
5. **D1 audit-log immutability** (d1-schema.md) — Cloudflare D1 lacks per-role permissions; immutability enforced at Worker layer. Accept with Logpush mirror, or defer launch until D1 ships per-role permissions? **Resolved 2026-05-21 (#892):** Worker-layer enforcement (`D1Executor` wrapper in `ai-employee/adapter/audit_log_immutability.py`) + Logpush mirror protocol + periodic integrity check; Captain-supervised redaction is the only legitimate mutation path. See [audit-log-immutability.md](audit-log-immutability.md).
6. **Vectorize index quota** (r2-vectorize-naming.md) — Wrangler/CF bulk-delete throttling may stretch heavy-customer decommissioning past the 60s drain window. Validate with synthetic fixture before launch.
7. **Voice-gate judge pool size** (voice-gate-fallback.md) — For solo practitioners, 3 judges is structurally hard. Captain proxies, or relax threshold for low-judge cohorts?
8. **Internal-drafts-only retainer math** (voice-gate-fallback.md) — Pricing strategy doc doesn't yet specify; spec assumes 50-60%. Resolve before customer #1 signs.
9. **Fabrication filter block-rate ceiling** (fabrication-filter.md) — 5% heuristic; tune against real data.
10. **Mobile dashboard reachability** (mobile-approval-flow.md) — MDM-restricted devices may block portal access; confirm during onboarding.
11. **Compliance packet narrative review cadence** (compliance-evidence-packet.md) — Auto-generate with Captain review-and-amend, or fully manual? Decision: auto-render then Captain edits before delivery.
12. **Onboarding walkthrough completion rate** (day-1-onboarding.md) — Partners often skip; Captain plans live-walk in demo close + follow-up email.
13. **Composio per-action pricing source** (cost-telemetry-events.md) — Hardcoded JSON vs dynamic API pull.
14. **D1 metering access pattern** (cost-telemetry-events.md) — Validate Cloudflare GraphQL Analytics access against the live account.
15. **Atomic-wipe decommissioning** (decommission-drain.md) — True atomicity impossible across independent APIs; spec settles for ordered-best-effort. Confirm satisfies §13.3.
16. **Decommission-archive cleanup verification** (decommission-drain.md) — Captain-signed deletion proof at 30 days needed.

## Cross-spec references

The specs link `[[name]]` style across each other:

```
customer-yaml-schema ─► oauth-lifecycle       (token_ref pattern)
customer-yaml-schema ─► dashboard-roles       (users[] block)
customer-yaml-schema ─► r2-vectorize-naming   (memory.* fields)

capability-contracts ─► oauth-lifecycle       (auth_expired error path)
capability-contracts ─► fabrication-filter    (empty-state on forbidden)

d1-schema            ─► all telemetry/audit specs
r2-vectorize-naming  ─► decommission-drain    (prefix enumeration)
r2-vectorize-naming  ─► compliance-evidence-packet (audit-exports path)

voice-gate-fallback  ─► mobile-approval-flow  (banner on gate not passed)
voice-gate-fallback  ─► day-1-onboarding      (step 3 voice review)

fabrication-filter   ─► compliance-evidence-packet (no PII in markers)

mobile-approval-flow ─► dashboard-roles       (role-based tab visibility)
mobile-approval-flow ─► fabrication-filter    (flag banner rendering)

cost-telemetry       ─► d1-schema             (cost_telemetry table)
cost-telemetry       ─► decommission-drain    (final rollup before D1 delete)

decommission-drain   ─► compliance-evidence-packet (final export contents)
decommission-drain   ─► r2-vectorize-naming   (retention bucket)
```
