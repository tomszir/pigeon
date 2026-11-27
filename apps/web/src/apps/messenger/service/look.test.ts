// One look at one Lighthouse, run through every case of the waiting model's cap
// (verification/models/lighthouse-wait/model/fetch.ts): every small store over three tags in two
// lists, every way a sender can put while a look reads, a sender flooding tags with junk, and a
// Lighthouse that lists without end. The model's own planted defects are caught by the same cases.
import { describe, expect, it } from 'vitest'
import {
  checkLooks,
  FETCH_RULES,
  type LookWith,
  modelLook,
} from '../../../../../../verification/models/lighthouse-wait/model/fetch.ts'
import { readLighthouse } from './look.ts'

/** The look the mailbox makes, through the model's Lighthouse: it takes and drops what's its own. */
const implementation: LookWith = async (lighthouse, tags, place, taken, limits, options) => {
  const have = new Set(taken)
  const listed = new Map<string, { readonly mine: boolean; readonly size: number }>()
  let fromSource = 0
  const result = await readLighthouse(
    tags,
    place,
    async (chunk, cursor) => {
      options.between?.()
      const page = lighthouse.list(chunk, cursor)
      for (const item of page.items) listed.set(item.id, item)
      return page
    },
    async (item) => {
      const kept = listed.get(item.id)
      if (kept === undefined || !tags.includes(item.tag)) return { kind: 'skipped' }
      if (item.tag === options.source?.tag) fromSource += 1
      if (kept.mine) {
        have.add(item.id)
        lighthouse.drop(item.id)
      }
      return { kind: 'got', bytes: kept.size }
    },
    {
      caps: {
        gets: limits.maxGets,
        bytes: limits.maxBytes,
        lists: limits.maxLists,
        tagsPerList: limits.tagsPerList,
        behind: limits.maxBehind,
      },
      stop: () => options.source !== undefined && fromSource >= options.source.max,
    },
  )
  return {
    taken: [...have].sort(),
    place: result.place,
    lists: result.lists,
    gets: result.gets,
    bytes: result.bytes,
    mainDone: result.mainDone,
    complete: result.complete,
    seen: result.listedTo,
  }
}

describe('a capped look', () => {
  it('passes every case of the model’s cap', async () => {
    const { found, cases } = await checkLooks(implementation)
    expect(found).toBeUndefined()
    expect(cases).toBeGreaterThan(40_000)
  }, 60_000)

  it('runs cases that tell the model’s planted defects from the design', async () => {
    for (const defect of [
      { capped: false },
      { savesLeast: false },
      { provesFinished: false },
      { splitsHeavyTag: false },
    ])
      expect((await checkLooks(modelLook({ ...FETCH_RULES, ...defect }))).found).toBeDefined()
  }, 60_000)

  it('saves nothing when a blob can’t be got, so it’s read again next time', async () => {
    const place = { cursor: 7, behind: { x: 3 } }
    const result = await readLighthouse(
      ['a', 'x'],
      place,
      async () => ({ items: [{ id: 'b', tag: 'a', size: 1 }], cursor: 9, more: false }),
      async () => ({ kind: 'failed' }),
    )
    expect(result).toMatchObject({ reachable: false, complete: false, place })
  })
})
