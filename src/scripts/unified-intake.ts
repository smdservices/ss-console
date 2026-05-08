/**
 * Client-side controller for the UnifiedIntake.astro component.
 *
 * Owns the V2 multi-turn intake DOM: form submit, voice dictation on
 * the original textarea, conversation thread rendering, and reply
 * input behavior.
 *
 * The page-level controller (src/scripts/book.ts) handles network
 * calls to /api/intake/send and /api/intake/continue. The two scripts
 * coordinate over CustomEvents on the #unified-intake element. The
 * full event contract is enforced by
 * tests/booking/unified-intake-event-contract.test.ts.
 */

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

interface SpeechRecognitionErrorEventLike {
  error: string
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

interface UnifiedIntakeElements {
  shell: HTMLElement
  form: HTMLFormElement
  textInput: HTMLTextAreaElement
  micBtn: HTMLButtonElement
  sendBtn: HTMLButtonElement
  errorDiv: HTMLElement
  voiceUnsupported: HTMLElement
  permissionError: HTMLElement
  thread: HTMLElement
  emptyAck: HTMLElement
  replySection: HTMLElement
  replyText: HTMLTextAreaElement
  replySendBtn: HTMLButtonElement
  replyError: HTMLElement
  turnCapMsg: HTMLElement
  bookingOffer: HTMLElement
  pickTimeBtn: HTMLButtonElement
}

function el<T extends HTMLElement>(id: string, ctor: new () => T): T | null {
  const node = document.getElementById(id)
  return node instanceof ctor ? node : null
}

function locateFormElements() {
  return {
    shell: el('unified-intake', HTMLElement),
    form: el('unified-intake-form', HTMLFormElement),
    textInput: el('ui-message', HTMLTextAreaElement),
    micBtn: el('ui-mic-btn', HTMLButtonElement),
    sendBtn: el('ui-send-btn', HTMLButtonElement),
    errorDiv: el('ui-error', HTMLElement),
    voiceUnsupported: el('ui-voice-unsupported', HTMLElement),
    permissionError: el('ui-voice-permission-error', HTMLElement),
  }
}

function locateConversationElements() {
  return {
    thread: el('ui-thread', HTMLElement),
    emptyAck: el('ui-empty-ack', HTMLElement),
    replySection: el('ui-reply-section', HTMLElement),
    replyText: el('ui-reply-text', HTMLTextAreaElement),
    replySendBtn: el('ui-reply-send-btn', HTMLButtonElement),
    replyError: el('ui-reply-error', HTMLElement),
    turnCapMsg: el('ui-turn-cap-msg', HTMLElement),
    bookingOffer: el('ui-booking-offer', HTMLElement),
    pickTimeBtn: el('ui-pick-time-btn', HTMLButtonElement),
  }
}

function locateElements(): UnifiedIntakeElements | null {
  const f = locateFormElements()
  const c = locateConversationElements()
  const all = { ...f, ...c }
  for (const v of Object.values(all)) {
    if (v === null) return null
  }
  return all as UnifiedIntakeElements
}

function setupVoiceRecognition(els: UnifiedIntakeElements): SpeechRecognitionLike | null {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) {
    els.micBtn.hidden = true
    els.voiceUnsupported.hidden = false
    return null
  }
  const recognition = new SR()
  recognition.lang = 'en-US'
  recognition.interimResults = false
  recognition.continuous = false
  recognition.maxAlternatives = 1

  recognition.onresult = (e) => {
    let finalText = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript
    }
    if (finalText) {
      const current = els.textInput.value
      const needsSpace = current.length > 0 && !/\s$/.test(current)
      els.textInput.value = current + (needsSpace ? ' ' : '') + finalText
    }
  }
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      els.permissionError.hidden = false
    } else if (e.error === 'no-speech' || e.error === 'aborted') {
      // benign
    } else {
      console.error('[unified-intake] recognition error', e.error)
    }
    setListening(els, false)
  }
  recognition.onend = () => {
    if (els.shell.dataset.state === 'listening') setListening(els, false)
  }
  return recognition
}

function setListening(els: UnifiedIntakeElements, on: boolean): void {
  els.shell.dataset.state = on ? 'listening' : 'idle'
  els.textInput.readOnly = on
}

function stopRecognitionIfActive(
  recognition: SpeechRecognitionLike | null,
  els: UnifiedIntakeElements
): void {
  if (recognition && els.shell.dataset.state === 'listening') {
    try {
      recognition.stop()
    } catch (err) {
      void err
    }
  }
}

function clearThread(els: UnifiedIntakeElements): void {
  while (els.thread.firstChild) els.thread.removeChild(els.thread.firstChild)
  els.thread.hidden = true
}

function hidePostSendUi(els: UnifiedIntakeElements): void {
  clearThread(els)
  els.emptyAck.hidden = true
  els.replySection.hidden = true
  els.replyText.value = ''
  els.replyError.hidden = true
  els.replyError.textContent = ''
  els.turnCapMsg.hidden = true
  els.bookingOffer.hidden = true
}

function appendThreadEntry(
  els: UnifiedIntakeElements,
  role: 'user' | 'assistant',
  content: string
): void {
  els.thread.hidden = false
  const block = document.createElement('div')
  if (role === 'assistant') {
    block.className =
      'whitespace-pre-wrap rounded-[var(--ss-radius-card)] border border-[color:var(--ss-color-text-secondary)]/20 bg-white px-4 py-3 text-base leading-relaxed text-[color:var(--ss-color-text-primary)] shadow-sm'
    block.textContent = content
  } else {
    block.className =
      'whitespace-pre-wrap rounded-[var(--ss-radius-card)] bg-[color:var(--ss-color-text-secondary)]/5 px-4 py-3 text-base leading-relaxed text-[color:var(--ss-color-text-primary)]'
    const label = document.createElement('span')
    label.className =
      'mb-1 block text-xs font-medium uppercase tracking-wide text-[color:var(--ss-color-text-secondary)]'
    label.textContent = 'You'
    const body = document.createElement('span')
    body.className = 'block'
    body.textContent = content
    block.appendChild(label)
    block.appendChild(body)
  }
  els.thread.appendChild(block)
}

function applyState(els: UnifiedIntakeElements, next: string, supportsVoice: boolean): void {
  els.shell.dataset.state = next
  const fields = els.form.querySelectorAll('input, textarea')
  const locked =
    next === 'send_thinking' ||
    next === 'send_done' ||
    next === 'continue_thinking' ||
    next === 'booked'
  fields.forEach((f) => {
    ;(f as HTMLInputElement | HTMLTextAreaElement).readOnly = locked
  })
  if (next === 'send_thinking') {
    els.sendBtn.disabled = true
    els.sendBtn.textContent = 'Sending...'
  } else if (next === 'send_done') {
    els.sendBtn.disabled = true
    els.sendBtn.hidden = true
    if (supportsVoice) els.micBtn.hidden = true
    els.replySendBtn.disabled = false
    els.replySendBtn.textContent = 'Send'
    els.replyText.readOnly = false
  } else if (next === 'continue_thinking') {
    els.replySendBtn.disabled = true
    els.replySendBtn.textContent = 'Sending...'
    els.replyText.readOnly = true
  } else if (next === 'turn_capped') {
    els.replySection.hidden = true
    els.turnCapMsg.hidden = false
  } else if (next === 'booked') {
    els.sendBtn.disabled = true
    els.sendBtn.hidden = true
    if (supportsVoice) els.micBtn.hidden = true
    els.replySection.hidden = true
  } else if (next === 'idle') {
    els.sendBtn.disabled = false
    els.sendBtn.hidden = false
    els.sendBtn.textContent = 'Get in touch'
    if (supportsVoice) {
      els.micBtn.hidden = false
      els.micBtn.disabled = false
    }
    hidePostSendUi(els)
  }
}

interface UnifiedSendDetail {
  name: string
  email: string
  business_name: string
  phone: string
  website: string | null
  message: string
  rendered_at: number
}

function fdString(fd: FormData, key: string): string {
  const value = fd.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function readFormData(form: HTMLFormElement, renderedAt: number): UnifiedSendDetail {
  const fd = new FormData(form)
  return {
    name: fdString(fd, 'name'),
    email: fdString(fd, 'email'),
    business_name: fdString(fd, 'business_name'),
    phone: fdString(fd, 'phone'),
    website: fdString(fd, 'website') || null,
    message: fdString(fd, 'message'),
    rendered_at: renderedAt,
  }
}

function bindMicButton(
  els: UnifiedIntakeElements,
  recognition: SpeechRecognitionLike | null
): void {
  if (!recognition) return
  els.micBtn.addEventListener('click', () => {
    if (els.shell.dataset.state === 'listening') {
      recognition.stop()
      return
    }
    if (els.shell.dataset.state !== 'idle') return
    els.permissionError.hidden = true
    setListening(els, true)
    try {
      recognition.start()
    } catch (err) {
      console.error('[unified-intake] start() failed', err)
      setListening(els, false)
    }
  })
}

function bindFormSubmit(els: UnifiedIntakeElements, renderedAt: number): void {
  els.form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (els.sendBtn.disabled) return
    const data = readFormData(els.form, renderedAt)
    els.shell.dispatchEvent(new CustomEvent('unified-send', { detail: data, bubbles: true }))
  })
}

function bindReplySend(els: UnifiedIntakeElements): void {
  els.replySendBtn.addEventListener('click', () => {
    if (els.replySendBtn.disabled) return
    const message = els.replyText.value.trim()
    if (!message) {
      els.replyError.textContent = 'Type a message before sending.'
      els.replyError.hidden = false
      return
    }
    els.replyError.hidden = true
    els.replyError.textContent = ''
    els.shell.dispatchEvent(
      new CustomEvent('unified-reply-send', { detail: { message }, bubbles: true })
    )
  })
}

function bindPickTime(els: UnifiedIntakeElements): void {
  els.pickTimeBtn.addEventListener('click', () => {
    els.shell.dispatchEvent(new CustomEvent('unified-pick-time', { bubbles: true }))
  })
}

function bindPageEvents(
  els: UnifiedIntakeElements,
  recognition: SpeechRecognitionLike | null,
  supportsVoice: boolean
): void {
  els.shell.addEventListener('unified-set-state', (e) => {
    const next = (e as CustomEvent).detail?.state
    if (!next) return
    const prev = els.shell.dataset.state
    if (next !== 'idle' && next !== 'listening' && prev === 'listening') {
      stopRecognitionIfActive(recognition, els)
    }
    applyState(els, String(next), supportsVoice)
  })
  els.shell.addEventListener('unified-show-error', (e) => {
    const msg = (e as CustomEvent).detail?.message || 'Something went wrong. Please try again.'
    els.errorDiv.textContent = msg
    els.errorDiv.hidden = false
  })
  els.shell.addEventListener('unified-clear-error', () => {
    els.errorDiv.hidden = true
    els.errorDiv.textContent = ''
  })
  els.shell.addEventListener('unified-reply-error', (e) => {
    const msg = (e as CustomEvent).detail?.message || 'Something went wrong. Please try again.'
    els.replyError.textContent = msg
    els.replyError.hidden = false
  })
  els.shell.addEventListener('unified-append-turn', (e) => {
    const { role, content } = (e as CustomEvent).detail ?? {}
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return
    const trimmed = content.trim()
    if (!trimmed) return
    appendThreadEntry(els, role, trimmed)
  })
  els.shell.addEventListener('unified-show-empty-ack', () => {
    els.emptyAck.hidden = false
  })
  els.shell.addEventListener('unified-show-conversation-controls', () => {
    els.replySection.hidden = false
    els.bookingOffer.hidden = false
  })
  els.shell.addEventListener('unified-show-booking-only', () => {
    els.bookingOffer.hidden = false
  })
  els.shell.addEventListener('unified-clear-reply-text', () => {
    els.replyText.value = ''
  })
}

;(() => {
  const els = locateElements()
  if (!els) return
  const recognition = setupVoiceRecognition(els)
  const supportsVoice = recognition !== null
  // Captured at script-execute time. The page-level handler reads this
  // off unified-send detail and sends it as `rendered_at` to the
  // server, which rejects submissions under 2s old as bot-driven.
  const renderedAt = Date.now()
  bindMicButton(els, recognition)
  bindFormSubmit(els, renderedAt)
  bindReplySend(els)
  bindPickTime(els)
  bindPageEvents(els, recognition, supportsVoice)
})()

export {}
