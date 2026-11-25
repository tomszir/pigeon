import { fireEvent, render, screen } from '@solidjs/testing-library'
import { expect, it, vi } from 'vitest'
import { Elsewhere } from './elsewhere.tsx'

it('covers the screen with what happened and the one way to use Pigeon here', () => {
  const onTakeOver = vi.fn()
  render(() => <Elsewhere title="Pigeon is open in another tab" onTakeOver={onTakeOver} />)
  const dialog = screen.getByRole('alertdialog', { name: 'Pigeon is open in another tab' })
  const button = screen.getByRole('button', { name: 'Use Pigeon Here' })
  expect(dialog.contains(button)).toBe(true)
  expect(document.activeElement).toBe(button)
  fireEvent.click(button)
  expect(onTakeOver).toHaveBeenCalledOnce()
})
