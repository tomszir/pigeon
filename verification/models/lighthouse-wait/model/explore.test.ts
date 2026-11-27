// The explorer itself: it finds a shortest way to a broken invariant, checks settled states, and
// stops at its bound.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { explore, type Model, walk } from './explore.ts'

/** A counter that steps up by one or two, and must never reach 5; settled, it must be even. */
const counter: Model<{ n: number }> = {
  name: 'counter',
  init: { n: 0 },
  steps: (s) =>
    s.n >= 6
      ? []
      : [
          ['+1', { n: s.n + 1 }],
          ['+2', { n: s.n + 2 }],
        ],
  safety: [{ id: 'never 5', check: (s) => (s.n === 5 ? 'reached 5' : undefined) }],
  settle: (s) => ({ n: s.n + (s.n % 2) }),
  settled: [{ id: 'even', check: (s) => (s.n % 2 === 0 ? undefined : 'odd') }],
}

describe('the explorer', () => {
  it('finds a shortest path to a broken invariant', () => {
    const result = explore(counter)
    const five = result.violations.find((v) => v.id === 'never 5')
    assert.deepEqual(five?.path, ['+1', '+2', '+2'])
  })

  it('checks invariants on the settled state', () => {
    const result = explore({ ...counter, settle: (s) => s })
    assert.ok(result.violations.some((v) => v.id === 'even'))
    assert.ok(!explore(counter).violations.some((v) => v.id === 'even'))
  })

  it('stops at its bound and says so', () => {
    const result = explore(counter, { maxStates: 3 })
    assert.equal(result.states, 3)
    assert.equal(result.truncated, true)
  })

  it('walks the same way for the same seed', () => {
    const a = walk(counter, { walks: 20, maxLength: 10, seed: 1 })
    const b = walk(counter, { walks: 20, maxLength: 10, seed: 1 })
    assert.equal(a.states, b.states)
    assert.ok(a.violations.some((v) => v.id === 'never 5'))
  })
})
