import { fireEvent, render, screen } from '@solidjs/testing-library'
import { expect, it, vi } from 'vitest'
import { FullScreen } from './full-screen.tsx'

it('covers the screen with what happened and what this tab can do', () => {
  const onTakeOver = vi.fn()
  render(() => (
    <FullScreen
      spec={{
        kind: 'notice',
        title: 'Pigeon is open in another tab',
        text: 'Only one tab runs Pigeon at a time.',
        buttons: [{ label: '&Use Pigeon Here', onClick: onTakeOver, isDefault: true }],
      }}
    />
  ))
  const dialog = screen.getByRole('alertdialog', { name: 'Pigeon is open in another tab' })
  const button = screen.getByRole('button', { name: 'Use Pigeon Here' })
  expect(dialog.contains(button)).toBe(true)
  expect(document.activeElement).toBe(button)
  fireEvent.click(button)
  expect(onTakeOver).toHaveBeenCalledOnce()
})

it('shows an error with its details and every way out', () => {
  const again = vi.fn()
  const over = vi.fn()
  render(() => (
    <FullScreen
      spec={{
        kind: 'error',
        title: 'Pigeon couldn’t start',
        text: 'Something stopped it.',
        details: 'ReferenceError: x',
        buttons: [
          { label: '&Try Again', onClick: again, isDefault: true },
          { label: '&Start Over...', onClick: over },
        ],
      }}
    />
  ))
  expect(screen.getByRole('alertdialog').textContent).toContain('ReferenceError: x')
  fireEvent.click(screen.getByRole('button', { name: 'Start Over...' }))
  expect(over).toHaveBeenCalledOnce()
  expect(again).not.toHaveBeenCalled()
})
