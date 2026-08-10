/**
 * Initiation-card contract (the Operator "test page" + first-conversation card).
 *
 * The card (operator/customers/<slug>/initiation-card.yaml) is the
 * maintainable source for the staged commands a client speaks to a new
 * Operator. This suite keeps it honest:
 *
 *  - schema shape holds (stages -> commands, required fields present)
 *  - every `backed_by` resolves to a real skill in operator/skills/
 *    (or the literal `core-dialogue` for plain grounded conversation)
 *  - every skill-backed UNLOCKED command is actually bound and enabled on
 *    that seat's customer.yaml — a card telling the client to say something
 *    the seat cannot do is the exact "watch it struggle" failure the card
 *    exists to prevent (locked stages are exempt: they name their unlock)
 *  - every command carries expected AND falsifier — a command we cannot
 *    grade honestly does not go on the card (Law 12)
 *  - the rehearsal mirror: the pilot card carries every unlocked
 *    ashton-price command verbatim (same `say`, same `backed_by`), so what
 *    is rehearsed is what the client is told to say
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { parse as parseYaml } from 'yaml'

// Constant paths only — no interpolated filesystem paths in this suite.
const CARD_PATHS = {
  'ashton-price': resolve('operator/customers/ashton-price/initiation-card.yaml'),
  'pilot-smokeball': resolve('operator/customers/pilot-smokeball/initiation-card.yaml'),
} as const

const SEAT_YAML_PATHS = {
  'ashton-price': resolve('operator/customers/ashton-price/customer.yaml'),
  'pilot-smokeball': resolve('operator/customers/pilot-smokeball/customer.yaml'),
} as const

type Slug = keyof typeof CARD_PATHS

const SEATS = Object.keys(CARD_PATHS) as Slug[]

/** Names of every skill that has a body, listed once — membership checks
 *  replace any input-derived path construction. */
const SKILL_DIRS = new Set(readdirSync(resolve('operator/skills')))

interface CardCommand {
  say: string
  backed_by: string
  proves: string
  expected: string
  falsifier: string
  admin_only?: boolean
}

interface CardStage {
  id: string
  title: string
  commands: CardCommand[]
  locked?: string
}

interface Card {
  schema_version: number
  card_version: string
  customer: string
  stages: CardStage[]
}

function loadCard(slug: Slug): Card {
  return parseYaml(readFileSync(CARD_PATHS[slug], 'utf-8')) as Card
}

function seatSkillBindings(slug: Slug): Map<string, boolean> {
  const raw = parseYaml(readFileSync(SEAT_YAML_PATHS[slug], 'utf-8')) as {
    personas?: Array<{ skills?: Array<{ name: string; enabled?: boolean }> }>
  }
  const map = new Map<string, boolean>()
  for (const persona of raw.personas ?? []) {
    for (const s of persona.skills ?? []) {
      map.set(s.name, s.enabled !== false)
    }
  }
  return map
}

describe.each(SEATS)('initiation card: %s', (slug) => {
  const card = loadCard(slug)

  it('schema shape holds', () => {
    expect(card.schema_version).toBe(1)
    expect(card.customer).toBe(slug)
    expect(card.card_version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(card.stages.length).toBeGreaterThan(0)
    const ids = card.stages.map((s) => s.id)
    expect(new Set(ids).size, 'stage ids must be unique').toBe(ids.length)
    for (const stage of card.stages) {
      expect(stage.title, `stage ${stage.id} title`).toBeTruthy()
      expect(stage.commands.length, `stage ${stage.id} commands`).toBeGreaterThan(0)
    }
  })

  it('every command is gradeable: say, proves, expected, falsifier all present', () => {
    for (const stage of card.stages) {
      for (const cmd of stage.commands) {
        for (const field of ['say', 'backed_by', 'proves', 'expected', 'falsifier'] as const) {
          expect(cmd[field], `stage ${stage.id}: command missing ${field}`).toBeTruthy()
        }
      }
    }
  })

  it('every backed_by resolves to a real skill or core-dialogue', () => {
    for (const stage of card.stages) {
      for (const cmd of stage.commands) {
        if (cmd.backed_by === 'core-dialogue') continue
        expect(
          SKILL_DIRS.has(cmd.backed_by),
          `stage ${stage.id}: backed_by "${cmd.backed_by}" has no skill body under operator/skills/`
        ).toBe(true)
      }
    }
  })

  it('every skill-backed unlocked command is bound and enabled on the seat', () => {
    const bindings = seatSkillBindings(slug)
    for (const stage of card.stages) {
      if (stage.locked) continue
      for (const cmd of stage.commands) {
        if (cmd.backed_by === 'core-dialogue') continue
        expect(
          bindings.get(cmd.backed_by),
          `stage ${stage.id}: "${cmd.say}" is on the card but skill "${cmd.backed_by}" is not bound+enabled on ${slug}`
        ).toBe(true)
      }
    }
  })
})

describe('rehearsal mirror', () => {
  it('every unlocked ashton-price command exists verbatim on the pilot card', () => {
    const ap = loadCard('ashton-price')
    const pilot = loadCard('pilot-smokeball')
    const pilotCommands = new Set(
      pilot.stages.flatMap((s) => s.commands.map((c) => `${c.say}::${c.backed_by}`))
    )
    for (const stage of ap.stages) {
      if (stage.locked) continue
      for (const cmd of stage.commands) {
        expect(
          pilotCommands.has(`${cmd.say}::${cmd.backed_by}`),
          `ashton-price card says "${cmd.say}" but the pilot card does not rehearse it`
        ).toBe(true)
      }
    }
  })

  it('locked stages name their unlock event', () => {
    const ap = loadCard('ashton-price')
    for (const stage of ap.stages) {
      if (stage.locked !== undefined) {
        expect(
          stage.locked.length,
          `stage ${stage.id} locked: must name the unlock`
        ).toBeGreaterThan(10)
      }
    }
  })
})
