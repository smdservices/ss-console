/**
 * Client-side booking flow logic for book.astro.
 *
 * Manages: unified intake send (turn 1), multi-turn intake continuation,
 * slot picker reveal, slot selection, booking POST, confirmation panel,
 * and email fallback.
 *
 * V2 multi-turn flow:
 *   - unified-send → POST /api/intake/send → first AI reply rendered.
 *     If the prospect submitted a non-empty message, the conversation
 *     controls (reply input + booking offer) appear so the prospect can
 *     keep talking or pick a time. If the message was empty, only the
 *     booking offer appears.
 *   - unified-reply-send → POST /api/intake/continue → next AI reply
 *     appended to the thread, reply input cleared. Repeat until the
 *     prospect picks a time, leaves, or hits the conversation turn cap.
 *   - unified-pick-time → reveal slot picker, fetch slots, etc.
 */

interface UnifiedFormData {
  name: string
  email: string
  business_name: string
  phone: string
  website: string | null
  message: string
  rendered_at: number
}

interface BookingSlot {
  start_utc: string
  timezone: string
  label: string
}

interface BookingResponse {
  slot_label?: string
  meet_url?: string | null
  manage_url?: string | null
  error?: string
  message?: string
  fallback?: { email?: string }
}

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
  error?: string
  message?: string
}

interface BookElements {
  intakeRoot: HTMLElement
  slotPickerSection: HTMLElement
  picker: HTMLElement & { refetchSlots?: () => void }
  selectedSlotBanner: HTMLElement
  selectedSlotText: HTMLElement
  changeSlotBtn: HTMLButtonElement
  bookSubmitBtn: HTMLButtonElement
  errorBanner: HTMLElement
  slotTakenBanner: HTMLElement
  confirmPanel: HTMLElement
  emailFallback: HTMLElement
  prefillTokenStore: HTMLInputElement | null
}

interface BookState {
  sendSucceeded: boolean
  submittedData: UnifiedFormData | null
  currentSlot: BookingSlot | null
  slotsFetched: boolean
  conversationActive: boolean
}

function dispatchState(root: HTMLElement, state: string): void {
  root.dispatchEvent(new CustomEvent('unified-set-state', { detail: { state }, bubbles: false }))
}

function dispatchError(root: HTMLElement, message: string): void {
  root.dispatchEvent(new CustomEvent('unified-show-error', { detail: { message }, bubbles: false }))
}

function dispatchClearError(root: HTMLElement): void {
  root.dispatchEvent(new CustomEvent('unified-clear-error', { bubbles: false }))
}

function dispatchReplyError(root: HTMLElement, message: string): void {
  root.dispatchEvent(
    new CustomEvent('unified-reply-error', { detail: { message }, bubbles: false })
  )
}

function appendTurn(root: HTMLElement, role: 'user' | 'assistant', content: string): void {
  root.dispatchEvent(
    new CustomEvent('unified-append-turn', { detail: { role, content }, bubbles: false })
  )
}

function showConversationControls(root: HTMLElement): void {
  root.dispatchEvent(new CustomEvent('unified-show-conversation-controls', { bubbles: false }))
}

function showBookingOnly(root: HTMLElement): void {
  root.dispatchEvent(new CustomEvent('unified-show-booking-only', { bubbles: false }))
}

function showEmptyAck(root: HTMLElement): void {
  root.dispatchEvent(new CustomEvent('unified-show-empty-ack', { bubbles: false }))
}

function clearReplyText(root: HTMLElement): void {
  root.dispatchEvent(new CustomEvent('unified-clear-reply-text', { bubbles: false }))
}

function showConfirmation(els: BookElements, body: BookingResponse, state: BookState): void {
  els.intakeRoot.style.display = 'none'
  els.slotPickerSection.hidden = true

  const confSlot = document.getElementById('conf-slot')
  if (confSlot instanceof HTMLElement) {
    confSlot.textContent = body.slot_label ?? 'Your call is booked'
  }
  if (body.meet_url) {
    const meetRow = document.getElementById('conf-meet-row')
    const meetLink = document.getElementById('conf-meet-link')
    if (meetRow instanceof HTMLElement) meetRow.hidden = false
    if (meetLink instanceof HTMLAnchorElement) meetLink.href = body.meet_url
  }
  if (body.manage_url) {
    const manageRow = document.getElementById('conf-manage-row')
    const manageLink = document.getElementById('conf-manage-link')
    if (manageRow instanceof HTMLElement) manageRow.hidden = false
    if (manageLink instanceof HTMLAnchorElement) manageLink.href = body.manage_url
  }
  els.confirmPanel.hidden = false
  els.confirmPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  dispatchState(els.intakeRoot, 'booked')
  void state // suppress unused-var (state passed for symmetry)
}

function showEmailFallback(els: BookElements, body: BookingResponse, state: BookState): void {
  const fallbackEmail = body.fallback?.email ?? 'team@smd.services'
  const mailtoEl = document.getElementById('fallback-mailto')
  const data = state.submittedData
  const subject = encodeURIComponent('Assessment Call Request')
  const bodyText = encodeURIComponent(
    "Hi, I'd like to schedule an assessment call.\n\n" +
      (data?.name ? 'Name: ' + data.name + '\n' : '') +
      (data?.business_name ? 'Business: ' + data.business_name + '\n' : '')
  )
  if (mailtoEl instanceof HTMLAnchorElement) {
    mailtoEl.href = 'mailto:' + fallbackEmail + '?subject=' + subject + '&body=' + bodyText
    mailtoEl.textContent = 'Email ' + fallbackEmail
  }
  els.intakeRoot.style.display = 'none'
  els.slotPickerSection.hidden = true
  els.emailFallback.hidden = false
  els.emailFallback.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function extractSendErrorMessage(res: Response, body: IntakeSendResponse): string {
  if (res.status === 400 && body.field_errors) {
    return (
      Object.values(body.field_errors).join(' ') || body.message || 'Some fields need attention.'
    )
  }
  if (res.status === 429) return 'Too many submissions. Please wait a few minutes and try again.'
  return body.message ?? body.error ?? 'Something went wrong. Please try again.'
}

function extractContinueErrorMessage(res: Response, body: IntakeContinueResponse): string {
  if (res.status === 401) {
    return body.error === 'session_expired'
      ? 'This conversation has timed out. Pick a time to talk to keep going.'
      : 'We could not authorize this message. Please refresh and try again.'
  }
  if (res.status === 429) return 'Too many messages. Please wait a moment and try again.'
  if (res.status === 503)
    return 'The assistant is temporarily unavailable. Try again or pick a time to talk.'
  return body.message ?? body.error ?? 'Something went wrong. Please try again.'
}

async function handleSend(event: Event, els: BookElements, state: BookState): Promise<void> {
  const data = (event as CustomEvent<UnifiedFormData>).detail
  dispatchClearError(els.intakeRoot)

  const missing: string[] = []
  if (!data.name) missing.push('name')
  if (!data.email) missing.push('email')
  if (!data.business_name) missing.push('business name')
  if (!data.phone) missing.push('phone')
  if (missing.length > 0) {
    dispatchError(els.intakeRoot, `Please fill in: ${missing.join(', ')}.`)
    return
  }

  dispatchState(els.intakeRoot, 'send_thinking')

  const payload = {
    name: data.name,
    email: data.email,
    business_name: data.business_name,
    phone: data.phone,
    website: data.website,
    message: data.message,
    rendered_at: data.rendered_at,
  }

  try {
    const res = await fetch('/api/intake/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as IntakeSendResponse

    if (res.ok && body.ok) {
      state.sendSucceeded = true
      state.submittedData = { ...data }
      dispatchState(els.intakeRoot, 'send_done')

      const userMessage = data.message.trim()
      const aiReply = (body.ai_reply ?? '').trim()

      if (userMessage) {
        appendTurn(els.intakeRoot, 'user', userMessage)
      }
      if (aiReply) {
        appendTurn(els.intakeRoot, 'assistant', aiReply)
      }

      if (aiReply && body.can_continue) {
        // Conversation is live — reveal reply input + booking offer.
        state.conversationActive = true
        showConversationControls(els.intakeRoot)
      } else {
        // No conversation (empty message or AI generation failed). Just
        // show the booking offer; the empty-ack renders too if the user
        // submitted with no message at all.
        if (!userMessage) showEmptyAck(els.intakeRoot)
        showBookingOnly(els.intakeRoot)
      }
      return
    }

    dispatchError(els.intakeRoot, extractSendErrorMessage(res, body))
    dispatchState(els.intakeRoot, 'idle')
  } catch (err) {
    console.error('[book] /api/intake/send error:', err)
    dispatchError(
      els.intakeRoot,
      'Could not reach the server. Please check your connection and try again.'
    )
    dispatchState(els.intakeRoot, 'idle')
  }
}

async function handleReplySend(event: Event, els: BookElements, state: BookState): Promise<void> {
  if (!state.conversationActive) return
  const detail = (event as CustomEvent<{ message: string }>).detail
  const message = (detail?.message ?? '').trim()
  if (!message) return

  // Optimistically render the user turn so the conversation feels live.
  appendTurn(els.intakeRoot, 'user', message)
  clearReplyText(els.intakeRoot)
  dispatchState(els.intakeRoot, 'continue_thinking')

  try {
    const res = await fetch('/api/intake/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    const body = (await res.json().catch(() => ({}))) as IntakeContinueResponse

    if (res.ok && body.ok) {
      const aiReply = (body.ai_reply ?? '').trim()
      if (aiReply) {
        appendTurn(els.intakeRoot, 'assistant', aiReply)
      }
      if (body.can_continue) {
        dispatchState(els.intakeRoot, 'send_done')
      } else {
        // Turn cap reached. The booking is the next step.
        state.conversationActive = false
        dispatchState(els.intakeRoot, 'turn_capped')
      }
      return
    }

    dispatchReplyError(els.intakeRoot, extractContinueErrorMessage(res, body))
    if (res.status === 401) {
      // Session expired — disable further continuations, leave booking
      // offer in place as the path forward.
      state.conversationActive = false
      dispatchState(els.intakeRoot, 'turn_capped')
    } else {
      dispatchState(els.intakeRoot, 'send_done')
    }
  } catch (err) {
    console.error('[book] /api/intake/continue error:', err)
    dispatchReplyError(
      els.intakeRoot,
      'Could not reach the server. Please check your connection and try again.'
    )
    dispatchState(els.intakeRoot, 'send_done')
  }
}

async function handleBookSubmit(els: BookElements, state: BookState): Promise<void> {
  if (!state.currentSlot || !state.submittedData) return

  els.bookSubmitBtn.disabled = true
  els.bookSubmitBtn.textContent = 'Booking...'
  els.errorBanner.hidden = true
  els.slotTakenBanner.hidden = true

  const payload: Record<string, unknown> = {
    name: state.submittedData.name,
    email: state.submittedData.email,
    business_name: state.submittedData.business_name,
    phone: state.submittedData.phone,
    website: state.submittedData.website,
    message: '',
    slot_start_utc: state.currentSlot.start_utc,
    timezone: state.currentSlot.timezone,
  }
  if (els.prefillTokenStore?.value) {
    payload.prefill_token = els.prefillTokenStore.value
  }

  const resetBookSubmit = (): void => {
    els.bookSubmitBtn.disabled = !state.currentSlot
    els.bookSubmitBtn.textContent = 'Book Your Call'
  }

  const showBookError = (msg: string): void => {
    els.errorBanner.textContent = msg
    els.errorBanner.hidden = false
  }

  try {
    const res = await fetch('/api/booking/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body: BookingResponse = await res.json()

    if (res.status === 201) {
      showConfirmation(els, body, state)
      return
    }
    if (res.status === 409) {
      els.slotTakenBanner.hidden = false
      state.currentSlot = null
      els.selectedSlotBanner.hidden = true
      els.bookSubmitBtn.disabled = true
      if (els.picker.refetchSlots) els.picker.refetchSlots()
      els.picker.scrollIntoView({ behavior: 'smooth', block: 'start' })
      resetBookSubmit()
      return
    }
    if (res.status === 429) {
      showBookError('Too many booking attempts. Please wait a few minutes and try again.')
      resetBookSubmit()
      return
    }
    if (res.status === 503) {
      showEmailFallback(els, body, state)
      return
    }
    showBookError(body.message ?? body.error ?? 'Something went wrong. Please try again.')
    resetBookSubmit()
  } catch (err) {
    console.error('[book] reserve error:', err)
    showBookError('Could not reach the server. Please check your connection and try again.')
    resetBookSubmit()
  }
}

function handleSlotSelected(event: Event, els: BookElements, state: BookState): void {
  state.currentSlot = (event as CustomEvent<BookingSlot>).detail
  if (!state.currentSlot) return

  const d = new Date(state.currentSlot.start_utc)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  els.selectedSlotText.textContent = `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} at ${state.currentSlot.label}`

  els.selectedSlotBanner.hidden = false
  els.errorBanner.hidden = true
  els.slotTakenBanner.hidden = true
  els.bookSubmitBtn.disabled = false
  els.bookSubmitBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function locateBookElements(): BookElements | null {
  const intakeRoot = document.getElementById('unified-intake')
  const slotPickerSection = document.getElementById('slot-picker-section')
  const pickerElement = document.getElementById('slot-picker')
  const selectedSlotBanner = document.getElementById('selected-slot-banner')
  const selectedSlotText = document.getElementById('selected-slot-text')
  const changeSlotBtn = document.getElementById('change-slot-btn')
  const bookSubmitBtn = document.getElementById('bf-submit')
  const errorBanner = document.getElementById('bf-error')
  const slotTakenBanner = document.getElementById('bf-slot-taken')
  const confirmPanel = document.getElementById('confirmation-panel')
  const emailFallback = document.getElementById('email-fallback-panel')
  const prefillTokenStore = document.getElementById(
    'prefill-token-store'
  ) as HTMLInputElement | null

  if (
    !(intakeRoot instanceof HTMLElement) ||
    !(slotPickerSection instanceof HTMLElement) ||
    !(pickerElement instanceof HTMLElement) ||
    !(selectedSlotBanner instanceof HTMLElement) ||
    !(selectedSlotText instanceof HTMLElement) ||
    !(changeSlotBtn instanceof HTMLButtonElement) ||
    !(bookSubmitBtn instanceof HTMLButtonElement) ||
    !(errorBanner instanceof HTMLElement) ||
    !(slotTakenBanner instanceof HTMLElement) ||
    !(confirmPanel instanceof HTMLElement) ||
    !(emailFallback instanceof HTMLElement)
  ) {
    return null
  }
  const picker = pickerElement as HTMLElement & { refetchSlots?: () => void }
  return {
    intakeRoot,
    slotPickerSection,
    picker,
    selectedSlotBanner,
    selectedSlotText,
    changeSlotBtn,
    bookSubmitBtn,
    errorBanner,
    slotTakenBanner,
    confirmPanel,
    emailFallback,
    prefillTokenStore,
  }
}

function bindBookListeners(els: BookElements, state: BookState): void {
  els.intakeRoot.addEventListener('unified-send', (event) => {
    void handleSend(event, els, state)
  })
  els.intakeRoot.addEventListener('unified-reply-send', (event) => {
    void handleReplySend(event, els, state)
  })
  els.intakeRoot.addEventListener('unified-pick-time', () => {
    if (!state.sendSucceeded || !state.submittedData) return
    els.slotPickerSection.hidden = false
    if (!state.slotsFetched && els.picker.refetchSlots) {
      els.picker.refetchSlots()
      state.slotsFetched = true
    }
    els.slotPickerSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  els.picker.addEventListener('slot-selected', (event) => {
    handleSlotSelected(event, els, state)
  })
  els.changeSlotBtn.addEventListener('click', () => {
    els.picker.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  els.bookSubmitBtn.addEventListener('click', () => {
    void handleBookSubmit(els, state)
  })
}

;(() => {
  const els = locateBookElements()
  if (!els) return

  const state: BookState = {
    sendSucceeded: false,
    submittedData: null,
    currentSlot: null,
    slotsFetched: false,
    conversationActive: false,
  }

  bindBookListeners(els, state)
})()
