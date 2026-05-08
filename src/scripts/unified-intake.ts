/**
 * V3 /book voice-input controller.
 *
 * Walks every button with `data-mic-target="<textarea-id>"` and wires a
 * SpeechRecognition instance to write transcripts into the named
 * textarea. One shared recognition instance — the Web Speech API is
 * single-active anyway, and the active target switches on each click.
 *
 * The page-level controller (src/scripts/book.ts) owns the chat shell,
 * thread, network calls, and state transitions. This script is voice
 * only.
 *
 * Plan rule: mic on every text input. Verification covers (1) intro
 * textarea, (2) chat input on the first reply, (3) chat input on the
 * Nth reply (turn 4+).
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

interface MicPair {
  button: HTMLButtonElement
  textarea: HTMLTextAreaElement
  unsupportedMsg: HTMLElement | null
  permissionMsg: HTMLElement | null
}

const PAIRS_BY_BUTTON_ID: Record<string, { unsupported: string; permission: string }> = {
  'intro-mic-btn': {
    unsupported: 'intro-voice-unsupported',
    permission: 'intro-voice-permission',
  },
  'chat-mic-btn': {
    unsupported: 'chat-voice-unsupported',
    permission: 'chat-voice-permission',
  },
}

function locatePairs(): MicPair[] {
  const pairs: MicPair[] = []
  const buttons = document.querySelectorAll<HTMLButtonElement>('button[data-mic-target]')
  buttons.forEach((button) => {
    const targetId = button.dataset.micTarget
    if (!targetId) return
    const textarea = document.getElementById(targetId)
    if (!(textarea instanceof HTMLTextAreaElement)) return
    const helpers = PAIRS_BY_BUTTON_ID[button.id]
    pairs.push({
      button,
      textarea,
      unsupportedMsg: helpers ? document.getElementById(helpers.unsupported) : null,
      permissionMsg: helpers ? document.getElementById(helpers.permission) : null,
    })
  })
  return pairs
}

function appendTranscript(textarea: HTMLTextAreaElement, transcript: string): void {
  if (!transcript) return
  const current = textarea.value
  const needsSpace = current.length > 0 && !/\s$/.test(current)
  textarea.value = current + (needsSpace ? ' ' : '') + transcript
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

function setListening(button: HTMLButtonElement, on: boolean): void {
  button.dataset.listening = on ? 'true' : 'false'
}

function setupMicPairs(): void {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const pairs = locatePairs()
  if (pairs.length === 0) return

  if (!SR) {
    for (const pair of pairs) {
      pair.button.hidden = true
      if (pair.unsupportedMsg) pair.unsupportedMsg.hidden = false
    }
    return
  }

  const recognition = new SR()
  recognition.lang = 'en-US'
  recognition.interimResults = false
  recognition.continuous = false
  recognition.maxAlternatives = 1

  let activePair: MicPair | null = null

  recognition.onresult = (e) => {
    let finalText = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript
    }
    if (activePair) appendTranscript(activePair.textarea, finalText)
  }
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      if (activePair?.permissionMsg) activePair.permissionMsg.hidden = false
    } else if (e.error === 'no-speech' || e.error === 'aborted') {
      // benign
    } else {
      console.error('[unified-intake] recognition error', e.error)
    }
    if (activePair) {
      setListening(activePair.button, false)
      activePair.textarea.readOnly = false
    }
  }
  recognition.onend = () => {
    if (activePair) {
      setListening(activePair.button, false)
      activePair.textarea.readOnly = false
    }
    activePair = null
  }

  for (const pair of pairs) {
    pair.button.addEventListener('click', () => {
      // Already listening on THIS pair? Stop.
      if (activePair === pair && pair.button.dataset.listening === 'true') {
        try {
          recognition.stop()
        } catch (err) {
          void err
        }
        return
      }
      // Listening on a different pair? Stop that one first.
      if (activePair && activePair.button.dataset.listening === 'true') {
        try {
          recognition.stop()
        } catch (err) {
          void err
        }
      }
      if (pair.permissionMsg) pair.permissionMsg.hidden = true
      activePair = pair
      setListening(pair.button, true)
      pair.textarea.readOnly = true
      try {
        recognition.start()
      } catch (err) {
        console.error('[unified-intake] start() failed', err)
        setListening(pair.button, false)
        pair.textarea.readOnly = false
        activePair = null
      }
    })
  }
}

;(() => {
  setupMicPairs()
})()

export {}
