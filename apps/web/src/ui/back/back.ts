// Back steps back inside Pigeon. app/ provides the stack over the browser's
// history; anything you can step back from (a menu, a window on the Pocket, a page in Explorer)
// pushes an entry while it's open and says it's done when it closes another way.
import type { BackEntry, BackStack } from '@pigeon/core'
import { createContext, onCleanup, useContext } from 'solid-js'

const nothing: BackEntry = { done: () => {} }

/** Without a provider (in tests, say) Back reaches nothing. */
const NO_BACK: BackStack = { push: () => nothing, moved: () => {}, size: () => 0 }

export const BackContext = createContext<BackStack>(NO_BACK)

export const useBack = (): BackStack => useContext(BackContext)

/**
 * One thing Back closes while it's open: call `open` when it opens and `close` when it closes
 * any other way. Back runs `onBack`, which should close it. Cleaned up with its owner.
 */
export function backStep(stack: BackStack, onBack: () => void) {
  let entry: BackEntry | undefined
  const close = () => {
    entry?.done()
    entry = undefined
  }
  onCleanup(close)
  return {
    open: () => {
      if (entry !== undefined) return
      entry = stack.push(() => {
        entry = undefined
        onBack()
      })
    },
    close,
  }
}
