// The Worker Lighthouse's Crypto against core's crypto contract, which checks it with
// Wycheproof's vectors. A Lighthouse seals nothing, so only the Crypto half applies.
import { cryptoContract } from '@pigeon/core/testing'
import { createWorkerCrypto } from './worker-crypto.ts'

/** WebCrypto with a verify that takes every signature, for the contract's own-refusal checks. */
const permissive = new Proxy(crypto.subtle, {
  get(subtle, key) {
    if (key === 'verify') return async () => true
    const value = Reflect.get(subtle, key)
    return typeof value === 'function' ? value.bind(subtle) : value
  },
})

cryptoContract('Worker Lighthouse', () => createWorkerCrypto(), {
  permissive: () => createWorkerCrypto(permissive),
})
