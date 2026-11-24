import type { Desktop, WindowId } from '@pigeon/core'
import { fireEvent, render, screen } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { brandIcon } from '../../ui/icons/icons.ts'
import type { Launcher, WindowHandle, WindowSpec } from '../shell/types.ts'
import { PhoneShell, softKeyPath } from './phone-shell.tsx'

const icon = brandIcon('pigeon-16')
const launcher = (id: string, label: string, extra: Partial<Launcher> = {}): Launcher => ({
  id,
  label,
  icon16: icon,
  icon32: icon,
  onOpen: vi.fn(),
  ...extra,
})

const box = { x: 0, y: 0, width: 100, height: 100 }

function setup(touch = true) {
  const messenger = launcher('messenger', 'Pigeon Messenger')
  const addFriend = vi.fn()
  const readme = launcher('readme', 'Read Me')
  const files = launcher('files', 'Shared Files', { disabled: true })
  const [desktop, setDesktop] = createSignal<Desktop>({ windows: [], active: null })
  const closed: WindowId[] = []
  const close = vi.fn()
  const specs = new Map<WindowId, WindowSpec>([
    ['readme', { title: 'Read Me', icon, bounds: box, content: () => <p>Read me</p> }],
    [
      'messenger',
      {
        title: 'Pigeon',
        taskTitle: 'Pigeon Messenger',
        icon,
        bounds: box,
        content: () => <textarea aria-label="Message to Mika" />,
      },
    ],
  ])
  const handle = (id: WindowId): WindowHandle => ({
    id,
    close: () => {
      closed.push(id)
      if (id === 'messenger') close()
    },
    minimize: () => undefined,
    buzz: () => undefined,
    isActive: () => desktop().active === id,
  })
  render(() => (
    <PhoneShell
      specs={specs}
      desktop={desktop()}
      menu={{ programs: [messenger, readme], places: [files], tools: [], all: [] }}
      phone={{
        home: () => <p>Good evening, Toms</p>,
        leftSoftKey: (front) =>
          front === 'messenger'
            ? { label: 'Add Friend', onPress: addFriend }
            : { label: 'Messenger', onPress: messenger.onOpen },
      }}
      notice={null}
      onCloseNotice={() => undefined}
      now={() => new Date(2026, 10, 24, 19, 42)}
      touch={touch}
      lcd
      alerts={new Map()}
      visible={{ height: 844, top: 0 }}
      onShutDown={() => undefined}
      handle={handle}
    />
  ))
  const openMessengerWindow = () =>
    setDesktop({
      windows: [{ id: 'messenger', bounds: box, minimized: false }],
      active: 'messenger',
    })
  const openBoth = () =>
    setDesktop({
      windows: [
        { id: 'messenger', bounds: box, minimized: false },
        { id: 'readme', bounds: box, minimized: false },
      ],
      active: 'readme',
    })
  return { messenger, readme, addFriend, close, closed, openMessengerWindow, openBoth }
}

const key = (name: string) => screen.getByRole('button', { name })
const keys = () => screen.queryByRole('navigation', { name: 'Pocket keys' })

describe('PhoneShell', () => {
  it('starts on Today, with the soft keys saying what they do', () => {
    setup()
    expect(screen.getByRole('region', { name: 'Today' }).textContent).toContain(
      'Good evening, Toms',
    )
    expect(key('Home: Today').getAttribute('aria-current')).toBe('page')
    expect(key('Left soft key: Messenger')).toBeTruthy()
    expect(key('Right soft key: Menu')).toBeTruthy()
  })

  it('opens a program from the left soft key, then changes the key for that window', () => {
    const { messenger, addFriend, close, openMessengerWindow } = setup()
    fireEvent.click(key('Left soft key: Messenger'))
    expect(messenger.onOpen).toHaveBeenCalledOnce()
    openMessengerWindow()
    expect(screen.getByRole('region', { name: 'Pigeon' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Pigeon Messenger' })).toBeTruthy()
    expect(key('Home: Today').getAttribute('aria-current')).toBeNull()
    fireEvent.click(key('Left soft key: Add Friend'))
    expect(addFriend).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close Pigeon Messenger' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes the windows behind whichever comes to the front, and all of them on Today', () => {
    const { closed, openBoth } = setup()
    openBoth()
    expect(screen.getByRole('region', { name: 'Read Me' })).toBeTruthy()
    expect(closed).toEqual(['messenger'])
    fireEvent.click(key('Home: Today'))
    expect(screen.getByRole('region', { name: 'Today' })).toBeTruthy()
    expect(closed.slice(1).sort()).toEqual(['messenger', 'readme'])
  })

  it('opens the Pigeon menu from the right soft key and closes it with Escape', async () => {
    const { readme } = setup()
    fireEvent.click(key('Right soft key: Menu'))
    const menu = screen.getByRole('menu', { name: 'Pigeon menu' })
    expect(key('Right soft key: Close').getAttribute('aria-expanded')).toBe('true')
    await Promise.resolve()
    expect(document.activeElement?.textContent).toBe('Pigeon Messenger')
    expect(screen.getByRole('menuitem', { name: 'Shared Files' }).hasAttribute('disabled')).toBe(
      true,
    )
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('Read Me')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(key('Right soft key: Menu'))

    fireEvent.click(key('Right soft key: Menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Read Me' }))
    expect(readme.onOpen).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('moves the keys aside while typing on a touch screen, and keeps them otherwise', () => {
    const { openMessengerWindow } = setup()
    openMessengerWindow()
    const field = screen.getByRole('textbox', { name: 'Message to Mika' })
    fireEvent.focusIn(field)
    expect(keys()).toBeNull()
    fireEvent.focusOut(field, { relatedTarget: null })
    expect(keys()).not.toBeNull()
  })

  it('keeps the keys with a mouse and keyboard', () => {
    const { openMessengerWindow } = setup(false)
    openMessengerWindow()
    fireEvent.focusIn(screen.getByRole('textbox', { name: 'Message to Mika' }))
    expect(keys()).not.toBeNull()
  })
})

it('draws a soft key to its real width, keeping the hollow and corners', () => {
  const narrow = softKeyPath(100)
  const wide = softKeyPath(160)
  expect(narrow).toContain('L 110 -23')
  expect(wide).toContain('L 170 -23')
  // The hollow around the home key is the same whatever the width.
  expect(narrow.slice(narrow.indexOf('L 34 23'))).toBe(wide.slice(wide.indexOf('L 34 23')))
})
