import { fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOLTIP_DELAY_MS, Tooltip } from './tooltip.tsx'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Tooltip', () => {
  it('appears after the pointer rests for half a second and goes when it leaves', () => {
    render(() => (
      <Tooltip text="Send a buzz (Ctrl+G)">
        <button type="button">Buzz</button>
      </Tooltip>
    ))
    const anchor = screen.getByRole('button').parentElement as HTMLElement
    fireEvent.pointerEnter(anchor)
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1)
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.advanceTimersByTime(1)
    expect(screen.getByRole('tooltip').textContent).toBe('Send a buzz (Ctrl+G)')
    fireEvent.pointerLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
