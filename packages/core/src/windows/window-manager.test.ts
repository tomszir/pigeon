import { describe, expect, it } from 'vitest'
import {
  blurAll,
  closeWindow,
  type Desktop,
  emptyDesktop,
  findWindow,
  fitBounds,
  focusWindow,
  minimizeWindow,
  moveWindow,
  openWindow,
  placeBounds,
  refitWindows,
  resizeWindow,
  toggleFromTaskbar,
  toggleMaximize,
  type Workspace,
} from './window-manager.ts'

const workspace: Workspace = {
  width: 1024,
  height: 738,
  minWidth: 120,
  minHeight: 60,
  grip: 40,
  titleBarHeight: 28,
}

const box = { x: 100, y: 100, width: 300, height: 200 }

/** Opens windows a, b, c in that order: c is in front and focused. */
function threeWindows(): Desktop {
  let desktop = emptyDesktop
  for (const id of ['a', 'b', 'c']) desktop = openWindow(desktop, id, box, workspace)
  return desktop
}

const order = (desktop: Desktop) => desktop.windows.map((window) => window.id).join('')

describe('openWindow', () => {
  it('puts the new window in front with focus', () => {
    const desktop = threeWindows()
    expect(order(desktop)).toBe('abc')
    expect(desktop.active).toBe('c')
  })

  it('focuses a window that is already open instead of opening a second', () => {
    const desktop = openWindow(threeWindows(), 'a', box, workspace)
    expect(order(desktop)).toBe('bca')
    expect(desktop.active).toBe('a')
  })

  it('brings back a minimised window', () => {
    const desktop = openWindow(minimizeWindow(threeWindows(), 'a'), 'a', box, workspace)
    expect(findWindow(desktop, 'a')?.minimized).toBe(false)
    expect(desktop.active).toBe('a')
  })

  it('fits oversized windows into the workspace', () => {
    const desktop = openWindow(
      emptyDesktop,
      'a',
      { x: 0, y: 0, width: 5000, height: 5000 },
      workspace,
    )
    expect(findWindow(desktop, 'a')?.bounds).toEqual({ x: 0, y: 0, width: 1024, height: 738 })
  })
})

describe('focus', () => {
  it('raises the window and makes it the only active one', () => {
    const desktop = focusWindow(threeWindows(), 'a')
    expect(order(desktop)).toBe('bca')
    expect(desktop.active).toBe('a')
  })

  it('ignores unknown windows', () => {
    const desktop = threeWindows()
    expect(focusWindow(desktop, 'nope')).toBe(desktop)
  })

  it('can leave nothing focused', () => {
    expect(blurAll(threeWindows()).active).toBeNull()
  })
})

describe('closeWindow', () => {
  it('passes focus to the next visible window', () => {
    const desktop = closeWindow(threeWindows(), 'c')
    expect(order(desktop)).toBe('ab')
    expect(desktop.active).toBe('b')
  })

  it('keeps focus where it was when a background window closes', () => {
    expect(closeWindow(threeWindows(), 'a').active).toBe('c')
  })

  it('skips minimised windows when passing focus', () => {
    const desktop = closeWindow(minimizeWindow(threeWindows(), 'b'), 'c')
    expect(desktop.active).toBe('a')
  })
})

describe('minimise and the taskbar', () => {
  it('minimising the focused window focuses the next one down', () => {
    const desktop = minimizeWindow(threeWindows(), 'c')
    expect(findWindow(desktop, 'c')?.minimized).toBe(true)
    expect(desktop.active).toBe('b')
  })

  it('leaves nothing focused when every window is minimised', () => {
    let desktop = threeWindows()
    for (const id of ['a', 'b', 'c']) desktop = minimizeWindow(desktop, id)
    expect(desktop.active).toBeNull()
  })

  it.each([
    ['the focused window minimises', 'c', true, 'b'],
    ['a background window comes to the front', 'a', false, 'a'],
  ])('clicking its taskbar button: %s', (_, id, minimized, active) => {
    const desktop = toggleFromTaskbar(threeWindows(), id)
    expect(findWindow(desktop, id)?.minimized).toBe(minimized)
    expect(desktop.active).toBe(active)
  })

  it('clicking a minimised window’s button restores and focuses it', () => {
    const desktop = toggleFromTaskbar(minimizeWindow(threeWindows(), 'c'), 'c')
    expect(findWindow(desktop, 'c')?.minimized).toBe(false)
    expect(desktop.active).toBe('c')
  })
})

describe('maximise', () => {
  it('fills the workspace and restores the old bounds afterwards', () => {
    const maximized = toggleMaximize(threeWindows(), 'a', workspace)
    expect(findWindow(maximized, 'a')?.bounds).toEqual({ x: 0, y: 0, width: 1024, height: 738 })
    expect(maximized.active).toBe('a')

    const restored = toggleMaximize(maximized, 'a', workspace)
    expect(findWindow(restored, 'a')?.bounds).toEqual(box)
    expect(findWindow(restored, 'a')?.restoreBounds).toBeUndefined()
  })

  it('a maximised window neither moves nor resizes', () => {
    const maximized = toggleMaximize(threeWindows(), 'a', workspace)
    const moved = moveWindow(maximized, 'a', { x: 50, y: 50 }, workspace)
    const resized = resizeWindow(moved, 'a', { width: 200, height: 200 }, workspace)
    expect(findWindow(resized, 'a')?.bounds).toEqual({ x: 0, y: 0, width: 1024, height: 738 })
  })
})

describe('moving keeps the title bar reachable', () => {
  it.each([
    ['inside the workspace', { x: 200, y: 150 }, { x: 200, y: 150 }],
    ['off the left edge', { x: -1000, y: 100 }, { x: 40 - 300, y: 100 }],
    ['off the right edge', { x: 2000, y: 100 }, { x: 1024 - 40, y: 100 }],
    ['above the top', { x: 100, y: -50 }, { x: 100, y: 0 }],
    ['under the taskbar', { x: 100, y: 900 }, { x: 100, y: 738 - 28 }],
  ])('%s', (_, to, expected) => {
    const desktop = moveWindow(threeWindows(), 'a', to, workspace)
    expect(findWindow(desktop, 'a')?.bounds).toEqual({ ...box, ...expected })
  })
})

describe('resizeWindow', () => {
  it.each([
    ['grows within the workspace', { width: 400, height: 300 }, { width: 400, height: 300 }],
    ['stops at the minimum size', { width: 10, height: 10 }, { width: 120, height: 60 }],
    ['stops at the workspace edge', { width: 5000, height: 5000 }, { width: 924, height: 638 }],
  ])('%s', (_, size, expected) => {
    const desktop = resizeWindow(threeWindows(), 'a', size, workspace)
    expect(findWindow(desktop, 'a')?.bounds).toEqual({ x: 100, y: 100, ...expected })
  })
})

describe('fitBounds', () => {
  it('leaves a window that already fits alone', () => {
    expect(fitBounds(box, workspace)).toEqual(box)
  })
})

describe('placeBounds', () => {
  it('pulls a new window wholly on screen when it fits', () => {
    expect(placeBounds({ x: 900, y: 600, width: 300, height: 200 }, workspace)).toEqual({
      x: 1024 - 300,
      y: 738 - 200,
      width: 300,
      height: 200,
    })
  })
})

describe('refitWindows', () => {
  const small: Workspace = { ...workspace, width: 800, height: 570 }

  it('moves and shrinks windows into a smaller workspace', () => {
    const desktop = openWindow(
      emptyDesktop,
      'a',
      { x: 818, y: 8, width: 200, height: 600 },
      workspace,
    )
    expect(findWindow(refitWindows(desktop, small), 'a')?.bounds).toEqual({
      x: 600,
      y: 0,
      width: 200,
      height: 570,
    })
  })

  it('keeps maximised windows filling the new workspace', () => {
    const maximized = toggleMaximize(threeWindows(), 'a', workspace)
    const window = findWindow(refitWindows(maximized, small), 'a')
    expect(window?.bounds).toEqual({ x: 0, y: 0, width: 800, height: 570 })
    expect(window?.restoreBounds).toEqual(box)
  })
})
