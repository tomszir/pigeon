import { fireEvent, render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BALLOON_TIMEOUT_MS, Balloon } from './balloon.tsx'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Balloon', () => {
  it('closes itself after ten seconds', () => {
    const onClose = vi.fn()
    render(() => (
      <Balloon title="Mika is now online" onClose={onClose}>
        Click to open the conversation.
      </Balloon>
    ))
    vi.advanceTimersByTime(BALLOON_TIMEOUT_MS - 1)
    expect(onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from its button', () => {
    const onClose = vi.fn()
    render(() => (
      <Balloon title="Hello" onClose={onClose}>
        Body
      </Balloon>
    ))
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
