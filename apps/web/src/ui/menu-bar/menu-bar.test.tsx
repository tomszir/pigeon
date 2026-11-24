import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Window } from '../window/window.tsx'
import { MenuBar } from './menu-bar.tsx'

function renderMenuBar() {
  const picked = { newChat: vi.fn(), sendFile: vi.fn(), close: vi.fn(), about: vi.fn() }
  render(() => (
    <Window title="Mika - Conversation" active bounds={{ x: 0, y: 0, width: 400, height: 300 }}>
      <MenuBar
        label="Conversation"
        menus={[
          {
            label: '&File',
            entries: [
              { label: '&New conversation', shortcut: 'Ctrl+N', onSelect: picked.newChat },
              { label: 'Send a &File...', onSelect: picked.sendFile },
              { label: 'Save &As...', disabled: true },
              { kind: 'separator' },
              { label: 'C&lose', shortcut: 'Alt+F4', onSelect: picked.close },
            ],
          },
          { label: '&Help', entries: [{ label: '&About Pigeon', onSelect: picked.about }] },
        ]}
      />
    </Window>
  ))
  return picked
}

const focused = () => document.activeElement?.getAttribute('aria-label')

describe('MenuBar', () => {
  it('opens a menu on Alt and its letter, focusing the first item', () => {
    renderMenuBar()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'f', altKey: true })
    expect(screen.getByRole('menu', { name: 'File' })).toBeTruthy()
    expect(focused()).toBe('New conversation')
  })

  it('moves with the arrows, skipping disabled items and separators, and wraps', () => {
    renderMenuBar()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe('Send a File...')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe('Close')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focused()).toBe('New conversation')
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(focused()).toBe('Close')
  })

  it('picks an item with its access key and closes', () => {
    const picked = renderMenuBar()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'l' })
    expect(picked.close).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(focused()).toBe('File')
  })

  it('ignores disabled items', () => {
    renderMenuBar()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save As...' }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('walks to the next menu with Right and closes on Escape', () => {
    renderMenuBar()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowRight' })
    expect(screen.getByRole('menu', { name: 'Help' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(focused()).toBe('Help')
  })

  it('closes when the pointer goes down elsewhere', () => {
    renderMenuBar()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('focuses the bar when Alt is pressed and released alone', () => {
    renderMenuBar()
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Alt' })
    fireEvent.keyUp(dialog, { key: 'Alt' })
    expect(focused()).toBe('File')
  })
})

describe('MenuBar toggling', () => {
  it('closes an open menu when its own title is clicked again', () => {
    renderMenuBar()
    const file = screen.getByRole('menuitem', { name: 'File' })
    fireEvent.click(file)
    fireEvent.pointerDown(file)
    fireEvent.click(file)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('Menus opened with the mouse', () => {
  it('start with nothing highlighted, follow the pointer, and clear when it leaves', () => {
    renderMenuBar()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }), { detail: 1 })
    const menu = screen.getByRole('menu', { name: 'File' })
    expect(document.activeElement).toBe(menu)

    const send = screen.getByRole('menuitem', { name: 'Send a File...' })
    fireEvent.pointerEnter(send)
    expect(document.activeElement).toBe(send)
    fireEvent.pointerLeave(send)
    expect(document.activeElement).toBe(menu)
  })

  it('reach the last item with Up when nothing is highlighted', () => {
    renderMenuBar()
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }), { detail: 1 })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
    expect(focused()).toBe('Close')
  })
})
