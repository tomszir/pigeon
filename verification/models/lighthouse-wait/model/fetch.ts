// One look at one Lighthouse, with a cap on how much it takes: the client's tags go in lists of
// at most so many tags (chunks), each read a page at a time from the cursor it saved last time.
// The model runs every small store, honest or one that lists without end, through looks one
// after another, and checks that each look is bounded and that the looks together take
// everything meant for this device, however the store is laid out.

export interface FetchLimits {
  /** Tags in one list (512): more tags make more chunks. */
  readonly tagsPerList: number
  /** Blobs in one listed page (256). */
  readonly pageSize: number
  /** No new page is started once this many blobs were got at this Lighthouse in this look. */
  readonly maxGets: number
  /** ...or this many bytes. */
  readonly maxBytes: number
  /** Lists at this Lighthouse in one look, at most. */
  readonly maxLists: number
}

export interface FetchRules {
  /** A look stops starting pages at the caps. */
  readonly capped: boolean
  /** Chunks are read a page each in turn, so every chunk moves on in every look. */
  readonly inTurn: boolean
  /**
   * A look that stopped at a cap saves the least cursor among chunks it didn't finish, so
   * nothing in a chunk that fell behind is skipped; one that finished every chunk saves the most.
   */
  readonly savesLeastUnfinished: boolean
  /** A look that stopped at a cap saves a cursor at all, so the next one starts further on. */
  readonly savesWhenCapped: boolean
}

export const FETCH_RULES: FetchRules = {
  capped: true,
  inTurn: true,
  savesLeastUnfinished: true,
  savesWhenCapped: true,
}

export interface Item {
  readonly seq: number
  readonly id: string
  readonly tag: string
  readonly size: number
  /** Sealed to this device: it opens, takes and drops it. Junk never opens and stays. */
  readonly mine: boolean
  /** Sealed to other devices too, so it stays listed after this device drops its copy. */
  readonly shared: boolean
}

/** What a Lighthouse answers a list with; an honest one from its store, a hostile one anything. */
export interface Listing {
  readonly items: readonly Item[]
  readonly cursor: number
  readonly more: boolean
}

export interface Lister {
  list(tags: readonly string[], cursor: number): Listing
  drop(id: string): void
}

export function honest(store: readonly Item[], pageSize: number): Lister {
  let held = [...store]
  return {
    list(tags, cursor) {
      const found = held
        .filter((item) => tags.includes(item.tag) && item.seq > cursor)
        .sort((a, b) => a.seq - b.seq)
      const page = found.slice(0, pageSize)
      return { items: page, cursor: page.at(-1)?.seq ?? cursor, more: found.length > pageSize }
    },
    drop(id) {
      held = held.filter((item) => item.id !== id || item.shared)
    },
  }
}

/** A Lighthouse that lists a full page of blobs under your tags, every time, without end. */
export function endless(pageSize: number, size: number): Lister {
  let seq = 0
  return {
    list(tags) {
      const items = Array.from({ length: pageSize }, () => {
        seq += 1
        return { seq, id: `junk${seq}`, tag: tags[0] ?? '', size, mine: false, shared: false }
      })
      return { items, cursor: seq, more: true }
    },
    drop() {},
  }
}

export interface Look {
  readonly taken: readonly string[]
  readonly saved: number
  readonly lists: number
  readonly gets: number
  readonly bytes: number
}

/**
 * The most a look may do: the caps are checked between rounds, a page from each chunk not yet
 * finished, so the round that crossed them is the most it goes over.
 */
export const lookBounds = (
  limits: FetchLimits,
  biggest: number,
  chunks: number,
): { readonly lists: number; readonly gets: number; readonly bytes: number } => ({
  lists: limits.maxLists + chunks - 1,
  gets: limits.maxGets + chunks * limits.pageSize - 1,
  bytes: limits.maxBytes + (chunks * limits.pageSize - 1) * biggest,
})

/** A guard for a look with no cap, so the model itself always ends. */
const RUNAWAY = 10_000

/** One look at `lighthouse` for `tags` from `cursor`, taking what's mine and not yet taken. */
export function look(
  lighthouse: Lister,
  tags: readonly string[],
  cursor: number,
  taken: readonly string[],
  limits: FetchLimits,
  rules: FetchRules = FETCH_RULES,
): Look {
  const chunks: string[][] = []
  for (let at = 0; at < tags.length; at += limits.tagsPerList)
    chunks.push(tags.slice(at, at + limits.tagsPerList))
  const at = chunks.map(() => cursor)
  const done = chunks.map(() => false)
  const have = new Set(taken)
  let lists = 0
  let gets = 0
  let bytes = 0
  let capped = false
  const over = () =>
    rules.capped && (gets >= limits.maxGets || bytes >= limits.maxBytes || lists >= limits.maxLists)
  const page = (index: number) => {
    const chunk = chunks[index] ?? []
    lists += 1
    const listed = lighthouse.list(chunk, at[index] ?? cursor)
    for (const item of listed.items) {
      if (!chunk.includes(item.tag)) continue
      gets += 1
      bytes += item.size
      if (item.mine) {
        have.add(item.id)
        lighthouse.drop(item.id)
      }
    }
    at[index] = listed.cursor
    if (!listed.more) done[index] = true
  }
  while (done.some((d) => !d) && lists < RUNAWAY) {
    if (over()) {
      capped = true
      break
    }
    // A whole round at a time, so a chunk late in the list isn't left behind by the cap.
    if (rules.inTurn) {
      for (let i = 0; i < chunks.length; i++) if (!done[i]) page(i)
    } else page(done.findIndex((d) => !d))
  }
  if (lists >= RUNAWAY) capped = true
  const unfinished = at.filter((_, i) => !done[i])
  let saved = cursor
  if (!capped) saved = Math.max(cursor, ...at)
  else if (rules.savesWhenCapped)
    saved = rules.savesLeastUnfinished
      ? Math.max(cursor, Math.min(...unfinished))
      : Math.max(cursor, ...at)
  return { taken: [...have].sort(), saved, lists, gets, bytes }
}

/** Every store of up to `count` blobs over `tags`, each mine or junk, shared or not. */
export function* stores(count: number, tags: readonly string[], size: number): Generator<Item[]> {
  const kinds = tags.flatMap((tag) => [
    { tag, mine: true, shared: false },
    { tag, mine: true, shared: true },
    { tag, mine: false, shared: false },
  ])
  for (let n = 0; n <= count; n++) {
    const pick = (i: number, acc: Item[]): Generator<Item[]> =>
      (function* () {
        if (i === n) {
          yield acc
          return
        }
        for (const kind of kinds)
          yield* pick(i + 1, [...acc, { ...kind, seq: i + 1, id: `b${i + 1}`, size }])
      })()
    yield* pick(0, [])
  }
}

export interface FetchFinding {
  readonly id: string
  readonly message: string
}

/**
 * F1: every look is bounded; F2: looks one after another take every blob meant for this device;
 * F3: a look that didn't finish saves a cursor further on, or takes something new.
 */
export function checkStore(
  store: readonly Item[],
  tags: readonly string[],
  limits: FetchLimits,
  rules: FetchRules = FETCH_RULES,
): FetchFinding | undefined {
  const lighthouse = honest(store, limits.pageSize)
  const chunks = Math.ceil(tags.length / limits.tagsPerList)
  const bounds = lookBounds(limits, Math.max(0, ...store.map((item) => item.size)), chunks)
  let cursor = 0
  let taken: readonly string[] = []
  const mine = store.filter((item) => item.mine).map((item) => item.id)
  for (let round = 0; round <= store.length + 2; round++) {
    const result = look(lighthouse, tags, cursor, taken, limits, rules)
    if (result.lists > bounds.lists || result.gets > bounds.gets || result.bytes > bounds.bytes)
      return {
        id: 'F1 bounded',
        message: `a look made ${result.lists} lists and ${result.gets} gets`,
      }
    const finished = result.saved >= Math.max(0, ...store.map((item) => item.seq))
    if (!finished && result.saved <= cursor && result.taken.length === taken.length)
      return {
        id: 'F3 progress',
        message: `a look from ${cursor} saved ${result.saved} and took nothing new`,
      }
    cursor = result.saved
    taken = result.taken
    if (mine.every((id) => taken.includes(id))) return undefined
  }
  const missing = mine.filter((id) => !taken.includes(id))
  return {
    id: 'F2 no lost mail',
    message: `never took ${missing.join(', ')} from ${JSON.stringify(store)}`,
  }
}

/** F1 against a Lighthouse that lists without end. */
export function checkEndless(
  tags: readonly string[],
  limits: FetchLimits,
  rules: FetchRules = FETCH_RULES,
): FetchFinding | undefined {
  const result = look(endless(limits.pageSize, 1), tags, 0, [], limits, rules)
  const bounds = lookBounds(limits, 1, Math.ceil(tags.length / limits.tagsPerList))
  if (result.lists > bounds.lists || result.gets > bounds.gets || result.bytes > bounds.bytes)
    return {
      id: 'F1 bounded',
      message: `a look at an endless Lighthouse made ${result.lists} lists and ${result.gets} gets`,
    }
  return undefined
}
