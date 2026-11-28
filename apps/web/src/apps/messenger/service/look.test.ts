// One look at one Lighthouse with more tags than one list takes, run through every case in
// `./look-cases.ts`: every small store over three tags in two lists, every way a sender can put
// while the look reads, and a Lighthouse that stops answering a list or a get partway.
import { describe, expect, it } from 'vitest'
import { readLighthouse } from './look.ts'
import { checkLooks, FETCH_RULES, type LookWith, modelLook } from './look-cases.ts'

/**
 * The look the mailbox makes, through the model's Lighthouse: it gets every blob listed under its
 * tags, takes and drops what's its own, and stops at a blob it can't get.
 */
const implementation: LookWith = async (lighthouse, tags, cursor, taken, limits) => {
  const have = new Set(taken)
  const result = await readLighthouse(
    tags,
    cursor,
    async (chunk, from) => lighthouse.list(chunk, from),
    async (item) => {
      if (!tags.includes(item.tag)) return { kind: 'done' }
      const got = lighthouse.get(item.id)
      if (got === undefined) return { kind: 'failed' }
      if (got !== 'gone' && got.mine) {
        have.add(got.id)
        lighthouse.drop(got.id)
      }
      return { kind: 'done' }
    },
    { tagsPerList: limits.tagsPerList },
  )
  return {
    taken: [...have].sort(),
    cursor: result.complete ? result.cursor : cursor,
    complete: result.complete,
    // The mailbox moves a Lighthouse's days on only with a cursor from a look that finished.
    movesDays: result.complete,
  }
}

describe('a look over several lists', () => {
  it('passes every case of the model’s look', async () => {
    const { found, cases } = await checkLooks(implementation)
    expect(found).toBeUndefined()
    expect(cases).toBeGreaterThan(400_000)
  }, 120_000)

  it('runs cases that tell the model’s planted defects from the design', async () => {
    for (const defect of [
      { savesLeast: false },
      { provesFinished: false },
      { stopsAtFailedGet: false },
      { keepsDaysWhenUnfinished: false },
    ])
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
