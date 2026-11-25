import { bindSealingKey, openMail, sealMail, verifySealingKey } from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { createBrowserCrypto, generateIdentity, signerFor } from './browser-crypto.ts'
import { createWebSealCrypto, generateSealingKey, sealerFor } from './seal-crypto.ts'

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
