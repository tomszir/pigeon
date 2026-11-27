// The conformance traces: the reference holds every invariant on them, Node and the Worker agree
// on them, and each planted defect in the Lighthouse makes the traces tell it from the reference.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkEvent, emptyGhost } from './checks.ts'
import {
  conform,
  parity,
  randomTrace,
  referenceSubject,
  TRACE_CONNS,
  TRACE_LIMITS,
  TRACE_TAGS,
} from './conformance.ts'
import { emptyLighthouse, RULES, type Rules, step, type Variant } from './lighthouse.ts'
import { TRACES } from './limits.ts'
import { DEFECTS } from './wait-model.ts'

const base = { limits: TRACE_LIMITS, conns: TRACE_CONNS, tags: TRACE_TAGS, length: 80 }

describe('conformance traces', () => {
  for (const variant of ['node', 'worker'] as const) {
    it(`hold every invariant on the ${variant} reference`, () => {
      for (let seed = 1; seed <= TRACES; seed++) {
        let state = emptyLighthouse(variant)
        let ghost = emptyGhost
        for (const { event } of randomTrace({ ...base, variant, seed })) {
          const { state: after, out } = step(state, event, TRACE_LIMITS)
          const checked = checkEvent(state, event, after, out, TRACE_LIMITS, ghost)
          assert.deepEqual(checked.broken, [], `seed ${seed}, ${JSON.stringify(event)}`)
          state = after
          ghost = checked.ghost
        }
      }
    })

    it(`pass on the ${variant} reference itself`, async () => {
      const mismatch = await conform(async () => referenceSubject(variant, TRACE_LIMITS), {
        ...base,
        variant,
        count: TRACES,
      })
      assert.equal(mismatch, undefined)
    })
  }

  it('find Node and the Worker alike', () => {
    for (let seed = 1; seed <= TRACES; seed++) assert.equal(parity({ ...base, seed }), undefined)
  })

  it('find the Worker unlike Node when it notices leases only by a timer it lacks', () => {
    const rules: Rules = { ...RULES, sweepsFirst: false }
    let found: string | undefined
    for (let seed = 1; seed <= TRACES && found === undefined; seed++)
      found = parity({ ...base, seed }, rules)
    assert.ok(found)
  })
})

describe('planted defects against the conformance traces', () => {
  const lighthouseDefects = DEFECTS.filter((d) => d.rules !== undefined)
  for (const defect of lighthouseDefects)
    for (const variant of ['node', 'worker'] as Variant[]) {
      if (defect.variant === 'worker' && variant === 'node') continue
      it(`${defect.name} (${variant}) is told from the reference`, async () => {
        const mismatch = await conform(
          async () => referenceSubject(variant, TRACE_LIMITS, { ...RULES, ...defect.rules }),
          { ...base, variant, count: TRACES },
        )
        assert.ok(mismatch, `${defect.name} passed ${TRACES} traces`)
      })
    }
})
