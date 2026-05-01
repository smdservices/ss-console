export function initEntityDetailPage(): void {
  const form = document.getElementById('re-enrich-form')
  const btn = document.getElementById('re-enrich-btn') as HTMLButtonElement | null
  if (form && btn) {
    form.addEventListener('submit', () => {
      btn.disabled = true
      btn.textContent = 'Re-enriching...'
    })
  }

  const copyBtn = document.getElementById('copy-outreach-btn') as HTMLButtonElement | null
  const outreachEl = document.getElementById('outreach-content')
  if (copyBtn && outreachEl) {
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(outreachEl.textContent ?? '')
      copyBtn.textContent = 'Copied!'
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy'
      }, 2000)
    })
  }

  document.querySelectorAll<HTMLButtonElement>('.js-toggle-long').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const body = toggle.previousElementSibling as HTMLElement | null
      if (!body || !body.classList.contains('js-truncated')) return
      const expanded = body.classList.toggle('is-expanded')
      toggle.textContent = expanded ? 'Show less' : 'Show more'
    })
  })

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

  sblForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const formData = new FormData(sblForm)
    const meetingType = (formData.get('meeting_type') ?? '').toString().trim()
    const durationMinutes = (formData.get('duration_minutes') ?? '30').toString()
    const sendMode = (formData.get('send_mode') ?? 'email').toString()
    const wantsServerSend = sendMode === 'email'

    sblSubmit.disabled = true
    sblSubmit.textContent = wantsServerSend ? 'Sending...' : 'Preparing...'
    if (sblError) {
      sblError.classList.add('hidden')
      sblError.textContent = ''
    }

    try {
      const res = await fetch(`/api/admin/entities/${entityId}/send-booking-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_type: meetingType || null,
          duration_minutes: durationMinutes,
          send_email: wantsServerSend,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        booking_url?: string
        outreach_template?: string
        mailto_url?: string
        email_status?: string
        send_error?: string | null
        error?: string
        message?: string
      }
      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
      }

      if (body.email_status === 'send_failed') {
        if (sblError) {
          sblError.textContent =
            'Email send failed. The booking link is on your clipboard. Paste it into mailto or your own mail client.'
          sblError.classList.remove('hidden')
        }
        if (body.outreach_template) {
          try {
            await navigator.clipboard.writeText(body.outreach_template)
          } catch (copyErr) {
            console.warn('[send-booking-link] clipboard write failed:', copyErr)
          }
        }
        if (body.mailto_url) {
          window.open(body.mailto_url, '_blank')
        }
        window.location.href = `${window.location.pathname}?stage_updated=1&send=failed`
        return
      }

      if (body.outreach_template) {
        try {
          await navigator.clipboard.writeText(body.outreach_template)
        } catch (copyErr) {
          console.warn('[send-booking-link] clipboard write failed:', copyErr)
        }
      }

      const skippedServerSend =
        body.email_status === 'skipped_by_caller' || body.email_status === 'skipped_no_recipient'
      if (skippedServerSend && body.mailto_url) {
        window.open(body.mailto_url, '_blank')
      }

      sblDialog.close()

      const sentParam = body.email_status === 'sent' ? '&send=sent' : ''
      window.location.href = `${window.location.pathname}?stage_updated=1${sentParam}`
    } catch (err) {
      console.error('[send-booking-link] error:', err)
      if (sblError) {
        sblError.textContent = err instanceof Error ? err.message : 'Could not send booking link.'
        sblError.classList.remove('hidden')
      }
      sblSubmit.disabled = false
      sblSubmit.textContent = 'Send link'
    }
  })
}
