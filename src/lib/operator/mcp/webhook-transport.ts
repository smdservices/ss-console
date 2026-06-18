/**
 * Production transport for the async MCP handoff path (Phase 2 / ADR 0043).
 *
 * Delivers a signed `HandoffEnvelope(surface="mcp")` to the Machine's
 * `/webhooks/mcp` gate over HTTPS. The bearer is
 * `HMAC-SHA256(OPERATOR_MCP_WEBHOOK_SECRET, slug)` — same derivation as the
 * runtime-read key (a different master). Each Machine holds only its own derived
 * key (`WEBHOOK_SECRET_MCP` set at provision); the master lives only on the
 * console.
 *
 * The Machine acknowledges receipt synchronously (2xx). The Operator works the
 * task async and reports via its authored channels (email, Telegram, etc.).
 */

import { deriveRuntimeReadKey } from '../runtime-read-transport'
import { resolveCustomerFlyApp } from '../fly-app-registry'

export interface MachineWebhookEnv {
  /** Same Machine base URL template as the runtime-read path
   * (e.g. `https://{app}.fly.dev`). Reused — both paths target the same Machine. */
  OPERATOR_RUNTIME_READ_URL?: string
  /** Master secret from which each Machine's per-customer MCP webhook key is
   * derived (`HMAC-SHA256(master, slug)`). Lives only on the console. */
  OPERATOR_MCP_WEBHOOK_SECRET?: string
}

export function isWebhookConfigured(env: MachineWebhookEnv): boolean {
  return (
    typeof env.OPERATOR_RUNTIME_READ_URL === 'string' &&
    env.OPERATOR_RUNTIME_READ_URL.length > 0 &&
    typeof env.OPERATOR_MCP_WEBHOOK_SECRET === 'string' &&
    env.OPERATOR_MCP_WEBHOOK_SECRET.length > 0
  )
}

export interface HandoffEnvelope {
  handoff_id: string
  surface: 'mcp'
  trust_class: 'known_external'
  task: string
  context?: string
  from_email: string
  from_profile: string
  submitted_at: string
}

export interface MachineWebhookTransport {
  send(customerSlug: string, envelope: HandoffEnvelope): Promise<void>
}

function machineBaseUrl(template: string, app: string): string {
  return template.includes('{app}') ? template.replace('{app}', app) : `https://${app}.fly.dev`
}

/**
 * Construct the production console→Machine webhook transport. Throws on
 * transport failure so the caller can map it to a fail-closed result.
 * A 4xx/5xx from the Machine is treated as a delivery failure.
 */
export function createMachineWebhookTransport(env: MachineWebhookEnv): MachineWebhookTransport {
  return {
    send: async (customerSlug, envelope) => {
      if (!isWebhookConfigured(env)) {
        throw new Error('MCP webhook transport not configured (OPERATOR_MCP_WEBHOOK_SECRET unset)')
      }
      const app = resolveCustomerFlyApp(customerSlug)
      if (!app) throw new Error(`webhook transport: unknown customer ${customerSlug}`)

      const baseUrl = machineBaseUrl(env.OPERATOR_RUNTIME_READ_URL!, app)
      const bearer = await deriveRuntimeReadKey(env.OPERATOR_MCP_WEBHOOK_SECRET!, customerSlug)

      const resp = await fetch(`${baseUrl}/webhooks/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
          'X-Tenant-Slug': customerSlug,
        },
        body: JSON.stringify(envelope),
      })
      if (!resp.ok) throw new Error(`webhook delivery failed: ${resp.status}`)
    },
  }
}
