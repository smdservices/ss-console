/**
 * V4 /book client controller.
 *
 * Three-state shell: intro → slots → closed.
 *
 *   intro   : IntakeIntroCard form. Two CTAs:
 *               - "Pick a time" submits via /api/intake/send and
 *                 transitions to the slot picker.
 *               - "Just send a note" submits via /api/intake/send and
 *                 transitions to the slot picker with a "Got your note"
 *                 banner above it. No terminal acknowledgment state —
 *                 the slot picker is on screen either way, so the
 *                 prospect can book if they want, or close the tab if
 *                 they do not.
 *             Both paths create the entity and fire backstage enrichment.
 *   slots   : IntakeSlots wrapping SlotPicker + selected-slot banner +
 *             confirm button. Pick a time, hit confirm, POST /api/booking/reserve.
 *   closed  : IntakeClosed acknowledgment card. Single 'booked' variant —
 *             surfaces the confirmed slot and reschedule link. Google
 *             Meet join link lives on the calendar invite and
 *             confirmation email.
 *
 * DOM location lives in book-elements.ts. State transitions and slot-
 * selected handling live in book-render.ts. This file owns network
 * calls and event binding.
 */

import { locateElements, type BookElements } from './book-elements'
import {
  clearIntroError,
  handleSlotSelected,
  showClosedBooked,
  showIntro,
  showIntroError,
  showSlots,
  type BookState,
  type BookingResponse,
} from './book-render'

interface IntakeSendResponse {
  ok?: boolean
  entity_id?: string
  error?: string
  message?: string
  field_errors?: Record<string, string>
  meta_event_id?: string
}

type IntakeIntent = 'book' | 'send'

const RENDERED_AT = Date.now()

/**
 * Browser half of the Meta event dedup pair (ADR 0066 gate 2, #1723). The
 * server mints the event_id, sends the CAPI event, and returns the id as
 * `meta_event_id`; firing the same event name with { eventID } here lets
 * Meta collapse the pair. No-op when the pixel isn't loaded (unconfigured
 * pixel id, GPC honored, or script blocked).
 */
function fireMetaBrowserEvent(eventName: 'Lead' | 'Schedule', eventId: string | undefined): void {
  if (!eventId) return
  const fbq = (window as { fbq?: (...args: unknown[]) => void }).fbq
  if (typeof fbq !== 'function') return
  fbq('track', eventName, {}, { eventID: eventId })
}

// ---------------------------------------------------------------------------
// Form-data helpers
// ---------------------------------------------------------------------------

function readStringField(fd: FormData, key: string): string {
  const value = fd.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function readIntroFormPayload(els: BookElements): {
  name: string
  email: string
  business_name: string
  message: string
  interest: string | null
} {
  const fd = new FormData(els.introForm)
  const interest = readStringField(fd, 'interest')
  return {
    name: readStringField(fd, 'name'),
    email: readStringField(fd, 'email'),
    business_name: readStringField(fd, 'business_name'),
    message: readStringField(fd, 'message'),
    interest: interest.length > 0 ? interest : null,
  }
}

// ---------------------------------------------------------------------------
// Network: submit intake (POST /api/intake/send)
// ---------------------------------------------------------------------------

function extractSendErrorMessage(res: Response, body: IntakeSendResponse): string {
  if (res.status === 400 && body.field_errors) {
    return (
      Object.values(body.field_errors).join(' ') || body.message || 'Some fields need attention.'
    )
  }
  if (res.status === 429) return 'Too many submissions. Wait a few minutes and try again.'
  return body.message ?? body.error ?? 'Something went wrong. Try again.'
}

async function submitIntake(
  els: BookElements,
  state: BookState,
  intent: IntakeIntent
): Promise<void> {
  clearIntroError(els)
  const payload = readIntroFormPayload(els)
  const missing: string[] = []
  if (!payload.name) missing.push('name')
  if (!payload.email) missing.push('email')
  if (!payload.business_name) missing.push('business')
  if (!payload.message) missing.push('a message')
  if (missing.length > 0) {
    showIntroError(els, `Please add ${missing.join(', ')}.`)
    return
  }

  const activeBtn = intent === 'book' ? els.introStartBtn : els.introSendBtn
  const originalLabel = activeBtn.textContent
  els.introStartBtn.disabled = true
  els.introSendBtn.disabled = true
  activeBtn.textContent = intent === 'book' ? 'Loading...' : 'Sending...'

  try {
    const res = await fetch('/api/intake/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, rendered_at: RENDERED_AT }),
    })
    const body = (await res.json().catch(() => ({}))) as IntakeSendResponse

    if (!res.ok || !body.ok) {
      showIntroError(els, extractSendErrorMessage(res, body))
      els.introStartBtn.disabled = false
      els.introSendBtn.disabled = false
      activeBtn.textContent = originalLabel
      return
    }

    fireMetaBrowserEvent('Lead', body.meta_event_id)

    state.email = payload.email
    state.name = payload.name
    state.businessName = payload.business_name
    // Both intents land on the slot picker. The 'send' path adds an
    // acknowledgment banner above it so the message-was-received
    // confirmation is on-screen with zero extra clicks. If the prospect
    // does nothing from here, that is fine.
    showSlots(els, state, { ack: intent === 'send' })
  } catch (err) {
    console.error('[book] /api/intake/send error:', err)
    showIntroError(els, 'Could not reach the server. Check your connection and try again.')
    els.introStartBtn.disabled = false
    els.introSendBtn.disabled = false
    activeBtn.textContent = originalLabel
  }
}

// ---------------------------------------------------------------------------
// Network: Confirm slot (POST /api/booking/reserve)
// ---------------------------------------------------------------------------

async function handleConfirmSlot(els: BookElements, state: BookState): Promise<void> {
  if (!state.currentSlot || !state.email || !state.name || !state.businessName) return

  els.confirmSlotBtn.disabled = true
  const originalText = els.confirmSlotBtn.textContent
  els.confirmSlotBtn.textContent = 'Booking...'
  els.slotError.hidden = true
  els.slotTaken.hidden = true

  const payload: Record<string, unknown> = {
    name: state.name,
    email: state.email,
    business_name: state.businessName,
    slot_start_utc: state.currentSlot.start_utc,
    timezone: state.currentSlot.timezone,
  }
  if (els.prefillTokenStore?.value) {
    payload.prefill_token = els.prefillTokenStore.value
  }

  const reset = (): void => {
    els.confirmSlotBtn.disabled = !state.currentSlot
    els.confirmSlotBtn.textContent = originalText ?? 'Confirm time'
  }

  try {
    const res = await fetch('/api/booking/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as BookingResponse

    if (res.status === 201) {
      fireMetaBrowserEvent('Schedule', body.meta_event_id)
      showClosedBooked(els, state, body)
      return
    }
    if (res.status === 409) {
      els.slotTaken.hidden = false
      state.currentSlot = null
      els.selectedSlotBanner.hidden = true
      els.confirmSlotBtn.disabled = true
      if (els.slotPicker.refetchSlots) els.slotPicker.refetchSlots()
      reset()
      return
    }
    if (res.status === 503) {
      els.slotError.textContent =
        'Online booking is temporarily unavailable. Try again in a moment.'
      els.slotError.hidden = false
      reset()
      return
    }
    els.slotError.textContent = body.message ?? body.error ?? 'Something went wrong. Try again.'
    els.slotError.hidden = false
    reset()
  } catch (err) {
    console.error('[book] reserve error:', err)
    els.slotError.textContent = 'Could not reach the server. Check your connection and try again.'
    els.slotError.hidden = false
    reset()
  }
}

// ---------------------------------------------------------------------------
// Bind
// ---------------------------------------------------------------------------

function bindIntro(els: BookElements, state: BookState): void {
  els.introForm.addEventListener('submit', (e) => {
    e.preventDefault()
    void submitIntake(els, state, 'book')
  })
  els.introSendBtn.addEventListener('click', () => {
    void submitIntake(els, state, 'send')
  })
}

function bindSlots(els: BookElements, state: BookState): void {
  els.slotPicker.addEventListener('slot-selected', (event) => {
    handleSlotSelected(event, els, state)
  })
  els.changeSlotBtn.addEventListener('click', () => {
    els.slotPicker.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  els.confirmSlotBtn.addEventListener('click', () => {
    void handleConfirmSlot(els, state)
  })
}

;(() => {
  const els = locateElements()
  if (!els) return
  const state: BookState = {
    shellState: 'intro',
    email: null,
    name: null,
    businessName: null,
    currentSlot: null,
    slotsFetched: false,
  }
  showIntro(els, state)
  bindIntro(els, state)
  bindSlots(els, state)
})()

export {}
