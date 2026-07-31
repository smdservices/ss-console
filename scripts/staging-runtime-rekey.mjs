#!/usr/bin/env node
/**
 * Give the STAGING console its own runtime-read master, and re-key the
 * pre-production Machine to match.
 *
 * Why a staging-only master rather than reusing production's:
 *
 *   The console holds a master; each Machine holds only HMAC-SHA256(master, slug)
 *   as its OPERATOR_RUNTIME_READ_KEY (operator/bin/provision-customer.sh:553-555).
 *   Putting production's master on staging would let staging derive a read key
 *   for EVERY seat, including real client seats. A staging-only master costs
 *   production nothing but its runtime read of `smd-staging` — a seat that
 *   serves nobody and exists precisely to be a pre-production gate. The pre-prod
 *   seat pairs with the pre-prod console; production keeps the real seats.
 *
 * One Machine can serve exactly one master, which is why this re-keys rather
 * than adds.
 *
 * Usage:
 *   infisical run --env prod --path /ss -- node scripts/staging-runtime-rekey.mjs
 *
 * The master is generated here, written to a 0600 file for storage via
 * `crane_secret_set`, and otherwise never printed. Pass --master-file=<path> to
 * reuse an existing master instead of minting a new one (idempotent re-runs, or
 * recovery after the Worker secret is rotated).
 *
 * Exit codes: 0 ok · 1 refused · 2 command failed
 */

import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Pinned. This script exists only to wire STAGING to the PRE-PRODUCTION seat.
const WORKER = 'ss-web-staging'
const FLY_APP = 'hermes-smd-staging'
const SLUG = 'smd-staging'
// Not a secret: the same public host pattern production uses. The per-customer
// bearer is what is sensitive, and that is derived, not stored here.
const READ_URL_TEMPLATE = 'https://{app}.fly.dev'

// ---------------------------------------------------------------------------
// Refuse anything that is not the staging pair. A typo here would either put a
// staging master on the production Worker or re-key a real client's Machine.
// ---------------------------------------------------------------------------
for (const [label, value, forbidden] of [
  ['worker', WORKER, 'ss-web'],
  ['fly app', FLY_APP, 'hermes-smd'],
]) {
  if (value === forbidden) {
    console.error(`Refusing: ${label} resolved to the production name "${value}".`)
    process.exit(1)
  }
}
if (!WORKER.endsWith('-staging') || !FLY_APP.endsWith('-staging')) {
  console.error('Refusing: both targets must be the -staging pair.')
  process.exit(1)
}

const args = process.argv.slice(2)
const masterFileArg = args.find((a) => a.startsWith('--master-file='))?.split('=')[1]
const outFile = masterFileArg ?? resolve(REPO_ROOT, '.staging-runtime-master.txt')

let master
if (masterFileArg && existsSync(masterFileArg)) {
  master = readFileSync(masterFileArg, 'utf-8').trim()
  console.log(`reusing master from ${masterFileArg} (${master.length} chars, not shown)`)
} else {
  master = randomBytes(32).toString('base64')
  writeFileSync(outFile, master, { mode: 0o600 })
  console.log(`minted staging master: ${master.length} chars (not shown)`)
  console.log(`wrote ${outFile} — store it with crane_secret_set, then delete it`)
}

const derived = createHmac('sha256', master).update(SLUG).digest('hex')

function run(cmd, argv, input) {
  try {
    execFileSync(cmd, argv, {
      cwd: REPO_ROOT,
      input,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
  } catch (err) {
    console.error(`\nFailed: ${cmd} ${argv.join(' ')}`)
    console.error(String(err.message ?? err))
    process.exit(2)
  }
}

console.log(`\n1/3  ${WORKER} <- OPERATOR_RUNTIME_READ_SECRET`)
run('npx', ['wrangler', 'secret', 'put', 'OPERATOR_RUNTIME_READ_SECRET', '--name', WORKER], master)

console.log(`2/3  ${WORKER} <- OPERATOR_RUNTIME_READ_URL`)
run(
  'npx',
  ['wrangler', 'secret', 'put', 'OPERATOR_RUNTIME_READ_URL', '--name', WORKER],
  READ_URL_TEMPLATE
)

// `fly secrets import` reads NAME=VALUE from stdin. `fly secrets set NAME=VALUE`
// would put the derived key in argv, where it is visible in the process list.
console.log(`3/3  ${FLY_APP} <- OPERATOR_RUNTIME_READ_KEY (derived, ${derived.length} hex chars)`)
run('fly', ['secrets', 'import', '-a', FLY_APP], `OPERATOR_RUNTIME_READ_KEY=${derived}\n`)

console.log(
  `\nDone. ${WORKER} and ${FLY_APP} now share a staging-only master.\n` +
    'Production keeps its own master and its real seats; it loses only its runtime\n' +
    `read of ${SLUG}, which serves nobody.`
)
