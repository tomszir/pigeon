// Taskbar buttons are 150px wide and share the space when there are many, dropping their labels
// below 70px each.

const FULL_WIDTH = 150
const LABEL_MIN_WIDTH = 70
const GAP = 3

export interface TaskButtonLayout {
  readonly width: number
  readonly showLabel: boolean
}

export function taskButtonLayout(count: number, available: number): TaskButtonLayout {
  if (count === 0) return { width: FULL_WIDTH, showLabel: true }
  const share = Math.floor((available - GAP * (count - 1)) / count)
  const width = Math.max(24, Math.min(FULL_WIDTH, share))
  return { width, showLabel: width >= LABEL_MIN_WIDTH }
}
