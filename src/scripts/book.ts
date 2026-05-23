/**
 * V4 /book client controller.
 *
 * Three-state shell: intro → slots → closed (booked).
 *
 *   intro   : IntakeIntroCard form. Submit POSTs /api/intake/send,
 *             which creates the entity and fires backstage enrichment.
 *             On success, transition straight to slots.
 *   slots   : IntakeSlots wrapping SlotPicker + selected-slot banner +
 *             confirm button. Pick a time, hit confirm, POST /api/booking/reserve.
 *   closed  : IntakeClosed acknowledgment card showing the booked slot
 *             plus the Google Meet + manage links.
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
}

const RENDERED_AT = Date.now()

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
  message: string
  business_name: string | null
  interest: string | null
} {
  const fd = new FormData(els.introForm)
  const business = readStringField(fd, 'business_name')
  const interest = readStringField(fd, 'interest')
  return {
    name: readStringField(fd, 'name'),
    email: readStringField(fd, 'email'),
    message: readStringField(fd, 'message'),
    business_name: business.length > 0 ? business : null,
    interest: interest.length > 0 ? interest : null,
  }
}

// ---------------------------------------------------------------------------
// Network: Start (POST /api/intake/send) → slot picker
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

async function handleStart(els: BookElements, state: BookState): Promise<void> {
  clearIntroError(els)
  const payload = readIntroFormPayload(els)
  const missing: string[] = []
  if (!payload.name) missing.push('name')
  if (!payload.email) missing.push('email')
  if (!payload.message) missing.push('a message')
  if (missing.length > 0) {
    showIntroError(els, `Please add ${missing.join(', ')}.`)
    return
  }

  els.introStartBtn.disabled = true
  els.introStartBtn.textContent = 'Loading...'

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
      els.introStartBtn.textContent = 'Pick a time'
      return
    }

    state.email = payload.email
    state.name = payload.name
    showSlots(els, state)
  } catch (err) {
    console.error('[book] /api/intake/send error:', err)
    showIntroError(els, 'Could not reach the server. Check your connection and try again.')
    els.introStartBtn.disabled = false
    els.introStartBtn.textContent = 'Pick a time'
  }
}

// ---------------------------------------------------------------------------
// Network: Confirm slot (POST /api/booking/reserve)
// ---------------------------------------------------------------------------

async function handleConfirmSlot(els: BookElements, state: BookState): Promise<void> {
  if (!state.currentSlot || !state.email || !state.name) return

  els.confirmSlotBtn.disabled = true
  const originalText = els.confirmSlotBtn.textContent
  els.confirmSlotBtn.textContent = 'Booking...'
  els.slotError.hidden = true
  els.slotTaken.hidden = true

  const payload: Record<string, unknown> = {
    name: state.name,
    email: state.email,
    business_name: els.introBusinessNameHidden?.value ?? '',
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
    void handleStart(els, state)
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
    currentSlot: null,
    slotsFetched: false,
  }
  showIntro(els, state)
  bindIntro(els, state)
  bindSlots(els, state)
})()

export {}
