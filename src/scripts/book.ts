/**
 * Client-side booking flow logic for book.astro.
 *
 * Manages: unified intake send, slot picker reveal, slot selection,
 * booking POST, confirmation panel, and email fallback.
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
  error?: string
  message?: string
  field_errors?: Record<string, string>
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

function dispatchAiReply(root: HTMLElement, reply: string | null): void {
  root.dispatchEvent(new CustomEvent('unified-ai-reply', { detail: { reply }, bubbles: false }))
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
      dispatchAiReply(els.intakeRoot, body.ai_reply ?? null)
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

;(() => {
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
    return
  }

  const picker = pickerElement as HTMLElement & { refetchSlots?: () => void }

  const els: BookElements = {
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

  const state: BookState = {
    sendSucceeded: false,
    submittedData: null,
    currentSlot: null,
    slotsFetched: false,
  }

  intakeRoot.addEventListener('unified-send', (event) => {
    void handleSend(event, els, state)
  })

  intakeRoot.addEventListener('unified-pick-time', () => {
    if (!state.sendSucceeded || !state.submittedData) return
    slotPickerSection.hidden = false
    if (!state.slotsFetched && picker.refetchSlots) {
      picker.refetchSlots()
      state.slotsFetched = true
    }
    slotPickerSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  picker.addEventListener('slot-selected', (event) => {
    handleSlotSelected(event, els, state)
  })

  changeSlotBtn.addEventListener('click', () => {
    picker.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  bookSubmitBtn.addEventListener('click', () => {
    void handleBookSubmit(els, state)
  })
})()
