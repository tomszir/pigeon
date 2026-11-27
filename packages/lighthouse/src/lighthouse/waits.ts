// The waits standing at a Lighthouse: at most one per connection, found by tag when a put comes,
// by lease end when time passes, and counted by their tags against the budgets of their address
// range, their IPv6 /48 and everyone together. It lives in memory only: a wait's tags are never
// written to storage, and the Worker rebuilds this from its sockets' attachments when it wakes.

/** One standing wait: what it asked for, and what its answer must be signed over. */
export interface Wait {
  readonly req: number
  /** The hash of the wait's frame, which its answer signs. */
  readonly hash: string
  readonly tags: readonly string[]
  readonly cursor: number
  /** When its lease ends, in ms. */
  readonly until: number
  readonly since: number
  /**
   * The order waits began in, for choosing whom to close when there's no room: the longest
   * standing is the first to begin, even of two that began in the same millisecond. Kept with
   * the wait, so it holds across the Worker's sleeps.
   */
  readonly order: number
}

/** A connection, as the index knows it. */
export interface Waiter {
  readonly range: string
  readonly wide: string | undefined
  /** When it was last heard from: its last frame or keepalive. */
  heard(): number
  /** Closes it, for the reason given. */
  close(code: number, reason: string): void
}

/** Which waiters closing one would make room among: the full limit's. */
export type Scope =
  | { readonly kind: 'range'; readonly range: string }
  | { readonly kind: 'wide'; readonly wide: string }
  | { readonly kind: 'any' }

export interface WaitBudget {
  readonly tagsPerRange: number
  readonly tagsPer48: number
  readonly maxTags: number
  /** How long a connection may go unheard before its wait counts for nothing, in ms. */
  readonly idleMs: number
}

export interface WaitIndex {
  get(waiter: Waiter): Wait | undefined
  add(waiter: Waiter, wait: Wait): void
  /**
   * Takes `waiter`'s wait out, if it still has `wait` (or any, when not given), and says whether
   * it did: whoever takes a wait out answers it, so it's answered once.
   */
  take(waiter: Waiter, wait?: Wait): Wait | undefined
  /** The waiters on `tag`. */
  on(tag: string): readonly Waiter[]
  /** Whether `tags` more fit beside the waits of others, closing those gone quiet as it counts. */
  fits(waiter: Waiter, tags: number, now: number): boolean
  /** Waiters whose lease has passed, soonest first. */
  ended(now: number): readonly Waiter[]
  /** Whether a waiter has gone quiet past the idle time. */
  quiet(waiter: Waiter, now: number): boolean
  /** The waiter whose wait has stood longest in `scope`, if any. */
  longest(scope: Scope): Waiter | undefined
  /** The `order` for a wait beginning now. */
  next(): number
  readonly size: () => number
}

export function createWaitIndex(budget: WaitBudget): WaitIndex {
  const waits = new Map<Waiter, Wait>()
  const byTag = new Map<string, Set<Waiter>>()
  /** Waiters by lease end, soonest first. */
  let byEnd: Waiter[] = []
  const tagsIn = { total: 0, range: new Map<string, number>(), wide: new Map<string, number>() }
  let begun = 0

  const move = (counts: Map<string, number>, key: string | undefined, by: number) => {
    if (key === undefined) return
    const next = (counts.get(key) ?? 0) + by
    if (next <= 0) counts.delete(key)
    else counts.set(key, next)
  }
  const count = (waiter: Waiter, wait: Wait, sign: 1 | -1) => {
    const by = sign * wait.tags.length
    tagsIn.total += by
    move(tagsIn.range, waiter.range, by)
    move(tagsIn.wide, waiter.wide, by)
  }
  const quiet = (waiter: Waiter, now: number) => now - waiter.heard() >= budget.idleMs
  const take = (waiter: Waiter, wait?: Wait) => {
    const held = waits.get(waiter)
    if (held === undefined || (wait !== undefined && held !== wait)) return undefined
    waits.delete(waiter)
    for (const tag of held.tags) {
      const set = byTag.get(tag)
      set?.delete(waiter)
      if (set?.size === 0) byTag.delete(tag)
    }
    byEnd = byEnd.filter((other) => other !== waiter)
    count(waiter, held, -1)
    return held
  }

  return {
    get: (waiter) => waits.get(waiter),
    add(waiter, wait) {
      take(waiter)
      begun = Math.max(begun, wait.order + 1)
      waits.set(waiter, wait)
      for (const tag of wait.tags) {
        const set = byTag.get(tag) ?? new Set<Waiter>()
        set.add(waiter)
        byTag.set(tag, set)
      }
      // Kept in order of lease end, so finding the ended ones only looks at the front.
      let at = byEnd.length
      while (at > 0 && (waits.get(byEnd[at - 1] as Waiter)?.until ?? 0) > wait.until) at -= 1
      byEnd.splice(at, 0, waiter)
      count(waiter, wait, 1)
    },
    take,
    on: (tag) => [...(byTag.get(tag) ?? [])],
    fits(waiter, tags, now) {
      const over = () =>
        tagsIn.total + tags > budget.maxTags ||
        (tagsIn.range.get(waiter.range) ?? 0) + tags > budget.tagsPerRange ||
        (waiter.wide !== undefined && (tagsIn.wide.get(waiter.wide) ?? 0) + tags > budget.tagsPer48)
      if (!over()) return true
      // A wait gone quiet counts for nothing. It's closed, not just left out, so it can't come
      // back with a keepalive after another has taken its room.
      for (const other of [...waits.keys()])
        if (other !== waiter && quiet(other, now)) {
          take(other)
          other.close(1000, 'idle')
        }
      return !over()
    },
    ended(now) {
      const out: Waiter[] = []
      for (const waiter of byEnd) {
        if ((waits.get(waiter)?.until ?? 0) > now) break
        out.push(waiter)
      }
      return out
    },
    quiet,
    longest(scope) {
      let best: Waiter | undefined
      let first = Number.POSITIVE_INFINITY
      for (const [waiter, wait] of waits) {
        if (scope.kind === 'range' && waiter.range !== scope.range) continue
        if (scope.kind === 'wide' && waiter.wide !== scope.wide) continue
        if (wait.order < first) {
          best = waiter
          first = wait.order
        }
      }
      return best
    },
    next: () => begun,
    size: () => waits.size,
  }
}
