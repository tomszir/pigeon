// The Store in IndexedDB: one object store of structured-cloned values, so CryptoKeys survive
// a reload without ever being exported.
import { createMemoryStore } from './memory-storage.ts'
import type { Store } from './storage.ts'

const DATABASE = 'pigeon'
const OBJECTS = 'kv'

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(OBJECTS)
  return done(request)
}

/**
 * Asks the browser not to clear Pigeon's storage when space runs low, since
 * losing it loses the identity. True when granted; some browsers ask the visitor first.
 */
export async function keepStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) === true
  } catch {
    return false
  }
}

/** IndexedDB when the browser allows it; otherwise memory, and `persistent` says so. */
export async function createBrowserStore(): Promise<{ store: Store; persistent: boolean }> {
  let database: IDBDatabase
  try {
    database = await openDatabase()
  } catch {
    return { store: createMemoryStore(), persistent: false }
  }
  const objects = (mode: IDBTransactionMode) =>
    database.transaction(OBJECTS, mode).objectStore(OBJECTS)
  return {
    persistent: true,
    store: {
      get: (key) => done(objects('readonly').get(key)),
      set: async (key, value) => void (await done(objects('readwrite').put(value, key))),
      delete: async (key) => void (await done(objects('readwrite').delete(key))),
      clear: async () => void (await done(objects('readwrite').clear())),
    },
  }
}
