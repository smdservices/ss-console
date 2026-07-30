/**
 * Production wiring for the write-only static-secret core
 * (credential-secret-write.ts). Two seams the edge needs:
 *
 *   1. The vault transport ({@link CustomerSecretWriter}) that physically
 *      relays the client-entered value into the per-customer isolated store.
 *      The real relay is the ADR 0036 pattern (set a per-customer Fly secret,
 *      restart the Machine so its boot-decode writes the value to the volume).
 *      That requires live per-customer Fly app context and the Fly API; it is
 *      the integration step. Until it is wired, {@link isSecretTransportConfigured}
 *      returns false and the endpoint returns an honest `not_enabled` — it
 *      NEVER calls a half-built transport. The contract above this seam (the
 *      no-leak core) is frozen and tested; wiring the relay does not touch it.
 *
 *   2. The console-side audit sink ({@link CredentialSecretAudit}) — a D1
 *      insert into `connector_secret_audit`. That table has no value column, so
 *      the record is structurally incapable of carrying the secret.
 *
 * Keeping both seams here (not in the endpoint) means the endpoint reads as a
 * thin auth + parse + orchestrate wrapper, and the one function the integration
 * team implements (the Fly relay) is isolated.
 */

import type { CapabilityName } from './capabilities/types'
import type { CredentialSecretAudit, CustomerSecretWriter } from './credential-secret-write'

/**
 * Minimal structural view of the env the transport needs. Declared structurally
 * (optional field) rather than via a Cloudflare.Env augmentation so this module
 * compiles before the binding is provisioned — passing the real `env` is valid
 * because the field is optional. When the relay lands, declare the binding in
 * env.d.ts + wrangler and this check starts returning true.
 */
export interface SecretTransportEnv {
  /** Per-customer secret-relay endpoint base. Absent until the relay is wired. */
  OPERATOR_SECRET_RELAY_URL?: string
}

/**
 * Is the production vault transport wired? The endpoint checks this BEFORE
 * touching the core, and returns `not_enabled` when false — so a client never
 * hits a half-built relay and no value is ever handed to an unimplemented sink.
 */
export function isSecretTransportConfigured(env: SecretTransportEnv): boolean {
  return (
    typeof env.OPERATOR_SECRET_RELAY_URL === 'string' && env.OPERATOR_SECRET_RELAY_URL.length > 0
  )
}

/**
 * Tagged error the not-yet-wired transport throws if ever invoked. The core
 * (`handleSecretWrite`) discards thrown detail and maps it to `write_failed`,
 * so even this sentinel cannot leak — but the endpoint guards with
 * `isSecretTransportConfigured` so it is never reached in practice.
 */
class SecretTransportNotConfiguredError extends Error {
  constructor() {
    super('operator secret transport is not configured (OPERATOR_SECRET_RELAY_URL unset)')
    this.name = 'SecretTransportNotConfiguredError'
  }
}

/**
 * Construct the production vault transport. Until the ADR 0036 Fly-secret relay
 * is wired (guarded by isSecretTransportConfigured), `write` throws the tagged
 * sentinel — it is never called in production because the endpoint gates on
 * the same configured check first.
 *
 * INTEGRATION STEP: replace the throwing body with the relay call —
 *   POST {OPERATOR_SECRET_RELAY_URL}/{customerSlug}/{connector}
 *   → sets the per-customer Fly secret + restarts the Machine (ADR 0036)
 *   → returns the non-secret storage ref.
 * The signature and the no-leak contract above it do not change.
 */
export function createSecretWriter(_env: SecretTransportEnv): CustomerSecretWriter {
  return {
    write: () => Promise.reject(new SecretTransportNotConfiguredError()),
  }
}

/**
 * Construct the console-side audit sink. Binds the per-request identity that
 * the core's audit interface does not carry (entity_id, actor_user_id) and
 * writes one append-only `connector_secret_audit` row. No value column exists.
 */
export function createSecretAudit(
  db: D1Database,
  ctx: { entityId: string; actorUserId: string }
): CredentialSecretAudit {
  return {
    record: async (row) => {
      await db
        .prepare(
          'INSERT INTO connector_secret_audit ' +
            '(customer_slug, entity_id, connector, actor_user_id, actor_email, ' +
            'actor_role, masked_tail, storage_ref) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          row.customerSlug,
          ctx.entityId,
          row.connector satisfies CapabilityName,
          ctx.actorUserId,
          row.actor,
          row.actorRole,
          row.masked,
          row.ref
        )
        .run()
    },
  }
}
