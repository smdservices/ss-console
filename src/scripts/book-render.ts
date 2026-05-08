/**
 * Render helpers for the V3 /book three-state shell. Split out of
 * book.ts so the page controller stays under the file-size ceiling.
 *
 * State transitions (intro → chat → closed-{booked,done}), turn-block
 * DOM construction, retry affordance, slot-picker turn surfacing.
 */

import type { BookElements } from './book-elements'

export type ShellState = 'intro' | 'chat' | 'closed'

export interface BookState {
  shellState: ShellState
  email: string | null
  name: string | null
  currentSlot: BookingSlot | null
  slotsFetched: boolean
  slotPickerSurfaced: boolean
  conversationActive: boolean
}

export interface BookingSlot {
  start_utc: string
  timezone: string
  label: string
}

export interface BookingResponse {
  slot_label?: string
  meet_url?: string | null
  manage_url?: string | null
  error?: string
  message?: string
  fallback?: { email?: string }
}

// ---------- State transitions ----------

export function showIntro(els: BookElements, state: BookState): void {
  state.shellState = 'intro'
  els.shell.dataset.state = 'intro'
  els.intro.hidden = false
  els.chat.hidden = true
  els.closed.hidden = true
  els.closedBooked.hidden = true
  els.closedDone.hidden = true
}

export function showChat(els: BookElements, state: BookState): void {
  state.shellState = 'chat'
  els.shell.dataset.state = 'chat'
  els.intro.hidden = true
  els.chat.hidden = false
  els.closed.hidden = true
}

export function showClosedBooked(els: BookElements, state: BookState, body: BookingResponse): void {
  state.shellState = 'closed'
  els.shell.dataset.state = 'closed'
  els.intro.hidden = true
  els.chat.hidden = true
  els.closed.hidden = false
  els.closedBooked.hidden = false
  els.closedDone.hidden = true

  els.closedBookedSlot.textContent = body.slot_label ?? 'Your call is booked.'
  if (body.meet_url) {
    els.closedBookedMeetRow.hidden = false
    els.closedBookedMeetLink.href = body.meet_url
  }
  if (body.manage_url) {
    els.closedBookedManageRow.hidden = false
    els.closedBookedManageLink.href = body.manage_url
  }
  els.closed.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function showClosedDone(els: BookElements, state: BookState): void {
  state.shellState = 'closed'
  els.shell.dataset.state = 'closed'
  els.intro.hidden = true
  els.chat.hidden = true
  els.closed.hidden = false
  els.closedDone.hidden = false
  els.closedBooked.hidden = true
  els.closed.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ---------- Thread rendering ----------

export function appendTurn(
  els: BookElements,
  role: 'user' | 'assistant',
  content: string,
  options: { dataset?: Record<string, string> } = {}
): HTMLElement {
  const article = document.createElement('article')
  article.className = 'ss-turn'
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      article.dataset[key] = value
    }
  }

  const roleLabel = document.createElement('p')
  roleLabel.className = 'ss-turn-role'
  roleLabel.textContent = role === 'user' ? 'You' : 'SMD'

  const body = document.createElement('div')
  body.className = 'ss-turn-body'
  const p = document.createElement('p')
  p.className = 'ss-turn-line'
  p.textContent = content
  body.appendChild(p)

  article.appendChild(roleLabel)
  article.appendChild(body)
  els.chatThread.appendChild(article)
  return article
}

export function attachRetryAffordance(block: HTMLElement, onRetry: () => void): void {
  const existing = block.querySelector('.ss-retry-affordance')
  if (existing) existing.remove()

  const wrap = document.createElement('div')
  wrap.className = 'ss-retry-affordance'

  const message = document.createElement('p')
  message.className = 'ss-error mt-row'
  message.textContent = 'Could not reach the server.'
  wrap.appendChild(message)

  const retryBtn = document.createElement('button')
  retryBtn.type = 'button'
  retryBtn.className = 'ss-quiet-link'
  retryBtn.textContent = 'Retry'
  retryBtn.dataset.action = 'retry'
  retryBtn.addEventListener('click', () => {
    wrap.remove()
    onRetry()
  })

  const sep = document.createElement('span')
  sep.className = 'ss-quiet-sep'
  sep.textContent = ' · '

  const pickTime = document.createElement('a')
  pickTime.href = '#chat-pick-time'
  pickTime.className = 'ss-quiet-link'
  pickTime.textContent = 'Pick a time to talk'
  pickTime.dataset.action = 'pick-time'

  wrap.appendChild(retryBtn)
  wrap.appendChild(sep)
  wrap.appendChild(pickTime)
  block.appendChild(wrap)
}

// ---------- Slot picker turn ----------

export function surfaceSlotPickerTurn(els: BookElements, state: BookState): void {
  if (state.slotPickerSurfaced) {
    els.chatSlotTurn.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  state.slotPickerSurfaced = true
  els.chatSlotTurn.hidden = false
  if (!state.slotsFetched && els.chatSlotPicker.refetchSlots) {
    els.chatSlotPicker.refetchSlots()
    state.slotsFetched = true
  }
  els.chatSlotTurn.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function handleSlotSelected(event: Event, els: BookElements, state: BookState): void {
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
  els.chatSelectedSlotText.textContent = `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} at ${state.currentSlot.label}`

  els.chatSelectedSlotBanner.hidden = false
  els.chatSlotError.hidden = true
  els.chatSlotTaken.hidden = true
  els.chatConfirmSlotBtn.disabled = false
  els.chatConfirmSlotBtn.textContent = `Confirm ${state.currentSlot.label}`
  els.chatConfirmSlotBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// ---------- Helpers ----------

export function showChatError(els: BookElements, message: string): void {
  els.chatError.textContent = message
  els.chatError.hidden = false
}

export function clearChatError(els: BookElements): void {
  els.chatError.hidden = true
  els.chatError.textContent = ''
}

export function showIntroError(els: BookElements, message: string): void {
  els.introError.textContent = message
  els.introError.hidden = false
}

export function clearIntroError(els: BookElements): void {
  els.introError.hidden = true
  els.introError.textContent = ''
}
