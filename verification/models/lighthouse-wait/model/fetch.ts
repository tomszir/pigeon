// One look at one Lighthouse with more tags than one list takes. The client's tags go in lists
// (chunks), all read from the cursor it saved there, a page at a time, each to its end. The cursor
// a look saves must never pass a blob a chunk hasn't listed, even one put while the look reads, nor
// stay where it was for good. The model runs every small store, every way a sender can put while
// a look reads, and a Lighthouse that stops answering partway, and checks that looks one after
// another take everything meant for this device, and that a look that finished saves what it read.

export interface FetchLimits {
  /** Tags in one list (512): more tags make more chunks. */
  readonly tagsPerList: number
  /** Blobs in one listed page (256). */
  readonly pageSize: number
}

export interface FetchRules {
  /**
   * The cursor saved is the least over every chunk, a finished one included, so nothing a chunk
   * hasn't listed is passed by. The furthest would pass a blob put under a chunk that finished
   * while another was still reading.
   */
  readonly savesLeast: boolean
  /**
   * A finished chunk counts as far as the furthest anything had been listed before its last page
   * was asked for, since a blob put after that has a later seq; one that finished before the
   * others got that far is asked once more at the end. Without this an empty chunk would hold the
   * cursor where it was for good.
   */
  readonly provesFinished: boolean
}

export const FETCH_RULES: FetchRules = {
  savesLeast: true,
  provesFinished: true,
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

/** What a Lighthouse answers a list with. */
export interface Listing {
  readonly items: readonly Item[]
  readonly cursor: number
  readonly more: boolean
}

export interface Lister {
  /** One page, or undefined when the Lighthouse doesn't answer. */
  list(tags: readonly string[], cursor: number): Listing | undefined
  drop(id: string): void
}

/** An honest Lighthouse, whose store can be put to between and during looks. */
export interface Honest extends Lister {
  /** Puts a blob under `tag`, with the next seq; says its id. */
  put(tag: string, kind: { readonly mine: boolean; readonly shared: boolean }, id?: string): string
  held(): readonly Item[]
}

export function honest(store: readonly Item[], pageSize: number): Honest {
  let held = [...store]
  let seq = Math.max(0, ...store.map((item) => item.seq))
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
    put(tag, kind, id) {
      seq += 1
      const name = id ?? `p${seq}`
      held = [...held, { seq, id: name, tag, size: 1, ...kind }]
      return name
    },
    held: () => held,
  }
}

export interface Look {
  readonly taken: readonly string[]
  /** The cursor to save. */
  readonly cursor: number
  /** Every chunk was read to its end. */
  readonly complete: boolean
  /** The furthest cursor any chunk was answered with. */
  readonly seen: number
}

interface Chunk {
  readonly tags: readonly string[]
  at: number
  done: boolean
  /** For a finished chunk: how far it's known nothing under its tags was left unlisted. */
  proven: number
}

/**
 * One look at `lighthouse` for `tags` from `cursor`, taking what's mine and not yet taken.
 * `between` runs before every list is asked for: a sender putting while the look goes on.
 */
export function look(
  lighthouse: Lister,
  tags: readonly string[],
  cursor: number,
  taken: readonly string[],
  limits: FetchLimits,
  rules: FetchRules = FETCH_RULES,
  options: { readonly between?: () => void } = {},
): Look {
  const chunks: Chunk[] = []
  for (let at = 0; at < tags.length; at += limits.tagsPerList)
    chunks.push({
      tags: tags.slice(at, at + limits.tagsPerList),
      at: cursor,
      done: false,
      proven: 0,
    })
  const have = new Set(taken)
  let seen = cursor
  let failed = false
  /** One page of `chunk`; false when the Lighthouse didn't answer. */
  const page = (chunk: Chunk): boolean => {
    options.between?.()
    const before = seen
    const listed = lighthouse.list(chunk.tags, chunk.at)
    if (listed === undefined) return false
    for (const item of listed.items) {
      if (!chunk.tags.includes(item.tag) || !item.mine) continue
      have.add(item.id)
      lighthouse.drop(item.id)
    }
    chunk.at = Math.max(chunk.at, listed.cursor)
    seen = Math.max(seen, listed.cursor)
    if (!listed.more) {
      chunk.done = true
      chunk.proven = rules.provesFinished ? Math.max(chunk.at, before) : chunk.at
    }
    return true
  }
  // A round at a time: a page from every chunk not finished.
  while (!failed && chunks.some((chunk) => !chunk.done))
    for (const chunk of chunks) if (!chunk.done && !failed && !page(chunk)) failed = true
  // A chunk that finished before the others got as far is asked once more, so it can count that
  // far too.
  if (!failed && rules.provesFinished)
    for (const chunk of chunks)
      if (chunk.proven < seen && !failed) {
        chunk.done = false
        while (!chunk.done && !failed) if (!page(chunk)) failed = true
      }
  const reach = (chunk: Chunk) => (chunk.done ? chunk.proven : chunk.at)
  let saved = cursor
  // A look that couldn't read a chunk to its end saves nothing, so it's read again next time.
  if (chunks.length > 0 && !failed)
    saved = rules.savesLeast
      ? Math.max(cursor, Math.min(...chunks.map(reach)))
      : Math.max(cursor, ...chunks.map((chunk) => chunk.at))
  return { taken: [...have].sort(), cursor: saved, complete: !failed, seen }
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

/** A look to check: the model's own, or an implementation's through an adapter. */
export type LookWith = (
  lighthouse: Lister,
  tags: readonly string[],
  cursor: number,
  taken: readonly string[],
  limits: FetchLimits,
  options: { readonly between?: () => void },
) => Look | Promise<Look>

/** The model's look under `rules`, as a `LookWith`. */
export const modelLook =
  (rules: FetchRules = FETCH_RULES): LookWith =>
  (lighthouse, tags, cursor, taken, limits, options) =>
    look(lighthouse, tags, cursor, taken, limits, rules, options)

export interface FetchFinding {
  readonly id: string
  readonly message: string
}

/**
 * F2: looks one after another take every blob meant for this device; F5: a look that finished,
 * with nothing put meanwhile, saves a cursor as far as anything it listed.
 */
export async function checkStore(
  store: readonly Item[],
  tags: readonly string[],
  limits: FetchLimits,
  lookWith: LookWith = modelLook(),
): Promise<FetchFinding | undefined> {
  const lighthouse = honest(store, limits.pageSize)
  let cursor = 0
  let taken: readonly string[] = []
  const mine = store.filter((item) => item.mine).map((item) => item.id)
  for (let round = 0; round <= 2; round++) {
    const result = await lookWith(lighthouse, tags, cursor, taken, limits, {})
    if (result.complete && result.cursor < result.seen)
      return {
        id: 'F5 a finished look saves what it read',
        message: `a look that read to ${result.seen} saved ${result.cursor}, over ${JSON.stringify(store)}`,
      }
    cursor = result.cursor
    taken = result.taken
  }
  const missing = mine.filter((id) => !taken.includes(id))
  if (missing.length === 0) return undefined
  return {
    id: 'F2 no lost mail',
    message: `never took ${missing.join(', ')} from ${JSON.stringify(store)}`,
  }
}

/** What a sender puts before list `at` of the first look: under which tag, of which kind. */
export interface Put {
  readonly at: number
  readonly tag: string
  readonly mine: boolean
  readonly shared: boolean
}

/** Every schedule of up to `count` puts during the first look, before one of its first `calls` lists. */
export function* schedules(
  count: number,
  calls: number,
  tags: readonly string[],
  shared = true,
): Generator<Put[]> {
  const kinds = tags.flatMap((tag) => [
    { tag, mine: true, shared: false },
    ...(shared ? [{ tag, mine: true, shared: true }] : []),
  ])
  for (let n = 0; n <= count; n++) {
    const pick = (i: number, from: number, acc: Put[]): Generator<Put[]> =>
      (function* () {
        if (i === n) {
          yield acc
          return
        }
        for (let at = from; at < calls; at++)
          for (const kind of kinds) yield* pick(i + 1, at, [...acc, { at, ...kind }])
      })()
    yield* pick(0, 0, [])
  }
}

/**
 * F2 when mail is put while a look reads, and when the Lighthouse stops answering at list
 * `failAt` of that look: every blob put is taken by a later look.
 */
export async function checkPutsDuring(
  store: readonly Item[],
  puts: readonly Put[],
  tags: readonly string[],
  limits: FetchLimits,
  lookWith: LookWith = modelLook(),
  failAt?: number,
): Promise<FetchFinding | undefined> {
  const inner = honest(store, limits.pageSize)
  const mine = store.filter((item) => item.mine).map((item) => item.id)
  let calls = 0
  let first = true
  const lighthouse: Lister = {
    list: (asked, cursor) =>
      first && calls - 1 === failAt ? undefined : inner.list(asked, cursor),
    drop: (id) => inner.drop(id),
  }
  const between = () => {
    for (const put of puts) if (put.at === calls) mine.push(inner.put(put.tag, put))
    calls += 1
  }
  let cursor = 0
  let taken: readonly string[] = []
  for (let round = 0; round <= 3; round++) {
    const options = round === 0 ? { between } : {}
    const result = await lookWith(lighthouse, tags, cursor, taken, limits, options)
    first = false
    cursor = result.cursor
    taken = result.taken
  }
  const missing = mine.filter((id) => !taken.includes(id))
  if (missing.length === 0) return undefined
  const failure = failAt === undefined ? '' : `, no answer at list ${failAt}`
  return {
    id: 'F2 no lost mail',
    message: `never took ${missing.join(', ')}: puts ${JSON.stringify(puts)}${failure}, over ${JSON.stringify(store)}`,
  }
}

/** The look model's limits, scaled down: lists of two tags, pages of one. */
export const FETCH_LIMITS: FetchLimits = { tagsPerList: 2, pageSize: 1 }
const TAGS = ['a', 'b', 'c']

/**
 * Every case the look model checks, run through `lookWith`: the first thing wrong, if any, and how
 * many cases it took.
 */
export async function checkLooks(
  lookWith: LookWith,
): Promise<{ readonly found?: FetchFinding; readonly cases: number }> {
  let cases = 0
  for (const store of stores(4, TAGS, 1)) {
    cases += 1
    const finding = await checkStore(store, TAGS, FETCH_LIMITS, lookWith)
    if (finding !== undefined) return { found: finding, cases }
  }
  for (const store of stores(2, TAGS, 1))
    for (const puts of schedules(2, 6, TAGS))
      for (const failAt of [undefined, 0, 2, 4]) {
        cases += 1
        const finding = await checkPutsDuring(store, puts, TAGS, FETCH_LIMITS, lookWith, failAt)
        if (finding !== undefined) return { found: finding, cases }
      }
  // Three puts, so one can land while the last lists are asked once more.
  for (const store of stores(1, TAGS, 1))
    for (const puts of schedules(3, 6, TAGS, false)) {
      cases += 1
      const finding = await checkPutsDuring(store, puts, TAGS, FETCH_LIMITS, lookWith)
      if (finding !== undefined) return { found: finding, cases }
    }
  return { cases }
}
