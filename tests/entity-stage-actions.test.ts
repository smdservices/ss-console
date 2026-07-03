/**
 * Guard the entity-detail stage-actions toolbar: rendered, live-endpoint-only.
 *
 * Regression: EntityStageActions.astro was orphaned by the #762 detail-page
 * redesign — the component existed but nothing imported it, so the Leads
 * detail page shipped with no Promote/Lost/draft-proposal affordances and the
 * booking/reply dialogs it opens were rendered but unreachable. The lead-gen
 * retirement (ADR 0060) then left it pointing at a deleted /dossier endpoint.
 * Rebuilt 2026-07-03 (Review 4 Captain call) as a worker-free toolbar; this
 * test pins both halves: the page renders it, and it targets only endpoints
 * that exist.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(rel), 'utf-8')

describe('entity detail page renders the stage-actions toolbar', () => {
  const page = read('src/pages/admin/entities/[id].astro')

  it('imports and renders EntityStageActions', () => {
    expect(page).toMatch(/import EntityStageActions from/)
    expect(page).toMatch(/<EntityStageActions/)
  })

  it('passes the loader-computed transition data through', () => {
    expect(page).toMatch(/transitions=\{transitions\}/)
    expect(page).toMatch(/mostRecentDraftableMeeting=\{mostRecentDraftableMeeting\}/)
  })
})

describe('EntityStageActions targets only live endpoints', () => {
  const src = read('src/components/admin/EntityStageActions.astro')

  it('posts stage transitions to the live stage endpoint', () => {
    expect(src).toMatch(/\/api\/admin\/entities\/\$\{entityId\}\/stage/)
    expect(existsSync(resolve('src/pages/api/admin/entities/[id]/stage.ts'))).toBe(true)
  })

  it('posts draft-proposal to the live meeting draft-quote endpoint', () => {
    expect(src).toMatch(/\/meetings\/\$\{mostRecentDraftableMeeting\.id\}\/draft-quote/)
    expect(
      existsSync(resolve('src/pages/api/admin/entities/[id]/meetings/[meetingId]/draft-quote.ts'))
    ).toBe(true)
  })

  it('posts new quotes to the live quotes endpoint', () => {
    expect(src).toMatch(/\/api\/admin\/entities\/\$\{entityId\}\/quotes/)
    expect(existsSync(resolve('src/pages/api/admin/entities/[id]/quotes.ts'))).toBe(true)
  })

  it('opens the booking and reply dialogs via their real wiring hooks', () => {
    // entity-detail-client.ts binds #send-booking-link-btn; LogReplyDialog
    // binds [data-open-reply-dialog]. Both must exist or the dialogs are
    // rendered-but-unreachable again.
    expect(src).toMatch(/id="send-booking-link-btn"/)
    expect(src).toMatch(/data-open-reply-dialog=\{entityId\}/)
    expect(read('src/lib/admin/entity-detail-client.ts')).toMatch(/send-booking-link-btn/)
  })

  it('carries no retired lead-gen machinery', () => {
    // The /dossier endpoint, re-enrich action, and machine-drafted outreach
    // mailto were removed with the automated lead-gen machine (ADR 0060).
    // Scan form targets and props, not the header comment (which names the
    // history on purpose).
    expect(src).not.toMatch(/action=.*dossier/)
    expect(src).not.toMatch(/id="re-enrich/)
    expect(src).not.toMatch(/outreachMailto/)
    expect(src).not.toMatch(/showReEnrichButton/)
  })
})
