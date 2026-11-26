// What a reload would lose, and when nobody is looking. A reload keeps what Pigeon has stored
// (friends, chats, letters waiting to go), but not text being typed, nor a pairing, a link or a
// recovery in the middle of its steps, nor a write or a letter still going out, so an update
// waits while any of those is going on.
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
 * a field and it's still there. The app's own forms say so themselves (`data-unsent`, set by
 * `ui/text-field`), which covers a one-line field in a dialog that isn't focused. For any other
 * field the page guesses: a multi-line box always counts, a one-line field while it has focus,
 * and a field the app fills in itself (Explorer's address bar) never does.
 */
export function watchUnsavedWork(options: {
  readonly isOpen: (id: WindowId) => boolean
  /** Work the Messenger has in flight (see `inFlight` there). */
  readonly inFlight?: () => boolean
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
    if (doc.querySelector('[data-unsent]') !== null) return true
    for (const field of doc.querySelectorAll<TextField>('textarea, input')) {
      if (!typedIn.has(field) || field.value === '') continue
      if (field instanceof HTMLTextAreaElement || field === doc.activeElement) return true
    }
    return false
  }

  return {
    isBusy: () =>
      FLOW_WINDOWS.some(options.isOpen) || hasUnsentText() || options.inFlight?.() === true,
    isQuiet: () => doc.visibilityState === 'hidden' || Date.now() - lastActivity >= IDLE_AFTER_MS,
    stop: () => {
      doc.removeEventListener('input', onInput, true)
      for (const name of activity) doc.removeEventListener(name, onActivity, true)
    },
  }
}
