/**
 * Teach the Operator — inline rule-add resolver (#810).
 *
 * Per platform-prd.md §10.3 and UX Lead Gap 2, the most natural moment
 * for a partner to add a memory rule is during draft review — not by
 * context-switching into the Memory tab. This module owns the typed
 * contract for the inline rule-add path that the draft detail page
 * surfaces.
 *
 * Data shape mirrors `operator/adapter/memory/pipeline.py` —
 * `MemoryRule { id, customer_id, kind, text, source_draft_id, created_by,
 * created_at }`. The `kind` vocabulary is closed; new values require an
 * ADR amendment and a matching update on the Hermes side (PR #944).
 *
 * Persistence seam (#821 + memory-rule bridge follow-on):
 *
 *   The portal D1 has no `memory_rules` or `pending_memory_rules` table
 *   today — both live on the per-customer Hermes Machine D1, which the
 *   portal Worker cannot bind to directly. The bridge follow-on lands
 *   the drain path; until then this module emits a structured
 *   `audit:memory_rule_added` log line that a Hermes-side tail-log
 *   drain consumes (same pattern as `recordSendApprovedAudit` in
 *   send-approved.ts).
 *
 *   The portal does NOT push the rule into Hermes runtime. The bridge
 *   layer is responsible for propagation. This module's contract is:
 *   accept the rule, validate it, record the partner's intent in an
 *   audit-stable form. Runtime ingestion is downstream.
 *
 * Anti-fabrication:
 *
 *   - No fake "rules learned" stats are surfaced anywhere. The detail
 *     page shows what was actually persisted via this resolver — no
 *     more, no less.
 *   - The persona name in user-facing copy comes from
 *     `getActivePersona()` at the page level. This resolver never hard-
 *     codes "Marcus" or any other fixture string.
 *   - Validation rejects empty text, oversize text, and unknown kinds
 *     rather than coercing them into plausible defaults.
 */

/**
 * Closed vocabulary for memory rule kinds. Mirrors the Hermes-side
 * `MemoryRule.kind` enum (`operator/adapter/memory/pipeline.py`).
 * Vocabulary is closed; new values require an ADR amendment plus a
 * lockstep update on the Python side.
 *
 *   drafting_voice    — A rule about how the Operator phrases
 *                       outbound messages ("never use 'reach out'").
 *   recipient_cohort  — A rule scoped to a recipient cohort
 *                       ("with opposing counsel, never apologize").
 *   matter_category   — A rule scoped to a matter category
 *                       ("on PI cases, always cc the paralegal").
 *   general           — A rule that applies broadly with no scope.
 */
export type MemoryRuleKind = 'drafting_voice' | 'recipient_cohort' | 'matter_category' | 'general'

export const MEMORY_RULE_KINDS: readonly MemoryRuleKind[] = [
  'drafting_voice',
  'recipient_cohort',
  'matter_category',
  'general',
] as const

const MEMORY_RULE_KIND_SET: ReadonlySet<string> = new Set(MEMORY_RULE_KINDS)

/**
 * Upper bound on the rule body length. Memory rules are intended as
 * short directives ("never use 'reach out'"), not paragraphs. Five
 * hundred characters is the launch ceiling — long enough to capture a
 * compound rule with a brief rationale, short enough to keep the rule
 * scannable in the Memory tab.
 */
export const MEMORY_RULE_TEXT_MAX_LENGTH = 500

/**
 * Human label for a MemoryRuleKind value. Closed vocabulary; the lookup
 * is total. Used by the inline form's kind selector and by the audit
 * log row's friendly action description.
 */
export function formatMemoryRuleKind(kind: MemoryRuleKind): string {
  switch (kind) {
    case 'drafting_voice':
      return 'Drafting voice'
    case 'recipient_cohort':
      return 'Recipient cohort'
    case 'matter_category':
      return 'Matter category'
    case 'general':
      return 'General'
  }
}

/**
 * Validation result for an inline rule-add submission. The endpoint
 * returns 400 with the human-readable reason in the body so the form
 * can surface it inline; the form never invents a "looks fine" outcome
 * for an invalid submission.
 *
 *   ok        — Submission is valid; the parsed shape is the resolver's
 *               canonical view of the rule.
 *   error     — Submission is invalid. `reason` is a one-sentence
 *               human-readable explanation suitable for inline display.
 *               `field` identifies which form field the user should
 *               correct; null when the error is form-level.
 */
export type TeachMarcusValidation =
  | { ok: true; rule: ValidatedMemoryRuleInput }
  | { ok: false; reason: string; field: 'kind' | 'text' | null }

/**
 * Canonical shape of a validated rule-add submission, before
 * persistence-layer fields (id, created_at, created_by) are attached.
 * The endpoint hands this to the audit emitter and (when the bridge
 * lands) to the Hermes-side persistence call.
 *
 *   kind            — Validated MemoryRuleKind from the closed vocab.
 *   text            — Trimmed rule body. Non-empty, ≤ MAX_LENGTH.
 *   sourceDraftId   — The draft the partner was reviewing when they
 *                     added the rule. Used so the Memory tab can
 *                     surface the originating context.
 *   recipientCohort — Optional cohort scope when kind is
 *                     'recipient_cohort'. Trimmed; null when blank.
 */
export interface ValidatedMemoryRuleInput {
  kind: MemoryRuleKind
  text: string
  sourceDraftId: string
  recipientCohort: string | null
}

/**
 * Validate an inline rule-add submission. Pure — no DB, no clock.
 * Exposed so the form-handler tests can pin every branch without
 * mocking persistence.
 *
 * Validation rules:
 *   - `kind` must be one of MEMORY_RULE_KINDS. Unknown values reject.
 *   - `text` must be non-empty after trim. Empty rejects.
 *   - `text` length ≤ MEMORY_RULE_TEXT_MAX_LENGTH. Oversize rejects.
 *   - `sourceDraftId` must be a non-empty string. Empty rejects (form-
 *     level error; the page guarantees a draft id when it renders
 *     the form, so this is defense in depth against tampered POSTs).
 *   - `recipientCohort` is optional. When present, trimmed; empty
 *     after trim collapses to null rather than rejecting.
 */
export function validateTeachMarcusInput(input: {
  kind: string | null | undefined
  text: string | null | undefined
  sourceDraftId: string | null | undefined
  recipientCohort: string | null | undefined
}): TeachMarcusValidation {
  if (typeof input.sourceDraftId !== 'string' || input.sourceDraftId.length === 0) {
    return {
      ok: false,
      reason: 'Missing draft id for the rule. Reload the draft and try again.',
      field: null,
    }
  }

  const kindCandidate = typeof input.kind === 'string' ? input.kind : ''
  if (!MEMORY_RULE_KIND_SET.has(kindCandidate)) {
    return {
      ok: false,
      reason: 'Choose a rule kind from the list before submitting.',
      field: 'kind',
    }
  }
  const kind = kindCandidate as MemoryRuleKind

  const textCandidate = typeof input.text === 'string' ? input.text.trim() : ''
  if (textCandidate.length === 0) {
    return {
      ok: false,
      reason: 'Add the rule text. An empty rule cannot be saved.',
      field: 'text',
    }
  }
  if (textCandidate.length > MEMORY_RULE_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      reason: `Rule text is ${textCandidate.length} characters. The maximum is ${MEMORY_RULE_TEXT_MAX_LENGTH}.`,
      field: 'text',
    }
  }

  const cohortCandidate =
    typeof input.recipientCohort === 'string' ? input.recipientCohort.trim() : ''
  const recipientCohort = cohortCandidate.length > 0 ? cohortCandidate : null

  return {
    ok: true,
    rule: {
      kind,
      text: textCandidate,
      sourceDraftId: input.sourceDraftId,
      recipientCohort,
    },
  }
}

/**
 * Audit event payload for the `MEMORY_RULE_ADDED` action. Mirrors the
 * Hermes-side `audit_log.action_type` vocabulary (#942). The portal D1
 * has no audit table today (no migration owned by this PR), so the
 * event is emitted as a structured log line with a stable prefix and
 * the Hermes-side tail-log drain (#821 follow-on) ingests it into the
 * per-customer D1.
 *
 *   approverId      — users.id of the partner who added the rule
 *   customerId      — entity_id of the customer owning the rule
 *   sourceDraftId   — the draft the partner was reviewing
 *   kind            — closed-vocabulary MemoryRuleKind
 *   textLength      — character count of the rule body (the body itself
 *                     is NOT in the audit event — short rules contain
 *                     authored prose and the audit channel is not the
 *                     right surface for it; the Memory tab reads from
 *                     the persisted row when the bridge lands)
 *   recipientCohort — cohort scope when present
 *   timestamp       — ISO 8601 UTC ms when the rule was added
 */
export interface MemoryRuleAddedAuditEvent {
  approverId: string
  customerId: string
  sourceDraftId: string
  kind: MemoryRuleKind
  textLength: number
  recipientCohort: string | null
  timestamp: string
}

/**
 * Build a `MemoryRuleAddedAuditEvent` from the inputs the API endpoint
 * already has. Exposed for unit-testing the payload shape — the
 * endpoint constructs the event inline.
 */
export function buildMemoryRuleAddedAuditEvent(input: {
  approverId: string
  customerId: string
  rule: ValidatedMemoryRuleInput
  now?: Date
}): MemoryRuleAddedAuditEvent {
  const ts = (input.now ?? new Date()).toISOString()
  return {
    approverId: input.approverId,
    customerId: input.customerId,
    sourceDraftId: input.rule.sourceDraftId,
    kind: input.rule.kind,
    textLength: input.rule.text.length,
    recipientCohort: input.rule.recipientCohort,
    timestamp: ts,
  }
}

/**
 * Record the `MEMORY_RULE_ADDED` audit event for a rule submission.
 *
 * The per-customer Hermes audit_log is the eventual destination
 * (`operator/adapter/audit_log.py`). Today the portal cannot reach
 * it directly. The event is emitted as a structured log line with the
 * stable `[audit:memory_rule_added]` prefix so the Hermes-side tail-
 * log drain can JSON.parse it without scraping arbitrary log text.
 *
 * Same shape as `recordSendApprovedAudit` in send-approved.ts — the two are
 * the only portal-side audit emitters today and they share the
 * structured-log idiom.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function recordMemoryRuleAddedAudit(event: MemoryRuleAddedAuditEvent): Promise<void> {
  const line = JSON.stringify({
    type: 'audit:memory_rule_added',
    action: 'MEMORY_RULE_ADDED',
    ...event,
  })
  console.info(line)
}

/**
 * Result of a rule-add submission. The API endpoint returns this in
 * the JSON response so the form can either show a confirmation toast
 * or surface a validation/persistence error inline.
 *
 *   ok      — Rule was accepted. The audit event was recorded; the
 *             bridge follow-on will propagate the rule to Hermes.
 *   error   — Rule was rejected. `reason` is the human-readable
 *             explanation; the form surfaces it inline.
 */
export type TeachMarcusResult =
  | { ok: true; auditTimestamp: string }
  | { ok: false; reason: string; field: 'kind' | 'text' | null }
