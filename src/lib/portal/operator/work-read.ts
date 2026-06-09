/**
 * Work read path (client-portal §5.3). The items the operator's configuration
 * routes to a human. Bridges the frozen ADR 0043 runtime read into a small
 * work-item shape.
 *
 * Entirely entitlement-conditional: an item exists here ONLY because a skill
 * was authored to route to a human (ADR 0035). This reader returns whatever the
 * runtime produces — it never synthesizes a queue. At launch (read path not
 * wired, and/or no skill authored to draft) it returns [], and the surface
 * renders an honest empty state — not a broken queue.
 *
 * Same discipline as activity-read / matters-read: gated on
 * isRuntimeReadConfigured so an unwired deploy returns [] without writing a
 * read-audit row per view; defensive parse, never cast.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { readMachineRuntime, type RuntimeReadActor } from '../../operator/runtime-read'
import {
  createMachineRuntimeTransport,
  createRuntimeReadAudit,
  isRuntimeReadConfigured,
  type RuntimeReadEnv,
} from '../../operator/runtime-read-transport'

export interface WorkItem {
  id: string
  subject: string
  recipient: string
  skill: string
  createdAt: string
}

export interface WorkReadDeps {
  db: D1Database
  env: RuntimeReadEnv
  actorUserId: string
}

/** Items routed to a human for this client. Fails closed to [] until wired. */
export async function loadWorkItems(
  deps: WorkReadDeps,
  customerSlug: string,
  actor: RuntimeReadActor
): Promise<WorkItem[]> {
  if (!isRuntimeReadConfigured(deps.env)) return []
  const result = await readMachineRuntime(
    {
      transport: createMachineRuntimeTransport(deps.env),
      audit: createRuntimeReadAudit(deps.db, { actorUserId: deps.actorUserId }),
    },
    customerSlug,
    { kind: 'draft' },
    actor
  )
  return result.ok ? parseWorkItems(result.data) : []
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function reqString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Parse the runtime payload (bare array or `{ items: [...] }`) into WorkItem[].
 * Rows missing a required field are dropped — never a fabricated work card. */
export function parseWorkItems(data: unknown): WorkItem[] {
  const raw: unknown = isRecord(data) && Array.isArray(data['items']) ? data['items'] : data
  if (!Array.isArray(raw)) return []
  const out: WorkItem[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = reqString(item['id'])
    const subject = reqString(item['subject'])
    const recipient = reqString(item['recipient'])
    const skill = reqString(item['skill'])
    const createdAt = reqString(item['createdAt'])
    if (
      id === null ||
      subject === null ||
      recipient === null ||
      skill === null ||
      createdAt === null
    ) {
      continue
    }
    out.push({ id, subject, recipient, skill, createdAt })
  }
  return out
}
