// Invite links on your other devices: the options side by side. Each runs with the maker
// running, away for good, removed, and replaced, and against a hostile removed device; the
// outcomes below are what the design note's comparison reports.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { explore, summary } from './explore.ts'
import { MAX_STATES } from './limits.ts'
import { LINK_DEFECTS, linkConfigs, linksModel } from './links.ts'

interface Expected {
  readonly broken: readonly string[]
  /** Another device can approve. */
  readonly elsewhere: boolean
  /** Some history ends with one side showing a friendship the other doesn't. */
  readonly oneSided: boolean
}

const OK = { broken: [] } as const

const EXPECTED: Readonly<Record<string, Expected>> = {
  'links (a), maker runs': { ...OK, elsewhere: false, oneSided: false },
  'links (a), maker away': { ...OK, elsewhere: false, oneSided: false },
  'links (a), maker removed': { ...OK, elsewhere: false, oneSided: true },
  'links (a), maker replaced': { ...OK, elsewhere: false, oneSided: true },
  'links (b), maker runs': { ...OK, elsewhere: true, oneSided: false },
  'links (b), maker away': { ...OK, elsewhere: true, oneSided: false },
  'links (b), maker removed': { ...OK, elsewhere: true, oneSided: true },
  'links (b), maker replaced': { ...OK, elsewhere: true, oneSided: true },
  'links (c), maker runs': { ...OK, elsewhere: true, oneSided: false },
  'links (c), maker away': { ...OK, elsewhere: true, oneSided: true },
  'links (c), maker removed': { ...OK, elsewhere: true, oneSided: true },
  'links (c), maker replaced': { ...OK, elsewhere: true, oneSided: true },
  'links (b), hostile X': { ...OK, elsewhere: true, oneSided: false },
  'links (c), hostile X': {
    broken: [
      'K2 no removed device holds a new friend’s secret',
      'K3 the maker acts only on a device still on its list',
      'K5 both sides agree on the friendship',
    ],
    elsewhere: true,
    oneSided: true,
  },
}

describe('invite links on your other devices', () => {
  for (const cfg of linkConfigs())
    it(cfg.name, () => {
      const want = EXPECTED[cfg.name]
      assert.ok(want, `no expectation for ${cfg.name}`)
      const result = explore(linksModel(cfg), { maxStates: MAX_STATES })
      console.log(summary(result))
      assert.equal(result.truncated, false)
      assert.deepEqual(result.violations.map((v) => v.id).sort(), [...want.broken].sort())
      assert.equal(result.reached.includes('settled:approved on A'), want.elsewhere)
      assert.equal(result.reached.includes('settled:one side only'), want.oneSided)
      assert.ok(result.reached.includes('settled:added'), 'never added')
    })
})

describe('invite links, planted defects', () => {
  for (const defect of LINK_DEFECTS)
    it(`${defect.name} is caught by ${defect.caughtBy}`, () => {
      const result = explore(linksModel(defect.cfg), {
        maxStates: MAX_STATES,
        stopAt: defect.caughtBy,
      })
      const caught = result.violations.find((v) => v.id === defect.caughtBy)
      console.log(`${summary(result)}\n  ${caught?.message} after ${caught?.path.join(' > ')}`)
      assert.ok(caught)
    })
})
