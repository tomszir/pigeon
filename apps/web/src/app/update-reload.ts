// Reloading into a newer Pigeon once it's safe. update-check.ts says a newer version is out; this
// waits until nothing would be lost and nobody is looking, then reloads, once per version.
import { isNewer } from './whats-new.ts'

/** How often a tab with an update waiting looks again for a safe moment. */
export const RETRY_EVERY_MS = 5_000

export interface PendingReloadOptions {
  /** The version this tab is running. */
  readonly current: string
  /** Something would be lost by a reload now (see unsaved-work.ts). */
  readonly isBusy: () => boolean
  /** The tab is hidden or nobody has touched it for a while. */
  readonly isQuiet: () => boolean
  readonly reload: () => void
  /**
   * The version this tab last reloaded for, kept across the reload (session storage). If a
   * reload brings the same old code back, as a stale cache could, the tab says nothing more
   * instead of reloading in a loop.
   */
  readonly attempted: {
    readonly get: () => string | undefined
    /** Throws when it can't be kept; the tab then doesn't reload. */
    readonly set: (version: string) => void
  }
  readonly document?: Document
}

export interface PendingReload {
  /** Notes that `version` is out; reloads at the next safe moment. */
  readonly want: (version: string) => void
  readonly stop: () => void
}

export function createPendingReload(options: PendingReloadOptions): PendingReload {
  const doc = options.document ?? document
  let wanted: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    doc.removeEventListener('visibilitychange', tryNow)
  }

  function tryNow() {
    if (wanted === undefined || options.isBusy() || !options.isQuiet()) return
    const version = wanted
    stop()
    wanted = undefined
    try {
      options.attempted.set(version)
    } catch {
      // Can't be remembered, so a reload that brings back the same code could repeat: stay put.
      return
    }
    options.reload()
  }

  return {
    want: (version) => {
      if (!isNewer(version, options.current)) return
      const tried = options.attempted.get()
      // Already reloaded for this version (or a later one) and still on old code.
      if (tried !== undefined && !isNewer(version, tried)) return
      if (wanted !== undefined && !isNewer(version, wanted)) return
      wanted = version
      if (timer === undefined) {
        timer = setInterval(tryNow, RETRY_EVERY_MS)
        doc.addEventListener('visibilitychange', tryNow)
      }
      tryNow()
    },
    stop,
  }
}

/**
 * What a tab does when a newer version is out. Where the browser keeps what Pigeon stores, it
 * reloads by itself once that's safe. Where it keeps nothing, a reload would forget the person,
 * so the tab only says an update is out, once per version, and leaves the reload to them.
 */
export function onNewerVersion(options: {
  readonly persistent: boolean
  readonly pending: Pick<PendingReload, 'want'>
  readonly offer: (version: string) => void
}): (version: string) => void {
  return options.persistent ? options.pending.want : options.offer
}
