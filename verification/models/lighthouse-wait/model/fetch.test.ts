// The capped look: every small store over three tags in two lists, and every way a sender can put
// while a look reads, is taken in full by looks one after another, each bounded; a sender who
// floods tags with junk holds back mail under other tags by a look per flooded tag at most; and
// a Lighthouse that lists without end is bounded too. Each planted defect is caught.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  checkEndless,
  checkFlood,
  checkPutsDuring,
  checkStore,
  FETCH_RULES,
  type FetchFinding,
  type FetchLimits,
  type FetchRules,
  schedules,
  stores,
} from './fetch.ts'

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

/** The first thing wrong under `rules`, and how many cases it took. */
export function firstFinding(rules: FetchRules = FETCH_RULES): {
  found?: FetchFinding
  cases: number
} {
  let cases = 0
  const found = (finding: FetchFinding | undefined) => finding
  for (const store of stores(4, TAGS, 1)) {
    cases += 1
    const finding = found(checkStore(store, TAGS, FETCH_LIMITS, rules))
    if (finding !== undefined) return { found: finding, cases }
  }
  for (const store of stores(2, TAGS, 1))
    for (const puts of schedules(2, 4, TAGS)) {
      cases += 1
      const finding = checkPutsDuring(store, puts, TAGS, FETCH_LIMITS, rules)
      if (finding !== undefined) return { found: finding, cases }
    }
  const floodLimits = { ...FETCH_LIMITS, tagsPerList: 3 }
  for (const flooded of [['x'], ['x', 'y']])
    for (let at = 0; at < 5; at++) {
      cases += 1
      const finding =
        checkFlood(FLOOD_TAGS, flooded, at, floodLimits, rules) ??
        checkFlood(FLOOD_TAGS, flooded, at, floodLimits, rules, { tag: 'x', max: 1 })
      if (finding !== undefined) return { found: finding, cases }
    }
  for (const tags of [TAGS, ['a', 'b', 'c', 'd', 'e']]) {
    cases += 1
    const finding = checkEndless(tags, FETCH_LIMITS, rules)
    if (finding !== undefined) return { found: finding, cases }
  }
  return { cases }
}

describe('a capped look', () => {
  it('takes everything, a bounded look at a time, however the store changes, and a flood holds back only its tag', () => {
    const { found, cases } = firstFinding()
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
    it(`${name} is caught by ${id}`, () => {
      const { found } = firstFinding({ ...FETCH_RULES, ...rules })
      assert.equal(found?.id, id, found?.message)
    })
})
