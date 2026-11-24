import { describe, expect, it } from 'vitest'
import { buzzAlert } from '../shell/buzz.ts'
import { taskButtonLayout } from './task-buttons.ts'

describe('buzzAlert', () => {
  it.each([
    [false, true, 'shake'],
    [true, true, 'flash'],
    [false, false, 'flash'],
    [true, false, 'flash'],
  ] as const)('reduced motion %s, shaking on %s: %s', (reduced, shake, kind) => {
    expect(buzzAlert(reduced, shake)).toBe(kind)
  })
})

describe('taskButtonLayout', () => {
  it.each([
    ['one window', 1, 600, 150, true],
    ['four windows fit at full width', 4, 609, 150, true],
    ['eight windows share the space', 8, 600, 72, true],
    ['nine windows drop their labels', 9, 600, 64, false],
    ['never thinner than an icon', 40, 600, 24, false],
  ])('%s', (_, count, available, width, showLabel) => {
    expect(taskButtonLayout(count, available)).toEqual({ width, showLabel })
  })
})
