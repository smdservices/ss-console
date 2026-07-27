/**
 * Config pull-request transport (#2003 slice 2).
 *
 * A compiled entitlement delta becomes a REVIEWABLE PULL REQUEST against the
 * customer.yaml in git — never a direct push to the default branch. Captain
 * decision, 2026-07-27: the change must be real (ADR 0069 Lock 3 — a handler
 * that only records intent is not done) and persisted to the source of truth
 * (ADR 0012 — git; ADR 0044's live-apply path is reverted and unbuilt), while
 * the venture's all-changes-through-PRs rule keeps a human between a client
 * click and the default branch.
 *
 * What the client's action therefore does: opens a PR carrying a one-line
 * diff and the full governance context in its body. Merging it re-projects
 * the config (deploy.yml sync) and the running Machine picks it up at its
 * next reprovision. The portal must say exactly that — a submitted change is
 * "submitted", never "applied".
 *
 * ## Credential
 *
 * `OPERATOR_CONFIG_PR_TOKEN` — a FINE-GRAINED GitHub token scoped to this one
 * repository with `contents: write` + `pull_requests: write` and nothing else.
 * Deliberately NOT the fleet `GH_TOKEN`: this credential lives in a
 * client-reachable request path, so its blast radius is bounded to opening a
 * PR on one repo. Unset → every call fails closed with an honest error; there
 * is no degraded "record it and hope" mode.
 */

export interface ConfigPrEnv {
  OPERATOR_CONFIG_PR_TOKEN?: string
}

export interface ConfigPrRequest {
  /** Repo-relative path, e.g. operator/customers/ashton-price/customer.yaml */
  path: string
  /** Full new file content (produced by the surgical exposure editor). */
  content: string
  branch: string
  title: string
  body: string
}

export interface ConfigPrResult {
  url: string
  number: number
  branch: string
}

const OWNER = 'venturecrane'
const REPO = 'ss-console'
const BASE = 'main'
const API = 'https://api.github.com'

/** True when the PR transport is configured. Callers must check and refuse. */
export function isConfigPrConfigured(env: ConfigPrEnv): boolean {
  return typeof env.OPERATOR_CONFIG_PR_TOKEN === 'string' && env.OPERATOR_CONFIG_PR_TOKEN.length > 0
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'ss-console-operator-config',
  }
}

async function gh<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: true; data: T } | { ok: false; status: number; detail: string }> {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: headers(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    return { ok: false, status: resp.status, detail: detail.slice(0, 300) }
  }
  return { ok: true, data: (await resp.json()) as T }
}

/** base64 for a UTF-8 string in the Workers runtime (no Buffer). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/**
 * Read a repo file at the base branch. The Worker has no filesystem, so this
 * is the ONLY honest source of the current authored text — and it is the same
 * bytes the PR will be based on, which removes any drift between a bundled
 * copy and git HEAD.
 */
export async function readConfigFile(env: ConfigPrEnv, path: string): Promise<string> {
  if (!isConfigPrConfigured(env)) {
    throw new Error('config PR transport not configured (OPERATOR_CONFIG_PR_TOKEN unset)')
  }
  const resp = await gh<{ content: string; encoding: string }>(
    env.OPERATOR_CONFIG_PR_TOKEN!,
    'GET',
    `/repos/${OWNER}/${REPO}/contents/${path}?ref=${BASE}`
  )
  if (!resp.ok) throw new Error(`config read failed: ${resp.status} ${resp.detail}`)
  if (resp.data.encoding !== 'base64') {
    throw new Error(`unexpected content encoding: ${resp.data.encoding}`)
  }
  const binary = atob(resp.data.content.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Open a PR carrying the new file content. Throws on any failure so the
 * caller records nothing and surfaces an honest error — the same
 * remote-first-then-record ordering the pause control uses. A partially
 * created branch is left in place rather than silently deleted; it is inert
 * without a PR and visible to whoever investigates.
 */
export async function openConfigPr(
  env: ConfigPrEnv,
  request: ConfigPrRequest
): Promise<ConfigPrResult> {
  if (!isConfigPrConfigured(env)) {
    throw new Error('config PR transport not configured (OPERATOR_CONFIG_PR_TOKEN unset)')
  }
  const token = env.OPERATOR_CONFIG_PR_TOKEN!

  const baseRef = await gh<{ object: { sha: string } }>(
    token,
    'GET',
    `/repos/${OWNER}/${REPO}/git/ref/heads/${BASE}`
  )
  if (!baseRef.ok) throw new Error(`base ref read failed: ${baseRef.status} ${baseRef.detail}`)

  const existing = await gh<{ sha: string }>(
    token,
    'GET',
    `/repos/${OWNER}/${REPO}/contents/${request.path}?ref=${BASE}`
  )
  if (!existing.ok) throw new Error(`file read failed: ${existing.status} ${existing.detail}`)

  const branchCreate = await gh<unknown>(token, 'POST', `/repos/${OWNER}/${REPO}/git/refs`, {
    ref: `refs/heads/${request.branch}`,
    sha: baseRef.data.object.sha,
  })
  if (!branchCreate.ok) {
    throw new Error(`branch create failed: ${branchCreate.status} ${branchCreate.detail}`)
  }

  const commit = await gh<unknown>(
    token,
    'PUT',
    `/repos/${OWNER}/${REPO}/contents/${request.path}`,
    {
      message: request.title,
      content: toBase64(request.content),
      sha: existing.data.sha,
      branch: request.branch,
    }
  )
  if (!commit.ok) throw new Error(`commit failed: ${commit.status} ${commit.detail}`)

  const pr = await gh<{ html_url: string; number: number }>(
    token,
    'POST',
    `/repos/${OWNER}/${REPO}/pulls`,
    { title: request.title, head: request.branch, base: BASE, body: request.body }
  )
  if (!pr.ok) throw new Error(`pull request failed: ${pr.status} ${pr.detail}`)

  return { url: pr.data.html_url, number: pr.data.number, branch: request.branch }
}
