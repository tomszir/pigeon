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

  it('does its action when clicked, then closes', () => {
    const onClose = vi.fn()
    const onClick = vi.fn()
    render(() => (
      <Balloon title="What's new" onClose={onClose} onClick={onClick}>
        See what's new?
      </Balloon>
    ))
    fireEvent.click(screen.getByRole('button', { name: "See what's new?" }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from its button without doing its action', () => {
    const onClose = vi.fn()
    const onClick = vi.fn()
    render(() => (
      <Balloon title="What's new" onClose={onClose} onClick={onClick}>
        See what's new?
      </Balloon>
    ))
    fireEvent.click(screen.getByRole('button', { name: 'Close notification' }))
    expect(onClick).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
