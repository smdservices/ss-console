import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { formatDateKey, parseSlotsResponse } from '../src/scripts/slot-picker'

const componentSource = (): string =>
  readFileSync(resolve('src/components/booking/SlotPicker.astro'), 'utf-8')

const scriptSource = (): string => readFileSync(resolve('src/scripts/slot-picker.ts'), 'utf-8')

describe('SlotPicker extraction', () => {
  it('keeps the Astro component below the source file ceiling', () => {
    expect(componentSource().split('\n').length).toBeLessThanOrEqual(500)
  })

  it('loads the shared client controller instead of inlining the picker controller', () => {
    const src = componentSource()
    expect(src).toContain("from '../../scripts/slot-picker'")
    expect(src).not.toContain('async function fetchSlots')
    expect(src).not.toContain('picker.refetchSlots =')
  })

  it('preserves the parent-page public contract', () => {
    const src = scriptSource()
    expect(src).toContain('refetchSlots')
    expect(src).toContain('getGuestTimezone')
    expect(src).toContain("'slot-selected'")
  })
})

describe('SlotPicker response parsing', () => {
  it('accepts the booking slots response shape', () => {
    const parsed = parseSlotsResponse({
      days: [
        {
          date: '2026-07-08',
          slots: [
            {
              start_utc: '2026-07-08T16:00:00Z',
              end_utc: '2026-07-08T16:30:00Z',
              label: '9:00 AM',
            },
          ],
        },
      ],
    })

    expect(parsed.days?.[0]?.slots[0]?.label).toBe('9:00 AM')
  })

  it('rejects malformed slot payloads before rendering', () => {
    expect(() =>
      parseSlotsResponse({
        days: [{ date: 'not-a-date', slots: [{ start_utc: '', label: '9:00 AM' }] }],
      })
    ).toThrow()
  })

  it('formats local date keys for calendar button matching', () => {
    expect(formatDateKey(new Date(2026, 6, 8))).toBe('2026-07-08')
  })
})
