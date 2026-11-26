import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../platform/storage/memory-storage.ts'
import { isNewer, rememberVersion, SEEN_VERSION, updatedSinceLastVisit } from './whats-new.ts'

describe('isNewer', () => {
  it('compares each part as a number', () => {
    expect(isNewer('0.10.0', '0.9.1')).toBe(true)
    expect(isNewer('0.4.1', '0.4.0')).toBe(true)
    expect(isNewer('0.4.0', '0.4.0')).toBe(false)
    expect(isNewer('0.3.0', '0.4.0')).toBe(false)
  })
})

describe('updatedSinceLastVisit', () => {
  it('says nothing on a first visit, and remembers the version', async () => {
    const store = createMemoryStore()
    expect(await updatedSinceLastVisit(store, '0.5.0')).toBe(false)
    expect(await store.get(SEEN_VERSION)).toBe('0.5.0')
    expect(await updatedSinceLastVisit(store, '0.5.0')).toBe(false)
  })

  it('tells a returning visitor once', async () => {
    const store = createMemoryStore({ [SEEN_VERSION]: '0.4.0' })
    expect(await updatedSinceLastVisit(store, '0.5.0')).toBe(true)
    // Not told yet (an invite took the visit), so the next visit asks again.
    expect(await updatedSinceLastVisit(store, '0.5.0')).toBe(true)
    await rememberVersion(store, '0.5.0')
    expect(await updatedSinceLastVisit(store, '0.5.0')).toBe(false)
  })

  it('tells someone who visited before versions were remembered', async () => {
    const store = createMemoryStore({ identity: { kept: true } })
    expect(await updatedSinceLastVisit(store, '0.5.0')).toBe(true)
  })

  it('says nothing after a rollback', async () => {
    const store = createMemoryStore({ [SEEN_VERSION]: '0.5.0' })
    expect(await updatedSinceLastVisit(store, '0.4.0')).toBe(false)
  })
})
