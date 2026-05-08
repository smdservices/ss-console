/**
 * Source-level regression coverage for the V3 /book three-state shell.
 *
 * The page renders three Astro components (IntakeIntroCard, IntakeChat,
 * IntakeClosed) with two scripts wiring them: book.ts (state transitions
 * + network) and unified-intake.ts (voice on every textarea). These
 * tests inspect the source files to lock in the structural promises the
 * plan makes:
 *
 *   - The intro card has email + name + first-message textarea + mic on
 *     the textarea, and one primary "Start" button (Pattern 03).
 *   - The chat shell pre-renders hidden, has a sticky input bar with
 *     mic, send arrow, and a "Done" quiet link. The slot picker is
 *     pre-mounted as the final assistant turn (hidden until surfaced).
 *   - The page header has a persistent "Or pick a time to talk" link
 *     in all states.
 *   - book.ts has retry-affordance code and idempotency-key wiring for
 *     the Retry path.
 *   - unified-intake.ts uses data-mic-target to wire mic on every
 *     textarea in the shell.
 *
 * Behavioral coverage of the network paths lives in
 * tests/booking/intake-continue.test.ts (server) — these tests are
 * source-level structure assertions, the same shape as
 * tests/intake-questionnaire.test.ts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const bookSrc = readFileSync(resolve('src/pages/book.astro'), 'utf-8')
const introCardSrc = readFileSync(resolve('src/components/booking/IntakeIntroCard.astro'), 'utf-8')
const chatSrc = readFileSync(resolve('src/components/booking/IntakeChat.astro'), 'utf-8')
const closedSrc = readFileSync(resolve('src/components/booking/IntakeClosed.astro'), 'utf-8')
const bookTs = readFileSync(resolve('src/scripts/book.ts'), 'utf-8')
const bookRenderTs = readFileSync(resolve('src/scripts/book-render.ts'), 'utf-8')
const unifiedIntakeTs = readFileSync(resolve('src/scripts/unified-intake.ts'), 'utf-8')
const globalCss = readFileSync(resolve('src/styles/global.css'), 'utf-8')

describe('V3 /book three-state shell — page', () => {
  it('imports the three V3 components', () => {
    expect(bookSrc).toContain(
      "import IntakeIntroCard from '../components/booking/IntakeIntroCard.astro'"
    )
    expect(bookSrc).toContain("import IntakeChat from '../components/booking/IntakeChat.astro'")
    expect(bookSrc).toContain("import IntakeClosed from '../components/booking/IntakeClosed.astro'")
  })

  it('renders the persistent header "pick a time to talk" link', () => {
    expect(bookSrc).toContain('id="header-pick-time-link"')
    expect(bookSrc).toContain('Or pick a time to talk')
  })

  it('wraps the three states in the unified-intake root', () => {
    expect(bookSrc).toMatch(/id="unified-intake"\s+data-state="intro"/)
    expect(bookSrc).toContain('<IntakeIntroCard')
    expect(bookSrc).toContain('<IntakeChat')
    expect(bookSrc).toContain('<IntakeClosed')
  })

  it('imports both client scripts', () => {
    expect(bookSrc).toContain("import '../scripts/book.ts'")
    expect(bookSrc).toContain("import '../scripts/unified-intake.ts'")
  })
})

describe('V3 /book — IntakeIntroCard', () => {
  it('renders three required fields: email, name, message', () => {
    expect(introCardSrc).toContain('id="intro-email"')
    expect(introCardSrc).toContain('id="intro-name"')
    expect(introCardSrc).toContain('id="intro-message"')
  })

  it('mic button targets the message textarea', () => {
    expect(introCardSrc).toContain('id="intro-mic-btn"')
    expect(introCardSrc).toContain('data-mic-target="intro-message"')
  })

  it('has exactly one primary "Start" button (Pattern 03 — one CTA per view)', () => {
    expect(introCardSrc).toContain('id="intro-start-btn"')
    // The "Or pick a time to talk" link is a quiet link, NOT a primary.
    // Count `class="ss-primary"` occurrences in the component.
    const primaryCount = (introCardSrc.match(/class="ss-primary"/g) ?? []).length
    expect(primaryCount).toBe(1)
  })

  it('shows the persistent "or pick a time to talk" link as a quiet link', () => {
    expect(introCardSrc).toContain('id="intro-pick-time-link"')
    expect(introCardSrc).toContain('class="ss-quiet-link"')
  })

  it('does NOT collect business_name, phone, or website as visible fields', () => {
    // `business_name` may appear as a hidden input for prefill links,
    // but never as a labeled visible field. Phone and website are gone.
    expect(introCardSrc).not.toMatch(/id="intro-phone"/)
    expect(introCardSrc).not.toMatch(/id="intro-website"/)
    // If business_name is present, it must be a hidden input.
    if (/name="business_name"/.test(introCardSrc)) {
      expect(introCardSrc).toMatch(/type="hidden"\s+name="business_name"/)
    }
  })
})

describe('V3 /book — IntakeChat', () => {
  it('is rendered hidden so the page swaps it in after Start', () => {
    expect(chatSrc).toMatch(/<section\s+id="intake-chat"\s+class="ss-chat"\s+hidden>/)
  })

  it('has a thread container with aria-live for assistive tech', () => {
    expect(chatSrc).toContain('id="chat-thread"')
    expect(chatSrc).toContain('aria-live="polite"')
  })

  it('has a sticky input bar with textarea, mic, and send arrow', () => {
    expect(chatSrc).toContain('id="chat-reply"')
    expect(chatSrc).toContain('id="chat-mic-btn"')
    expect(chatSrc).toContain('data-mic-target="chat-reply"')
    expect(chatSrc).toContain('id="chat-send-btn"')
    // Arrow icon, not a "Send" word, to avoid the V2 ambiguity.
    expect(chatSrc).toContain('arrow_upward')
  })

  it('has a "Done" quiet link below the input row', () => {
    expect(chatSrc).toContain('id="chat-done-btn"')
    expect(chatSrc).toContain('data-action="done"')
  })

  it('mounts the slot picker as the final assistant turn (hidden initially)', () => {
    expect(chatSrc).toMatch(/id="chat-slot-turn"\s+class="ss-turn"\s+hidden/)
    // Imports SlotPicker so the picker renders inside this component.
    expect(chatSrc).toContain("import SlotPicker from './SlotPicker.astro'")
    expect(chatSrc).toContain('<SlotPicker />')
  })

  it('confirm button is the only primary CTA in the slot turn', () => {
    expect(chatSrc).toContain('id="chat-confirm-slot-btn"')
    const primaryCount = (chatSrc.match(/class="ss-primary[^"]*"/g) ?? []).length
    // Confirm slot — a single primary action lives in the slot turn.
    expect(primaryCount).toBe(1)
  })
})

describe('V3 /book — IntakeClosed', () => {
  it('is rendered hidden with two flavors (booked, done)', () => {
    expect(closedSrc).toMatch(/<section\s+id="intake-closed"\s+class="ss-closed"\s+hidden>/)
    expect(closedSrc).toContain('id="closed-booked"')
    expect(closedSrc).toContain('id="closed-done"')
    expect(closedSrc).toContain('data-flavor="booked"')
    expect(closedSrc).toContain('data-flavor="done"')
  })

  it('done flavor has only a primary "Pick a time to talk" CTA, no follow-up promise', () => {
    expect(closedSrc).toContain('id="closed-done-pick-time"')
    // The done card primary is the pick-a-time link.
    expect(closedSrc).toMatch(/id="closed-done-pick-time"[^>]*class="ss-primary[^"]*"/)
  })

  it('booked flavor surfaces the confirmed slot and optional meet/manage links', () => {
    expect(closedSrc).toContain('id="closed-booked-slot"')
    expect(closedSrc).toContain('id="closed-booked-meet-link"')
    expect(closedSrc).toContain('id="closed-booked-manage-link"')
  })
})

describe('V3 /book — book.ts', () => {
  it('owns the three shell-state transitions (helpers live in book-render.ts)', () => {
    // Transition helpers live in book-render.ts; book.ts imports them.
    expect(bookRenderTs).toContain('function showIntro(')
    expect(bookRenderTs).toContain('function showChat(')
    expect(bookRenderTs).toContain('function showClosedBooked(')
    expect(bookRenderTs).toContain('function showClosedDone(')
    // book.ts wires them up.
    expect(bookTs).toContain("from './book-render'")
    expect(bookTs).toContain('showIntro')
    expect(bookTs).toContain('showChat')
    expect(bookTs).toContain('showClosedBooked')
    expect(bookTs).toContain('showClosedDone')
  })

  it('sends an idempotency_key on the continue call', () => {
    // The Retry button replays without duplicating the user turn.
    expect(bookTs).toContain('idempotency_key')
    expect(bookTs).toContain('makeIdempotencyKey')
  })

  it('attaches an inline retry affordance on /api/intake/continue failure', () => {
    // The retry affordance helper lives in book-render.ts; book.ts wires it.
    expect(bookRenderTs).toContain('attachRetryAffordance')
    expect(bookRenderTs).toContain("textContent = 'Retry'")
    expect(bookRenderTs).toContain('Pick a time to talk')
    expect(bookTs).toContain('attachRetryAffordance')
  })

  it('handles slot_picker_next from the response', () => {
    expect(bookTs).toContain('slot_picker_next')
    expect(bookTs).toContain('surfaceSlotPickerTurn')
  })

  it('POSTs closed: true on Done click', () => {
    expect(bookTs).toContain('handleDone')
    expect(bookTs).toMatch(/JSON\.stringify\(\{\s*closed:\s*true\s*\}\)/)
  })

  it('handles 409 in_flight on Done by re-enabling the button without closing', () => {
    expect(bookTs).toContain('res.status === 409')
    expect(bookTs).toContain('reply is being generated')
  })

  it('confirms a slot and routes to the booked closed-state', () => {
    expect(bookTs).toContain('handleConfirmSlot')
    expect(bookTs).toContain('/api/booking/reserve')
  })
})

describe('V3 /book — unified-intake.ts (voice on every textarea)', () => {
  it('walks every button[data-mic-target] to wire mic on each pair', () => {
    expect(unifiedIntakeTs).toContain('button[data-mic-target]')
  })

  it('handles both intro and chat helper-message ids', () => {
    expect(unifiedIntakeTs).toContain("'intro-mic-btn'")
    expect(unifiedIntakeTs).toContain("'intro-voice-unsupported'")
    expect(unifiedIntakeTs).toContain("'chat-mic-btn'")
    expect(unifiedIntakeTs).toContain("'chat-voice-unsupported'")
  })

  it('appends transcripts via shared helper', () => {
    expect(unifiedIntakeTs).toContain('function appendTranscript')
  })
})

describe('V3 /book — global.css', () => {
  it('respects prefers-reduced-motion globally', () => {
    expect(globalCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    expect(globalCss).toMatch(/scroll-behavior:\s*auto/)
  })

  it('defines the Plainspoken chat shell tokens (zero-radius, hairline borders)', () => {
    expect(globalCss).toContain('.ss-chat')
    expect(globalCss).toContain('.ss-chat-input')
    expect(globalCss).toContain('.ss-chat-meta')
    expect(globalCss).toContain('.ss-turn')
    expect(globalCss).toContain('.ss-turn-role')
    expect(globalCss).toContain('.ss-mic-btn')
    expect(globalCss).toContain('.ss-send-btn')
  })
})
