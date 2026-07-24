# ADR 0056: Persona Exposure + Skill Initiation Entitlements

Status: Accepted

Date: 2026-06-26

> **Forward-note (2026-07-13).** This entitlement substrate was later extended (not superseded) by two ADRs: [ADR 0071](./0071-confirm-ceiling-and-hosted-agent-tier-ladder.md) adds a fourth ceiling value `confirm` (`autonomous < confirm < draft_for_review < refused`), and [ADR 0072](./0072-recipient-aware-proactive-send.md) adds the `external_send_internal` exposure class plus a recipient classifier. Both layer cleanly on the exposure/initiation model here.

## Context

The Operator previously mixed authorization concepts across scalar skill
ceilings, per-skill action overrides, scope-level ceilings, and mailbox-level
overrides. That made two different questions look like one setting:

- exposure: what class of action may reach the world, and at what ceiling?
- initiation: how may an enabled skill start?

That model was not enforceable enough for a flag-day runtime contract.

## Decision

Customer YAML now uses one entitlement model:

```yaml
personas:
  - slug: marcus
    entitlements:
      exposure:
        internal_write: autonomous
        external_send: draft_for_review
    skills:
      - name: inbox-triage
        enabled: true
        initiation:
          manual: true
          scheduled: false
          webhook: true
```

Exposure is persona-level. `personas[].entitlements.exposure` is sparse. Missing
action classes fail closed at runtime and render as unconfigured in UI. `read` is
not customer-authored; enforcement always allows reads.

Initiation is skill-level. Every enabled skill declares `initiation.manual`,
`initiation.scheduled`, and `initiation.webhook`. Cron entries require
`scheduled: true`. Webhook triggers require `webhook: true`. Manual/on-demand
surfaces require `manual: true`.

Vertical floors only narrow exposure. Current-turn approval floors for
`commitment` and `destructive` remain hard runtime floors.

## Removed Fields

The following fields are retired with no compatibility shim:

- `personas[].skills[].trust_ceiling`
- `personas[].skills[].action_ceilings`
- `scope.trust_ceiling`
- `scope.action_ceilings`
- `google_auth.managed_mailboxes[].action_ceilings`
- provisioning `skill_trust_ceiling`

Validators reject these fields as legacy entitlement fields.

## Consequences

The portal projection preserves persona exposure and skill initiation in
`customer_configs.personas_json`.

Governance audit vocabulary is now:

- `entitlement_exposure`
- `entitlement_initiation`
- `skill_enabled`

Promotion cards based on scalar skill ceilings are removed. A future promotion
surface must promote persona exposure or skill initiation explicitly.
