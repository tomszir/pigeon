import { expect, it } from 'vitest'
import { clockTime, dayLabel, fullTime } from './clock-text.ts'

it('spells times like the taskbar clock', () => {
  expect(clockTime(new Date(2026, 0, 1, 0, 5).getTime())).toBe('12:05 AM')
  expect(clockTime(new Date(2026, 0, 1, 12, 0).getTime())).toBe('12:00 PM')
  expect(clockTime(new Date(2026, 0, 1, 9, 41).getTime())).toBe('9:41 AM')
})

it('spells the whole date for a tooltip', () => {
  expect(fullTime(new Date(2026, 10, 24, 18, 38).getTime())).toBe('November 24, 2026 at 6:38 PM')
})

it('names a day line Today, Yesterday, or the day', () => {
  const now = new Date(2026, 10, 24, 0, 5).getTime()
  expect(dayLabel(new Date(2026, 10, 24, 23, 59).getTime(), now)).toBe('Today')
  expect(dayLabel(new Date(2026, 10, 23, 23, 59).getTime(), now)).toBe('Yesterday')
  expect(dayLabel(new Date(2026, 10, 22, 12, 0).getTime(), now)).toBe('November 22')
  expect(dayLabel(new Date(2025, 11, 31, 12, 0).getTime(), now)).toBe('December 31, 2025')
  // Across the start of a month.
  expect(
    dayLabel(new Date(2026, 9, 31, 12, 0).getTime(), new Date(2026, 10, 1, 8, 0).getTime()),
  ).toBe('Yesterday')
})
