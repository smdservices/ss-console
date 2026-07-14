import { describe, it, expect } from 'vitest'
import { startsLabels, resolveOperatorWork } from '../src/lib/portal/operator/facets/work/work'
import { SKILL_SUMMARIES } from '../src/lib/portal/operator/facets/skills/skill-summaries'
import type {
  CustomerConfigRow,
  PersonaConfig,
  PersonaSkill,
} from '../src/lib/portal/customer-config'
import type {
  RoutineGrid,
  RoutineGridRow,
  RoutineGridEnforcement,
  RoutineTier,
} from '../src/lib/operator/routine-grid'
import type { SkillInitiation } from '../src/lib/operator/customer-yaml/types'

/**
 * Operator "The work" facet resolver (ADR 0076; console structure doc §3.2).
 * Read-only projection of the routine grid (ADR 0075) into the lifecycle-grouped
 * view model, plus the gridless skills fallback. Every rendered fact traces to
 * an authored grid field, the fixed tier / starts maps, or the reviewed skill
 * summaries — nothing invented.
 *
 * Fixtures carry NO vertical vocabulary: the grid supplies the vertical as DATA
 * at runtime, so the resolver (and these fixtures) stay neutral.
 */

// 'health-monitor' is a real, vertical-neutral entry in the reviewed summaries
// catalog — used to prove a summary is attached from the catalog, never invented.
const SUMMARIZED_SLUG = 'health-monitor'

function enforcement(p: Partial<RoutineGridEnforcement> = {}): RoutineGridEnforcement {
  return {
    initiation: 'manual',
    exposure_keys: {},
    content_floor: false,
    banned_tools: [],
    notes: '',
    ...p,
  }
}

function row(p: Partial<RoutineGridRow> = {}): RoutineGridRow {
  // Ceiling defaults to the start tier (no graduation headroom) unless the
  // fixture sets it explicitly. Tiers are applied LAST so the computed defaults
  // win over the base literals, without duplicating keys across the spread.
  const start_tier: RoutineTier = p.start_tier ?? 'flag-only'
  const ceiling_tier: RoutineTier = p.ceiling_tier ?? start_tier
  return {
    routine: 'A routine',
    letter_section: 'Section one',
    skills: [],
    start_verbatim: 'We surface it.',
    ceiling_verbatim: 'We surface it.',
    enforcement: enforcement(),
    ...p,
    start_tier,
    ceiling_tier,
  }
}

function grid(rows: RoutineGridRow[]): RoutineGrid {
  return {
    adr: 'ADR 0075',
    seat: 'test-seat',
    persona: 'test-persona',
    source_letter: 'test-letter',
    rows,
  }
}

/** Grid-mode config: only routine_grid is read in this branch. */
function gridConfig(rows: RoutineGridRow[]): CustomerConfigRow {
  return { routine_grid: grid(rows), personas: [] } as unknown as CustomerConfigRow
}

// --- gridless-mode fixtures (mirror the skills resolver's inputs) -------------

function init(p: Partial<SkillInitiation> = {}): SkillInitiation {
  return { manual: false, scheduled: false, webhook: false, ...p }
}

function skill(name: string, i: Partial<SkillInitiation> = {}): PersonaSkill {
  return { name, initiation: init(i) }
}

function persona(p: Partial<PersonaConfig>): PersonaConfig {
  return {
    slug: 'p',
    status: 'active',
    name: 'X',
    title: null,
    signature_html: null,
    tone: [],
    send_as: null,
    entitlements: {} as PersonaConfig['entitlements'],
    skills: [],
    channel_bindings: [],
    ...p,
  }
}

/** Gridless-mode config: no grid, skills read from the active persona. */
function gridlessConfig(personas: PersonaConfig[]): CustomerConfigRow {
  return { routine_grid: null, personas } as unknown as CustomerConfigRow
}

describe('startsLabels', () => {
  it('maps each initiation mode to its client-legible label by substring detection', () => {
    expect(startsLabels('manual')).toEqual(['On request'])
    expect(startsLabels('scheduled')).toEqual(['On a schedule'])
    expect(startsLabels('webhook')).toEqual(['When something happens'])
  })

  it('detects modes inside a free-text initiation string, in a stable order', () => {
    // Words appear out of canonical order in the source string; output is fixed
    // request → schedule → event regardless.
    expect(startsLabels('webhook and scheduled; also manual')).toEqual([
      'On request',
      'On a schedule',
      'When something happens',
    ])
  })

  it('returns [] when no known mode is present (viewer shows nothing)', () => {
    expect(startsLabels('')).toEqual([])
    expect(startsLabels('something else entirely')).toEqual([])
  })
})

describe('resolveOperatorWork — grid mode', () => {
  it('groups rows into sections by letter_section in first-appearance order, preserving row order', () => {
    const model = resolveOperatorWork(
      gridConfig([
        row({ routine: 'First', letter_section: 'Alpha' }),
        row({ routine: 'Second', letter_section: 'Beta' }),
        row({ routine: 'Third', letter_section: 'Alpha' }),
      ])
    )
    expect(model.mode).toBe('grid')
    if (model.mode !== 'grid') return
    expect(model.sections.map((s) => s.name)).toEqual(['Alpha', 'Beta'])
    expect(model.sections[0].routines.map((r) => r.routine)).toEqual(['First', 'Third'])
    expect(model.sections[1].routines.map((r) => r.routine)).toEqual(['Second'])
  })

  it('renders each tier as its locked plain sentence for the Today line', () => {
    const model = resolveOperatorWork(
      gridConfig([
        row({ routine: 'a', start_tier: 'flag-only' }),
        row({ routine: 'b', start_tier: 'prepare-and-route' }),
        row({ routine: 'c', start_tier: 'auto-handle' }),
      ])
    )
    if (model.mode !== 'grid') throw new Error('expected grid mode')
    const today = model.sections[0].routines.map((r) => r.todaySentence)
    expect(today).toEqual(['Surfaces it', 'Prepares it for you', 'Handles it'])
  })

  it('surfaces a Can-become sentence + verbatim when the ceiling exceeds the start (headroom)', () => {
    const model = resolveOperatorWork(
      gridConfig([
        row({
          start_tier: 'prepare-and-route',
          ceiling_tier: 'auto-handle',
          ceiling_verbatim: 'You may authorize sending on its own.',
        }),
      ])
    )
    if (model.mode !== 'grid') throw new Error('expected grid mode')
    const r = model.sections[0].routines[0]
    expect(r.canBecomeSentence).toBe('Handles it')
    expect(r.canBecomeVerbatim).toBe('You may authorize sending on its own.')
    expect(r.capVerbatim).toBeNull()
  })

  it('renders the ceiling verbatim as the standing cap (no Can-become) when ceiling equals start', () => {
    const model = resolveOperatorWork(
      gridConfig([
        row({
          start_tier: 'flag-only',
          ceiling_tier: 'flag-only',
          ceiling_verbatim: 'It never acts on its own here.',
        }),
      ])
    )
    if (model.mode !== 'grid') throw new Error('expected grid mode')
    const r = model.sections[0].routines[0]
    expect(r.canBecomeSentence).toBeNull()
    expect(r.canBecomeVerbatim).toBeNull()
    expect(r.capVerbatim).toBe('It never acts on its own here.')
  })

  it('parses the row initiation into client-legible starts labels', () => {
    const model = resolveOperatorWork(
      gridConfig([row({ enforcement: enforcement({ initiation: 'manual, scheduled' }) })])
    )
    if (model.mode !== 'grid') throw new Error('expected grid mode')
    expect(model.sections[0].routines[0].startsLabels).toEqual(['On request', 'On a schedule'])
  })

  it('humanizes implementing-skill slugs and attaches the reviewed summary, null when uncatalogued', () => {
    const model = resolveOperatorWork(
      gridConfig([row({ skills: [SUMMARIZED_SLUG, 'a-skill-with-no-summary'] })])
    )
    if (model.mode !== 'grid') throw new Error('expected grid mode')
    const skills = model.sections[0].routines[0].skills
    expect(skills[0]).toEqual({
      name: 'Health monitor',
      slug: SUMMARIZED_SLUG,
      summary: SKILL_SUMMARIES[SUMMARIZED_SLUG],
    })
    expect(skills[1].summary).toBeNull()
  })
})

describe('resolveOperatorWork — gridless fallback', () => {
  it('degrades to the skills inventory (identical to the Skills resolver) when no grid is projected', () => {
    const model = resolveOperatorWork(
      gridlessConfig([
        persona({
          skills: [
            skill('welcome-message', { webhook: true }),
            skill('weekly-summary', { scheduled: true }),
          ],
        }),
      ])
    )
    expect(model.mode).toBe('gridless')
    if (model.mode !== 'gridless') return
    expect(model.skills.map((s) => s.slug)).toEqual(['welcome-message', 'weekly-summary'])
    expect(model.skills[0].name).toBe('Welcome message')
    expect(model.skills[0].initiation).toEqual(['When something happens'])
    expect(model.skills[1].initiation).toEqual(['On a schedule'])
  })

  it('is gridless with an empty skills list when config is null (honest empty state)', () => {
    const model = resolveOperatorWork(null)
    expect(model.mode).toBe('gridless')
    if (model.mode !== 'gridless') return
    expect(model.skills).toEqual([])
  })

  it('is gridless with an empty skills list when a gridless config has no active persona', () => {
    const model = resolveOperatorWork(
      gridlessConfig([persona({ status: 'archived', skills: [skill('x', { manual: true })] })])
    )
    if (model.mode !== 'gridless') throw new Error('expected gridless mode')
    expect(model.skills).toEqual([])
  })
})
