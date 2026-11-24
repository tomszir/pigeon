import { expect, it } from 'vitest'
import { canonicalJson } from './canonical.ts'

it('sorts keys at every depth and drops nothing else', () => {
  expect(canonicalJson({ b: 1, a: [{ d: true, c: null }], e: 'x' })).toBe(
    '{"a":[{"c":null,"d":true}],"b":1,"e":"x"}',
  )
})

it('refuses numbers JSON cannot carry', () => {
  expect(() => canonicalJson(Number.NaN)).toThrow()
})
