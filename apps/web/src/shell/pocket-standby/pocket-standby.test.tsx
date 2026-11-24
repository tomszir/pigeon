import { fireEvent, render, screen } from '@solidjs/testing-library'
import { expect, it, vi } from 'vitest'
import { PocketStandby } from './pocket-standby.tsx'

it('shows the time and what is new, and wakes on a tap or a key', () => {
  const onWake = vi.fn()
  render(() => (
    <PocketStandby
      now={() => new Date(2026, 10, 24, 21, 5)}
      news="1 new from Mika"
      onWake={onWake}
    />
  ))
  const standby = screen.getByRole('button', { name: /asleep/ })
  expect(standby.textContent).toMatch(/9:05/)
  expect(standby.textContent).toContain('1 new from Mika')
  fireEvent.click(standby)
  fireEvent.keyDown(document, { key: 'Enter' })
  expect(onWake).toHaveBeenCalledTimes(2)
})
