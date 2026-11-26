import { describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  base64Decode,
  base64Encode,
  utf8Decode,
  utf8Encode,
} from '../encoding/bytes.ts'
import { MAX_BLOB_BYTES } from '../lighthouse/protocol.ts'
import { fakeCrypto, fakeSealCrypto, fakeSigner } from '../testing/testing.ts'
import {
  bindSealingKey,
  dropHashes,
  type Letter,
  type MailExpected,
  mailTag,
  openMail,
  sealingKeyToKeep,
  sealMail,
  utcDate,
  verifySealingKey,
} from './mail.ts'

const seal = fakeSealCrypto()
const rook = fakeSigner('rook-laptop')
const mika = fakeSigner('mika')
const mikaLaptop = { signer: fakeSigner('mika-laptop'), sealer: seal.sealer('mika-laptop') }
const mikaPhone = { signer: fakeSigner('mika-phone'), sealer: seal.sealer('mika-phone') }
const stranger = seal.sealer('stranger')

const letter: Omit<Letter, 'from'> = {
  kind: 'farewell',
  sender: fakeSigner('rook').id,
  to: mika.id,
  date: '2026-11-25',
  id: 'abc12345',
  head: { epoch: 0, seq: 2 },
  at: 1_000,
  body: { note: 'goodbye' },
}
const expected: MailExpected = { to: mika.id, kinds: ['farewell'], dates: ['2026-11-25'] }

const keysOf = async () => [
  await bindSealingKey(mikaLaptop.signer, mikaLaptop.sealer),
  await bindSealingKey(mikaPhone.signer, mikaPhone.sealer),
]

const json = (blob: string) => {
  const bytes = base64Decode(blob)
  if (!bytes.ok) throw new Error('bad blob')
  const text = utf8Decode(bytes.value)
  if (!text.ok) throw new Error('bad blob')
  return JSON.parse(text.value) as Record<string, unknown>
}
const blobOf = (value: unknown) => base64Encode(utf8Encode(JSON.stringify(value)))

describe('mail tags', () => {
  it('differ by secret, recipient and day, and look like a Lighthouse tag', async () => {
    const secret = new Uint8Array(32).fill(1)
    const tag = await mailTag(fakeCrypto, secret, letter.to, '2026-11-25')
    expect(tag).toMatch(/^[a-z2-7]{52}$/)
    expect(await mailTag(fakeCrypto, secret, letter.to, '2026-11-26')).not.toBe(tag)
    expect(await mailTag(fakeCrypto, secret, rook.id, '2026-11-25')).not.toBe(tag)
    expect(await mailTag(fakeCrypto, new Uint8Array(32).fill(2), letter.to, '2026-11-25')).not.toBe(
      tag,
    )
    expect(utcDate(Date.UTC(2026, 10, 25, 23, 59))).toBe('2026-11-25')
  })
})

describe('sealing keys', () => {
  it('are bound to their device by its own signature', async () => {
    const binding = await bindSealingKey(mikaPhone.signer, mikaPhone.sealer)
    expect(await verifySealingKey(fakeCrypto, binding)).toBe(true)
    expect(await verifySealingKey(fakeCrypto, { ...binding, device: rook.id })).toBe(false)
    const other = base64Encode(stranger.publicKey)
    expect(await verifySealingKey(fakeCrypto, { ...binding, key: other })).toBe(false)
  })

  it('say the device opens HPKE with a second signature, which must hold when it is there', async () => {
    const binding = await bindSealingKey(mikaPhone.signer, mikaPhone.sealer)
    expect(binding.hpke).toBeDefined()
    // A Pigeon from before HPKE sends the key alone, which still holds.
    const { hpke: _, ...old } = binding
    expect(await verifySealingKey(fakeCrypto, old)).toBe(true)
    // The first signature can't stand in for the second, nor another device's for this one's.
    expect(await verifySealingKey(fakeCrypto, { ...binding, hpke: binding.sig })).toBe(false)
    const other = await bindSealingKey(mikaLaptop.signer, mikaLaptop.sealer)
    expect(await verifySealingKey(fakeCrypto, { ...binding, hpke: other.hpke ?? '' })).toBe(false)
    expect(await verifySealingKey(fakeCrypto, { ...binding, hpke: 'not base32!' })).toBe(false)
  })

  it('keep their HPKE claim when an older copy of the same key comes', async () => {
    const binding = await bindSealingKey(mikaPhone.signer, mikaPhone.sealer)
    const { hpke: _, ...older } = binding
    expect(sealingKeyToKeep(binding, older)).toBe(binding)
    expect(sealingKeyToKeep(older, binding)).toBe(binding)
    expect(sealingKeyToKeep(undefined, older)).toBe(older)
    // A new key is taken, claim or not.
    const { hpke: __, ...replaced } = await bindSealingKey(mikaPhone.signer, stranger)
    expect(sealingKeyToKeep(binding, replaced)).toBe(replaced)
    // Nor does a claim stick to another device's binding that happens to name the same key.
    const elsewhere = { ...older, device: mikaLaptop.signer.id }
    expect(sealingKeyToKeep(binding, elsewhere)).toBe(elsewhere)
  })
})

describe('mail', () => {
  it('is sealed with HPKE when every device says it opens it, and the older form otherwise', async () => {
    const [laptop, phone] = await keysOf()
    if (laptop === undefined || phone === undefined) throw new Error('no keys')
    const { hpke: _, ...oldPhone } = phone
    const hpke = await sealMail(seal, rook, letter, [laptop, phone])
    const older = await sealMail(seal, rook, letter, [laptop, oldPhone])
    if (!hpke.ok || !older.ok) throw new Error('not sealed')
    expect(json(hpke.value.blob)['v']).toBe(2)
    // The form every Pigeon opens, as it always was.
    const outer = json(older.value.blob)
    expect(outer['v']).toBe(1)
    expect(Object.keys(outer).sort()).toEqual(['commit', 'content', 'v', 'wraps'])
    for (const sealed of [hpke.value, older.value])
      for (const [i, device] of [mikaLaptop, mikaPhone].entries())
        expect(await openMail(fakeCrypto, seal, device.sealer, sealed.blob, expected)).toEqual({
          ok: true,
          value: { letter: { ...letter, from: rook.id }, drop: sealed.drops[i]?.value },
        })
  })

  it('opens neither form as the other', async () => {
    const [laptop, phone] = await keysOf()
    if (laptop === undefined || phone === undefined) throw new Error('no keys')
    const { hpke: _, ...oldPhone } = phone
    for (const devices of [
      [laptop, phone],
      [laptop, oldPhone],
    ]) {
      const sealed = await sealMail(seal, rook, letter, devices)
      if (!sealed.ok) throw new Error(sealed.error)
      const outer = json(sealed.value.blob)
      const relabelled = blobOf({ ...outer, v: outer['v'] === 1 ? 2 : 1 })
      expect(await openMail(fakeCrypto, seal, mikaLaptop.sealer, relabelled, expected)).toEqual({
        ok: false,
        error: 'not-for-this-device',
      })
      expect(
        (await openMail(fakeCrypto, seal, mikaLaptop.sealer, blobOf({ ...outer, v: 3 }), expected))
          .ok,
      ).toBe(false)
    }
  })

  it('refuses a letter committed as one kind and signed as another', async () => {
    // A sender whose commitment says `letter` while the letter inside says `farewell`.
    const lying = {
      ...seal,
      hkdf: (ikm: Uint8Array, info: string, length: number) =>
        seal.hkdf(ikm, info.replace(/\/farewell$/, '/letter'), length),
    }
    const sealed = await sealMail(lying, rook, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    const both = { ...expected, kinds: ['farewell', 'letter'] as const }
    expect(await openMail(fakeCrypto, seal, mikaLaptop.sealer, sealed.value.blob, both)).toEqual({
      ok: false,
      error: 'malformed',
    })
  })

  it('opens each HPKE wrap once, however many kinds the mailbox holds', async () => {
    const sealed = await sealMail(seal, rook, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    let opens = 0
    const counting = {
      ...stranger,
      hpkeOpen: (...args: Parameters<typeof stranger.hpkeOpen>) => {
        opens += 1
        return stranger.hpkeOpen(...args)
      },
    }
    const kinds = ['self', 'receipt', 'letter', 'rekey'] as const
    expect(
      await openMail(fakeCrypto, seal, counting, sealed.value.blob, { ...expected, kinds }),
    ).toEqual({ ok: false, error: 'not-for-this-device' })
    expect(opens).toBe(2)
  })

  it('refuses a commitment to no kind at all', async () => {
    const odd = {
      ...seal,
      hkdf: (ikm: Uint8Array, _info: string, length: number) =>
        seal.hkdf(ikm, 'pigeon/mail/v2/commit/nothing', length),
    }
    const sealed = await sealMail(odd, rook, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    expect(
      await openMail(fakeCrypto, seal, mikaLaptop.sealer, sealed.value.blob, expected),
    ).toEqual({
      ok: false,
      error: 'malformed',
    })
  })

  it('binds each HPKE wrap to its blob’s commitment', async () => {
    const one = await sealMail(seal, rook, letter, await keysOf())
    const two = await sealMail(seal, rook, { ...letter, id: 'def67890' }, await keysOf())
    if (!one.ok || !two.ok) throw new Error('not sealed')
    // One letter's wraps beside another's commitment and content open nothing.
    const moved = { ...json(two.value.blob), wraps: json(one.value.blob)['wraps'] }
    expect(await openMail(fakeCrypto, seal, mikaLaptop.sealer, blobOf(moved), expected)).toEqual({
      ok: false,
      error: 'not-for-this-device',
    })
  })

  it('opens on each recipient device, signed by the device that wrote it', async () => {
    const sealed = await sealMail(seal, rook, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    for (const [i, device] of [mikaLaptop, mikaPhone].entries()) {
      const opened = await openMail(fakeCrypto, seal, device.sealer, sealed.value.blob, expected)
      expect(opened).toEqual({
        ok: true,
        value: { letter: { ...letter, from: rook.id }, drop: sealed.value.drops[i]?.value },
      })
    }
  })

  it('opens nowhere else, and names no device or person', async () => {
    const sealed = await sealMail(seal, rook, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    expect(await openMail(fakeCrypto, seal, stranger, sealed.value.blob, expected)).toEqual({
      ok: false,
      error: 'not-for-this-device',
    })
    const text = JSON.stringify(json(sealed.value.blob))
    for (const id of [mikaLaptop.signer.id, mikaPhone.signer.id, rook.id, letter.to, letter.sender])
      expect(text).not.toContain(id)
  })

  it('refuses mail that is not what this mailbox holds', async () => {
    const sealed = await sealMail(seal, rook, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    for (const other of [
      { ...expected, to: rook.id },
      { ...expected, kinds: ['self' as const, 'letter' as const] },
      { ...expected, dates: ['2026-11-20'] },
    ])
      expect(await openMail(fakeCrypto, seal, mikaLaptop.sealer, sealed.value.blob, other)).toEqual(
        { ok: false, error: 'unexpected' },
      )
  })

  it('gives the Lighthouse sorted hashes of the drops, as it hashes the drop it is sent', async () => {
    const sealed = await sealMail(seal, rook, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    const hashes = await dropHashes(fakeCrypto, sealed.value)
    expect(hashes).toEqual([...hashes].sort())
    const value = base32Decode(sealed.value.drops[0]?.value ?? '')
    if (!value.ok) throw new Error('bad drop')
    expect(hashes).toContain(base32Encode(await fakeCrypto.sha256(value.value)))
    expect(hashes).not.toContain(sealed.value.drops[0]?.value)
  })

  it('skips a device whose key is no point, sealing to the rest', async () => {
    const [good] = await keysOf()
    const broken = {
      ...(await bindSealingKey(rook, stranger)),
      key: base64Encode(new Uint8Array(65)),
    }
    const sealed = await sealMail(seal, rook, letter, [broken, good ?? broken])
    expect(sealed.ok && sealed.value.skipped).toEqual([rook.id])
    expect(await sealMail(seal, rook, letter, [broken])).toEqual({ ok: false, error: 'no-devices' })
  })

  it('refuses a letter whose signature is not its writer’s', async () => {
    // A forger seals a letter that claims Rook's laptop wrote it.
    const forger = { id: rook.id, sign: fakeSigner('forger').sign }
    const sealed = await sealMail(seal, forger, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    expect(
      await openMail(fakeCrypto, seal, mikaLaptop.sealer, sealed.value.blob, expected),
    ).toEqual({ ok: false, error: 'bad-signature' })
  })

  it('refuses a blob whose commitment or content was changed', async () => {
    const sealed = await sealMail(seal, rook, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    const outer = json(sealed.value.blob)
    const flip = (text: string) => `${text[0] === 'A' ? 'B' : 'A'}${text.slice(1)}`
    for (const changed of [
      { ...outer, commit: flip(String(outer['commit'])) },
      { ...outer, content: flip(String(outer['content'])) },
      { ...outer, commit: undefined },
    ])
      expect(
        (await openMail(fakeCrypto, seal, mikaLaptop.sealer, blobOf(changed), expected)).ok,
      ).toBe(false)
  })

  it('takes only an uncompressed point as the fresh key', async () => {
    const sealed = await sealMail(seal, rook, letter, await keysOf())
    if (!sealed.ok) throw new Error(sealed.error)
    const outer = json(sealed.value.blob)
    const wraps = (outer['wraps'] as { e: string; w: string }[]).map((wrap) => {
      const e = base64Decode(wrap.e)
      return { ...wrap, e: e.ok ? base64Encode(e.value.subarray(0, 33)) : wrap.e }
    })
    expect(
      await openMail(fakeCrypto, seal, mikaLaptop.sealer, blobOf({ ...outer, wraps }), expected),
    ).toEqual({ ok: false, error: 'not-for-this-device' })
  })

  it('refuses one too big to put, and short ids', async () => {
    expect(
      await sealMail(seal, rook, { ...letter, body: 'x'.repeat(MAX_BLOB_BYTES) }, await keysOf()),
    ).toEqual({ ok: false, error: 'too-big' })
    const short = await sealMail(seal, rook, { ...letter, id: 'abc' }, await keysOf())
    if (!short.ok) throw new Error(short.error)
    expect(await openMail(fakeCrypto, seal, mikaLaptop.sealer, short.value.blob, expected)).toEqual(
      { ok: false, error: 'malformed' },
    )
  })
})
