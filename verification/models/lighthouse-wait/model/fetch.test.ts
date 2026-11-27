// The cap on one look: every store of up to five blobs over two chunks is taken in full by looks
// one after another, each bounded, and a Lighthouse that lists without end is bounded too. Each
// planted defect is caught.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  checkEndless,
  checkStore,
  FETCH_RULES,
  type FetchLimits,
  type FetchRules,
  stores,
} from './fetch.ts'

const LIMITS: FetchLimits = { tagsPerList: 1, pageSize: 2, maxGets: 2, maxBytes: 3, maxLists: 4 }
const TAGS = ['a', 'b']

const first = (rules: FetchRules, size = 1) => {
  for (const store of stores(5, TAGS, size)) {
    const found = checkStore(store, TAGS, LIMITS, rules)
    if (found !== undefined) return found
  }
  return checkEndless(TAGS, LIMITS, rules)
}

describe('a capped look', () => {
  it('takes everything, a bounded look at a time, from every small store', () => {
    assert.equal(first(FETCH_RULES), undefined)
    assert.equal(first(FETCH_RULES, 2), undefined)
  })

  it('is bounded at a Lighthouse that lists without end', () => {
    assert.equal(checkEndless(TAGS, LIMITS), undefined)
    assert.equal(checkEndless(['a', 'b', 'c'], LIMITS), undefined)
  })
})

describe('planted defects in the cap', () => {
  const cases: readonly (readonly [string, Partial<FetchRules>, string])[] = [
    ['no cap', { capped: false }, 'F1 bounded'],
    ['nothing saved at the cap', { savesWhenCapped: false }, 'F3 progress'],
    ['the furthest chunk saved at the cap', { savesLeastUnfinished: false }, 'F2 no lost mail'],
    ['chunks read one after another', { inTurn: false }, 'F3 progress'],
  ]
  for (const [name, rules, id] of cases)
    it(`${name} is caught by ${id}`, () => {
      assert.equal(first({ ...FETCH_RULES, ...rules })?.id, id)
    })
})
