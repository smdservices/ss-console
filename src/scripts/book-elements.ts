/**
 * DOM element location for the V3 /book three-state shell.
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
  chat: HTMLElement
  chatThread: HTMLElement
  chatReply: HTMLTextAreaElement
  chatSendBtn: HTMLButtonElement
  chatDoneBtn: HTMLButtonElement
  chatError: HTMLElement
  chatSlotTurn: HTMLElement
  chatSlotPicker: HTMLElement & { refetchSlots?: () => void }
  chatSelectedSlotBanner: HTMLElement
  chatSelectedSlotText: HTMLElement
  chatChangeSlotBtn: HTMLButtonElement
  chatSlotError: HTMLElement
  chatSlotTaken: HTMLElement
  chatConfirmSlotBtn: HTMLButtonElement
  closed: HTMLElement
  closedBooked: HTMLElement
  closedBookedSlot: HTMLElement
  closedBookedMeetRow: HTMLElement
  closedBookedMeetLink: HTMLAnchorElement
  closedBookedManageRow: HTMLElement
  closedBookedManageLink: HTMLAnchorElement
  closedDone: HTMLElement
  closedDonePickTime: HTMLAnchorElement
  headerPickTimeLink: HTMLAnchorElement | null
  introPickTimeLink: HTMLAnchorElement | null
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
  introPickTimeLink: HTMLAnchorElement | null
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
    introPickTimeLink: el('intro-pick-time-link', HTMLAnchorElement),
  }
}

interface ChatParts {
  chat: HTMLElement | null
  chatThread: HTMLElement | null
  chatReply: HTMLTextAreaElement | null
  chatSendBtn: HTMLButtonElement | null
  chatDoneBtn: HTMLButtonElement | null
  chatError: HTMLElement | null
  chatSlotTurn: HTMLElement | null
  chatSlotPicker: (HTMLElement & { refetchSlots?: () => void }) | null
  chatSelectedSlotBanner: HTMLElement | null
  chatSelectedSlotText: HTMLElement | null
  chatChangeSlotBtn: HTMLButtonElement | null
  chatSlotError: HTMLElement | null
  chatSlotTaken: HTMLElement | null
  chatConfirmSlotBtn: HTMLButtonElement | null
}

function locateChatParts(): ChatParts {
  const slotPickerEl = document.getElementById('slot-picker')
  return {
    chat: el('intake-chat', HTMLElement),
    chatThread: el('chat-thread', HTMLElement),
    chatReply: el('chat-reply', HTMLTextAreaElement),
    chatSendBtn: el('chat-send-btn', HTMLButtonElement),
    chatDoneBtn: el('chat-done-btn', HTMLButtonElement),
    chatError: el('chat-error', HTMLElement),
    chatSlotTurn: el('chat-slot-turn', HTMLElement),
    chatSlotPicker: slotPickerEl instanceof HTMLElement ? slotPickerEl : null,
    chatSelectedSlotBanner: el('chat-selected-slot-banner', HTMLElement),
    chatSelectedSlotText: el('chat-selected-slot-text', HTMLElement),
    chatChangeSlotBtn: el('chat-change-slot-btn', HTMLButtonElement),
    chatSlotError: el('chat-slot-error', HTMLElement),
    chatSlotTaken: el('chat-slot-taken', HTMLElement),
    chatConfirmSlotBtn: el('chat-confirm-slot-btn', HTMLButtonElement),
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
  closedDone: HTMLElement | null
  closedDonePickTime: HTMLAnchorElement | null
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
    closedDone: el('closed-done', HTMLElement),
    closedDonePickTime: el('closed-done-pick-time', HTMLAnchorElement),
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
  'chat',
  'chatThread',
  'chatReply',
  'chatSendBtn',
  'chatDoneBtn',
  'chatError',
  'chatSlotTurn',
  'chatSlotPicker',
  'chatSelectedSlotBanner',
  'chatSelectedSlotText',
  'chatChangeSlotBtn',
  'chatSlotError',
  'chatSlotTaken',
  'chatConfirmSlotBtn',
  'closed',
  'closedBooked',
  'closedBookedSlot',
  'closedBookedMeetRow',
  'closedBookedMeetLink',
  'closedBookedManageRow',
  'closedBookedManageLink',
  'closedDone',
  'closedDonePickTime',
]

export function locateElements(): BookElements | null {
  const shell = document.getElementById('unified-intake')
  if (!(shell instanceof HTMLElement)) return null

  const intro = locateIntroParts()
  const chat = locateChatParts()
  const closed = locateClosedParts()
  const composed: Record<string, unknown> = {
    shell,
    ...intro,
    ...chat,
    ...closed,
    headerPickTimeLink: el('header-pick-time-link', HTMLAnchorElement),
    prefillTokenStore: el('prefill-token-store', HTMLInputElement),
  }

  for (const key of REQUIRED_KEYS) {
    if (composed[key] == null) return null
  }
  return composed as unknown as BookElements
}
