import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { brandIcon } from '../../ui/icons/icons.ts'
import type { Launcher, PigeonMenuSpec } from '../shell/types.ts'
import { PigeonMenu } from './pigeon-menu.tsx'

const icon = brandIcon('pigeon-16')
const launcher = (id: string, label: string, extra: Partial<Launcher> = {}): Launcher => ({
  id,
  label,
  icon16: icon,
  icon32: icon,
  onOpen: vi.fn(),
  ...extra,
})

function renderMenu(focusFirst = false, user?: PigeonMenuSpec['user']) {
  const messenger = launcher('messenger', 'Pigeon Messenger', { description: 'Chat with friends' })
  const readme = launcher('readme', 'Read Me')
  const onClose = vi.fn()
  render(() => (
    <PigeonMenu
      spec={{
        programs: [messenger, readme],
        places: [],
        tools: [],
        all: [launcher('about', 'About')],
        ...(user === undefined ? {} : { user }),
      }}
      focusFirst={focusFirst}
      onClose={onClose}
      onShutDown={vi.fn()}
    />
  ))
  return { messenger, readme, onClose, menu: screen.getByRole('menu', { name: 'Pigeon menu' }) }
}

describe('PigeonMenu', () => {
  it('greets you by name with your picture, and says Pigeon before you have one', () => {
    renderMenu(false, () => ({ name: 'Mika', picture: { src: 'data:bird', size: 32 } }))
    const header = screen.getByText('Mika')
    expect(header.parentElement?.querySelector('img')?.getAttribute('src')).toBe('data:bird')
  })

  it('says Pigeon with its logo until you have a name', () => {
    renderMenu(false, () => ({ name: '', picture: undefined }))
    expect(screen.getByText('Pigeon')).toBeTruthy()
  })

  it('opens with nothing highlighted from the mouse, the first item from the keyboard', () => {
    const { menu } = renderMenu()
    expect(document.activeElement).toBe(menu)
  })

  it('highlights only the hovered item and clears when the pointer leaves', () => {
    const { menu } = renderMenu(true)
    const readme = screen.getByRole('menuitem', { name: 'Read Me' })
    fireEvent.pointerEnter(readme)
    expect(document.activeElement).toBe(readme)
    fireEvent.pointerLeave(readme)
    expect(document.activeElement).toBe(menu)
  })

  it('closes All Programs when the pointer moves to another item', () => {
    renderMenu()
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'All Programs' }))
    expect(screen.getByRole('menu', { name: 'All Programs' })).toBeTruthy()
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Read Me' }))
    expect(screen.queryByRole('menu', { name: 'All Programs' })).toBeNull()
  })

  it('opens a program and closes', () => {
    const { readme, onClose } = renderMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Read Me' }))
    expect(readme.onOpen).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })
})
