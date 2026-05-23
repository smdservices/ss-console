/**
 * Render helpers for the V4 /book three-state shell.
 *
 * States: intro form → slot picker → closed (booked).
 *
 * Split out of book.ts so the page controller stays under the file-size
 * ceiling. State transitions, slot-selected handling, error helpers.
 */

import type { BookElements } from './book-elements'

export type ShellState = 'intro' | 'slots' | 'closed'

export interface BookState {
  shellState: ShellState
  email: string | null
  name: string | null
  currentSlot: BookingSlot | null
  slotsFetched: boolean
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

function scrollShellTop(els: BookElements): void {
  els.shell.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function showIntro(els: BookElements, state: BookState): void {
  state.shellState = 'intro'
  els.shell.dataset.state = 'intro'
  els.intro.hidden = false
  els.slots.hidden = true
  els.closed.hidden = true
  els.closedBooked.hidden = true
}

export function showSlots(els: BookElements, state: BookState): void {
  state.shellState = 'slots'
  els.shell.dataset.state = 'slots'
  els.intro.hidden = true
  els.slots.hidden = false
  els.closed.hidden = true

  if (!state.slotsFetched && els.slotPicker.refetchSlots) {
    els.slotPicker.refetchSlots()
    state.slotsFetched = true
  }
  scrollShellTop(els)
}

export function showClosedBooked(els: BookElements, state: BookState, body: BookingResponse): void {
  state.shellState = 'closed'
  els.shell.dataset.state = 'closed'
  els.intro.hidden = true
  els.slots.hidden = true
  els.closed.hidden = false
  els.closedBooked.hidden = false

  els.closedBookedSlot.textContent = body.slot_label ?? 'Your call is booked.'
  if (body.meet_url) {
    els.closedBookedMeetRow.hidden = false
    els.closedBookedMeetLink.href = body.meet_url
  }
  if (body.manage_url) {
    els.closedBookedManageRow.hidden = false
    els.closedBookedManageLink.href = body.manage_url
  }
  scrollShellTop(els)
}

// ---------- Slot selection ----------

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
  els.selectedSlotText.textContent = `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} at ${state.currentSlot.label}`

  els.selectedSlotBanner.hidden = false
  els.slotError.hidden = true
  els.slotTaken.hidden = true
  els.confirmSlotBtn.disabled = false
  els.confirmSlotBtn.textContent = `Confirm ${state.currentSlot.label}`
  els.confirmSlotBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// ---------- Helpers ----------

export function showIntroError(els: BookElements, message: string): void {
  els.introError.textContent = message
  els.introError.hidden = false
}

export function clearIntroError(els: BookElements): void {
  els.introError.hidden = true
  els.introError.textContent = ''
}
