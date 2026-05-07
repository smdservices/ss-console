interface SblElements {
  entityId: string
  form: HTMLFormElement
  dialog: HTMLDialogElement
  submitBtn: HTMLButtonElement
  errorEl: HTMLElement | null
}

function getFormString(formData: FormData, key: string, fallback: string): string {
  const val = formData.get(key)
  return typeof val === 'string' ? val : fallback
}

interface SblResponseBody {
  ok?: boolean
  booking_url?: string
  outreach_template?: string
  mailto_url?: string
  email_status?: string
  send_error?: string | null
  error?: string
  message?: string
}

async function tryCopyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (copyErr) {
    console.warn('[send-booking-link] clipboard write failed:', copyErr)
  }
}

async function handleSblSuccess(body: SblResponseBody, els: SblElements): Promise<void> {
  if (body.email_status === 'send_failed') {
    if (els.errorEl) {
      els.errorEl.textContent =
        'Email send failed. The booking link is on your clipboard. Paste it into mailto or your own mail client.'
      els.errorEl.classList.remove('hidden')
    }
    if (body.outreach_template) await tryCopyToClipboard(body.outreach_template)
    if (body.mailto_url) window.open(body.mailto_url, '_blank')
    window.location.href = `${window.location.pathname}?stage_updated=1&send=failed`
    return
  }

  if (body.outreach_template) await tryCopyToClipboard(body.outreach_template)

  const skipped =
    body.email_status === 'skipped_by_caller' || body.email_status === 'skipped_no_recipient'
  if (skipped && body.mailto_url) window.open(body.mailto_url, '_blank')

  els.dialog.close()
  const sentParam = body.email_status === 'sent' ? '&send=sent' : ''
  window.location.href = `${window.location.pathname}?stage_updated=1${sentParam}`
}

async function handleSblSubmit(e: Event, els: SblElements): Promise<void> {
  e.preventDefault()
  const formData = new FormData(els.form)
  const meetingType = getFormString(formData, 'meeting_type', '').trim()
  const durationMinutes = getFormString(formData, 'duration_minutes', '30')
  const sendMode = getFormString(formData, 'send_mode', 'email')
  const wantsServerSend = sendMode === 'email'

  els.submitBtn.disabled = true
  els.submitBtn.textContent = wantsServerSend ? 'Sending...' : 'Preparing...'
  if (els.errorEl) {
    els.errorEl.classList.add('hidden')
    els.errorEl.textContent = ''
  }

  try {
    const res = await fetch(`/api/admin/entities/${els.entityId}/send-booking-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_type: meetingType || null,
        duration_minutes: durationMinutes,
        send_email: wantsServerSend,
      }),
    })
    const body = (await res.json().catch(() => ({}))) as SblResponseBody
    if (!res.ok || !body.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
    await handleSblSuccess(body, els)
  } catch (err) {
    console.error('[send-booking-link] error:', err)
    if (els.errorEl) {
      els.errorEl.textContent = err instanceof Error ? err.message : 'Could not send booking link.'
      els.errorEl.classList.remove('hidden')
    }
    els.submitBtn.disabled = false
    els.submitBtn.textContent = 'Send link'
  }
}

function setupReEnrichForm(): void {
  const form = document.getElementById('re-enrich-form')
  const btn = document.getElementById('re-enrich-btn') as HTMLButtonElement | null
  if (form && btn) {
    form.addEventListener('submit', () => {
      btn.disabled = true
      btn.textContent = 'Re-enriching...'
    })
  }
}

function setupCopyOutreach(): void {
  const copyBtn = document.getElementById('copy-outreach-btn') as HTMLButtonElement | null
  const outreachEl = document.getElementById('outreach-content')
  if (!copyBtn || !outreachEl) return
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(outreachEl.textContent ?? '').then(() => {
      copyBtn.textContent = 'Copied!'
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy'
      }, 2000)
    })
  })
}

function setupToggleLong(): void {
  document.querySelectorAll<HTMLButtonElement>('.js-toggle-long').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const body = toggle.previousElementSibling as HTMLElement | null
      if (!body || !body.classList.contains('js-truncated')) return
      const expanded = body.classList.toggle('is-expanded')
      toggle.textContent = expanded ? 'Show less' : 'Show more'
    })
  })
}

function setupSendBookingLink(): void {
  const entityId = window.location.pathname.split('/').filter(Boolean).pop()
  const sblBtn = document.getElementById('send-booking-link-btn')
  const sblDialog = document.getElementById('send-booking-link-dialog') as HTMLDialogElement | null
  const sblForm = document.getElementById('send-booking-link-form') as HTMLFormElement | null
  const sblCancel = document.getElementById('sbl-cancel')
  const sblSubmit = document.getElementById('sbl-submit') as HTMLButtonElement | null
  const sblError = document.getElementById('sbl-error')

  if (sblBtn && sblDialog) {
    sblBtn.addEventListener('click', () => {
      if (sblError) {
        sblError.classList.add('hidden')
        sblError.textContent = ''
      }
      sblDialog.showModal()
    })
  }
  if (sblCancel && sblDialog) {
    sblCancel.addEventListener('click', () => sblDialog.close())
  }
  if (!entityId || !sblForm || !sblDialog || !sblSubmit) return

  const els: SblElements = {
    entityId,
    form: sblForm,
    dialog: sblDialog,
    submitBtn: sblSubmit,
    errorEl: sblError,
  }
  sblForm.addEventListener('submit', (e) => {
    void handleSblSubmit(e, els)
  })
}

export function initEntityDetailPage(): void {
  setupReEnrichForm()
  setupCopyOutreach()
  setupToggleLong()
  setupSendBookingLink()
}
