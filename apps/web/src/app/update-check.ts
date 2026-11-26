// Telling an open tab that a newer Pigeon has been deployed. A tab keeps running the code it
// loaded, so it fetches `/version.json` (the same version the build holds as
// `__PIGEON_VERSION__`, written by version-file.ts) when it comes into view and now and then
// while it stays open, and calls `onNewer` the first time it sees a version later than its own.
// It never reloads anything itself: what to do about it is the visitor's call.
import { isNewer } from './whats-new.ts'

/** How long a tab left open waits between checks. */
export const CHECK_EVERY_MS = 60 * 60 * 1000
/** Coming into view checks again only after this long, so switching tabs isn't a request each time. */
export const FOCUS_GAP_MS = 5 * 60 * 1000

const VERSION = /^\d+\.\d+\.\d+$/

/** The version `version.json` holds, or undefined when the file isn't one (an error page, offline). */
export function parseVersionFile(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { version } = body as { version?: unknown }
  return typeof version === 'string' && VERSION.test(version) ? version : undefined
}

export interface UpdateWatchOptions {
  /** The version this tab is running. */
  readonly current: string
  /** `fetch`, or a fake. */
  readonly fetch: typeof fetch
  /** Said once per newer version seen. */
  readonly onNewer: (version: string) => void
  /** Where "came into view" is heard: the window and the document. */
  readonly window?: Window
  readonly document?: Document
}

/** Starts watching; the returned function stops it. */
export function watchForUpdates(options: UpdateWatchOptions): () => void {
  const win = options.window ?? window
  const doc = options.document ?? document
  let lastCheck = Date.now()
  let checking = false
  let said = options.current

  const check = async () => {
    if (checking) return
    checking = true
    lastCheck = Date.now()
    try {
      // Same origin only, so the policy's connect-src 'self' covers it; never from a cache.
      const response = await options.fetch('/version.json', {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      if (!response.ok) return
      const version = parseVersionFile(await response.json())
      if (version !== undefined && isNewer(version, said)) {
        said = version
        options.onNewer(version)
      }
    } catch {
      // Offline, or the file isn't JSON: nothing to say, and the next check tries again.
    } finally {
      checking = false
    }
  }

  const cameIntoView = () => {
    if (doc.visibilityState === 'hidden') return
    if (Date.now() - lastCheck >= FOCUS_GAP_MS) void check()
  }

  const timer = setInterval(() => void check(), CHECK_EVERY_MS)
  win.addEventListener('focus', cameIntoView)
  doc.addEventListener('visibilitychange', cameIntoView)
  return () => {
    clearInterval(timer)
    win.removeEventListener('focus', cameIntoView)
    doc.removeEventListener('visibilitychange', cameIntoView)
  }
}
