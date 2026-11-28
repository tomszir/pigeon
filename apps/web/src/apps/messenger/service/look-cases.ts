// One look at one Lighthouse with more tags than one list takes. The client's tags go in lists
// (chunks), all read from the cursor it saved there, a page at a time, each to its end, and every
// blob listed under its tags is got. The cursor a look saves must never pass a blob a chunk hasn't
// listed or a blob it couldn't get, even one put while the look reads, nor stay where it was for
// good; and a look that didn't finish keeps the days it reads for the next. The model runs every
// small store, every way a sender can put while a look reads, and a Lighthouse that stops answering
// a list or a get partway. The puts and the failures happen inside the Lighthouse, whatever the
// look does, and what the look read is worked out from what the Lighthouse answered.

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
  /** A blob that couldn't be got stops the look, which saves nothing, so it's got next time. */
  readonly stopsAtFailedGet: boolean
  /** A look that didn't finish keeps the last look's days, so the next reads them again. */
  readonly keepsDaysWhenUnfinished: boolean
}

export const FETCH_RULES: FetchRules = {
  savesLeast: true,
  provesFinished: true,
  stopsAtFailedGet: true,
  keepsDaysWhenUnfinished: true,
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
  /** One blob; `gone` once dropped or expired; undefined when the Lighthouse doesn't answer. */
  get(id: string): Item | 'gone' | undefined
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
    get: (id) => held.find((item) => item.id === id) ?? 'gone',
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
  /** Every chunk was read to its end and every blob got. */
  readonly complete: boolean
  /** The look's days move on, as they do only when it finished. */
  readonly movesDays: boolean
}

interface Chunk {
  readonly tags: readonly string[]
  at: number
  done: boolean
  /** For a finished chunk: how far it's known nothing under its tags was left unlisted. */
  proven: number
}

/** One look at `lighthouse` for `tags` from `cursor`, taking what's mine and not yet taken. */
export function look(
  lighthouse: Lister,
  tags: readonly string[],
  cursor: number,
  taken: readonly string[],
  limits: FetchLimits,
  rules: FetchRules = FETCH_RULES,
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
  /** One page of `chunk`; false when the Lighthouse didn't answer a list or a get. */
  const page = (chunk: Chunk): boolean => {
    const before = seen
    const listed = lighthouse.list(chunk.tags, chunk.at)
    if (listed === undefined) return false
    for (const item of listed.items) {
      if (!chunk.tags.includes(item.tag)) continue
      const got = lighthouse.get(item.id)
      if (got === undefined) {
        if (rules.stopsAtFailedGet) return false
        continue
      }
      if (got === 'gone' || !got.mine) continue
      have.add(got.id)
      lighthouse.drop(got.id)
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
  return {
    taken: [...have].sort(),
    cursor: saved,
    complete: !failed,
    movesDays: !failed || !rules.keepsDaysWhenUnfinished,
  }
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
) => Look | Promise<Look>

/** The model's look under `rules`, as a `LookWith`. */
export const modelLook =
  (rules: FetchRules = FETCH_RULES): LookWith =>
  (lighthouse, tags, cursor, taken, limits) =>
    look(lighthouse, tags, cursor, taken, limits, rules)

export interface FetchFinding {
  readonly id: string
  readonly message: string
}

/** A Lighthouse that notes the furthest cursor it answered a list with. */
function noting(inner: Lister): Lister & { seen: () => number; reset: (from: number) => void } {
  let seen = 0
  return {
    list(tags, cursor) {
      const listed = inner.list(tags, cursor)
      if (listed !== undefined) seen = Math.max(seen, listed.cursor)
      return listed
    },
    get: (id) => inner.get(id),
    drop: (id) => inner.drop(id),
    seen: () => seen,
    reset(from) {
      seen = from
    },
  }
}

/**
 * F2: looks one after another take every blob meant for this device; F5: a look over a store
 * nothing is put to finishes, and saves a cursor as far as the Lighthouse answered any list with.
 */
export async function checkStore(
  store: readonly Item[],
  tags: readonly string[],
  limits: FetchLimits,
  lookWith: LookWith = modelLook(),
): Promise<FetchFinding | undefined> {
  const lighthouse = noting(honest(store, limits.pageSize))
  let cursor = 0
  let taken: readonly string[] = []
  const mine = store.filter((item) => item.mine).map((item) => item.id)
  for (let round = 0; round <= 2; round++) {
    lighthouse.reset(cursor)
    const result = await lookWith(lighthouse, tags, cursor, taken, limits)
    if (!result.complete || result.cursor < lighthouse.seen())
      return {
        id: 'F5 a finished look saves what it read',
        message: `a look the Lighthouse answered to ${lighthouse.seen()} saved ${result.cursor}${result.complete ? '' : ', unfinished'}, over ${JSON.stringify(store)}`,
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

/** What a sender puts before request `at` of the first look: under which tag, of which kind. */
export interface Put {
  readonly at: number
  readonly tag: string
  readonly mine: boolean
  readonly shared: boolean
}

/** Every schedule of up to `count` puts during the first look, before one of its first `calls` requests. */
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

/** Where the first look's Lighthouse stops answering: at its `at`th list, or its `at`th get. */
export interface Failure {
  readonly kind: 'list' | 'get'
  readonly at: number
}

/**
 * F2 when mail is put while a look reads, before its lists and gets, and when the Lighthouse
 * stops answering a list or a get partway: every blob put is taken by a later look, and F6: a look
 * that didn't finish keeps its days.
 */
export async function checkPutsDuring(
  store: readonly Item[],
  puts: readonly Put[],
  tags: readonly string[],
  limits: FetchLimits,
  lookWith: LookWith = modelLook(),
  failure?: Failure,
): Promise<FetchFinding | undefined> {
  const inner = honest(store, limits.pageSize)
  const mine = store.filter((item) => item.mine).map((item) => item.id)
  let first = true
  let calls = 0
  let lists = 0
  let gets = 0
  const made = new Set<Put>()
  /** The puts due before this request of the first look. */
  const putting = () => {
    if (!first) return
    for (const put of puts)
      if (put.at === calls && !made.has(put)) {
        made.add(put)
        mine.push(inner.put(put.tag, put))
      }
    calls += 1
  }
  const lighthouse: Lister = {
    list(asked, cursor) {
      putting()
      lists += 1
      if (first && failure?.kind === 'list' && lists - 1 === failure.at) return undefined
      return inner.list(asked, cursor)
    },
    get(id) {
      putting()
      gets += 1
      if (first && failure?.kind === 'get' && gets - 1 === failure.at) return undefined
      return inner.get(id)
    },
    drop: (id) => inner.drop(id),
  }
  let cursor = 0
  let taken: readonly string[] = []
  let days: FetchFinding | undefined
  for (let round = 0; round <= 3; round++) {
    const result = await lookWith(lighthouse, tags, cursor, taken, limits)
    if (first) {
      // Puts the look never got as far as are put now: they happened all the same.
      for (const put of puts)
        if (!made.has(put)) {
          made.add(put)
          mine.push(inner.put(put.tag, put))
        }
      const failed = failure !== undefined && (failure.kind === 'list' ? lists : gets) > failure.at
      if (failed && result.movesDays)
        days = {
          id: 'F6 an unfinished look keeps its days',
          message: `a look that got no answer at ${failure.kind} ${failure.at} moved its days on`,
        }
    }
    first = false
    cursor = result.cursor
    taken = result.taken
  }
  const missing = mine.filter((id) => !taken.includes(id))
  // Mail lost is said first: a look that passed over what it couldn't get moved its days too.
  if (missing.length === 0) return days
  const stopped = failure === undefined ? '' : `, no answer at ${failure.kind} ${failure.at}`
  return {
    id: 'F2 no lost mail',
    message: `never took ${missing.join(', ')}: puts ${JSON.stringify(puts)}${stopped}, over ${JSON.stringify(store)}`,
  }
}

/** The look model's limits, scaled down: lists of two tags, pages of one. */
export const FETCH_LIMITS: FetchLimits = { tagsPerList: 2, pageSize: 1 }
const TAGS = ['a', 'b', 'c']
const FAILURES: readonly (Failure | undefined)[] = [
  undefined,
  { kind: 'list', at: 0 },
  { kind: 'list', at: 2 },
  { kind: 'get', at: 0 },
  { kind: 'get', at: 1 },
]

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
      for (const failure of FAILURES) {
        cases += 1
        const finding = await checkPutsDuring(store, puts, TAGS, FETCH_LIMITS, lookWith, failure)
        if (finding !== undefined) return { found: finding, cases }
      }
  // Three puts, so one can land while the last lists are asked once more.
  for (const store of stores(1, TAGS, 1))
    for (const puts of schedules(3, 8, TAGS, false)) {
      cases += 1
      const finding = await checkPutsDuring(store, puts, TAGS, FETCH_LIMITS, lookWith)
      if (finding !== undefined) return { found: finding, cases }
    }
  return { cases }
}
