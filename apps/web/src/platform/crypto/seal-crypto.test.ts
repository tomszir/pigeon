import { bindSealingKey, openMail, sealMail, verifySealingKey } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { createBrowserCrypto, generateIdentity, signerFor } from './browser-crypto.ts'
import { createWebSealCrypto, generateSealingKey, sealerFor } from './seal-crypto.ts'

const hex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16))
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

/**
 * RFC 9180's published test vector for this suite: base mode, DHKEM(P-256, HKDF-SHA256)
 * (kem_id 16), HKDF-SHA256 (kdf_id 1), AES-256-GCM (aead_id 2), its first encryption. From
 * test-vectors.json in the CFRG's draft-irtf-cfrg-hpke repository, which the RFC names as where
 * its vectors are.
 */
const VECTOR = {
  info: hex('4f6465206f6e2061204772656369616e2055726e'),
  pkRm: hex(
    '04abc7e49a4c6b3566d77d0304addc6ed0e98512ffccf505e6a8e3eb25c685136f853148544876de76c0f2ef99cdc3a05ccf5ded7860c7c021238f9e2073d2356c',
  ),
  skRm: hex('317f915db7bc629c48fe765587897e01e282d3e8445f79f27f65d031a88082b2'),
  enc: hex(
    '04c06b4f6bebc7bb495cb797ab753f911aff80aefb86fd8b6fcc35525f3ab5f03e0b21bd31a86c6048af3cb2d98e0d3bf01da5cc4c39ff5370d331a4f1f7d5a4e0',
  ),
  aad: hex('436f756e742d30'),
  ct: hex(
    '58c61a45059d0c5704560e9d88b564a8b63f1364b8d1fcb3c4c6ddc1d291742465e902cd216f8908da49f8f96f',
  ),
  pt: hex('4265617574792069732074727574682c20747275746820626561757479'),
}

/** The vector's recipient key, held as a device's is: non-extractable, for deriveBits only. */
async function vectorKey() {
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: base64url(VECTOR.pkRm.subarray(1, 33)),
    y: base64url(VECTOR.pkRm.subarray(33)),
    d: base64url(VECTOR.skRm),
  }
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
  return { privateKey, publicKey: VECTOR.pkRm }
}

describe('HPKE with WebCrypto', () => {
  it('opens RFC 9180’s test vector with a key the page can’t read', async () => {
    const key = await vectorKey()
    expect(key.privateKey.extractable).toBe(false)
    const opened = await sealerFor(key).hpkeOpen(VECTOR.enc, VECTOR.info, VECTOR.aad, VECTOR.ct)
    expect(opened).toEqual(VECTOR.pt)
  })

  it('seals with the library to the vector’s key, and opens only under the same info and aad', async () => {
    const seal = createWebSealCrypto()
    const sealer = sealerFor(await vectorKey())
    const sealed = await seal.hpkeSeal(VECTOR.pkRm, VECTOR.info, VECTOR.aad, VECTOR.pt)
    expect(sealed.enc).toHaveLength(65)
    expect(sealed.enc[0]).toBe(4)
    expect(sealed.sealed).toHaveLength(VECTOR.pt.length + 16)
    expect(await sealer.hpkeOpen(sealed.enc, VECTOR.info, VECTOR.aad, sealed.sealed)).toEqual(
      VECTOR.pt,
    )
    const other = new Uint8Array([1])
    expect(await sealer.hpkeOpen(sealed.enc, other, VECTOR.aad, sealed.sealed)).toBeUndefined()
    expect(await sealer.hpkeOpen(sealed.enc, VECTOR.info, other, sealed.sealed)).toBeUndefined()
    const stranger = sealerFor(await generateSealingKey())
    expect(
      await stranger.hpkeOpen(sealed.enc, VECTOR.info, VECTOR.aad, sealed.sealed),
    ).toBeUndefined()
  })

  it('refuses to seal to a key that is no point on the curve', async () => {
    const seal = createWebSealCrypto()
    const flat = new Uint8Array(65).fill(7)
    flat[0] = 4
    await expect(seal.hpkeSeal(flat, VECTOR.info, VECTOR.aad, VECTOR.pt)).rejects.toThrow()
  })
})

describe('sealing with WebCrypto', () => {
  it('seals mail to real P-256 keys that only their devices can open', async () => {
    const crypto = createBrowserCrypto()
    const seal = createWebSealCrypto()
    const writer = signerFor(await generateIdentity())
    const phone = { signer: signerFor(await generateIdentity()), key: await generateSealingKey() }
    const other = await generateSealingKey()
    expect(phone.key.publicKey).toHaveLength(65)
    const binding = await bindSealingKey(phone.signer, sealerFor(phone.key))
    expect(await verifySealingKey(crypto, binding)).toBe(true)

    const letter = {
      kind: 'self' as const,
      sender: writer.id,
      to: phone.signer.id,
      date: '2026-11-25',
      id: 'x1234567',
      head: { epoch: 0, seq: 1 },
      at: 5,
      body: { hello: 'phone' },
    }
    const sealed = await sealMail(seal, writer, letter, [binding])
    if (!sealed.ok) throw new Error(sealed.error)
    const expected = { to: phone.signer.id, kinds: ['self' as const], dates: ['2026-11-25'] }
    const opened = await openMail(crypto, seal, sealerFor(phone.key), sealed.value.blob, expected)
    expect(opened.ok && opened.value.letter).toEqual({ ...letter, from: writer.id })
    expect(JSON.parse(atob(sealed.value.blob)).v).toBe(2)
    // To a key from a Pigeon from before HPKE, the older form, which opens too.
    const { hpke: _, ...older } = binding
    const old = await sealMail(seal, writer, letter, [older])
    if (!old.ok) throw new Error(old.error)
    expect(JSON.parse(atob(old.value.blob)).v).toBe(1)
    const openedOld = await openMail(crypto, seal, sealerFor(phone.key), old.value.blob, expected)
    expect(openedOld.ok && openedOld.value.letter).toEqual({ ...letter, from: writer.id })
    expect((await openMail(crypto, seal, sealerFor(other), sealed.value.blob, expected)).ok).toBe(
      false,
    )
    // A copy whose fresh key is the same point written compressed doesn't open: no second blob
    // id for the same letter.
    const outer = JSON.parse(atob(sealed.value.blob)) as { wraps: { e: string; w: string }[] }
    const compressed = outer.wraps.map((wrap) => {
      const e = Uint8Array.from(atob(wrap.e), (c) => c.charCodeAt(0))
      const prefix = (e[64] ?? 0) % 2 === 0 ? 2 : 3
      const short = new Uint8Array([prefix, ...e.subarray(1, 33)])
      return { ...wrap, e: btoa(String.fromCharCode(...short)) }
    })
    const copy = btoa(JSON.stringify({ ...outer, wraps: compressed }))
    expect((await openMail(crypto, seal, sealerFor(phone.key), copy, expected)).ok).toBe(false)
  })

  it('keeps a sealing key’s private half unreadable, even by the page', async () => {
    const key = await generateSealingKey()
    expect(key.privateKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('pkcs8', key.privateKey)).rejects.toThrow()
  })
})
