// Invite links on your other devices: the options side by side. Each runs with the maker
// running, away for good, removed, and replaced; option (b) also with two askers, a busy answer,
// two approvals and a decline at once, an approving device removed before the maker acts, and a
// hostile removed device. The outcomes below are what the design note's comparison reports.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { explore, summary } from './explore.ts'
import { MAX_STATES } from './limits.ts'
import { LINK_DEFECTS, linkConfigs, linksModel } from './links-model.ts'

interface Expected {
  readonly broken: readonly string[]
  /** Another device can approve. */
  readonly elsewhere: boolean
  /** Some history ends with one side showing a friendship the other doesn't. */
  readonly oneSided: boolean
  /** Some history ends with someone added. */
  readonly added: boolean
}

const OK = { broken: [], added: true } as const

const EXPECTED: Readonly<Record<string, Expected>> = {
  'links (a), maker runs': { ...OK, elsewhere: false, oneSided: false },
  'links (a), maker away': { ...OK, elsewhere: false, oneSided: false, added: false },
  'links (a), maker removed': { ...OK, elsewhere: false, oneSided: true },
  'links (a), maker replaced': { ...OK, elsewhere: false, oneSided: true },
  'links (b), maker runs': { ...OK, elsewhere: true, oneSided: false },
  'links (b), maker away': { ...OK, elsewhere: true, oneSided: false, added: false },
  'links (b), maker removed': { ...OK, elsewhere: true, oneSided: true },
  'links (b), maker replaced': { ...OK, elsewhere: true, oneSided: true },
  'links (c), maker runs': { ...OK, elsewhere: true, oneSided: false },
  'links (c), maker away': { ...OK, elsewhere: true, oneSided: true, added: false },
  'links (c), maker removed': { ...OK, elsewhere: true, oneSided: true },
  'links (c), maker replaced': { ...OK, elsewhere: true, oneSided: true },
  'links (b), two askers, one approved, one declined': { ...OK, elsewhere: true, oneSided: false },
  'links (b), two askers, the second busy': { ...OK, elsewhere: true, oneSided: false },
  'links (b), approved twice and declined at once': { ...OK, elsewhere: true, oneSided: false },
  'links (b), the approving device removed': { ...OK, elsewhere: true, oneSided: false },
  'links (b), hostile X': { ...OK, elsewhere: true, oneSided: false },
  'links (c), hostile X': {
    broken: [
      'K2 no removed device holds a new friend’s secret',
      'K5 both sides agree on the friendship',
    ],
    elsewhere: true,
    oneSided: true,
    added: true,
  },
}

/** What some configurations must reach besides, so they can't pass without getting there. */
const MUST_REACH: Readonly<Record<string, readonly string[]>> = {
  'links (b), two askers, one approved, one declined': ['settled:declined'],
  'links (b), two askers, the second busy': ['settled:busy'],
  'links (b), approved twice and declined at once': ['settled:two approvals', 'settled:declined'],
  'links (b), the approving device removed': ['settled:approver removed'],
  'links (b), hostile X': ['settled:X removed', 'settled:X holds a secret'],
}

describe('invite links on your other devices', () => {
  for (const cfg of linkConfigs())
    it(cfg.name, () => {
      const want = EXPECTED[cfg.name]
      assert.ok(want, `no expectation for ${cfg.name}`)
      const result = explore(linksModel(cfg), { maxStates: MAX_STATES })
      console.log(summary(result))
      assert.deepEqual(result.violations.map((v) => v.id).sort(), [...want.broken].sort())
      assert.equal(result.reached.includes('settled:approved on A'), want.elsewhere)
      assert.equal(result.reached.includes('settled:one side only'), want.oneSided)
      assert.equal(result.reached.includes('settled:added'), want.added)
      for (const flag of MUST_REACH[cfg.name] ?? [])
        assert.ok(result.reached.includes(flag), `never reached ${flag}`)
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
