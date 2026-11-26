// The Node Lighthouse's Crypto against core's crypto contract, which checks it with Wycheproof's
// vectors. A Lighthouse seals nothing, so only the Crypto half applies.
import { webcrypto } from 'node:crypto'
import { cryptoContract } from '@pigeon/core/testing'
import { createNodeCrypto } from './node-crypto.ts'

/** Node's WebCrypto with a verify that takes every signature, for the own-refusal checks. */
const permissive = new Proxy(webcrypto.subtle, {
  get(subtle, key) {
    if (key === 'verify') return async () => true
    const value = Reflect.get(subtle, key)
    return typeof value === 'function' ? value.bind(subtle) : value
  },
})

cryptoContract('Node Lighthouse', () => createNodeCrypto(), {
  permissive: () => createNodeCrypto(permissive),
})
