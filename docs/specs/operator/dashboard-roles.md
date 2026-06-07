# Dashboard Multi-User Role Schema

**Spec for issue #788.** Three-role permission model: Principal, Operator, Compliance. Beta-1 blocker per UX, BA, PM, Target Customer ("Maria in the room"). Without this, paralegals can't edit memory without partner approval; compliance counsel can't see audit log without draft-approval rights.

## Contract

### Roles

| Role         | Persona                                                       | Auth                                            | Sessions                                       |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `principal`  | Partner/owner/founder. The buyer.                             | Clerk SSO via `portal.smd.services`             | 24h refresh                                    |
| `operator`   | Paralegal/office manager/admin. Day-to-day user.              | Clerk SSO                                       | 24h refresh                                    |
| `compliance` | Outside counsel / compliance officer. Read-only audit access. | Clerk SSO + per-customer "compliance" org claim | 1h refresh (shorter; per audit-window posture) |

Roles are stored in `customer.yaml.users[]` per customer-yaml-schema.md. Clerk org claims map `users[].email → role`. Runtime resolves on every dashboard request.

### Permission matrix

| Capability                                                                   | principal | operator                                             | compliance           |
| ---------------------------------------------------------------------------- | --------- | ---------------------------------------------------- | -------------------- |
| **Today tab** view                                                           | yes       | yes                                                  | no                   |
| **Queue tab** view                                                           | yes       | yes                                                  | no                   |
| **Queue** approve/reject draft                                               | yes       | yes (limited; see below)                             | no                   |
| **Memory tab** view                                                          | yes       | yes                                                  | no                   |
| **Memory tab** add/edit memory rule                                          | yes       | yes (non-promoting only)                             | no                   |
| **Memory tab** delete memory rule                                            | yes       | yes (requires principal confirmation for hard rules) | no                   |
| **Audit tab** view                                                           | yes       | yes                                                  | yes (Audit tab only) |
| **Audit tab** export compliance packet                                       | yes       | yes                                                  | yes                  |
| **Persona tab** view                                                         | yes       | yes                                                  | no                   |
| **Persona tab** edit signature/avatar/name                                   | yes       | no                                                   | no                   |
| **Persona tab** edit voice samples                                           | yes       | yes                                                  | no                   |
| **Skills tab** view                                                          | yes       | yes                                                  | no                   |
| **Skills tab** enable/disable skill                                          | yes       | no                                                   | no                   |
| **Skills tab** **promote trust ceiling** (draft_for_review → autonomous)     | yes       | no                                                   | no                   |
| **Skills tab** **demote trust ceiling** (any → draft_for_review or disabled) | yes       | yes                                                  | no                   |
| **Skills tab** configure skill scope/params                                  | yes       | yes                                                  | no                   |
| **Voice tab** view                                                           | yes       | yes                                                  | no                   |
| **Voice tab** edit voice rules                                               | yes       | yes                                                  | no                   |
| **Voice tab** run blind-test                                                 | yes       | yes                                                  | no                   |
| **Voice tab** mark blind-test passed (unlocks first external draft)          | yes       | no                                                   | no                   |
| **Pause** all agent activity (sticky stop)                                   | yes       | yes                                                  | no                   |
| **Resume** after pause                                                       | yes       | no                                                   | no                   |

### Operator's "limited" draft approval

Operator may approve drafts on skills where the principal has pre-authorized that skill for operator approval. The pre-authorization itself requires principal action (Skills tab → "Operator may approve" toggle, per-skill). Default: principal-approval-only for every skill.

This addresses the BA OQ-004 question: a paralegal can run the agent's day-to-day inbox without partner involvement, but the partner stays in the loop on judgment-bearing skills (e.g. settlement-statement-prep) until they actively delegate.

### "Maria in the room" scenario

A principal and a day-to-day delegate are onboarded together. Onboarding creates both users:

- Partner = principal
- Paralegal = operator

In v1 the partner pre-authorizes `inbox-triage-and-draft` and `morning-digest` for operator approval. The paralegal runs the day-to-day. Partner reviews the morning digest, taps approvals from their phone. Compliance counsel (the firm's outside ethics lawyer) is added later — only when the firm requests an audit packet.

## Failure modes

- **Role not present in customer.yaml** → user is denied access at dashboard load; redirected to "request access" page that notifies the principal via escalation.failure_recipients
- **Operator attempts trust promotion** → API returns 403 with body `{ error: "principal-only", required_role: "principal" }`; UI hides the button server-side (no client-side bypass)
- **Compliance attempts to view Today/Queue/Memory** → 403 with body `{ error: "compliance-role-restricted-to-audit" }`
- **Clerk session expires mid-action** → user lands on re-auth screen; their pending action persists in localStorage for ≤5 min and resumes on re-auth
- **customer.yaml.users[] has duplicate email** → validator rejects at provision time per customer-yaml-schema.md

## Verification

1. **RBAC test suite** at `tests/operator/dashboard-rbac.test.ts` covers the full permission matrix: for every row × role combination, assert the API returns the documented response (200 / 403 / 404).
2. **UI visibility tests** at `tests/operator/dashboard-ui-roles.test.ts` (Playwright) cover that compliance users see only the Audit tab in the nav, operators see all except Skills/Persona admin actions, principals see everything.
3. **Audit log assertion**: every trust promotion / demotion / role-restricted action writes a `RBAC_EVENT` to `audit_log` per d1-schema.md (`action_type`, `actor`, `attempted_action`, `outcome`).
4. **Clerk integration test**: validates org claim resolution → role mapping under three customer.yaml configurations (principal-only; principal+operator; principal+operator+compliance).

## Dedicated Compliance dashboard view (#895)

The `compliance` role grants direct access to the audit surface (per the matrix above) regardless of any opt-in. Separately, customers may opt in to a **dedicated Compliance dashboard view** at `/portal/products/operator/compliance` that groups the audit-log entry point, the read-only retention posture, and the evidence packet entry into a single landing for the compliance reviewer.

### Opt-in: `customer.yaml.compliance_enabled`

Top-level optional boolean. Defaults to `false`.

- **`compliance_enabled: false`** (the default). The dedicated Compliance view does NOT render. Sub-50-attorney PI firms typically don't retain ethics counsel; the principal wears the compliance hat and works from the existing Audit surface. RBAC on the audit surface is unchanged — compliance-role users who exist in `users[]` can still hit `/portal/products/operator/audit` directly.

- **`compliance_enabled: true`**. The dedicated Compliance view renders for compliance and principal roles. The view is the separation-of-duties landing the compliance reviewer uses; the principal sees it as a read-only summary.

Wiring this as an explicit boolean (not auto-derived from "does any user have `role: compliance`") preserves the explicit-config posture: separation of duties is a deliberate firm decision, not a side effect of seat provisioning.

### Visibility matrix for the dedicated Compliance view

| Capability                                                   | principal                                                | operator         | compliance                   |
| ------------------------------------------------------------ | -------------------------------------------------------- | ---------------- | ---------------------------- |
| Compliance card on Operator landing                          | yes if `compliance_enabled`                              | no               | yes (always)                 |
| Compliance dashboard renders enabled view                    | yes if `compliance_enabled`                              | n/a (redirected) | yes if `compliance_enabled`  |
| Compliance dashboard renders "not enabled" empty state       | n/a (no card surfaced)                                   | n/a (redirected) | yes if `!compliance_enabled` |
| Audit log entry from Compliance dashboard                    | yes                                                      | n/a              | yes                          |
| Retention posture (read-only)                                | yes                                                      | n/a              | yes                          |
| Evidence packet entry (today: instructions only; #878 wires) | yes                                                      | n/a              | yes                          |
| Retention mutation                                           | yes (via principal-only Settings + customer.yaml git PR) | no               | no                           |

When `compliance_enabled: false` and the caller has the compliance role, the dashboard view renders an honest empty state pointing the user to the audit log surface directly. This is the standard empty-state pattern (`docs/style/empty-state-pattern.md`): no fabricated controls, no "coming soon" copy.

### Why retention is read-only here

Audit retention is `customer.yaml.memory.retention.audit_log_days`, governed by the override-up-only enforcement in `audit-retention.md`. Mutating customer.yaml requires a git PR; the principal-only Settings surface is the in-portal write path. The Compliance dashboard intentionally shows the current state without offering mutation so a compliance reviewer can confirm the firm's posture without needing principal credentials or coordinating a config-repo PR for every read.

## Implementation notes

- New file: `src/lib/operator/rbac.ts` — declares the permission matrix as a typed const; exports `can(user, capability) → boolean` helper.
- Dashboard middleware at `src/middleware.ts` extends existing role check to load `customer.yaml.users[]` for the requested customer (or denies).
- Tab visibility configured in `src/components/operator/Dashboard.tsx` from `rbac.visibleTabs(role)`.
- Clerk org setup: each Operator customer maps to one Clerk org; user roles are Clerk org roles (`principal`, `operator`, `compliance`). The dashboard reads `user.publicMetadata.role` from the active org.
- `customer.yaml.users[]` schema lives in customer-yaml-schema.md.
- Audit-log RBAC event shape defined in d1-schema.md.

Removes the §19 open decision: "Multi-user role model in dashboard (principal-only vs principal+operator+compliance multi-role): demoed as principal-only; multi-role in beta-1. Role schema not yet specified." → Replaced by this spec. Multi-role available from v1.
