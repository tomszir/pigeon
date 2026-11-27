// One look over more tags than one list takes: every small store over three tags in two lists,
// every way a sender can put while a look reads, and a Lighthouse that stops answering a list or a
// get partway, are taken in full by looks one after another; a look that finished saves what the
// Lighthouse answered it with, and one that didn't keeps its days. Each planted defect is caught.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkLooks, FETCH_RULES, type FetchRules, modelLook } from './fetch.ts'

describe('a look over several lists', () => {
  it('takes everything, however the store changes while it reads, and saves what it read', async () => {
    const { found, cases } = await checkLooks(modelLook())
    assert.equal(found, undefined, found?.message)
    assert.ok(cases > 100_000, `only ${cases} cases`)
  })
})

describe('planted defects in a look', () => {
  const cases: readonly (readonly [string, Partial<FetchRules>, string])[] = [
    ['the furthest list’s cursor saved', { savesLeast: false }, 'F2 no lost mail'],
    [
      'a finished list counted only as far as it listed',
      { provesFinished: false },
      'F5 a finished look saves what it read',
    ],
    ['a blob that couldn’t be got passed over', { stopsAtFailedGet: false }, 'F2 no lost mail'],
    [
      'an unfinished look’s days moved on',
      { keepsDaysWhenUnfinished: false },
      'F6 an unfinished look keeps its days',
    ],
  ]
  for (const [name, rules, id] of cases)
    it(`${name} is caught by ${id}`, async () => {
      const { found } = await checkLooks(modelLook({ ...FETCH_RULES, ...rules }))
      assert.equal(found?.id, id, found?.message)
    })
})
