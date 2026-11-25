// Back steps back inside Pigeon (decision 0034). Everything you can step back from (a page
// Explorer opened, a window on the Pocket, an open menu) adds an entry, and each entry is one
// entry in the browser's history at the same address. The browser's Back takes the newest entry
// off and runs it; with none left, Back leaves Pigeon as it always did.
//
// The browser's history and this stack have to stay in step even when something is closed inside
// Pigeon instead. An entry closed that way is marked done, and done entries at the top are taken
// out of the browser's history again. History moves are asynchronous, so while one is on its way
// new entries wait, and are added once it has landed.

/** The browser's history, as the stack drives it. Depths count entries from the page's own. */
export interface HistoryPort {
  /** Adds an entry after the current one, which is at `depth` once added. */
  readonly push: (depth: number) => void
  /** Moves by `delta` entries; where it lands comes back later through `moved`. */
  readonly go: (delta: number) => void
  /** Marks the current entry as being at `depth`. */
  readonly mark: (depth: number) => void
}

/** One thing you can step back from. */
export interface BackEntry {
  /** It was closed inside Pigeon, so Back no longer needs to: its history entry goes too. */
  readonly done: () => void
}

export interface BackStack {
  /** Adds something Back closes; `onBack` runs when the browser's Back reaches it. */
  readonly push: (onBack: () => void) => BackEntry
  /** The browser moved to the entry at `depth`, or to one it didn't mark (undefined). */
  readonly moved: (depth: number | undefined) => void
  /** Entries Back would close, newest last. For tests and status. */
  readonly size: () => number
}

interface Entry {
  readonly onBack: () => void
  live: boolean
  /** Its history entry has been added. */
  pushed: boolean
  /** A history entry of the page's own, not Pigeon's: never taken out, and Back passes it. */
  readonly foreign?: true
}

/** A stack over the browser's history, which is at `depth` now (0 for a fresh page). */
export function createBackStack(history: HistoryPort, depth = 0): BackStack {
  /** Pushed entries first, at depths base + 1, base + 2, ...; unpushed ones after. */
  const entries: Entry[] = []
  /** The depth of the history entry just below the first entry. */
  let base = depth
  let at = depth
  /** History moves of ours on their way, whose landing isn't a press of Back. */
  let pending = 0

  /** Done entries leave; trailing ones take their history entries with them; waiting ones are added. */
  const settle = () => {
    if (pending > 0) return
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry !== undefined && !entry.pushed && !entry.live) entries.splice(i, 1)
    }
    let trailing = 0
    while (true) {
      const top = entries[entries.length - 1 - trailing]
      if (top === undefined || !top.pushed || top.live || top.foreign) break
      trailing++
    }
    const waiting = entries.some((entry) => !entry.pushed)
    if (trailing > 0 && !waiting) {
      entries.splice(entries.length - trailing, trailing)
      pending++
      history.go(-trailing)
      return
    }
    for (const entry of entries) {
      if (entry.pushed) continue
      at++
      entry.pushed = true
      history.push(at)
    }
  }

  const back = (to: number) => {
    // A jump below the first entry (a reload's leftovers, or the history menu) moves the base.
    base = Math.min(base, to)
    // Back by `at - to`: the entries above `to` are gone from the browser, newest first.
    const gone = entries.splice(to - base).reverse()
    at = to
    let ran = false
    for (const entry of gone) {
      if (!entry.live) continue
      entry.live = false
      ran = true
      entry.onBack()
    }
    if (!ran && gone.length > 0) {
      // Only done or foreign entries were passed, so this press of Back hasn't done anything
      // yet: carry on, to the next entry or out of Pigeon.
      history.go(-1)
      return
    }
    if (!ran && entries.length === 0 && to > 0) {
      // Entries left from before a reload, which nothing here answers: go past them all, and
      // past the page's own, as Back would have.
      history.go(-to - 1)
      return
    }
    settle()
  }

  return {
    push: (onBack) => {
      const entry: Entry = { onBack, live: true, pushed: false }
      entries.push(entry)
      settle()
      return {
        done: () => {
          if (!entry.live) return
          entry.live = false
          settle()
        },
      }
    },
    moved: (to) => {
      if (to === undefined) {
        // An entry of the page's own, such as an invite link opened in the address bar. It
        // stands in the stack like a done entry, so Back passes it on the way down.
        at++
        entries.push({ onBack: () => {}, live: false, pushed: true, foreign: true })
        history.mark(at)
        return
      }
      if (pending > 0) {
        pending--
        at = to
        settle()
        return
      }
      if (to === at) return
      if (to > at) {
        // Forward isn't mirrored: what Back closed stays closed. Go back to where we were.
        pending++
        const from = at
        at = to
        history.go(from - to)
        return
      }
      back(to)
    },
    size: () => entries.filter((entry) => entry.live).length,
  }
}
