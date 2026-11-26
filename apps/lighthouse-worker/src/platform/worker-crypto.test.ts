import { isCanonicalSignature, peerIdFromPublicKey } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { createWorkerCrypto } from './worker-crypto.ts'

describe('checking a signature', () => {
  it('refuses the high-S spelling of a P-256 signature and takes the low-S one', async () => {
    const subtle = crypto.subtle
    const pair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const raw = (await subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer
    const id = peerIdFromPublicKey(new Uint8Array(raw))
    const data = new TextEncoder().encode('hello')
    const verifier = createWorkerCrypto(subtle)
    const seen = new Set<boolean>()
    // WebCrypto gives either spelling, about half each.
    for (let tries = 0; tries < 64 && seen.size < 2; tries += 1) {
      const signature = new Uint8Array(
        await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data),
      )
      const low = isCanonicalSignature(id, signature)
      seen.add(low)
      expect(await verifier.verify(id, signature, data)).toBe(low)
    }
    expect(seen.size).toBe(2)
  })
})
