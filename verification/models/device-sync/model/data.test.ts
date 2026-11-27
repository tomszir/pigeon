// The your-data model: every scenario holds every invariant under the design, reaches what it
// is meant to reach, and each planted defect is caught by the invariant it names.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFECTS, dataModel, SCENARIOS, withDefect } from './data-model.ts'
import { DESIGN } from './data-state.ts'
import { explore, summary, walk } from './explore.ts'
import { MAX_STATES, WALK_LENGTH, WALKS } from './limits.ts'

/** What each scenario must reach once settled, so it can't pass by never getting there. */
const MUST_REACH: Readonly<Record<string, readonly string[]>> = {
  friends: ['settled:G live on A', 'settled:G live on C', 'settled:unfriended', 'letter lost'],
  blocks: ['settled:blocked', 'letter lost'],
  settings: ['settled:relay on', 'settled:petname set'],
  removal: [
    'removed',
    'settled:every device knew of the removal',
    'settled:secret replaced after removal',
    'settled:G live on A',
    'forged entry taken',
  ],
  room: ['forged entry taken', 'settled:every device knew of the removal'],
  link: ['C linked', 'letter lost', 'settled:secret replaced after removal'],
  outbox: ['settled:secret replaced after removal'],
  newer: ['settled:unreadable entry held', 'settled:G live on A'],
}

describe('your data, under the design', () => {
  for (const [key, cfg] of Object.entries(SCENARIOS))
    it(`${cfg.name}: every invariant holds`, () => {
      const result = explore(dataModel(cfg), { maxStates: MAX_STATES })
      console.log(summary(result))
      assert.deepEqual(
        result.violations.map((v) => `${v.id}: ${v.message} after ${v.path.join(' > ')}`),
        [],
      )
      for (const flag of MUST_REACH[key] ?? [])
        assert.ok(result.reached.includes(flag), `never reached ${flag}`)
    })

  for (const key of ['removal', 'room', 'link'])
    it(`${key}: random walks deeper than the search`, () => {
      const cfg = SCENARIOS[key]
      assert.ok(cfg)
      const result = walk(dataModel(cfg), { walks: WALKS, maxLength: WALK_LENGTH, seed: 138 })
      console.log(summary(result))
      assert.deepEqual(result.violations, [])
    })

  it('the scenarios run the design', () => {
    for (const cfg of Object.values(SCENARIOS)) assert.deepEqual(cfg.rules, DESIGN)
  })
})

describe('your data, planted defects', () => {
  for (const defect of DEFECTS)
    it(`${defect.name} (${defect.what}) is caught by ${defect.caughtBy}`, () => {
      const result = explore(dataModel(withDefect(defect)), {
        maxStates: MAX_STATES,
        stopAt: defect.caughtBy,
      })
      const caught = result.violations.find((v) => v.id === defect.caughtBy)
      console.log(`${summary(result)}\n  ${caught?.message} after ${caught?.path.join(' > ')}`)
      assert.ok(caught, `${defect.caughtBy} never broke`)
    })
})
