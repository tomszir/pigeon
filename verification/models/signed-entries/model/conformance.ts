// The test an implementation of entry signing must pass: what it signs each entry of the model's
// domain over must be the current release's bytes, and for every entry and every byte string a
// signature might be over (each entry's in each form, and other signed objects), it must take
// the signature exactly when the current release does. An implementation is reached through a
// `Subject`, with its own ids.
import { bytes, CURRENT, type Entry, FORMS, OTHER_SIGNED, releaseOf, takes } from './entries.ts'
import { domain, forgeries, type Ids, writerOf } from './system.ts'

export interface Subject {
  readonly ids: Ids
  /** The bytes the implementation signs `entry` over, as UTF-8 text. */
  sign(entry: Entry): Promise<string>
  /** Whether the implementation takes `entry` with its writer's signature over `over`. */
  verify(entry: Entry, over: string): Promise<boolean>
}

export interface Mismatch {
  readonly what: string
  readonly expected: string | boolean
  readonly got: string | boolean
}

/** Where the implementation and the current release differ, if anywhere. */
export async function checkEntrySigning(subject: Subject): Promise<Mismatch[]> {
  const entries = domain(subject.ids)
  const writer = writerOf(subject.ids)
  const signs = releaseOf(CURRENT).signs
  const mismatches: Mismatch[] = []
  const candidates = [
    ...forgeries(subject.ids).flatMap((entry) => FORMS.map((form) => bytes(entry, form))),
    ...OTHER_SIGNED,
  ]
  for (const [index, entry] of entries.entries()) {
    const expected = bytes(entry, signs)
    const got = await subject.sign(entry)
    if (got !== expected) mismatches.push({ what: `entry ${index} signed over`, expected, got })
    for (const over of candidates) {
      const want = takes(CURRENT, entry, { by: writer(entry), over }, writer)
      const has = await subject.verify(entry, over)
      if (want !== has)
        mismatches.push({
          what: `entry ${index} with a signature over ${over}`,
          expected: want,
          got: has,
        })
    }
  }
  return mismatches
}
