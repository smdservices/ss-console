#!/usr/bin/env node
/**
 * One-shot reconciliation: classify the pre-pivot job_monitor Signal-stage
 * entities through ADR 0003's inferPostingActorRole and mark wrong-actor
 * ones lost. Dry-run by default; pass --apply to execute.
 *
 * Mirrors workers/job-monitor/src/qualify.ts:STAFFING_AGENCY_NAMES verbatim.
 * If that list ever changes, this script must be re-synced.
 *
 * Usage:
 *   node scripts/reconcile-job-monitor-pivot.mjs           # dry-run
 *   node scripts/reconcile-job-monitor-pivot.mjs --apply   # execute
 */

import { execSync } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const STAFFING_AGENCY_NAMES = [
  'robert half',
  'aerotek',
  'kelly services',
  'express employment',
  'adecco',
  'randstad',
  'manpowergroup',
  'appleone',
  'insight global',
  'ultimate staffing',
  'cornerstone staffing',
  'pridestaff',
  'labor finders',
  'staffmark',
  'teksystems',
  'jobot',
  'gpac',
  'nesco resource',
  'volt workforce',
  'peopleready',
  'spherion',
  'burnett specialists',
  'addison group',
  'creative circle',
  'kforce',
  'cybercoders',
  'motion recruitment',
  'lhh',
  'aston carter',
  'onin staffing',
]

// Belt-and-suspenders: assert the inlined banlist matches the worker source.
const qualifySource = readFileSync(resolve('workers/job-monitor/src/qualify.ts'), 'utf-8')
for (const name of STAFFING_AGENCY_NAMES) {
  if (!qualifySource.includes(`'${name}'`)) {
    console.error(
      `Drift: '${name}' is in this script but not in qualify.ts. Re-sync before applying.`
    )
    process.exit(1)
  }
}

function inferPostingActorRole({ company_name, apply_options = [] }) {
  const company = (company_name || '').trim().toLowerCase()
  if (!company) return 'unknown'
  if (
    company.includes('confidential') ||
    company.includes('confidential client') ||
    company.includes('our client')
  )
    return 'staffing_agency'
  if (STAFFING_AGENCY_NAMES.some((n) => company.includes(n))) return 'staffing_agency'
  const uniqueLinks = new Set((apply_options || []).map((o) => o?.link?.trim()).filter(Boolean))
  if (uniqueLinks.size >= 3) return 'syndicator'
  return 'direct'
}

function decodeJobHash(b64) {
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
  } catch {
    return null
  }
}

function d1Read(sql) {
  const out = execSync(
    `npx wrangler d1 execute ss-console-db --remote --json --command ${JSON.stringify(sql)}`,
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
  )
  return JSON.parse(out)
}

const apply = process.argv.includes('--apply')

console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
console.log('Loading job_monitor signal-stage entities...')

const result = d1Read(
  `SELECT e.id, e.name, e.org_id, c.metadata FROM entities e LEFT JOIN context c ON c.entity_id=e.id AND c.type='signal' AND c.source='job_monitor' WHERE e.stage='signal' AND e.source_pipeline='job_monitor' GROUP BY e.id ORDER BY e.created_at DESC`
)
const rows = result[0].results
console.log(`Loaded ${rows.length} entities\n`)

const decisions = rows.map((r) => {
  let companyName = r.name
  let applyOptions = []
  if (r.metadata) {
    try {
      const meta = JSON.parse(r.metadata)
      if (meta.job_hash) {
        const decoded = decodeJobHash(meta.job_hash)
        if (decoded) {
          companyName = decoded.company_name || r.name
          applyOptions = decoded.apply_options || []
        }
      }
    } catch {
      /* metadata not JSON, keep entity.name as-is */
    }
  }
  const role = inferPostingActorRole({ company_name: companyName, apply_options: applyOptions })
  // Tier 2: explicit franchise-in-name structural disqualifier. ADR 0003
  // §5 names "national-chain franchise" as one of the five structural
  // disqualifiers. A name that literally cites "franchise" is an
  // unambiguous self-identification — no false positives possible.
  const franchiseInName = /\bfranchise\b/i.test(r.name) || /\bfranchise\b/i.test(companyName)
  let category = 'keep'
  if (role === 'staffing_agency' || role === 'syndicator') category = 'wrong-actor'
  else if (franchiseInName) category = 'franchise'
  return {
    id: r.id,
    org_id: r.org_id,
    entity_name: r.name,
    raw_company: companyName,
    apply_count: applyOptions.length,
    role,
    franchiseInName,
    category,
  }
})

const buckets = decisions.reduce((acc, d) => {
  acc[d.category] ??= []
  acc[d.category].push(d)
  return acc
}, {})

console.log('Classification:')
console.log(`  wrong-actor (actor-role filter)   ${(buckets['wrong-actor'] || []).length}`)
console.log(`  franchise (explicit-in-name)      ${(buckets['franchise'] || []).length}`)
console.log(`  keep                              ${(buckets['keep'] || []).length}`)

const wrong = decisions.filter((d) => d.category !== 'keep')
const keep = decisions.filter((d) => d.category === 'keep')

console.log(`\nWould reclassify ${wrong.length} entities as lost / not-a-fit:`)
for (const d of wrong) {
  const same = d.entity_name === d.raw_company ? '' : ` (raw="${d.raw_company}")`
  console.log(`  ${d.category.padEnd(12)} ${d.entity_name}${same}`)
}
console.log(`\nWould keep ${keep.length} entities in Signal (sample 8):`)
for (const d of keep.slice(0, 8)) {
  console.log(`  keep         ${d.entity_name}`)
}
if (keep.length > 8) console.log(`  ... and ${keep.length - 8} more`)

if (!apply) {
  console.log('\n(dry-run, no changes)')
  process.exit(0)
}

// APPLY
console.log('\nApplying...')
const wrongActorReason = 'Wrong-actor pre-pivot reconciliation (ADR 0003)'
const wrongActorDetail =
  "Job posting whose actor was a staffing agency, syndicator, or 'confidential client' / 'our client' arrangement — not the operating business that owns the role. Filtered going forward by ADR 0003 inferPostingActorRole + STAFFING_AGENCY_NAMES banlist."
const franchiseReason = 'Structural disqualifier pre-pivot reconciliation (ADR 0003)'
const franchiseDetail =
  'National-chain franchise — entity name explicitly cites franchise affiliation. ADR 0003 §5 structural disqualifier (corporate playbook, owner has limited autonomy over process and tool decisions).'
const now = new Date().toISOString()

const escape = (s) => String(s).replace(/'/g, "''")
const stmts = []
for (const d of wrong) {
  const isFranchise = d.category === 'franchise'
  const reasonText = isFranchise ? franchiseReason : wrongActorReason
  const lostDetail = isFranchise ? franchiseDetail : wrongActorDetail
  const ctxId = randomUUID()
  const content = `Stage: signal → lost. ${reasonText}. ${lostDetail}`
  const meta = JSON.stringify({
    from: 'signal',
    to: 'lost',
    reason: reasonText,
    lost_reason: 'not-a-fit',
    lost_detail: lostDetail,
  })
  stmts.push(
    `UPDATE entities SET stage='lost', stage_changed_at='${now}', updated_at='${now}' WHERE id='${d.id}' AND org_id='${d.org_id}';`
  )
  stmts.push(
    `INSERT INTO context (id, entity_id, org_id, type, content, source, content_size, metadata, created_at) VALUES ('${ctxId}', '${d.id}', '${d.org_id}', 'stage_change', '${escape(content)}', 'system', ${content.length}, '${escape(meta)}', '${now}');`
  )
}

const sqlFile = '/tmp/job-monitor-reconcile.sql'
writeFileSync(sqlFile, stmts.join('\n') + '\n')
console.log(`Wrote ${wrong.length} entity reclassifications to ${sqlFile}`)
execSync(`npx wrangler d1 execute ss-console-db --remote --file=${sqlFile}`, {
  stdio: 'inherit',
})
console.log(`\nApplied. ${wrong.length} entities reclassified.`)
