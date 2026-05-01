export type IntakeQuestionnaireMode = 'booking' | 'prep'

export interface IntakeOption {
  value: string
  label: string
}

export const INTAKE_EMPLOYEE_COUNT_OPTIONS: IntakeOption[] = [
  { value: '1-5', label: '1 - 5' },
  { value: '6-10', label: '6 - 10' },
  { value: '11-25', label: '11 - 25' },
  { value: '26-50', label: '26 - 50' },
  { value: '50+', label: '50+' },
]

export const INTAKE_YEARS_IN_BUSINESS_OPTIONS: IntakeOption[] = [
  { value: '<1', label: 'Less than 1 year' },
  { value: '1-3', label: '1 - 3 years' },
  { value: '3-5', label: '3 - 5 years' },
  { value: '5-10', label: '5 - 10 years' },
  { value: '10+', label: '10+ years' },
]

export const INTAKE_HOW_HEARD_OPTIONS: IntakeOption[] = [
  { value: 'Google Search', label: 'Google Search' },
  { value: 'Referral', label: 'Referral' },
  { value: 'BNI / Networking group', label: 'BNI / Networking group' },
  { value: 'Chamber of Commerce', label: 'Chamber of Commerce' },
  { value: 'Social Media', label: 'Social Media' },
  { value: 'SCORE / SBA', label: 'SCORE / SBA' },
  { value: 'other', label: 'Other' },
]

type IntakeFormPayload = Record<string, string>

function toggleConditionalInput(source: HTMLSelectElement, target: HTMLInputElement) {
  if (source.value === 'other') {
    target.classList.remove('hidden')
    return
  }

  target.classList.add('hidden')
  target.value = ''
}

export function bindIntakeConditionalFields(root: HTMLElement): void {
  if (root.dataset.intakeConditionalBound === 'true') {
    return
  }

  const sources = root.querySelectorAll('[data-intake-other-source]')
  for (const source of sources) {
    if (!(source instanceof HTMLSelectElement)) continue

    const fieldName = source.dataset.intakeOtherSource
    if (!fieldName) continue

    const target = root.querySelector(`[data-intake-other-input="${fieldName}"]`)
    if (!(target instanceof HTMLInputElement)) continue

    const sync = () => toggleConditionalInput(source, target)
    source.addEventListener('change', sync)
    sync()
  }

  root.dataset.intakeConditionalBound = 'true'
}

export function formDataToObject(formData: FormData): IntakeFormPayload {
  const data: IntakeFormPayload = {}

  formData.forEach((value, key) => {
    if (typeof value === 'string') {
      data[key] = value
    }
  })

  return data
}

export function normalizeIntakePayload(data: IntakeFormPayload): IntakeFormPayload {
  const normalized: IntakeFormPayload = { ...data }

  if (normalized.vertical === 'other' && normalized.vertical_other) {
    normalized.vertical = normalized.vertical_other
  }
  delete normalized.vertical_other

  if (normalized.how_heard === 'other' && normalized.how_heard_other) {
    normalized.how_heard = normalized.how_heard_other
  }
  delete normalized.how_heard_other

  return normalized
}
