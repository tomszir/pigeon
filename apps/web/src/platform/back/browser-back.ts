// The back stack over the browser's own history. Every entry Pigeon adds is at
// the same address, marked with its depth in `history.state`, so the address bar never changes,
// nothing reloads, and invite links in the address work as before.
import { type BackStack, createBackStack } from '@pigeon/core'

const KEY = 'pigeonBack'

const depthOf = (state: unknown): number | undefined => {
  if (typeof state !== 'object' || state === null) return undefined
  const depth = (state as Record<string, unknown>)[KEY]
  return typeof depth === 'number' && Number.isSafeInteger(depth) ? depth : undefined
}

/** Keeps whatever else is in the entry's state, adding Pigeon's depth. */
const withDepth = (state: unknown, depth: number) => ({
  ...(typeof state === 'object' && state !== null ? state : {}),
  [KEY]: depth,
})

export function createBrowserBack(win: Window = window): BackStack {
  const { history } = win
  const start = depthOf(history.state) ?? 0
  history.replaceState(withDepth(history.state, start), '')
  const stack = createBackStack(
    {
      push: (depth) => history.pushState(withDepth(null, depth), ''),
      go: (delta) => history.go(delta),
      mark: (depth) => history.replaceState(withDepth(history.state, depth), ''),
    },
    start,
  )
  win.addEventListener('popstate', (event) => stack.moved(depthOf(event.state)))
  return stack
}
