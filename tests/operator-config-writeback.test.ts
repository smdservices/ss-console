import { describe, it } from 'vitest'

/**
 * ADR 0069 Lock 3 + ADR 0026 — the governed config write path. These guards
 * activate with the write-back spine (Slice 1). Named and present now so the
 * guard is visible in the spine (pending = `.todo`, tied to its slice).
 *
 * When active they assert the ADR 0026 bar every configurable write must clear:
 *  - a principal-authored change persists to customer.yaml and re-projects to
 *    customer_configs;
 *  - an immutable config_change_audit event is emitted (who / what / old→new /
 *    when / principal);
 *  - a raise above a vertical floor is rejected and the attempt audited (lower
 *    immediate, raise floor-checked — the asymmetry);
 *  - no agent/tool/prompt code path writes config;
 *  - the intent-log-only handlers (e.g. trust-ceiling.ts) are gone.
 */
describe('operator config write-back governance (ADR 0069 Lock 3 / ADR 0026)', () => {
  it.todo('config change persists to customer.yaml and re-projects (Slice 1)')
  it.todo('config change emits an immutable config_change_audit event (Slice 1)')
  it.todo('raise above a vertical floor is rejected and audited; lower is immediate (Slice 1)')
  it.todo('no agent/tool/prompt code path writes config (Slice 1 grep guard)')
})
