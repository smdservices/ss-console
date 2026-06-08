/**
 * Production wiring for the live runtime read path (runtime-read.ts, ADR 0043
 * path A). Two seams the edge needs:
 *
 *   1. The console→Machine transport ({@link MachineRuntimeTransport}) — the
 *      authenticated, read-only HTTP call to one customer's Machine read
 *      endpoint. Until that endpoint + the per-customer console→Machine
 *      credential are wired, {@link isRuntimeReadConfigured} returns false and
 *      drill-in surfaces render honest empty states (the design's documented
 *      "until built, runtime surfaces render empty states"). The not-configured
 *      transport throws, and `readMachineRuntime` is fail-closed, so a caller
 *      always gets a clean empty result — never a crash.
 *
 *   2. The console-side read-audit sink ({@link RuntimeReadAudit}) — a D1
 *      insert into `operator_runtime_read_audit`.
 *
 * Keeping both here means the drill-in surfaces stay thin and the one piece the
 * integration team implements (the Machine read transport) is isolated.
 */

import type { MachineRuntimeTransport, RuntimeReadAudit } from './runtime-read'

/**
 * Structural view of the env the transport needs. Optional field so this module
 * compiles before the binding is provisioned; declared in env.d.ts. When the
 * Machine read endpoint + per-customer credential land, this check returns true.
 */
export interface RuntimeReadEnv {
  /** Base URL/credential locator for the console→Machine read calls. Absent
   * until the live read path is wired. */
  OPERATOR_RUNTIME_READ_URL?: string
}

export function isRuntimeReadConfigured(env: RuntimeReadEnv): boolean {
  return (
    typeof env.OPERATOR_RUNTIME_READ_URL === 'string' && env.OPERATOR_RUNTIME_READ_URL.length > 0
  )
}

export class RuntimeReadNotConfiguredError extends Error {
  constructor() {
    super('operator runtime read path is not configured (OPERATOR_RUNTIME_READ_URL unset)')
    this.name = 'RuntimeReadNotConfiguredError'
  }
}

/**
 * Construct the production console→Machine transport. Until the Machine read
 * endpoint is wired (guarded by isRuntimeReadConfigured), `read` throws — which
 * `readMachineRuntime` collapses to a fail-closed empty result. Read-only by
 * construction: the only method is `read`, scoped to one customer per call.
 *
 * INTEGRATION STEP: replace the throwing body with the authenticated read —
 *   GET {OPERATOR_RUNTIME_READ_URL}/{customerSlug}/{query.kind}?... with the
 *   per-customer console→Machine credential (ADR 0043 §A). Throw
 *   RuntimeReadUnauthorizedError on 401/403; throw on any other failure so the
 *   client fails closed. The contract above this seam does not change.
 */
export function createMachineRuntimeTransport(_env: RuntimeReadEnv): MachineRuntimeTransport {
  return {
    read: () => Promise.reject(new RuntimeReadNotConfiguredError()),
  }
}

/**
 * Construct the console-side read-audit sink. Binds the per-request actor id
 * (which the core's audit interface does not carry) and writes one append-only
 * `operator_runtime_read_audit` row per read attempt.
 */
export function createRuntimeReadAudit(
  db: D1Database,
  ctx: { actorUserId: string }
): RuntimeReadAudit {
  return {
    record: async (row) => {
      await db
        .prepare(
          'INSERT INTO operator_runtime_read_audit ' +
            '(customer_slug, actor_user_id, actor_email, actor_role, kind, outcome) ' +
            'VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(row.customerSlug, ctx.actorUserId, row.actor, row.actorRole, row.kind, row.outcome)
        .run()
    },
  }
}
