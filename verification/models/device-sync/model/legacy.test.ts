// Moving a pair from before pair secrets with two devices on the lower-id side: today's answer,
// which names no secret, leaves one device on a secret the friend never took; a named answer
// alone leaves it unmoved; a named answer and device sync bring every device onto one secret.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { explore, summary } from './explore.ts'
import { LEGACY_CASES, legacyModel } from './legacy.ts'

describe('moving to pair secrets with two devices on one side', () => {
  for (const c of LEGACY_CASES)
    it(
      c.caughtBy
        ? `${c.name} is caught by ${c.caughtBy}`
        : `${c.name}: every device ends on one secret`,
      () => {
        const result = explore(legacyModel(c.name, c.rules))
        console.log(summary(result))
        assert.equal(result.truncated, false)
        assert.ok(result.reached.includes('two secrets made'), 'both devices never made a secret')
        if (c.caughtBy) assert.ok(result.violations.some((v) => v.id === c.caughtBy))
        else assert.deepEqual(result.violations, [])
      },
    )
})
