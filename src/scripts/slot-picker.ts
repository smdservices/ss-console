import { z } from 'zod'

const STALE_MS = 5 * 60 * 1000

const SlotSchema = z.object({
  start_utc: z.string().min(1),
  end_utc: z.string().min(1),
  label: z.string().min(1),
})

const SlotDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slots: z.array(SlotSchema),
})

const SlotsResponseSchema = z
  .object({
    days: z.array(SlotDaySchema).optional(),
    fallback: z.object({ email: z.email().optional() }).optional(),
  })
  .catchall(z.unknown())

export type SlotPickerSlot = z.infer<typeof SlotSchema>
type SlotPickerDay = z.infer<typeof SlotDaySchema>
type SlotsResponse = z.infer<typeof SlotsResponseSchema>

interface SlotPickerElement extends HTMLElement {
  refetchSlots?: () => void
  getGuestTimezone?: () => string
}

interface SlotPickerParts {
  picker: SlotPickerElement
  loadingEl: HTMLElement
  errorEl: HTMLElement
  errorMsg: HTMLElement
  emptyEl: HTMLElement
  staleEl: HTMLElement
  mainEl: HTMLElement
  unavailableEl: HTMLElement
  tzLabel: HTMLElement
  monthLabel: HTMLElement
  datesContainer: HTMLElement
  slotsContainer: HTMLElement
  dateLabel: HTMLElement
  noSlotsDay: HTMLElement
  prevBtn: HTMLButtonElement
  nextBtn: HTMLButtonElement
  retryBtn: HTMLButtonElement
  refreshBtn: HTMLButtonElement
}

interface SlotPickerState {
  guestTz: string
  allDays: SlotPickerDay[]
  viewingYear: number
  viewingMonth: number
  selectedDate: string | null
  selectedSlot: SlotPickerSlot | null
  fetchedAt: number
}

export function parseSlotsResponse(input: unknown): SlotsResponse {
  return SlotsResponseSchema.parse(input)
}

function findElement<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const node = document.getElementById(id)
  if (!(node instanceof ctor)) throw new Error(`SlotPicker missing #${id}`)
  return node
}

function locateParts(picker: HTMLElement | null): SlotPickerParts | null {
  if (!(picker instanceof HTMLElement)) return null
  return {
    picker,
    loadingEl: findElement('sp-loading', HTMLElement),
    errorEl: findElement('sp-error', HTMLElement),
    errorMsg: findElement('sp-error-msg', HTMLElement),
    emptyEl: findElement('sp-empty', HTMLElement),
    staleEl: findElement('sp-stale', HTMLElement),
    mainEl: findElement('sp-main', HTMLElement),
    unavailableEl: findElement('sp-unavailable', HTMLElement),
    tzLabel: findElement('sp-tz-label', HTMLElement),
    monthLabel: findElement('sp-month-label', HTMLElement),
    datesContainer: findElement('sp-dates', HTMLElement),
    slotsContainer: findElement('sp-slots', HTMLElement),
    dateLabel: findElement('sp-date-label', HTMLElement),
    noSlotsDay: findElement('sp-no-slots-day', HTMLElement),
    prevBtn: findElement('sp-prev', HTMLButtonElement),
    nextBtn: findElement('sp-next', HTMLButtonElement),
    retryBtn: findElement('sp-retry-btn', HTMLButtonElement),
    refreshBtn: findElement('sp-refresh-btn', HTMLButtonElement),
  }
}

function show(el: HTMLElement): void {
  el.classList.remove('hidden')
}

function hide(el: HTMLElement): void {
  el.classList.add('hidden')
}

function showOnly(parts: SlotPickerParts, el: HTMLElement): void {
  for (const target of [
    parts.loadingEl,
    parts.errorEl,
    parts.emptyEl,
    parts.mainEl,
    parts.unavailableEl,
  ]) {
    hide(target)
  }
  show(el)
}

function detectGuestTimezone(): string {
  const fallback = 'America/Phoenix'
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback
  } catch {
    return fallback
  }
}

function parseLocalDate(str: string): Date {
  const [year, month, day] = str.split('-').map((part) => Number.parseInt(part, 10))
  return new Date(year, month - 1, day)
}

export function formatDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function readSlotsResponse(res: Response): Promise<SlotsResponse> {
  const body: unknown = await res.json()
  return parseSlotsResponse(body)
}

function handleUnavailable(parts: SlotPickerParts, body: SlotsResponse): void {
  showOnly(parts, parts.unavailableEl)
  if (!body.fallback?.email) return
  const link = parts.unavailableEl.querySelector('a')
  if (!(link instanceof HTMLAnchorElement)) return
  link.href = `mailto:${body.fallback.email}?subject=Assessment%20Call%20Request`
  link.textContent = `Email ${body.fallback.email}`
}

function setInitialAvailability(
  parts: SlotPickerParts,
  state: SlotPickerState,
  body: SlotsResponse
): void {
  state.allDays = (body.days ?? []).filter((day) => day.slots.length > 0)
  state.fetchedAt = Date.now()
  if (state.allDays.length === 0) {
    showOnly(parts, parts.emptyEl)
    return
  }

  parts.tzLabel.textContent = `Times shown in ${state.guestTz.replace(/_/g, ' ')}`
  const firstAvailDate = parseLocalDate(state.allDays[0].date)
  state.viewingYear = firstAvailDate.getFullYear()
  state.viewingMonth = firstAvailDate.getMonth()
  state.selectedDate = state.allDays[0].date
  renderDates(parts, state)
  renderSlots(parts, state)
  showOnly(parts, parts.mainEl)
}

async function fetchSlots(parts: SlotPickerParts, state: SlotPickerState): Promise<void> {
  showOnly(parts, parts.loadingEl)
  hide(parts.staleEl)
  state.selectedSlot = null

  try {
    const res = await fetch(`/api/booking/slots?tz=${encodeURIComponent(state.guestTz)}`)
    const body = await readSlotsResponse(res)
    if (res.status === 503) {
      handleUnavailable(parts, body)
      return
    }
    if (!res.ok) throw new Error(`API ${res.status}`)
    setInitialAvailability(parts, state, body)
  } catch (err) {
    console.error('[SlotPicker] fetch failed:', err)
    parts.errorMsg.textContent = 'Could not load available times. Please try again.'
    showOnly(parts, parts.errorEl)
  }
}

function setMonthNavigation(parts: SlotPickerParts, state: SlotPickerState): void {
  const today = new Date()
  parts.prevBtn.disabled =
    state.viewingYear < today.getFullYear() ||
    (state.viewingYear === today.getFullYear() && state.viewingMonth <= today.getMonth())

  const lastAvail = parseLocalDate(state.allDays[state.allDays.length - 1].date)
  parts.nextBtn.disabled =
    state.viewingYear > lastAvail.getFullYear() ||
    (state.viewingYear === lastAvail.getFullYear() && state.viewingMonth >= lastAvail.getMonth())
}

function appendDayHeaders(parts: SlotPickerParts): void {
  for (const name of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    const span = document.createElement('span')
    span.className =
      'text-[10px] font-medium text-[color:var(--ss-color-text-muted)] py-1 text-center'
    span.textContent = name
    parts.datesContainer.appendChild(span)
  }
}

function dateButtonClass(
  hasSlots: boolean,
  isSelected: boolean,
  isToday: boolean,
  isPast: boolean
): string {
  const base =
    'h-9 w-full flex items-center justify-center rounded-[var(--ss-radius-card)] text-sm transition-colors '
  if (isSelected) return `${base}bg-primary text-white font-semibold`
  if (isToday && hasSlots) {
    return `${base}ring-2 ring-primary text-[color:var(--ss-color-text-primary)] font-semibold hover:bg-[color:var(--ss-color-border-subtle)]`
  }
  if (isToday) return `${base}ring-2 ring-primary text-[color:var(--ss-color-text-muted)]`
  if (hasSlots) {
    return `${base}text-[color:var(--ss-color-text-primary)] font-semibold hover:bg-[color:var(--ss-color-border-subtle)]`
  }
  if (isPast) return `${base}text-slate-200 cursor-not-allowed`
  return `${base}text-[color:var(--ss-color-text-muted)] cursor-not-allowed`
}

function appendDateButtons(parts: SlotPickerParts, state: SlotPickerState): void {
  const availableDates = new Set(state.allDays.map((day) => day.date))
  const todayStr = formatDateKey(new Date())
  const startDay = new Date(state.viewingYear, state.viewingMonth, 1).getDay()
  const daysInMonth = new Date(state.viewingYear, state.viewingMonth + 1, 0).getDate()

  for (let i = 0; i < startDay; i++) parts.datesContainer.appendChild(document.createElement('div'))
  for (let day = 1; day <= daysInMonth; day++) {
    appendDateButton(parts, state, availableDates, todayStr, day)
  }

  const remainder = (startDay + daysInMonth) % 7
  for (let j = 0; remainder > 0 && j < 7 - remainder; j++) {
    parts.datesContainer.appendChild(document.createElement('div'))
  }
}

function appendDateButton(
  parts: SlotPickerParts,
  state: SlotPickerState,
  availableDates: Set<string>,
  todayStr: string,
  day: number
): void {
  const dateStr = `${state.viewingYear}-${String(state.viewingMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const hasSlots = availableDates.has(dateStr)
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = dateButtonClass(
    hasSlots,
    dateStr === state.selectedDate,
    dateStr === todayStr,
    dateStr < todayStr
  )
  btn.textContent = String(day)

  if (hasSlots) {
    btn.addEventListener('click', () => {
      state.selectedDate = dateStr
      state.selectedSlot = null
      renderDates(parts, state)
      renderSlots(parts, state)
    })
  } else {
    btn.disabled = true
  }
  parts.datesContainer.appendChild(btn)
}

function renderDates(parts: SlotPickerParts, state: SlotPickerState): void {
  parts.datesContainer.innerHTML = ''
  if (state.allDays.length === 0) return
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  parts.monthLabel.textContent = `${monthNames[state.viewingMonth]} ${state.viewingYear}`
  setMonthNavigation(parts, state)
  appendDayHeaders(parts)
  appendDateButtons(parts, state)
}

function updateDateLabel(parts: SlotPickerParts, selectedDate: string | null): void {
  if (!selectedDate) return
  const d = parseLocalDate(selectedDate)
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  parts.dateLabel.textContent = `${dayNames[d.getDay()]}, ${monthNames[d.getMonth()]} ${d.getDate()}`
}

function renderSlots(parts: SlotPickerParts, state: SlotPickerState): void {
  parts.slotsContainer.innerHTML = ''
  const dayEntry = state.allDays.find((day) => day.date === state.selectedDate) ?? null
  updateDateLabel(parts, state.selectedDate)
  if (!dayEntry || dayEntry.slots.length === 0) {
    show(parts.noSlotsDay)
    return
  }
  hide(parts.noSlotsDay)
  for (const slot of dayEntry.slots) appendSlotButton(parts, state, slot)
}

function appendSlotButton(
  parts: SlotPickerParts,
  state: SlotPickerState,
  slot: SlotPickerSlot
): void {
  const btn = document.createElement('button')
  btn.type = 'button'
  const isSelected = state.selectedSlot?.start_utc === slot.start_utc
  btn.className = isSelected
    ? 'rounded-[var(--ss-radius-card)] border px-3 py-2 text-sm font-medium transition-colors border-primary bg-primary text-white'
    : 'rounded-[var(--ss-radius-card)] border px-3 py-2 text-sm font-medium transition-colors border-[color:var(--ss-color-border)] bg-white text-[color:var(--ss-color-text-primary)] hover:border-primary hover:text-primary'
  btn.textContent = slot.label
  btn.addEventListener('click', () => selectSlot(parts, state, slot))
  parts.slotsContainer.appendChild(btn)
}

function selectSlot(parts: SlotPickerParts, state: SlotPickerState, slot: SlotPickerSlot): void {
  state.selectedSlot = slot
  renderSlots(parts, state)
  parts.picker.dispatchEvent(
    new CustomEvent('slot-selected', {
      bubbles: true,
      detail: {
        start_utc: slot.start_utc,
        end_utc: slot.end_utc,
        label: slot.label,
        date: state.selectedDate,
        timezone: state.guestTz,
      },
    })
  )
}

function bindEvents(parts: SlotPickerParts, state: SlotPickerState): void {
  parts.prevBtn.addEventListener('click', () => {
    state.viewingMonth--
    if (state.viewingMonth < 0) {
      state.viewingMonth = 11
      state.viewingYear--
    }
    renderDates(parts, state)
  })
  parts.nextBtn.addEventListener('click', () => {
    state.viewingMonth++
    if (state.viewingMonth > 11) {
      state.viewingMonth = 0
      state.viewingYear++
    }
    renderDates(parts, state)
  })
  parts.retryBtn.addEventListener('click', () => {
    void fetchSlots(parts, state)
  })
  parts.refreshBtn.addEventListener('click', () => {
    void fetchSlots(parts, state)
  })
}

function bindPublicMethods(parts: SlotPickerParts, state: SlotPickerState): void {
  parts.picker.refetchSlots = () => {
    void fetchSlots(parts, state)
  }
  parts.picker.getGuestTimezone = () => state.guestTz
}

export function initSlotPicker(): void {
  try {
    const parts = locateParts(document.getElementById('slot-picker'))
    if (!parts) return
    const state: SlotPickerState = {
      guestTz: detectGuestTimezone(),
      allDays: [],
      viewingYear: 0,
      viewingMonth: 0,
      selectedDate: null,
      selectedSlot: null,
      fetchedAt: 0,
    }
    bindEvents(parts, state)
    bindPublicMethods(parts, state)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.fetchedAt > 0 && Date.now() - state.fetchedAt > STALE_MS) {
        show(parts.staleEl)
      }
    })
  } catch (err) {
    console.error('[SlotPicker] initialization failed:', err)
  }
}
