/**
 * DOM element location for the V4 /book three-state shell.
 *
 * States: intro form → slot picker → closed (booked).
 *
 * Split out of book.ts so the page controller stays under the file-size
 * ceiling. Each locator function pulls its section's elements; the
 * orchestrator composes them and returns null if anything required is
 * missing.
 */

export interface BookElements {
  shell: HTMLElement
  intro: HTMLElement
  introForm: HTMLFormElement
  introError: HTMLElement
  introStartBtn: HTMLButtonElement
  introEmail: HTMLInputElement
  introName: HTMLInputElement
  introMessage: HTMLTextAreaElement
  introBusinessNameHidden: HTMLInputElement | null
  slots: HTMLElement
  slotPicker: HTMLElement & { refetchSlots?: () => void }
  selectedSlotBanner: HTMLElement
  selectedSlotText: HTMLElement
  changeSlotBtn: HTMLButtonElement
  slotError: HTMLElement
  slotTaken: HTMLElement
  confirmSlotBtn: HTMLButtonElement
  closed: HTMLElement
  closedBooked: HTMLElement
  closedBookedSlot: HTMLElement
  closedBookedMeetRow: HTMLElement
  closedBookedMeetLink: HTMLAnchorElement
  closedBookedManageRow: HTMLElement
  closedBookedManageLink: HTMLAnchorElement
  prefillTokenStore: HTMLInputElement | null
}

function el<T extends HTMLElement>(id: string, ctor: new () => T): T | null {
  const node = document.getElementById(id)
  return node instanceof ctor ? node : null
}

interface IntroParts {
  intro: HTMLElement | null
  introForm: HTMLFormElement | null
  introError: HTMLElement | null
  introStartBtn: HTMLButtonElement | null
  introEmail: HTMLInputElement | null
  introName: HTMLInputElement | null
  introMessage: HTMLTextAreaElement | null
  introBusinessNameHidden: HTMLInputElement | null
}

function locateIntroParts(): IntroParts {
  const introForm = el('intro-form', HTMLFormElement)
  const introBusinessNameHidden = introForm
    ? introForm.querySelector<HTMLInputElement>('input[name="business_name"]')
    : null
  return {
    intro: el('intake-intro', HTMLElement),
    introForm,
    introError: el('intro-error', HTMLElement),
    introStartBtn: el('intro-start-btn', HTMLButtonElement),
    introEmail: el('intro-email', HTMLInputElement),
    introName: el('intro-name', HTMLInputElement),
    introMessage: el('intro-message', HTMLTextAreaElement),
    introBusinessNameHidden,
  }
}

interface SlotParts {
  slots: HTMLElement | null
  slotPicker: (HTMLElement & { refetchSlots?: () => void }) | null
  selectedSlotBanner: HTMLElement | null
  selectedSlotText: HTMLElement | null
  changeSlotBtn: HTMLButtonElement | null
  slotError: HTMLElement | null
  slotTaken: HTMLElement | null
  confirmSlotBtn: HTMLButtonElement | null
}

function locateSlotParts(): SlotParts {
  const slotPickerEl = document.getElementById('slot-picker')
  return {
    slots: el('intake-slots', HTMLElement),
    slotPicker: slotPickerEl instanceof HTMLElement ? slotPickerEl : null,
    selectedSlotBanner: el('selected-slot-banner', HTMLElement),
    selectedSlotText: el('selected-slot-text', HTMLElement),
    changeSlotBtn: el('change-slot-btn', HTMLButtonElement),
    slotError: el('slot-error', HTMLElement),
    slotTaken: el('slot-taken', HTMLElement),
    confirmSlotBtn: el('confirm-slot-btn', HTMLButtonElement),
  }
}

interface ClosedParts {
  closed: HTMLElement | null
  closedBooked: HTMLElement | null
  closedBookedSlot: HTMLElement | null
  closedBookedMeetRow: HTMLElement | null
  closedBookedMeetLink: HTMLAnchorElement | null
  closedBookedManageRow: HTMLElement | null
  closedBookedManageLink: HTMLAnchorElement | null
}

function locateClosedParts(): ClosedParts {
  return {
    closed: el('intake-closed', HTMLElement),
    closedBooked: el('closed-booked', HTMLElement),
    closedBookedSlot: el('closed-booked-slot', HTMLElement),
    closedBookedMeetRow: el('closed-booked-meet-row', HTMLElement),
    closedBookedMeetLink: el('closed-booked-meet-link', HTMLAnchorElement),
    closedBookedManageRow: el('closed-booked-manage-row', HTMLElement),
    closedBookedManageLink: el('closed-booked-manage-link', HTMLAnchorElement),
  }
}

const REQUIRED_KEYS: ReadonlyArray<keyof BookElements> = [
  'intro',
  'introForm',
  'introError',
  'introStartBtn',
  'introEmail',
  'introName',
  'introMessage',
  'slots',
  'slotPicker',
  'selectedSlotBanner',
  'selectedSlotText',
  'changeSlotBtn',
  'slotError',
  'slotTaken',
  'confirmSlotBtn',
  'closed',
  'closedBooked',
  'closedBookedSlot',
  'closedBookedMeetRow',
  'closedBookedMeetLink',
  'closedBookedManageRow',
  'closedBookedManageLink',
]

export function locateElements(): BookElements | null {
  const shell = document.getElementById('unified-intake')
  if (!(shell instanceof HTMLElement)) return null

  const intro = locateIntroParts()
  const slots = locateSlotParts()
  const closed = locateClosedParts()
  const composed: Record<string, unknown> = {
    shell,
    ...intro,
    ...slots,
    ...closed,
    prefillTokenStore: el('prefill-token-store', HTMLInputElement),
  }

  for (const key of REQUIRED_KEYS) {
    if (composed[key] == null) return null
  }
  return composed as unknown as BookElements
}
