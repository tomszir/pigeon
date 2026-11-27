// One look at one Lighthouse with more tags than one list takes, run through every case of the
// waiting model's look (verification/models/lighthouse-wait/model/fetch.ts): every small store
// over three tags in two lists, every way a sender can put while the look reads, and a Lighthouse
// that stops answering partway. The model's planted defects are caught by the same cases.
import { describe, expect, it } from 'vitest'
import {
  checkLooks,
  FETCH_RULES,
  type LookWith,
  modelLook,
} from '../../../../../../verification/models/lighthouse-wait/model/fetch.ts'
import { readLighthouse } from './look.ts'

/** The look the mailbox makes, through the model's Lighthouse: it takes and drops what's its own. */
const implementation: LookWith = async (lighthouse, tags, cursor, taken, limits, options) => {
  const have = new Set(taken)
  const listed = new Map<string, { readonly mine: boolean }>()
  const result = await readLighthouse(
    tags,
    cursor,
    async (chunk, from) => {
      options.between?.()
      const page = lighthouse.list(chunk, from)
      for (const item of page?.items ?? []) listed.set(item.id, item)
      return page
    },
    async (item) => {
      if (listed.get(item.id)?.mine === true && tags.includes(item.tag)) {
        have.add(item.id)
        lighthouse.drop(item.id)
      }
      return { kind: 'done' }
    },
    { tagsPerList: limits.tagsPerList },
  )
  return {
    taken: [...have].sort(),
    cursor: result.complete ? result.cursor : cursor,
    complete: result.complete,
    seen: result.listedTo,
  }
}

describe('a look over several lists', () => {
  it('passes every case of the model’s look', async () => {
    const { found, cases } = await checkLooks(implementation)
    expect(found).toBeUndefined()
    expect(cases).toBeGreaterThan(300_000)
  }, 120_000)

  it('runs cases that tell the model’s planted defects from the design', async () => {
    for (const defect of [{ savesLeast: false }, { provesFinished: false }])
      expect((await checkLooks(modelLook({ ...FETCH_RULES, ...defect }))).found).toBeDefined()
  }, 120_000)

  it('saves nothing when a blob can’t be got, or one is left for the next look', async () => {
    for (const outcome of ['failed', 'held'] as const) {
      const result = await readLighthouse(
        ['a'],
        7,
        async () => ({ items: [{ id: 'b', tag: 'a', size: 1 }], cursor: 9, more: false }),
        async () => ({ kind: outcome }),
      )
      expect(result.complete).toBe(false)
    }
  })
})
