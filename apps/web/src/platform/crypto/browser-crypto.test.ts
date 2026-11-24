import { isPeerId, parsePeerId } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import {
  createBrowserCrypto,
  generateIdentity,
  isStoredIdentity,
  signerFor,
} from './browser-crypto.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('browser crypto', () => {
  it('signs with a non-extractable key that verifies under its PeerId, and nothing else', async () => {
    const identity = await generateIdentity()
    expect(isStoredIdentity(identity)).toBe(true)
    expect(identity.privateKey.extractable).toBe(false)
    const signer = signerFor(identity)
    expect(isPeerId(signer.id)).toBe(true)

    const crypto = createBrowserCrypto()
    const signature = await signer.sign(bytes('coo'))
    expect(await crypto.verify(signer.id, signature, bytes('coo'))).toBe(true)
    expect(await crypto.verify(signer.id, signature, bytes('coo!'))).toBe(false)
    const other = signerFor(await generateIdentity())
    expect(await crypto.verify(other.id, signature, bytes('coo'))).toBe(false)
    expect(await crypto.verify('junk', signature, bytes('coo'))).toBe(false)
  })

  it('falls back to P-256 where Ed25519 is missing', async () => {
    const subtle = crypto.subtle
    const noEd25519 = new Proxy(subtle, {
      get(target, key) {
        if (key === 'generateKey')
          return (algorithm: AlgorithmIdentifier, ...rest: [boolean, KeyUsage[]]) =>
            (algorithm as Algorithm).name === 'Ed25519'
              ? Promise.reject(new Error('NotSupportedError'))
              : target.generateKey(algorithm as EcKeyGenParams, ...rest)
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const signer = signerFor(await generateIdentity(noEd25519))
    expect(parsePeerId(signer.id)).toMatchObject({ ok: true, value: { kind: 'p256' } })
    const signature = await signer.sign(bytes('coo'))
    expect(await createBrowserCrypto().verify(signer.id, signature, bytes('coo'))).toBe(true)
  })
})
