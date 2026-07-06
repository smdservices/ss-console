/**
 * Infisical write transport for the Hosted Agent BYO Anthropic key
 * (ADR 0067; custody model per ADR 0042's write-only core).
 *
 * The customer's key is staged at the per-customer Infisical path the
 * provisioning wrapper already reads from (`reprovision.sh` injects the
 * whole /ss tree), so the Captain's go-live run picks it up with zero
 * extra steps. The write is delegated custody by design (ADR 0042): the
 * Captain must be able to stage the key onto the Machine.
 *
 * Configuration seam: a Universal Auth machine identity scoped write-only
 * to the hosted-customers path. Until `INFISICAL_UA_CLIENT_ID` /
 * `INFISICAL_UA_CLIENT_SECRET` / `INFISICAL_PROJECT_ID` are provisioned in
 * the Worker, {@link isHostedSecretTransportConfigured} returns false and
 * the endpoint returns an honest `not_enabled` (the key is then collected
 * during the Captain-run go-live step instead). SHIPS DARK: the first
 * wiring must be live-verified end-to-end before the portal path is
 * announced to a customer.
 *
 * No-leak contract: the value flows into `write` and out to Infisical
 * over TLS; it is never logged, never returned (only a non-secret storage
 * ref comes back), and any thrown error is collapsed upstream to
 * `write_failed` without detail.
 */

const INFISICAL_BASE = 'https://app.infisical.com'
/** Secrets staged under /ss/hosted/<slug>; reprovision.sh env-injects /ss recursively. */
const HOSTED_SECRET_PATH_PREFIX = '/hosted'
const SECRET_NAME = 'ANTHROPIC_API_KEY'

export interface HostedSecretTransportEnv {
  INFISICAL_UA_CLIENT_ID?: string
  INFISICAL_UA_CLIENT_SECRET?: string
  INFISICAL_PROJECT_ID?: string
  /** Environment slug; defaults to 'prod'. */
  INFISICAL_ENV_SLUG?: string
}

export function isHostedSecretTransportConfigured(env: HostedSecretTransportEnv): boolean {
  return Boolean(
    env.INFISICAL_UA_CLIENT_ID && env.INFISICAL_UA_CLIENT_SECRET && env.INFISICAL_PROJECT_ID
  )
}

async function universalAuthLogin(env: HostedSecretTransportEnv): Promise<string> {
  const res = await fetch(`${INFISICAL_BASE}/api/v1/auth/universal-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: env.INFISICAL_UA_CLIENT_ID,
      clientSecret: env.INFISICAL_UA_CLIENT_SECRET,
    }),
  })
  if (!res.ok) {
    // Status only — never the response body, which could echo request detail.
    throw new Error(`infisical universal-auth login failed: ${res.status}`)
  }
  const data: { accessToken: string } = await res.json()
  return data.accessToken
}

export interface HostedKeyWriter {
  /** Write the key for `customerSlug`; returns a NON-secret storage ref. */
  write(input: { customerSlug: string; secret: string }): Promise<{ ref: string }>
}

/**
 * Construct the Infisical writer. Upsert semantics: create, and on a
 * conflict (key already staged from an earlier attempt) update instead.
 */
export function createHostedKeyWriter(env: HostedSecretTransportEnv): HostedKeyWriter {
  return {
    write: async ({ customerSlug, secret }) => {
      const token = await universalAuthLogin(env)
      const environment = env.INFISICAL_ENV_SLUG ?? 'prod'
      const secretPath = `${HOSTED_SECRET_PATH_PREFIX}/${customerSlug}`
      const payload = {
        workspaceId: env.INFISICAL_PROJECT_ID,
        environment,
        secretPath,
        secretValue: secret,
        type: 'shared',
      }
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
      const createRes = await fetch(`${INFISICAL_BASE}/api/v3/secrets/raw/${SECRET_NAME}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      if (!createRes.ok) {
        const updateRes = await fetch(`${INFISICAL_BASE}/api/v3/secrets/raw/${SECRET_NAME}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(payload),
        })
        if (!updateRes.ok) {
          throw new Error(
            `infisical secret write failed: create ${createRes.status}, update ${updateRes.status}`
          )
        }
      }
      return { ref: `infisical:/ss${secretPath}/${SECRET_NAME}` }
    },
  }
}
