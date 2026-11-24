import { render, screen } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Connecting } from './connecting.tsx'

describe('Connecting', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('marks each step, counts down, and offers a hint once the wait drags on', async () => {
    let time = 1000
    const onCancel = vi.fn()
    render(() => (
      <Connecting
        friend="Your friend"
        startedAt={1000}
        timeoutMs={45_000}
        now={() => time}
        onCancel={onCancel}
        steps={[
          { label: 'Reaching the relays', state: 'done' },
          { label: 'Looking for whoever made K7RT-VP2B', state: 'current' },
          { label: 'Asking who they are', state: 'pending' },
        ]}
        hint={{ afterMs: 12_000, text: 'Nobody there yet.' }}
      />
    ))
    const current = screen.getByText('Looking for whoever made K7RT-VP2B').closest('li')
    expect(current?.getAttribute('aria-current')).toBe('step')
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.getByText(/stops trying in 45 seconds/)).toBeTruthy()
    expect(screen.queryByText('Nobody there yet.')).toBeNull()

    time += 13_000
    await vi.advanceTimersByTimeAsync(1000)
    expect(screen.getByText(/stops trying in 32 seconds/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Nobody there yet.')

    screen.getByRole('button', { name: 'Cancel' }).click()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
