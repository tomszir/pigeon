// One look at one Lighthouse, with a cap on how much it takes. The client's tags go in lists of at
// most so many tags (chunks), each read a page at a time; a tag that fell behind, because mail
// under it filled a look, is read in a list of its own from a cursor of its own, so it holds back
// nothing but itself. The model runs every small store, stores that change between and during
// looks, a sender who floods one tag with junk, and a Lighthouse that lists without end, and
// checks that each look is bounded, that looks together take everything meant for this device,
// and that a flood under one tag doesn't hold back mail under the others.

export interface FetchLimits {
  /** Tags in one list (512): more tags make more chunks. */
  readonly tagsPerList: number
  /** Blobs in one listed page (256). */
  readonly pageSize: number
  /** No new round is started once this many blobs were got at this Lighthouse in this look. */
  readonly maxGets: number
  /** ...or this many bytes. */
  readonly maxBytes: number
  /** ...or this many lists made. */
  readonly maxLists: number
  /** Tags read in lists of their own at most (16). */
  readonly maxBehind: number
}

export interface FetchRules {
  /** A look stops starting rounds at the caps. */
  readonly capped: boolean
  /**
   * The cursor saved is the least over every list, so nothing a list hasn't listed is passed by,
   * a finished list included.
   */
  readonly savesLeast: boolean
  /**
   * A finished list counts as far as the furthest anything had been listed before its last page
   * was asked for: a blob put after that has a later seq. One that finished before the others got
   * that far is asked once more at the end. Without this, an empty list would hold the cursor
   * where it was for good.
   */
  readonly provesFinished: boolean
  /** A look stopped at a cap reads the tag that filled most of it in a list of its own. */
  readonly splitsHeavyTag: boolean
}

export const FETCH_RULES: FetchRules = {
  capped: true,
  savesLeast: true,
  provesFinished: true,
  splitsHeavyTag: true,
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

/** Where a client stands at one Lighthouse: its cursor, and the tags read on their own. */
export interface Place {
  readonly cursor: number
  /** Tags that fell behind, each with its own cursor. */
  readonly behind: Readonly<Record<string, number>>
}

export const START: Place = { cursor: 0, behind: {} }

export interface Look {
  readonly taken: readonly string[]
  readonly place: Place
  readonly lists: number
  readonly gets: number
  readonly bytes: number
  /** Every list that isn't a tag read on its own reached its end. */
  readonly mainDone: boolean
  /** Every list reached its end and no cap was reached. */
  readonly complete: boolean
  /** The furthest cursor a list of the rest, not a tag read on its own, was answered with. */
  readonly seen: number
}

/** A source's own limit, as an invite link's requests have: blobs got under `tag` a look. */
export interface SourceLimit {
  readonly tag: string
  readonly max: number
}

/**
 * The most a look may do: the caps are checked between rounds, a page from each list not yet
 * finished, so the round that crossed them is the most it goes over, and a list may be asked once
 * more at the end.
 */
export const lookBounds = (
  limits: FetchLimits,
  biggest: number,
  lists: number,
): { readonly lists: number; readonly gets: number; readonly bytes: number } => ({
  lists: limits.maxLists + 2 * lists - 1,
  gets: limits.maxGets + 2 * lists * limits.pageSize - 1,
  bytes: limits.maxBytes + (2 * lists * limits.pageSize - 1) * biggest,
})

/** A guard for a look with no cap, so the model itself always ends. */
const RUNAWAY = 200

interface List {
  readonly tags: readonly string[]
  readonly own: boolean
  at: number
  done: boolean
  /** For a finished list: how far it's known nothing under its tags was left unlisted. */
  proven: number
}

/**
 * One look at `lighthouse` for `tags` from `place`, taking what's mine and not yet taken.
 * `between` runs before every list is asked for: a sender putting while the look goes on.
 */
export function look(
  lighthouse: Lister,
  tags: readonly string[],
  place: Place,
  taken: readonly string[],
  limits: FetchLimits,
  rules: FetchRules = FETCH_RULES,
  options: { readonly between?: () => void; readonly source?: SourceLimit } = {},
): Look {
  const behind = Object.fromEntries(
    Object.entries(place.behind).filter(([tag]) => tags.includes(tag)),
  )
  const main = tags.filter((tag) => behind[tag] === undefined)
  const lists: List[] = []
  for (let at = 0; at < main.length; at += limits.tagsPerList)
    lists.push({
      tags: main.slice(at, at + limits.tagsPerList),
      own: false,
      at: place.cursor,
      done: false,
      proven: 0,
    })
  for (const [tag, at] of Object.entries(behind))
    lists.push({ tags: [tag], own: true, at, done: false, proven: 0 })
  const have = new Set(taken)
  /** Blobs listed in lists not read on their own, by tag, to find the heaviest. */
  const weight = new Map<string, number>()
  let seen = place.cursor
  let calls = 0
  let gets = 0
  let bytes = 0
  let fromSource = 0
  let capped = false
  const over = () =>
    rules.capped &&
    (gets >= limits.maxGets ||
      bytes >= limits.maxBytes ||
      calls >= limits.maxLists ||
      (options.source !== undefined && fromSource >= options.source.max))
  const page = (list: List) => {
    options.between?.()
    const before = seen
    calls += 1
    const listed = lighthouse.list(list.tags, list.at)
    for (const item of listed.items) {
      if (!list.tags.includes(item.tag)) continue
      gets += 1
      bytes += item.size
      if (item.tag === options.source?.tag) fromSource += 1
      if (!list.own) weight.set(item.tag, (weight.get(item.tag) ?? 0) + 1)
      if (item.mine) {
        have.add(item.id)
        lighthouse.drop(item.id)
      }
    }
    list.at = Math.max(list.at, listed.cursor)
    seen = Math.max(seen, listed.cursor)
    if (!listed.more) {
      list.done = true
      list.proven = rules.provesFinished ? Math.max(list.at, before) : list.at
    }
  }
  while (lists.some((l) => !l.done) && calls < RUNAWAY) {
    if (over()) {
      capped = true
      break
    }
    // A round at a time: a page from every list not finished.
    for (const list of lists) if (!list.done) page(list)
  }
  if (calls >= RUNAWAY) capped = true
  const reach = (list: List) => (list.done ? list.proven : list.at)
  const mains = lists.filter((l) => !l.own)
  // A list that finished before the others got as far is asked once more, so it can count that
  // far too: one empty list early in a round would otherwise hold the cursor where it was.
  const unfinishedAt = mains.filter((l) => !l.done).map((l) => l.at)
  const target = unfinishedAt.length > 0 ? Math.min(...unfinishedAt) : seen
  for (const list of mains)
    if (list.done && list.proven < target) {
      list.done = false
      page(list)
    }
  const mainDone = mains.every((l) => l.done)
  let cursor = place.cursor
  if (mains.length > 0)
    cursor = rules.savesLeast
      ? Math.max(place.cursor, Math.min(...mains.map(reach)))
      : Math.max(place.cursor, ...mains.map((l) => l.at))
  const nextBehind: Record<string, number> = {}
  for (const list of lists.filter((l) => l.own)) {
    const tag = list.tags[0] ?? ''
    // Caught up: it joins the rest again.
    if (!(list.done && list.proven >= cursor)) nextBehind[tag] = reach(list)
  }
  if (rules.splitsHeavyTag && !mainDone && Object.keys(nextBehind).length < limits.maxBehind) {
    let heaviest: string | undefined
    for (const [tag, n] of weight)
      if (heaviest === undefined || n > (weight.get(heaviest) ?? 0)) heaviest = tag
    // Read on its own from the cursor saved, so the rest goes on from there without it.
    if (heaviest !== undefined) nextBehind[heaviest] = cursor
  }
  return {
    taken: [...have].sort(),
    place: { cursor, behind: nextBehind },
    lists: calls,
    gets,
    bytes,
    mainDone,
    complete: !capped && lists.every((l) => l.done),
    seen: Math.max(place.cursor, ...mains.map((l) => l.at)),
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
  place: Place,
  taken: readonly string[],
  limits: FetchLimits,
  options: { readonly between?: () => void; readonly source?: SourceLimit },
) => Look | Promise<Look>

/** The model's look under `rules`, as a `LookWith`. */
export const modelLook =
  (rules: FetchRules = FETCH_RULES): LookWith =>
  (lighthouse, tags, place, taken, limits, options) =>
    look(lighthouse, tags, place, taken, limits, rules, options)

export interface FetchFinding {
  readonly id: string
  readonly message: string
}

const listsFor = (tags: readonly string[], place: Place, limits: FetchLimits) => {
  const own = Object.keys(place.behind).filter((tag) => tags.includes(tag)).length
  return Math.ceil((tags.length - own) / limits.tagsPerList) + own
}

/**
 * F1: every look is bounded; F2: looks one after another take every blob meant for this device;
 * F3: a look that didn't finish moves on somewhere, or takes something new; F5: one that finished,
 * with nothing put meanwhile, saves a cursor as far as anything it listed.
 */
export async function checkStore(
  store: readonly Item[],
  tags: readonly string[],
  limits: FetchLimits,
  lookWith: LookWith = modelLook(),
): Promise<FetchFinding | undefined> {
  const lighthouse = honest(store, limits.pageSize)
  let place = START
  let taken: readonly string[] = []
  const mine = store.filter((item) => item.mine).map((item) => item.id)
  const biggest = Math.max(0, ...store.map((item) => item.size))
  for (let round = 0; round <= store.length + 3; round++) {
    const bounds = lookBounds(limits, biggest, listsFor(tags, place, limits))
    const result = await lookWith(lighthouse, tags, place, taken, limits, {})
    if (result.lists > bounds.lists || result.gets > bounds.gets || result.bytes > bounds.bytes)
      return {
        id: 'F1 bounded',
        message: `a look made ${result.lists} lists and ${result.gets} gets`,
      }
    if (result.complete && result.place.cursor < result.seen)
      return {
        id: 'F5 a finished look saves what it read',
        message: `a look that read to ${result.seen} saved ${result.place.cursor}`,
      }
    const still = JSON.stringify(result.place) === JSON.stringify(place)
    if (!result.complete && still && result.taken.length === taken.length)
      return {
        id: 'F3 progress',
        message: `a look from ${JSON.stringify(place)} moved on nowhere and took nothing new`,
      }
    place = result.place
    taken = result.taken
    if (mine.every((id) => taken.includes(id))) return undefined
  }
  const missing = mine.filter((id) => !taken.includes(id))
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
): Generator<Put[]> {
  const kinds = tags.flatMap((tag) => [
    { tag, mine: true, shared: false },
    { tag, mine: true, shared: true },
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

/** F2 when mail is put while a look is reading: every blob put is taken by a later look. */
export async function checkPutsDuring(
  store: readonly Item[],
  puts: readonly Put[],
  tags: readonly string[],
  limits: FetchLimits,
  lookWith: LookWith = modelLook(),
): Promise<FetchFinding | undefined> {
  const lighthouse = honest(store, limits.pageSize)
  const mine = store.filter((item) => item.mine).map((item) => item.id)
  let calls = 0
  const between = () => {
    for (const put of puts) if (put.at === calls) mine.push(lighthouse.put(put.tag, put))
    calls += 1
  }
  let place = START
  let taken: readonly string[] = []
  for (let round = 0; round <= store.length + puts.length + 3; round++) {
    const result = await lookWith(
      lighthouse,
      tags,
      place,
      taken,
      limits,
      round === 0 ? { between } : {},
    )
    place = result.place
    taken = result.taken
    if (round > 0 && mine.every((id) => taken.includes(id))) return undefined
  }
  const missing = mine.filter((id) => !taken.includes(id))
  return {
    id: 'F2 no lost mail',
    message: `never took ${missing.join(', ')}, put during a look: ${JSON.stringify(puts)} over ${JSON.stringify(store)}`,
  }
}

/**
 * F4: a sender who floods tags with junk, more than a look takes, before every look and between
 * its lists, holds back mail under another tag by at most a look per flooded tag.
 */
export async function checkFlood(
  tags: readonly string[],
  flooded: readonly string[],
  letterAt: number,
  limits: FetchLimits,
  lookWith: LookWith = modelLook(),
  source?: SourceLimit,
): Promise<FetchFinding | undefined> {
  const lighthouse = honest([], limits.pageSize)
  const victim = tags.find((tag) => !flooded.includes(tag)) ?? ''
  const flood = () => {
    for (const tag of flooded)
      for (let i = 0; i < limits.maxGets; i++) lighthouse.put(tag, { mine: false, shared: false })
  }
  let place = START
  let taken: readonly string[] = []
  const bound = letterAt + 1 + flooded.length
  for (let n = 0; n <= bound; n++) {
    flood()
    if (n === letterAt) lighthouse.put(victim, { mine: true, shared: false }, 'letter')
    const result = await lookWith(lighthouse, tags, place, taken, limits, {
      between: flood,
      ...(source === undefined ? {} : { source }),
    })
    place = result.place
    taken = result.taken
    if (taken.includes('letter')) return undefined
  }
  return {
    id: 'F4 one tag holds back only itself',
    message: `a letter under ${victim}, put at look ${letterAt} while ${flooded.join(' and ')} flooded, wasn't taken by look ${bound}`,
  }
}

/** F1 against a Lighthouse that lists without end. */
export async function checkEndless(
  tags: readonly string[],
  limits: FetchLimits,
  lookWith: LookWith = modelLook(),
): Promise<FetchFinding | undefined> {
  let place = START
  const lighthouse = endless(limits.pageSize, 1)
  for (let n = 0; n < 4; n++) {
    const bounds = lookBounds(limits, 1, listsFor(tags, place, limits))
    const result = await lookWith(lighthouse, tags, place, [], limits, {})
    if (result.lists > bounds.lists || result.gets > bounds.gets || result.bytes > bounds.bytes)
      return {
        id: 'F1 bounded',
        message: `a look at an endless Lighthouse made ${result.lists} lists and ${result.gets} gets`,
      }
    place = result.place
  }
  return undefined
}

/** The cap model's limits, scaled down: pages of 2, two gets, six lists, two tags on their own. */
export const FETCH_LIMITS: FetchLimits = {
  tagsPerList: 2,
  pageSize: 2,
  maxGets: 2,
  maxBytes: 3,
  maxLists: 6,
  maxBehind: 2,
}
const TAGS = ['a', 'b', 'c']
const FLOOD_TAGS = ['f', 'x', 'y']

/**
 * Every case the cap model checks, run through `lookWith`: the first thing wrong, if any, and how
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
    for (const puts of schedules(2, 4, TAGS)) {
      cases += 1
      const finding = await checkPutsDuring(store, puts, TAGS, FETCH_LIMITS, lookWith)
      if (finding !== undefined) return { found: finding, cases }
    }
  const floodLimits = { ...FETCH_LIMITS, tagsPerList: 3 }
  for (const flooded of [['x'], ['x', 'y']])
    for (let at = 0; at < 5; at++) {
      cases += 1
      const finding =
        (await checkFlood(FLOOD_TAGS, flooded, at, floodLimits, lookWith)) ??
        (await checkFlood(FLOOD_TAGS, flooded, at, floodLimits, lookWith, { tag: 'x', max: 1 }))
      if (finding !== undefined) return { found: finding, cases }
    }
  for (const tags of [TAGS, ['a', 'b', 'c', 'd', 'e']]) {
    cases += 1
    const finding = await checkEndless(tags, FETCH_LIMITS, lookWith)
    if (finding !== undefined) return { found: finding, cases }
  }
  return { cases }
}
