type QuoteLineItem = {
  problem: string
  description: string
  estimated_hours: number
}

function formatDollars(amount: number): string {
  return (
    '$' +
    amount.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  )
}

export function initQuoteBuilderPage(rootId = 'quote-builder-page'): void {
  const root = document.getElementById(rootId)
  if (!(root instanceof HTMLElement)) return

  const isDraft = root.dataset.isDraft === 'true'
  if (!isDraft) return

  const rate = Number(root.dataset.rate ?? '0')
  const initialLineItems = JSON.parse(root.dataset.lineItems ?? '[]') as QuoteLineItem[]

  const body = document.getElementById('line-items-body')
  const addBtn = document.getElementById('add-line-item-btn')
  const warning = document.getElementById('line-item-warning')
  const totalHoursEl = document.getElementById('total-hours')
  const totalPriceEl = document.getElementById('total-price')
  const depositAmountEl = document.getElementById('deposit-amount')
  const completionAmountEl = document.getElementById('completion-amount')
  const depositSelect = document.getElementById('deposit-pct-select') as HTMLSelectElement | null
  const saveLineItemsInput = document.getElementById('save-line-items') as HTMLInputElement | null
  const saveDepositPctInput = document.getElementById('save-deposit-pct') as HTMLInputElement | null
  const saveScheduleInput = document.getElementById('save-schedule') as HTMLInputElement | null
  const saveDeliverablesInput = document.getElementById(
    'save-deliverables'
  ) as HTMLInputElement | null
  const saveEngagementOverviewInput = document.getElementById(
    'save-engagement-overview'
  ) as HTMLInputElement | null
  const saveMilestoneLabelInput = document.getElementById(
    'save-milestone-label'
  ) as HTMLInputElement | null
  const saveOriginatingSignalInput = document.getElementById(
    'save-originating-signal-id'
  ) as HTMLInputElement | null
  const scheduleRowsContainer = document.getElementById('schedule-rows') as HTMLElement | null
  const deliverableRowsContainer = document.getElementById('deliverable-rows') as HTMLElement | null
  const addScheduleRowBtn = document.getElementById('add-schedule-row-btn')
  const addDeliverableRowBtn = document.getElementById('add-deliverable-row-btn')
  const engagementOverviewInput = document.getElementById(
    'engagement-overview-input'
  ) as HTMLTextAreaElement | null
  const milestoneLabelInput = document.getElementById(
    'milestone-label-input'
  ) as HTMLInputElement | null
  const originatingSignalInput = document.getElementById(
    'originating-signal-input'
  ) as HTMLSelectElement | null
  const generatePdfBtn = document.getElementById('generate-pdf-btn') as HTMLButtonElement | null
  const signBtn = document.getElementById('sign-btn') as HTMLButtonElement | null
  const saveForm = document.getElementById('save-form')
  const generatePdfForm = document.getElementById('generate-pdf-form')
  const signForm = document.getElementById('sign-form')

  if (!(body instanceof HTMLElement)) return
  const lineItemsBody = body

  function getLineItems(): QuoteLineItem[] {
    const rows = lineItemsBody.querySelectorAll('.line-item-row')
    const items: QuoteLineItem[] = []
    rows.forEach((row) => {
      const problem = (row.querySelector('.item-problem') as HTMLInputElement | null)?.value ?? ''
      const description =
        (row.querySelector('.item-description') as HTMLInputElement | null)?.value ?? ''
      const hours = parseFloat(
        (row.querySelector('.item-hours') as HTMLInputElement | null)?.value ?? '0'
      )
      if (problem.trim() || description.trim()) {
        items.push({
          problem: problem.trim(),
          description: description.trim(),
          estimated_hours: Number.isNaN(hours) ? 0 : hours,
        })
      }
    })
    return items
  }

  function clearEmptyState(container: HTMLElement | null): void {
    if (!container) return
    const empty = container.querySelector('.schedule-empty-state, .deliverable-empty-state')
    if (empty) empty.remove()
  }

  function maybeShowEmptyState(container: HTMLElement | null, isDeliverable: boolean): void {
    if (!container) return
    const rows = container.querySelectorAll(isDeliverable ? '.deliverable-row' : '.schedule-row')
    if (rows.length > 0) return

    const div = document.createElement('div')
    div.className =
      'text-sm text-[color:var(--ss-color-text-secondary)] italic py-2 ' +
      (isDeliverable ? 'deliverable-empty-state' : 'schedule-empty-state')
    div.textContent = container.getAttribute('data-empty-text') ?? ''
    container.appendChild(div)
  }

  function getScheduleRows(): Array<{ label: string; body: string }> {
    if (!scheduleRowsContainer) return []
    const rows = scheduleRowsContainer.querySelectorAll('.schedule-row')
    const out: Array<{ label: string; body: string }> = []
    rows.forEach((row) => {
      const label =
        (row.querySelector('.schedule-label') as HTMLInputElement | null)?.value?.trim() ?? ''
      const bodyText =
        (row.querySelector('.schedule-body') as HTMLInputElement | null)?.value?.trim() ?? ''
      if (label.length > 0 || bodyText.length > 0) {
        out.push({ label, body: bodyText })
      }
    })
    return out
  }

  function getDeliverableRows(): Array<{ title: string; body: string }> {
    if (!deliverableRowsContainer) return []
    const rows = deliverableRowsContainer.querySelectorAll('.deliverable-row')
    const out: Array<{ title: string; body: string }> = []
    rows.forEach((row) => {
      const title =
        (row.querySelector('.deliverable-title') as HTMLInputElement | null)?.value?.trim() ?? ''
      const bodyText =
        (row.querySelector('.deliverable-body') as HTMLTextAreaElement | null)?.value?.trim() ?? ''
      if (title.length > 0 || bodyText.length > 0) {
        out.push({ title, body: bodyText })
      }
    })
    return out
  }

  function syncAuthoredContentInputs(): void {
    if (saveScheduleInput) saveScheduleInput.value = JSON.stringify(getScheduleRows())
    if (saveDeliverablesInput) saveDeliverablesInput.value = JSON.stringify(getDeliverableRows())
    if (saveEngagementOverviewInput && engagementOverviewInput) {
      saveEngagementOverviewInput.value = engagementOverviewInput.value
    }
    if (saveMilestoneLabelInput && milestoneLabelInput) {
      saveMilestoneLabelInput.value = milestoneLabelInput.value
    }
    if (saveOriginatingSignalInput && originatingSignalInput) {
      saveOriginatingSignalInput.value = originatingSignalInput.value
    }
  }

  function renumberRows(): void {
    const rows = lineItemsBody.querySelectorAll('.line-item-row')
    rows.forEach((row, i) => {
      const num = row.querySelector('.row-number')
      if (num) num.textContent = String(i + 1)
      row.setAttribute('data-index', String(i))
    })
  }

  function recalculate(): void {
    const items = getLineItems()
    const totalHours = items.reduce((sum, item) => sum + item.estimated_hours, 0)
    const totalPrice = totalHours * rate
    const depositPct = parseFloat(depositSelect?.value ?? '0.5')

    if (totalHoursEl) totalHoursEl.textContent = String(totalHours)
    if (totalPriceEl) totalPriceEl.textContent = formatDollars(totalPrice)

    const depositAmount = totalPrice * depositPct
    const completionAmount = totalPrice * (1 - depositPct)
    if (depositAmountEl) depositAmountEl.textContent = formatDollars(depositAmount)
    if (completionAmountEl) completionAmountEl.textContent = formatDollars(completionAmount)

    if (warning) {
      warning.classList.toggle('hidden', items.length < 3)
    }

    if (saveLineItemsInput) saveLineItemsInput.value = JSON.stringify(items)
    if (saveDepositPctInput) saveDepositPctInput.value = String(depositPct)

    renumberRows()
  }

  function addScheduleRow(): void {
    if (!scheduleRowsContainer) return
    clearEmptyState(scheduleRowsContainer)
    const div = document.createElement('div')
    div.className = 'flex gap-2 mb-2 schedule-row'
    div.innerHTML = `
      <input type="text" class="w-32 border border-[color:var(--ss-color-border)] rounded px-2 py-1 text-sm schedule-label" placeholder="Label" />
      <input type="text" class="flex-1 border border-[color:var(--ss-color-border)] rounded px-2 py-1 text-sm schedule-body" placeholder="What happens in this phase" />
      <button type="button" class="text-[color:var(--ss-color-text-muted)] hover:text-error transition-colors remove-schedule-row-btn px-2" title="Remove">&times;</button>
    `
    scheduleRowsContainer.appendChild(div)
  }

  function addDeliverableRow(): void {
    if (!deliverableRowsContainer) return
    clearEmptyState(deliverableRowsContainer)
    const div = document.createElement('div')
    div.className = 'mb-3 deliverable-row'
    div.innerHTML = `
      <div class="flex gap-2">
        <div class="flex-1 space-y-1">
          <input type="text" class="w-full border border-[color:var(--ss-color-border)] rounded px-2 py-1 text-sm deliverable-title" placeholder="Title" />
          <textarea class="w-full border border-[color:var(--ss-color-border)] rounded px-2 py-1 text-sm deliverable-body" rows="2" placeholder="Description"></textarea>
        </div>
        <button type="button" class="text-[color:var(--ss-color-text-muted)] hover:text-error transition-colors remove-deliverable-row-btn px-2" title="Remove">&times;</button>
      </div>
    `
    deliverableRowsContainer.appendChild(div)
  }

  function addRow(): void {
    const index = lineItemsBody.querySelectorAll('.line-item-row').length
    const tr = document.createElement('tr')
    tr.className = 'border-b border-[color:var(--ss-color-border-subtle)] line-item-row'
    tr.setAttribute('data-index', String(index))
    tr.innerHTML = `
      <td class="py-2 px-2 text-[color:var(--ss-color-text-muted)] row-number">${index + 1}</td>
      <td class="py-2 px-2">
        <input type="text" class="w-full border border-[color:var(--ss-color-border)] rounded px-2 py-1 text-sm item-problem" value="" placeholder="e.g., Scheduling chaos" />
      </td>
      <td class="py-2 px-2">
        <input type="text" class="w-full border border-[color:var(--ss-color-border)] rounded px-2 py-1 text-sm item-description" value="" placeholder="What we'll deliver" />
      </td>
      <td class="py-2 px-2 text-right">
        <input type="number" class="w-20 border border-[color:var(--ss-color-border)] rounded px-2 py-1 text-sm text-right item-hours" value="0" min="0.5" step="0.5" />
      </td>
      <td class="py-2 px-2 text-center">
        <button type="button" class="text-[color:var(--ss-color-text-muted)] hover:text-error transition-colors remove-item-btn" title="Remove">&times;</button>
      </td>
    `
    lineItemsBody.appendChild(tr)
    recalculate()
  }

  if (addScheduleRowBtn) addScheduleRowBtn.addEventListener('click', addScheduleRow)
  if (addDeliverableRowBtn) addDeliverableRowBtn.addEventListener('click', addDeliverableRow)
  if (addBtn) addBtn.addEventListener('click', addRow)

  if (scheduleRowsContainer) {
    scheduleRowsContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null
      if (!target?.classList.contains('remove-schedule-row-btn')) return
      const row = target.closest('.schedule-row')
      if (row) {
        row.remove()
        maybeShowEmptyState(scheduleRowsContainer, false)
      }
    })
  }

  if (deliverableRowsContainer) {
    deliverableRowsContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null
      if (!target?.classList.contains('remove-deliverable-row-btn')) return
      const row = target.closest('.deliverable-row')
      if (row) {
        row.remove()
        maybeShowEmptyState(deliverableRowsContainer, true)
      }
    })
  }

  lineItemsBody.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    if (!target?.classList.contains('remove-item-btn')) return
    const row = target.closest('.line-item-row')
    if (row && lineItemsBody.querySelectorAll('.line-item-row').length > 1) {
      row.remove()
      recalculate()
    }
  })

  lineItemsBody.addEventListener('input', recalculate)
  if (depositSelect) depositSelect.addEventListener('change', recalculate)

  if (saveForm) {
    saveForm.addEventListener('submit', () => {
      recalculate()
      syncAuthoredContentInputs()
    })
  }

  if (generatePdfForm && generatePdfBtn) {
    generatePdfForm.addEventListener('submit', () => {
      generatePdfBtn.disabled = true
      generatePdfBtn.textContent = 'Generating...'
    })
  }

  if (signForm && signBtn) {
    signForm.addEventListener('submit', () => {
      signBtn.disabled = true
      signBtn.textContent = 'Sending...'
    })
  }

  if (warning && initialLineItems.length >= 3) {
    warning.classList.remove('hidden')
  }
}
