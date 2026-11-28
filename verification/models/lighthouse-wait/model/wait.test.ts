// The waiting model: every scenario holds every invariant on both Lighthouses and reaches what
// it is meant to, and each planted defect is caught by the invariant it names.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { explore, summary, walk } from './explore.ts'
import { MAX_STATES, WALK_LENGTH, WALKS } from './limits.ts'
import { DEFECTS, SCENARIOS, waitModel, withDefect } from './wait-model.ts'

/** What each scenario must reach, so it can't pass by never getting there. */
const MUST_REACH: Readonly<Record<string, readonly string[]>> = {
  cycle: ['mail put', 'a wait stands', 'cued', 'a wait sent again after its lease'],
  sleep: ['a wake owed across a reset', 'cued'],
  fault: ['a wait stands', 'cued'],
  reads: ['a wait stands', 'cued'],
  midnight: ['a wait stands', 'cued'],
  switch: ['a wait stands'],
  room: ['evicted'],
  quiet: ['a wait stands'],
  shared: ['a wait stands', 'cued'],
  lull: ['a wait given up past its lease', 'a wait sent again after its lease', 'cued'],
}

describe('waiting for mail at a Lighthouse', () => {
  for (const [key, scenario] of Object.entries(SCENARIOS))
    for (const variant of scenario.variants ?? (['node', 'worker'] as const)) {
      it(`${scenario.name}, ${variant}: every invariant holds`, () => {
        const result = explore(waitModel(key, variant), { maxStates: MAX_STATES })
        assert.deepEqual(result.violations, [], summary(result))
        assert.equal(result.truncated, false, summary(result))
        for (const flag of MUST_REACH[key] ?? [])
          assert.ok(result.reached.includes(flag), `${key} never reached "${flag}"`)
      })
      it(`${scenario.name}, ${variant}: random walks find nothing`, () => {
        const result = walk(waitModel(key, variant), {
          walks: WALKS,
          maxLength: WALK_LENGTH,
          seed: 7,
        })
        assert.deepEqual(result.violations, [], summary(result))
      })
    }
})

describe('planted defects in waiting', () => {
  for (const defect of DEFECTS)
    it(`${defect.name} (${defect.variant}) is caught by ${defect.catches}`, () => {
      const result = explore(withDefect(defect), { maxStates: MAX_STATES, stopAt: defect.catches })
      const caught = result.violations.find((v) => v.id === defect.catches)
      assert.ok(caught, `${defect.name} went uncaught: ${summary(result)}`)
    })
})
