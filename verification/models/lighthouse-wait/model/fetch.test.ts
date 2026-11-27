// The capped look: every small store over three tags in two lists, and every way a sender can put
// while a look reads, is taken in full by looks one after another, each bounded; a sender who
// floods tags with junk holds back mail under other tags by a look per flooded tag at most; and
// a Lighthouse that lists without end is bounded too. Each planted defect is caught.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkLooks, FETCH_RULES, type FetchRules, modelLook } from './fetch.ts'

describe('a capped look', () => {
  it('takes everything, a bounded look at a time, however the store changes, and a flood holds back only its tag', async () => {
    const { found, cases } = await checkLooks(modelLook())
    assert.equal(found, undefined, found?.message)
    assert.ok(cases > 40_000, `only ${cases} cases`)
  })
})

describe('planted defects in the cap', () => {
  const cases: readonly (readonly [string, Partial<FetchRules>, string])[] = [
    ['no cap', { capped: false }, 'F1 bounded'],
    ['the furthest list’s cursor saved', { savesLeast: false }, 'F2 no lost mail'],
    [
      'a finished list counted only as far as it listed',
      { provesFinished: false },
      'F5 a finished look saves what it read',
    ],
    [
      'a flooded tag left in with the rest',
      { splitsHeavyTag: false },
      'F4 one tag holds back only itself',
    ],
  ]
  for (const [name, rules, id] of cases)
    it(`${name} is caught by ${id}`, async () => {
      const { found } = await checkLooks(modelLook({ ...FETCH_RULES, ...rules }))
      assert.equal(found?.id, id, found?.message)
    })
})
