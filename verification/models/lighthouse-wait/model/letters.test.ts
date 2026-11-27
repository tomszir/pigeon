// Letters to one friend: an ask during a run isn't lost, and runs don't repeat on their own.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { explore, summary } from './explore.ts'
import { LETTER_RULES, lettersModel } from './letters.ts'

describe('letter runs', () => {
  it('hold nothing back once a run ends, and run once per ask', () => {
    const result = explore(lettersModel())
    assert.deepEqual(result.violations, [], summary(result))
    assert.equal(result.truncated, false)
    for (const flag of ['asked during a run', 'at the cap', 'mid-run'])
      assert.ok(result.reached.includes(flag), flag)
  })

  it("catches a mail check's resume dropped during a run", () => {
    const result = explore(lettersModel({ ...LETTER_RULES, remembersAsk: false }), {
      stopAt: 'R1 nothing held after a run',
    })
    assert.ok(
      result.violations.some((v) => v.id === 'R1 nothing held after a run'),
      summary(result),
    )
  })

  it('catches a run started again whenever one ends', () => {
    const result = explore(lettersModel({ ...LETTER_RULES, runsOnlyWhenAsked: false }), {
      stopAt: 'R2 one run per ask',
    })
    assert.ok(
      result.violations.some((v) => v.id === 'R2 one run per ask'),
      summary(result),
    )
  })
})
