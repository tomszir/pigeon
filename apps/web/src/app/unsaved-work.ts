// What a reload would lose, and when nobody is looking. A reload keeps what Pigeon has stored
// (friends, chats, letters waiting to go), but not a message being typed, nor a pairing, a link
// or a recovery in the middle of its steps, so an update waits while any of those is going on.
import type { WindowId } from '@pigeon/core'

/** Windows that hold a step-by-step exchange or a secret being entered, which a reload would drop. */
export const FLOW_WINDOWS: readonly WindowId[] = [
  'add-friend',
  'link-device',
  'join-device',
  'make-recovery-key',
  'use-recovery-key',
  'export-data',
  'import-data',
]

/** After this long without a click, key or touch, nobody is at the keyboard. */
export const IDLE_AFTER_MS = 30_000

export interface UnsavedWork {
  /** Something would be lost by a reload now. */
  readonly isBusy: () => boolean
  /** The tab is hidden, or nobody has touched it for a while. */
  readonly isQuiet: () => boolean
  readonly stop: () => void
}

type TextField = HTMLInputElement | HTMLTextAreaElement

const isTextField = (target: EventTarget | null): target is TextField =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type))

/**
 * Watches the page for work a reload would lose. Text counts as unsent when a person typed it in
 * a field (so Explorer's address bar, which the app fills in itself, doesn't) and it's still
 * there: always in a multi-line box (a chat or letter being written), and in a one-line field
 * while it has focus.
 */
export function watchUnsavedWork(options: {
  readonly isOpen: (id: WindowId) => boolean
  readonly document?: Document
}): UnsavedWork {
  const doc = options.document ?? document
  const typedIn = new WeakSet<TextField>()
  let lastActivity = Date.now()

  const onInput = (event: Event) => {
    if (isTextField(event.target)) typedIn.add(event.target)
  }
  const onActivity = () => {
    lastActivity = Date.now()
  }
  const activity = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
  doc.addEventListener('input', onInput, true)
  for (const name of activity) doc.addEventListener(name, onActivity, true)

  const hasUnsentText = () => {
    for (const field of doc.querySelectorAll<TextField>('textarea, input')) {
      if (!typedIn.has(field) || field.value === '') continue
      if (field instanceof HTMLTextAreaElement || field === doc.activeElement) return true
    }
    return false
  }

  return {
    isBusy: () => FLOW_WINDOWS.some(options.isOpen) || hasUnsentText(),
    isQuiet: () => doc.visibilityState === 'hidden' || Date.now() - lastActivity >= IDLE_AFTER_MS,
    stop: () => {
      doc.removeEventListener('input', onInput, true)
      for (const name of activity) doc.removeEventListener(name, onActivity, true)
    },
  }
}
