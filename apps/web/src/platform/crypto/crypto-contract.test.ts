// The web app's WebCrypto Crypto, SealCrypto and Sealer against core's crypto contract, which
// checks them with Wycheproof's vectors.
import { cryptoContract, sealContract } from '@pigeon/core/testing'
import { createBrowserCrypto } from './browser-crypto.ts'
import { createWebSealCrypto, sealerFor } from './seal-crypto.ts'

/** WebCrypto with a verify that takes every signature, for the contract's own-refusal checks. */
const permissive = new Proxy(crypto.subtle, {
  get(subtle, key) {
    if (key === 'verify') return async () => true
    const value = Reflect.get(subtle, key)
    return typeof value === 'function' ? value.bind(subtle) : value
  },
})

cryptoContract('browser WebCrypto', () => createBrowserCrypto(), {
  permissive: () => createBrowserCrypto(permissive),
})

sealContract('browser WebCrypto', {
  seal: () => createWebSealCrypto(),
  async sealer(jwk) {
    const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const
    const privateKey = await crypto.subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits'])
    // The public half isn't used to share; Wycheproof's keys carry it in the JWK anyway.
    return sealerFor({ privateKey, publicKey: new Uint8Array(65) })
  },
})
