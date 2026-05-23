/**
 * V3 /book client controller.
 *
 * Three-state shell: intro → chat → closed (booked or done).
 *
 *   intro    : IntakeIntroCard form. Submit POSTs /api/intake/send.
 *   chat     : IntakeChat shell with sticky input bar, mic on every
 *              text input, "Done" quiet link below input row, persistent
 *              "Or pick a time to talk" link in the page header. Slot
 *              picker mounted as the final assistant turn (hidden until
 *              the server says slot_picker_next: true).
 *   closed   : IntakeClosed acknowledgment card, two flavors. "booked"
 *              shows the confirmed slot. "done" shows a short ack and
 *              one primary "Pick a time to talk" CTA. Per CLAUDE.md
 *              fabricated-content policy, "done" must NOT promise
 *              follow-up outreach.
 *
 * DOM location lives in book-elements.ts. State transitions, turn
 * rendering, and retry affordances live in book-render.ts. This file
 * owns network calls and event binding.
 */

import { locateElements, type BookElements } from './book-elements'
import {
  appendTurn,
  attachRetryAffordance,
  clearChatError,
  clearIntroError,
  handleSlotSelected,
  showChat,
  showChatError,
  showClosedBooked,
  showClosedDone,
  showIntro,
  showIntroError,
  surfaceSlotPickerTurn,
  type BookState,
  type BookingResponse,
} from './book-render'

interface IntakeSendResponse {
  ok?: boolean
  ai_reply?: string | null
  entity_id?: string
  can_continue?: boolean
  error?: string
  message?: string
  field_errors?: Record<string, string>
}

interface IntakeContinueResponse {
  ok?: boolean
  ai_reply?: string | null
  turn?: number
  can_continue?: boolean
  slot_picker_next?: boolean
  closed?: boolean
  error?: string
  message?: string
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
// Network: Start (POST /api/intake/send)
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
  els.introStartBtn.textContent = 'Starting...'

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
      els.introStartBtn.textContent = 'Start'
      return
    }

    state.email = payload.email
    state.name = payload.name
    state.conversationActive = body.can_continue ?? false

    showChat(els, state)
    appendTurn(els, 'user', payload.message)
    if (body.ai_reply) {
      appendTurn(els, 'assistant', body.ai_reply)
    }
    els.chatReply.focus()
  } catch (err) {
    console.error('[book] /api/intake/send error:', err)
    showIntroError(els, 'Could not reach the server. Check your connection and try again.')
    els.introStartBtn.disabled = false
    els.introStartBtn.textContent = 'Start'
  }
}

// ---------------------------------------------------------------------------
// Network: Reply (POST /api/intake/continue)
// ---------------------------------------------------------------------------

async function postContinueTurn(args: {
  message: string
  idempotencyKey: string
}): Promise<
  | { ok: true; body: IntakeContinueResponse }
  | { ok: false; status: number; body: IntakeContinueResponse }
> {
  const res = await fetch('/api/intake/continue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: args.message, idempotency_key: args.idempotencyKey }),
  })
  const body = (await res.json().catch(() => ({}))) as IntakeContinueResponse
  if (res.ok && body.ok) return { ok: true, body }
  return { ok: false, status: res.status, body }
}

function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function handleReply(els: BookElements, state: BookState): Promise<void> {
  if (!state.conversationActive) return
  const message = els.chatReply.value.trim()
  if (!message) return

  clearChatError(els)
  els.chatReply.value = ''
  const idempotencyKey = makeIdempotencyKey()
  const userBlock = appendTurn(els, 'user', message, {
    dataset: { idempotencyKey },
  })

  els.chatSendBtn.disabled = true

  const tryOnce = async (): Promise<void> => {
    try {
      const result = await postContinueTurn({ message, idempotencyKey })
      if (result.ok) {
        if (result.body.ai_reply) appendTurn(els, 'assistant', result.body.ai_reply)
        if (result.body.slot_picker_next) surfaceSlotPickerTurn(els, state)
        if (result.body.can_continue === false) state.conversationActive = false
        els.chatSendBtn.disabled = false
        return
      }
      if (result.status === 401) {
        state.conversationActive = false
        showChatError(els, 'This conversation has timed out. Pick a time to talk to keep going.')
        surfaceSlotPickerTurn(els, state)
        els.chatSendBtn.disabled = false
        return
      }
      attachRetryAffordance(userBlock, () => {
        void tryOnce()
      })
      els.chatSendBtn.disabled = false
    } catch (err) {
      console.error('[book] /api/intake/continue error:', err)
      attachRetryAffordance(userBlock, () => {
        void tryOnce()
      })
      els.chatSendBtn.disabled = false
    }
  }

  await tryOnce()
}

// ---------------------------------------------------------------------------
// Network: Done (POST /api/intake/continue with closed:true)
// ---------------------------------------------------------------------------

async function handleDone(els: BookElements, state: BookState): Promise<void> {
  if (state.shellState !== 'chat') return
  els.chatDoneBtn.disabled = true
  try {
    const res = await fetch('/api/intake/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closed: true }),
    })
    if (res.status === 409) {
      els.chatDoneBtn.disabled = false
      showChatError(els, 'A reply is being generated. Try Done again in a moment.')
      return
    }
    showClosedDone(els, state)
  } catch (err) {
    console.error('[book] /api/intake/continue (close) error:', err)
    els.chatDoneBtn.disabled = false
    showChatError(els, 'Could not reach the server. Try Done again.')
  }
}

// ---------------------------------------------------------------------------
// Network: Confirm slot (POST /api/booking/reserve)
// ---------------------------------------------------------------------------

async function handleConfirmSlot(els: BookElements, state: BookState): Promise<void> {
  if (!state.currentSlot || !state.email || !state.name) return

  els.chatConfirmSlotBtn.disabled = true
  const originalText = els.chatConfirmSlotBtn.textContent
  els.chatConfirmSlotBtn.textContent = 'Booking...'
  els.chatSlotError.hidden = true
  els.chatSlotTaken.hidden = true

  const payload: Record<string, unknown> = {
    name: state.name,
    email: state.email,
    business_name: els.introBusinessNameHidden?.value ?? '',
    phone: '',
    website: null,
    message: '',
    slot_start_utc: state.currentSlot.start_utc,
    timezone: state.currentSlot.timezone,
  }
  if (els.prefillTokenStore?.value) {
    payload.prefill_token = els.prefillTokenStore.value
  }

  const reset = (): void => {
    els.chatConfirmSlotBtn.disabled = !state.currentSlot
    els.chatConfirmSlotBtn.textContent = originalText ?? 'Confirm time'
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
      els.chatSlotTaken.hidden = false
      state.currentSlot = null
      els.chatSelectedSlotBanner.hidden = true
      els.chatConfirmSlotBtn.disabled = true
      if (els.chatSlotPicker.refetchSlots) els.chatSlotPicker.refetchSlots()
      reset()
      return
    }
    if (res.status === 503) {
      els.chatSlotError.textContent =
        'Online booking is temporarily unavailable. Try again in a moment.'
      els.chatSlotError.hidden = false
      reset()
      return
    }
    els.chatSlotError.textContent = body.message ?? body.error ?? 'Something went wrong. Try again.'
    els.chatSlotError.hidden = false
    reset()
  } catch (err) {
    console.error('[book] reserve error:', err)
    els.chatSlotError.textContent =
      'Could not reach the server. Check your connection and try again.'
    els.chatSlotError.hidden = false
    reset()
  }
}

// ---------------------------------------------------------------------------
// Bind
// ---------------------------------------------------------------------------

function bindHeaderPickTime(els: BookElements, state: BookState): void {
  const pickTimeNow = (event: Event): void => {
    event.preventDefault()
    if (state.shellState === 'intro') {
      showChat(els, state)
      surfaceSlotPickerTurn(els, state)
    } else if (state.shellState === 'chat') {
      surfaceSlotPickerTurn(els, state)
    }
  }
  els.headerPickTimeLink?.addEventListener('click', pickTimeNow)
  els.introPickTimeLink?.addEventListener('click', pickTimeNow)
  els.closedDonePickTime.addEventListener('click', (event) => {
    event.preventDefault()
    showChat(els, state)
    surfaceSlotPickerTurn(els, state)
  })
}

function bindIntro(els: BookElements, state: BookState): void {
  els.introForm.addEventListener('submit', (e) => {
    e.preventDefault()
    void handleStart(els, state)
  })
}

function bindChat(els: BookElements, state: BookState): void {
  els.chatSendBtn.addEventListener('click', () => {
    void handleReply(els, state)
  })
  els.chatReply.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleReply(els, state)
    }
  })
  els.chatDoneBtn.addEventListener('click', () => {
    void handleDone(els, state)
  })
}

function bindSlotPicker(els: BookElements, state: BookState): void {
  els.chatSlotPicker.addEventListener('slot-selected', (event) => {
    handleSlotSelected(event, els, state)
  })
  els.chatChangeSlotBtn.addEventListener('click', () => {
    els.chatSlotPicker.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  els.chatConfirmSlotBtn.addEventListener('click', () => {
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
    slotPickerSurfaced: false,
    conversationActive: false,
  }
  showIntro(els, state)
  bindIntro(els, state)
  bindChat(els, state)
  bindSlotPicker(els, state)
  bindHeaderPickTime(els, state)
})()

export {}
