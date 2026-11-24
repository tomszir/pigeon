// Window-manager state for the desktop: which windows are open, where, in what order, and which
// one has focus. Pure functions from state to state; the shell keeps the state and draws it.

export type WindowId = string

export interface Bounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ManagedWindow {
  readonly id: WindowId
  readonly bounds: Bounds
  readonly minimized: boolean
  /** Bounds to return to, present only while the window is maximised. */
  readonly restoreBounds?: Bounds
}

export interface Desktop {
  /** Back to front: the last window is drawn on top. */
  readonly windows: readonly ManagedWindow[]
  /** The focused window. Never a minimised one. */
  readonly active: WindowId | null
}

/** The area windows live in and the rules that keep them usable. */
export interface Workspace {
  readonly width: number
  /** Height above the taskbar. */
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
  /** How much of a window's title bar must stay on screen when dragged. */
  readonly grip: number
  readonly titleBarHeight: number
}

export const emptyDesktop: Desktop = { windows: [], active: null }

export const isMaximized = (window: ManagedWindow): boolean => window.restoreBounds !== undefined

export function findWindow(desktop: Desktop, id: WindowId): ManagedWindow | undefined {
  return desktop.windows.find((window) => window.id === id)
}

/** The visible window nearest the front, the one focus falls to. */
function frontmostVisible(windows: readonly ManagedWindow[]): WindowId | null {
  for (let i = windows.length - 1; i >= 0; i--) {
    const window = windows[i]
    if (window !== undefined && !window.minimized) return window.id
  }
  return null
}

function update(
  desktop: Desktop,
  id: WindowId,
  change: (window: ManagedWindow) => ManagedWindow,
): Desktop {
  return {
    ...desktop,
    windows: desktop.windows.map((window) => (window.id === id ? change(window) : window)),
  }
}

/** Moves a window to the front. */
function raise(windows: readonly ManagedWindow[], id: WindowId): readonly ManagedWindow[] {
  const window = windows.find((w) => w.id === id)
  if (window === undefined) return windows
  return [...windows.filter((w) => w.id !== id), window]
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

/** Keeps a window's size within the workspace and enough of its title bar on screen. */
export function fitBounds(bounds: Bounds, workspace: Workspace): Bounds {
  const width = clamp(bounds.width, workspace.minWidth, workspace.width)
  const height = clamp(bounds.height, workspace.minHeight, workspace.height)
  return {
    width,
    height,
    x: clamp(bounds.x, workspace.grip - width, workspace.width - workspace.grip),
    y: clamp(bounds.y, 0, workspace.height - workspace.titleBarHeight),
  }
}

/** Keeps a window wholly on screen where it fits, as a newly opened window should be. */
export function placeBounds(bounds: Bounds, workspace: Workspace): Bounds {
  const width = clamp(bounds.width, workspace.minWidth, workspace.width)
  const height = clamp(bounds.height, workspace.minHeight, workspace.height)
  return {
    width,
    height,
    x: clamp(bounds.x, 0, workspace.width - width),
    y: clamp(bounds.y, 0, workspace.height - height),
  }
}

/**
 * Brings every window back on screen after the workspace changes size, as when the screen
 * resolution drops: maximised windows fill the new workspace, the rest move and shrink to fit.
 */
export function refitWindows(desktop: Desktop, workspace: Workspace): Desktop {
  const full = { x: 0, y: 0, width: workspace.width, height: workspace.height }
  return {
    ...desktop,
    windows: desktop.windows.map((window) =>
      window.restoreBounds === undefined
        ? { ...window, bounds: placeBounds(window.bounds, workspace) }
        : { ...window, bounds: full, restoreBounds: placeBounds(window.restoreBounds, workspace) },
    ),
  }
}

/** Opens a window in front with focus, or brings an open one back and focuses it. */
export function openWindow(
  desktop: Desktop,
  id: WindowId,
  bounds: Bounds,
  workspace: Workspace,
): Desktop {
  if (findWindow(desktop, id) !== undefined) return focusWindow(desktop, id)
  const window: ManagedWindow = { id, bounds: placeBounds(bounds, workspace), minimized: false }
  return { windows: [...desktop.windows, window], active: id }
}

export function closeWindow(desktop: Desktop, id: WindowId): Desktop {
  const windows = desktop.windows.filter((window) => window.id !== id)
  const active = desktop.active === id ? frontmostVisible(windows) : desktop.active
  return { windows, active }
}

/** Raises and focuses a window, restoring it first if it was minimised. */
export function focusWindow(desktop: Desktop, id: WindowId): Desktop {
  if (findWindow(desktop, id) === undefined) return desktop
  const shown = update(desktop, id, (window) => ({ ...window, minimized: false }))
  return { windows: raise(shown.windows, id), active: id }
}

/** Leaves no window focused, as when the desktop itself is clicked. */
export function blurAll(desktop: Desktop): Desktop {
  return { ...desktop, active: null }
}

export function minimizeWindow(desktop: Desktop, id: WindowId): Desktop {
  if (findWindow(desktop, id) === undefined) return desktop
  const windows = update(desktop, id, (window) => ({ ...window, minimized: true })).windows
  const active = desktop.active === id ? frontmostVisible(windows) : desktop.active
  return { windows, active }
}

/** What a taskbar button does: focus a background window, minimise the focused one. */
export function toggleFromTaskbar(desktop: Desktop, id: WindowId): Desktop {
  const window = findWindow(desktop, id)
  if (window === undefined) return desktop
  if (desktop.active === id && !window.minimized) return minimizeWindow(desktop, id)
  return focusWindow(desktop, id)
}

/** Maximises to the whole workspace, or restores the bounds it had before. */
export function toggleMaximize(desktop: Desktop, id: WindowId, workspace: Workspace): Desktop {
  const focused = focusWindow(desktop, id)
  return update(focused, id, (window) => {
    if (window.restoreBounds !== undefined) {
      const { restoreBounds, ...rest } = window
      return { ...rest, bounds: restoreBounds }
    }
    const full = { x: 0, y: 0, width: workspace.width, height: workspace.height }
    return { ...window, bounds: full, restoreBounds: window.bounds }
  })
}

/** Moves a window by its title bar. Maximised windows don't move. */
export function moveWindow(
  desktop: Desktop,
  id: WindowId,
  to: { readonly x: number; readonly y: number },
  workspace: Workspace,
): Desktop {
  return update(desktop, id, (window) =>
    isMaximized(window)
      ? window
      : { ...window, bounds: fitBounds({ ...window.bounds, ...to }, workspace) },
  )
}

/** Resizes from the bottom-right corner. Maximised windows don't resize. */
export function resizeWindow(
  desktop: Desktop,
  id: WindowId,
  size: { readonly width: number; readonly height: number },
  workspace: Workspace,
): Desktop {
  return update(desktop, id, (window) => {
    if (isMaximized(window)) return window
    const { x, y } = window.bounds
    const width = clamp(size.width, workspace.minWidth, workspace.width - x)
    const height = clamp(size.height, workspace.minHeight, workspace.height - y)
    return { ...window, bounds: { x, y, width, height } }
  })
}
