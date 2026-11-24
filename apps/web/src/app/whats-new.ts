// Whether to tell a returning visitor that Pigeon was updated (decision 0025). The last version
// this browser saw is kept in the Store; a first visit is told nothing.
import type { Store } from '../platform/storage/storage.ts'
import { IDENTITY } from './start-messenger.ts'

export const SEEN_VERSION = 'seenVersion'

/** True when `a` is a later version than `b`: "0.10.0" after "0.9.1". */
export function isNewer(a: string, b: string): boolean {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

/**
 * Whether this visit should say Pigeon was updated to `version`. A first visit (nothing stored,
 * not even an identity) remembers the version and says no. Call `rememberVersion` once the
 * visitor has been told.
 */
export async function updatedSinceLastVisit(store: Store, version: string): Promise<boolean> {
  const seen = await store.get(SEEN_VERSION)
  if (typeof seen === 'string') return isNewer(version, seen)
  // Someone with an identity but no seen version came before Pigeon remembered versions.
  if ((await store.get(IDENTITY)) !== undefined) return true
  await rememberVersion(store, version)
  return false
}

/** Remembers that this browser has been told about `version`. */
export const rememberVersion = (store: Store, version: string): Promise<void> =>
  store.set(SEEN_VERSION, version)
