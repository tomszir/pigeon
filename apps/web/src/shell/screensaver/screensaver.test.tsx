import { fireEvent, render, screen } from '@solidjs/testing-library'
import { expect, it, vi } from 'vitest'
import { FLOCK, Screensaver } from './screensaver.tsx'

it('flies the flock and wakes on a click or any key', () => {
  const onWake = vi.fn()
  render(() => <Screensaver onWake={onWake} />)
  const saver = screen.getByRole('button', { name: /Pigeon is asleep/ })
  expect(saver.querySelectorAll('img')).toHaveLength(FLOCK.length)
  fireEvent.click(saver)
  fireEvent.keyDown(document, { key: 'a' })
  expect(onWake).toHaveBeenCalledTimes(2)
})
