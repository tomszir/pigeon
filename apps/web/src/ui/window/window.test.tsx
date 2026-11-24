import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../button/button.tsx'
import { Window } from './window.tsx'

const bounds = { x: 10, y: 20, width: 300, height: 200 }

function renderWindow(extra: Partial<Parameters<typeof Window>[0]> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onToggleMaximize: vi.fn(),
    onFocus: vi.fn(),
  }
  render(() => (
    <Window
      title="Read Me.txt - Pigeon Reader"
      active
      bounds={bounds}
      controls={{ minimize: true, maximize: true }}
      {...handlers}
      {...extra}
    >
      <p>Body</p>
    </Window>
  ))
  return handlers
}

describe('Window', () => {
  it('is a dialog named by its title and drawn at its bounds', () => {
    renderWindow()
    const dialog = screen.getByRole('dialog', { name: 'Read Me.txt - Pigeon Reader' })
    expect(dialog.style.left).toBe('10px')
    expect(dialog.style.width).toBe('300px')
  })

  it('sends the title-bar buttons to their handlers', () => {
    const handlers = renderWindow()
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(handlers.onMinimize).toHaveBeenCalledTimes(1)
    expect(handlers.onToggleMaximize).toHaveBeenCalledTimes(1)
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('offers Restore instead of Maximize while maximised', () => {
    renderWindow({ maximized: true })
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull()
  })

  it('maximises on a double-click of the title', () => {
    const handlers = renderWindow()
    fireEvent.dblClick(screen.getByText('Read Me.txt - Pigeon Reader'))
    expect(handlers.onToggleMaximize).toHaveBeenCalledTimes(1)
  })

  it('takes focus when clicked', () => {
    const handlers = renderWindow({ active: false })
    fireEvent.pointerDown(screen.getByText('Body'))
    expect(handlers.onFocus).toHaveBeenCalled()
  })

  it('presses a button inside it on Alt and its access key', () => {
    const onSeal = vi.fn()
    render(() => (
      <Window title="Chat" active bounds={bounds}>
        <Button label="Se&al letter" onClick={onSeal} />
      </Window>
    ))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a', altKey: true })
    expect(onSeal).toHaveBeenCalledTimes(1)
  })

  it('presses the default button on Enter', () => {
    const onOk = vi.fn()
    render(() => (
      <Window title="About" active bounds={bounds}>
        <p>Text</p>
        <Button label="OK" isDefault onClick={onOk} />
      </Window>
    ))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })
    expect(onOk).toHaveBeenCalledTimes(1)
  })
})

describe('Window focus', () => {
  it('takes keyboard focus when it is active', () => {
    render(() => (
      <Window title="Chat" active bounds={bounds}>
        <p>Text</p>
      </Window>
    ))
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })
})
