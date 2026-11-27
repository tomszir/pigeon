// How one mail check reads one Lighthouse. Its tags go in lists: in chunks of as many as one list
// takes, all from the cursor saved there, and each tag that fell behind in a list of its own from
// that tag's own cursor. A round is a page from every list not yet finished; no new round starts
// once the look has taken as much as it may there. Junk under one tag, which never opens and can't
// be dropped, can be put faster than a look drains it: a look stopped at a cap reads the tag that
// filled most of it on its own from then on, so a flood holds back nothing but that tag.
import { MAX_LIST_TAGS } from '@pigeon/core'

/** How much one look may take from one Lighthouse. */
export interface LookCaps {
  /** No new round once this many blobs were got there. */
  readonly gets: number
  /** ...or this many bytes. */
  readonly bytes: number
  /** ...or this many lists made. */
  readonly lists: number
  /** Tags in one list. */
  readonly tagsPerList: number
  /** Tags read in lists of their own, at most. */
  readonly behind: number
}

export const LOOK_CAPS: LookCaps = {
  gets: 512,
  bytes: 8 * 1024 * 1024,
  lists: 64,
  tagsPerList: MAX_LIST_TAGS,
  behind: 16,
}

/** Where a look starts at one Lighthouse, and where the next will. */
export interface Place {
  readonly cursor: number
  /** Tags that fell behind, each read on its own from its own cursor. */
  readonly behind: Readonly<Record<string, number>>
}

/** Where this device stands at one Lighthouse, as kept between looks. */
export interface Fetched extends Place {
  /** When it last looked there and read every list to its end. */
  readonly at: number
}

/** What was kept of where this device stands at each Lighthouse, read as untrusted. */
export function fetchedFrom(stored: unknown): Record<string, Fetched> {
  const out: Record<string, Fetched> = {}
  if (typeof stored !== 'object' || stored === null) return out
  for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
    const kept = value as Partial<Record<keyof Fetched, unknown>>
    if (typeof kept?.cursor !== 'number' || typeof kept.at !== 'number') continue
    const behind: Record<string, number> = {}
    // Kept before tags were ever read on their own, there's none.
    if (typeof kept.behind === 'object' && kept.behind !== null)
      for (const [tag, cursor] of Object.entries(kept.behind as Record<string, unknown>))
        if (typeof cursor === 'number') behind[tag] = cursor
    out[id] = { cursor: kept.cursor, at: kept.at, behind }
  }
  return out
}

export interface ListedPage {
  readonly items: readonly { readonly id: string; readonly tag: string; readonly size: number }[]
  readonly cursor: number
  readonly more: boolean
}

/** What became of one listed blob. */
export type ItemOutcome =
  /** Got, `bytes` long, whatever was then done with it. */
  | { readonly kind: 'got'; readonly bytes: number }
  /**
   * Not got: not one of its tags, too big to ask for, or gone since it was listed. It costs no
   * get; the cap on lists bounds how many of these a look can be shown.
   */
  | { readonly kind: 'skipped' }
  /** Couldn't be got: the look stops here and saves nothing. */
  | { readonly kind: 'failed' }

export interface LookResult {
  /** Nothing failed: only then is `place` to be saved. */
  readonly reachable: boolean
  /** Every list reached its end and no cap was reached. */
  readonly complete: boolean
  /** Every list but the tags read on their own reached its end, so a wait may follow. */
  readonly mainDone: boolean
  /** Tags read on their own that didn't reach their end, for a wait to leave out. */
  readonly stillBehind: readonly string[]
  /** Where the next look starts. */
  readonly place: Place
  /** The furthest cursor a list of the rest, not a tag read on its own, was answered with. */
  readonly listedTo: number
  readonly lists: number
  readonly gets: number
  readonly bytes: number
}

interface List {
  readonly tags: readonly string[]
  readonly own: boolean
  at: number
  done: boolean
  /** For a finished list: how far it's known nothing under its tags was left unlisted. */
  proven: number
}

/**
 * Reads `tags` from `place`. `list` asks for one page (undefined when it couldn't); `item`
 * handles one listed blob. `stop` says whether something besides the caps has had enough (a
 * source at its own limit), checked with them between rounds.
 */
export async function readLighthouse(
  tags: readonly string[],
  place: Place,
  list: (tags: readonly string[], cursor: number) => Promise<ListedPage | undefined>,
  item: (listed: ListedPage['items'][number]) => Promise<ItemOutcome>,
  options: {
    readonly caps?: LookCaps
    readonly stop?: () => boolean
    readonly stopped?: () => boolean
  } = {},
): Promise<LookResult> {
  const caps = options.caps ?? LOOK_CAPS
  const behind = Object.entries(place.behind).filter(([tag]) => tags.includes(tag))
  const own = new Set(behind.map(([tag]) => tag))
  const main = tags.filter((tag) => !own.has(tag))
  const lists: List[] = []
  for (let start = 0; start < main.length; start += caps.tagsPerList)
    lists.push({
      tags: main.slice(start, start + caps.tagsPerList),
      own: false,
      at: place.cursor,
      done: false,
      proven: 0,
    })
  for (const [tag, at] of behind) lists.push({ tags: [tag], own: true, at, done: false, proven: 0 })
  /** Blobs listed under each tag in the lists not read on their own, to find the heaviest. */
  const weight = new Map<string, number>()
  let seen = place.cursor
  let calls = 0
  let gets = 0
  let bytes = 0
  let capped = false
  const failed = (): LookResult => ({
    reachable: false,
    complete: false,
    mainDone: false,
    stillBehind: behind.map(([tag]) => tag),
    place,
    listedTo: place.cursor,
    lists: calls,
    gets,
    bytes,
  })

  /** One page of `entry`; false when it couldn't be read. */
  const page = async (entry: List): Promise<boolean> => {
    if (options.stopped?.() === true) return false
    // Anything put after this is asked for has a later seq than anything listed before it.
    const before = seen
    calls += 1
    const listed = await list(entry.tags, entry.at)
    if (listed === undefined) return false
    for (const one of listed.items) {
      if (entry.tags.includes(one.tag) && !entry.own)
        weight.set(one.tag, (weight.get(one.tag) ?? 0) + 1)
      const outcome = await item(one)
      if (outcome.kind === 'failed') return false
      if (outcome.kind === 'got') {
        gets += 1
        bytes += outcome.bytes
      }
    }
    entry.at = Math.max(entry.at, listed.cursor)
    seen = Math.max(seen, listed.cursor)
    if (!listed.more) {
      entry.done = true
      entry.proven = Math.max(entry.at, before)
    }
    return true
  }

  while (lists.some((entry) => !entry.done)) {
    if (
      gets >= caps.gets ||
      bytes >= caps.bytes ||
      calls >= caps.lists ||
      options.stop?.() === true
    ) {
      capped = true
      break
    }
    for (const entry of lists) if (!entry.done && !(await page(entry))) return failed()
  }
  const mains = lists.filter((entry) => !entry.own)
  // A list that finished before the others got as far is asked once more, so it can count that
  // far too: one empty list early in a round would otherwise hold the cursor where it was.
  const unfinished = mains.filter((entry) => !entry.done).map((entry) => entry.at)
  const target = unfinished.length > 0 ? Math.min(...unfinished) : seen
  for (const entry of mains)
    if (entry.done && entry.proven < target) {
      entry.done = false
      if (!(await page(entry))) return failed()
    }
  const reach = (entry: List) => (entry.done ? entry.proven : entry.at)
  // The least over every chunk, so nothing a chunk hasn't listed is passed by.
  const cursor =
    mains.length === 0 ? place.cursor : Math.max(place.cursor, Math.min(...mains.map(reach)))
  const mainDone = mains.every((entry) => entry.done)
  const nextBehind: Record<string, number> = {}
  for (const entry of lists.filter((one) => one.own)) {
    const tag = entry.tags[0] ?? ''
    // Caught up with the rest: it joins them again.
    if (!(entry.done && entry.proven >= cursor)) nextBehind[tag] = reach(entry)
  }
  if (!mainDone && Object.keys(nextBehind).length < caps.behind) {
    let heaviest: string | undefined
    for (const [tag, n] of weight)
      if (heaviest === undefined || n > (weight.get(heaviest) ?? 0)) heaviest = tag
    // Read on its own from the cursor saved, so the rest goes on from there without it.
    if (heaviest !== undefined) nextBehind[heaviest] = cursor
  }
  return {
    reachable: true,
    complete: !capped && lists.every((entry) => entry.done),
    mainDone,
    stillBehind: lists
      .filter((entry) => entry.own && !entry.done)
      .map((entry) => entry.tags[0] ?? ''),
    place: { cursor, behind: nextBehind },
    listedTo: Math.max(place.cursor, ...mains.map((entry) => entry.at)),
    lists: calls,
    gets,
    bytes,
  }
}
