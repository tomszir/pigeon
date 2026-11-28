// How one mail check reads one Lighthouse. Its tags go in lists of as many as one list takes, all
// from the cursor saved there, a page from each in turn, each to its end. The cursor it saves never
// passes a blob a list hasn't listed: it's the least over the lists, a finished one counting as far
// as anything had been listed before its last page was asked for, since a blob put after that has
// a later seq. Saving the furthest would pass a blob put under a list that finished while another
// was still reading.
import { MAX_LIST_TAGS } from '@pigeon/core'

/** What one look read at one Lighthouse, and the tags it listed there. */
export interface Looked {
  readonly at: number
  /** Every list was read to its end: a wait may follow. */
  readonly complete: boolean
  /** The cursor that look saved, or the one it started from. */
  readonly cursor: number
  /** Each tag listed, its day, and whether it's yours or an invite's, which a wait keeps first. */
  readonly tags: readonly { readonly tag: string; readonly date: string; readonly first: boolean }[]
}

export interface ListedPage {
  readonly items: readonly { readonly id: string; readonly tag: string; readonly size: number }[]
  readonly cursor: number
  readonly more: boolean
}

/** What became of one listed blob. */
export type ItemOutcome =
  /** Got, or passed over: nothing more to do with it. */
  | { readonly kind: 'done' }
  /** Left for the next look (a source at its own limit): this look doesn't count as finished. */
  | { readonly kind: 'held' }
  /** Couldn't be got: the look stops here and saves nothing. */
  | { readonly kind: 'failed' }

export interface LookResult {
  /** Every list was read to its end, nothing failed and nothing was left: save `cursor`. */
  readonly complete: boolean
  /** The cursor to save, when complete. */
  readonly cursor: number
  /** The furthest cursor any list was answered with. */
  readonly listedTo: number
}

interface List {
  readonly tags: readonly string[]
  at: number
  done: boolean
  /** For a finished list: how far it's known nothing under its tags was left unlisted. */
  proven: number
}

/**
 * Reads `tags` from `cursor`. `list` asks for one page (undefined when it couldn't); `item`
 * handles one listed blob.
 */
export async function readLighthouse(
  tags: readonly string[],
  cursor: number,
  list: (tags: readonly string[], cursor: number) => Promise<ListedPage | undefined>,
  item: (listed: ListedPage['items'][number]) => Promise<ItemOutcome>,
  options: { readonly tagsPerList?: number; readonly stopped?: () => boolean } = {},
): Promise<LookResult> {
  const perList = options.tagsPerList ?? MAX_LIST_TAGS
  const lists: List[] = []
  for (let start = 0; start < tags.length; start += perList)
    lists.push({ tags: tags.slice(start, start + perList), at: cursor, done: false, proven: 0 })
  let seen = cursor
  let held = false
  const unfinished = (): LookResult => ({ complete: false, cursor, listedTo: seen })

  /** One page of `entry`; false when it couldn't be read. */
  const page = async (entry: List): Promise<boolean> => {
    if (options.stopped?.() === true) return false
    // Anything put after this is asked for has a later seq than anything listed before it.
    const before = seen
    const listed = await list(entry.tags, entry.at)
    if (listed === undefined) return false
    for (const one of listed.items) {
      const outcome = await item(one)
      if (outcome.kind === 'failed') return false
      if (outcome.kind === 'held') held = true
    }
    entry.at = Math.max(entry.at, listed.cursor)
    seen = Math.max(seen, listed.cursor)
    if (!listed.more) {
      entry.done = true
      entry.proven = Math.max(entry.at, before)
    }
    return true
  }

  // A round at a time: a page from every list not finished.
  while (lists.some((entry) => !entry.done))
    for (const entry of lists) if (!entry.done && !(await page(entry))) return unfinished()
  // A list that finished before the others got as far is asked once more, so it can count that
  // far too: an empty list early in a round would otherwise hold the cursor where it was.
  for (const entry of lists)
    if (entry.proven < seen) {
      entry.done = false
      while (!entry.done) if (!(await page(entry))) return unfinished()
    }
  if (held) return unfinished()
  // The least over every list, so nothing a list hasn't listed is passed by.
  const least = lists.length === 0 ? cursor : Math.min(...lists.map((entry) => entry.proven))
  return { complete: true, cursor: Math.max(cursor, least), listedTo: seen }
}
