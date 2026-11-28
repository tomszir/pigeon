// The signed-entries model: every history inside the bound keeps every invariant, and each planted
// defect is caught by the invariant it names.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RULES, type Rules } from './entries.ts'
import { explore } from './system.ts'

describe('the bytes entries are signed over', () => {
  it('every history keeps every invariant', () => {
    const result = explore()
    assert.deepEqual(result.violations, [])
    for (const flag of [
      'an old tab refused a current entry',
      'a reloaded tab took a current entry',
      'a 0.8.3 tab took a current entry',
      'entries signed on old and current releases',
    ])
      assert.ok(result.reached.includes(flag), `never reached "${flag}"`)
  })
})

const DEFECTS: readonly {
  readonly name: string
  readonly rules: Partial<Rules>
  readonly catches: string
}[] = [
  {
    name: 'the current release signs a context no release takes',
    rules: { signsKnownContext: false },
    catches: 'E1 taken from 0.8.2 on',
  },
  {
    name: 'the current release stops taking the untyped form',
    rules: { takesUntyped: false },
    catches: 'E2 old entries still verify',
  },
  {
    name: "a typed device-log entry's bytes leave out its kind",
    rules: { typedHasKind: false },
    catches: 'E4 no kind swapped',
  },
  {
    name: "a chat entry's bytes leave out its chat",
    rules: { bindsLog: false },
    catches: 'E3 one meaning',
  },
]

describe('planted defects in entry signing', () => {
  for (const defect of DEFECTS)
    it(`${defect.name} is caught by ${defect.catches}`, () => {
      const result = explore({ ...RULES, ...defect.rules })
      const caught = result.violations.find((v) => v.id === defect.catches)
      assert.ok(
        caught,
        `${defect.name} went uncaught: ${JSON.stringify(result.violations.map((v) => v.id))}`,
      )
    })
})
