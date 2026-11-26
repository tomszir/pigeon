import type { Wake } from './wake.ts'

/** The page's own events: the tab showing again, the window getting focus, the network back. */
export function createBrowserWake(win: Window = window, doc: Document = document): Wake {
  return {
    on(listener) {
      const shown = () => {
        // A tab going out of sight fires the same event; only coming back counts.
        if (doc.visibilityState === 'visible') listener()
      }
      doc.addEventListener('visibilitychange', shown)
      win.addEventListener('focus', listener)
      win.addEventListener('online', listener)
      return () => {
        doc.removeEventListener('visibilitychange', shown)
        win.removeEventListener('focus', listener)
        win.removeEventListener('online', listener)
      }
    },
  }
}
