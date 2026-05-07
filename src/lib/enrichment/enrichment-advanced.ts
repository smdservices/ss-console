/**
 * Advanced enrichment module wrappers: LinkedIn, intelligence brief, outreach draft.
 * Extracted from index.ts to keep that file under the 500-line ceiling.
 * All exports here are re-exported from index.ts for backward compatibility.
 */

import type { Entity } from '../db/entities'
import { appendContext, assembleEntityContext } from '../db/context'
import { generateOutreachDraft } from '../claude/outreach'
import { lookupLinkedIn } from './linkedin'
import { generateDossier } from './dossier'
import { instrumentModule, fingerprint, type ModuleOutcome } from './instrument'
import {
  type EnrichEnv,
  type EnrichResult,
  applyOutcome,
  NON_AUTHORITATIVE_CONTEXT_META,
} from './types'

export async function tryLinkedIn(
  env: EnrichEnv,
  orgId: string,
  entity: Entity,
  result: EnrichResult
): Promise<void> {
  const outcome = await instrumentModule(
    {
      db: env.DB,
      org_id: orgId,
      entity_id: entity.id,
      module: 'linkedin',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (!env.PROXYCURL_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:proxycurl' }
      const linkedin = await lookupLinkedIn(entity.name, entity.area, env.PROXYCURL_API_KEY)
      if (!linkedin) return { kind: 'no_data', reason: 'no_match' }
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: `LinkedIn: ${linkedin.company_name}. ${linkedin.employee_count ? `~${linkedin.employee_count} employees.` : ''} ${linkedin.industry ? `Industry: ${linkedin.industry}.` : ''} ${linkedin.description ? linkedin.description.slice(0, 200) : ''}`,
        source: 'linkedin',
        metadata: linkedin as unknown as Record<string, unknown>,
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'linkedin', outcome)
}

export async function tryIntelligenceBrief(
  env: EnrichEnv,
  orgId: string,
  entity: Entity,
  result: EnrichResult
): Promise<void> {
  let inputFingerprint: string | null = null
  try {
    const ctx = await assembleEntityContext(env.DB, entity.id, { maxBytes: 32_000 })
    if (ctx) inputFingerprint = await fingerprint(ctx)
  } catch {
    // Informational only.
  }

  const outcome = await instrumentModule(
    {
      db: env.DB,
      org_id: orgId,
      entity_id: entity.id,
      module: 'intelligence_brief',
      mode: result.mode,
      triggered_by: result.triggered_by,
      input_fingerprint: inputFingerprint,
    },
    async (): Promise<ModuleOutcome> => {
      if (!env.ANTHROPIC_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:anthropic' }
      const fullContext = await assembleEntityContext(env.DB, entity.id, { maxBytes: 32_000 })
      if (!fullContext) return { kind: 'skipped', reason: 'no_context' }
      const brief = await generateDossier(fullContext, entity.name, env.ANTHROPIC_API_KEY)
      if (!brief) return { kind: 'no_data', reason: 'no_brief' }
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'enrichment',
        content: brief,
        source: 'intelligence_brief',
        metadata: {
          model: 'claude-sonnet-4-20250514',
          trigger: 'at_ingest',
          ...NON_AUTHORITATIVE_CONTEXT_META,
        },
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'intelligence_brief', outcome)
}

/**
 * Outreach draft generation. Wrapped in `instrumentModule` (issue #631)
 * so failures land a `failed` row in `enrichment_runs` instead of vanishing
 * into a console.error.
 */
export async function tryOutreach(
  env: EnrichEnv,
  orgId: string,
  entity: Entity,
  result: EnrichResult
): Promise<void> {
  const outcome = await instrumentModule(
    {
      db: env.DB,
      org_id: orgId,
      entity_id: entity.id,
      module: 'outreach_draft',
      mode: result.mode,
      triggered_by: result.triggered_by,
    },
    async (): Promise<ModuleOutcome> => {
      if (!env.ANTHROPIC_API_KEY) return { kind: 'skipped', reason: 'missing_api_key:anthropic' }
      const context = await assembleEntityContext(env.DB, entity.id, { maxBytes: 24_000 })
      if (!context) return { kind: 'skipped', reason: 'no_context' }
      const draft = await generateOutreachDraft(
        env.ANTHROPIC_API_KEY,
        entity.name,
        context,
        entity.vertical
      )
      const ce = await appendContext(env.DB, orgId, {
        entity_id: entity.id,
        type: 'outreach_draft',
        content: draft,
        source: 'claude',
        metadata: {
          model: 'claude-sonnet-4-20250514',
          trigger: result.mode === 'full' ? 'at_ingest' : 're_enrich',
          vertical: entity.vertical ?? null,
        },
      })
      return { kind: 'succeeded', context_entry_id: ce.id }
    }
  )
  applyOutcome(result, 'outreach_draft', outcome)
}
