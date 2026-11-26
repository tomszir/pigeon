import { describe, expectTypeOf, it } from 'vitest'
import type { Messenger } from './messenger.ts'
import type { createMessenger } from './service.ts'

// This file is checked by `tsc` (the web package's typecheck script, part of `mise run check`),
// not by what vitest runs: the assertions below are types, and vitest only reports the test names.

// The interface is written out by hand while createMessenger's return type is inferred from what
// it returns. They must be the same type, member for member, `readonly` and parameter types
// included, so a member added or changed in one and not the other stops the build.
describe('Messenger', () => {
  it('is exactly what createMessenger returns', () => {
    expectTypeOf<Awaited<ReturnType<typeof createMessenger>>>().toEqualTypeOf<Messenger>()
  })
})
