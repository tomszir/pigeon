import { describe, expect, it } from 'vitest'
import { utf8Decode, utf8Encode } from '../encoding/bytes.ts'
import { canonicalBytes } from '../encoding/canonical.ts'
import { bindSealingKey } from '../mail/mail.ts'
import { fakeCrypto, fakeSealCrypto, fakeSigner } from '../testing/testing.ts'
import { cleanHandle, isHandle, MAX_MESSAGE_BYTES, openEnvelope, sealEnvelope } from './envelope.ts'

const rook = fakeSigner('rook')
const nonce = `${'a'.repeat(25)}q`
const binding = { nonce, local: '0'.repeat(64), remote: 'f'.repeat(64) }
const sealing = await bindSealingKey(rook, fakeSealCrypto().sealer('rook'))

describe('envelopes', () => {
  it('round-trips each body type', async () => {
    const bodies = [
      { type: 'hello', handle: 'Rook' },
      { type: 'hello', handle: 'Rook', avatar: 2 },
      { type: 'hello', handle: 'Rook', devices: true, instance: 'abcdefgh234567' },
      { type: 'hello', handle: 'Rook', binding },
      { type: 'nonce', nonce },
      { type: 'presence', status: 'away', message: 'brb' },
      { type: 'typing', active: true },
      { type: 'buzz' },
      { type: 'bye' },
      { type: 'log-sync', have: { [rook.id]: 3 } },
      { type: 'log-entries', entries: [] },
      { type: 'pake-start', via: 'code', pake: 'AAAA' },
      { type: 'pake-reply', pake: 'AAAA' },
      { type: 'pake-prove', mac: 'AAAA' },
      { type: 'pake-wrong' },
      { type: 'pair-offer', mac: 'AAAA', handle: 'Rook' },
      { type: 'pair-request', handle: 'Mika', sealing },
      { type: 'pair-accept', sealed: 'AAAA' },
      { type: 'pair-decline' },
      { type: 'link-offer', mac: 'AAAA', handle: 'Rook' },
      { type: 'link-request', sealing },
      { type: 'link-accept', part: 0, parts: 2, sealed: 'AAAA' },
    ] as const
    for (const body of bodies) {
      const bytes = await sealEnvelope(rook, 'pair:x', 1000, body)
      expect(await openEnvelope(fakeCrypto, 'pair:x', bytes)).toEqual({
        ok: true,
        value: { v: 1, from: rook.id, room: 'pair:x', at: 1000, body },
      })
    }
  })

  it('takes a nonce and a hello’s binding in one spelling only', async () => {
    const refused = [
      { type: 'nonce', nonce: nonce.toUpperCase() },
      // 16 bytes leave two bits over, which must be zero.
      { type: 'nonce', nonce: `${'a'.repeat(25)}b` },
      { type: 'nonce', nonce: 'a'.repeat(24) },
      { type: 'hello', handle: 'Rook', binding: { ...binding, local: 'F'.repeat(64) } },
      { type: 'hello', handle: 'Rook', binding: { ...binding, local: 'ff:'.repeat(32) } },
      { type: 'hello', handle: 'Rook', binding: { ...binding, remote: '0'.repeat(40) } },
      { type: 'hello', handle: 'Rook', binding: { ...binding, extra: 1 } },
      { type: 'hello', handle: 'Rook', binding: { local: binding.local, remote: binding.remote } },
    ]
    for (const body of refused) {
      const bytes = await sealEnvelope(rook, 'pair:x', 1, body as never)
      expect(await openEnvelope(fakeCrypto, 'pair:x', bytes)).toEqual({
        ok: false,
        error: 'malformed',
      })
    }
  })

  it('refuses an envelope replayed into another room', async () => {
    const bytes = await sealEnvelope(rook, 'pair:x', 0, { type: 'buzz' })
    expect(await openEnvelope(fakeCrypto, 'pair:y', bytes)).toEqual({
      ok: false,
      error: 'malformed',
    })
  })

  it('refuses a body changed after signing', async () => {
    const bytes = await sealEnvelope(rook, 'pair:x', 0, { type: 'typing', active: true })
    const text = utf8Decode(bytes)
    const parsed = JSON.parse(text.ok ? text.value : '')
    parsed.body.active = false
    expect(await openEnvelope(fakeCrypto, 'pair:x', canonicalBytes(parsed))).toEqual({
      ok: false,
      error: 'bad-signature',
    })
  })

  it('refuses unknown types, bad shapes, other versions, junk and oversize', async () => {
    const sealed = async (body: unknown, v = 1) => {
      const sig = 'aa'
      return canonicalBytes({ v, from: rook.id, room: 'pair:x', at: 0, body, sig } as never)
    }
    for (const bytes of [
      await sealed({ type: 'teleport' }),
      await sealed({ type: 'hello', handle: '' }),
      await sealed({ type: 'hello', handle: 'Rook', avatar: 0 }),
      await sealed({ type: 'hello', handle: 'Rook', avatar: 1.5 }),
      await sealed({ type: 'hello', handle: 'Rook', instance: 'not base32!' }),
      await sealed({ type: 'presence', status: 'asleep', message: '' }),
      await sealed({ type: 'buzz' }, 2),
      await sealed({ type: 'pake-start', via: 'guess', pake: 'AAAA' }),
      await sealed({ type: 'pair-request', handle: 'Mika' }),
      await sealed({ type: 'link-accept', part: 2, parts: 2, sealed: 'AAAA' }),
      await sealed({ type: 'link-accept', part: 0, parts: 5, sealed: 'AAAA' }),
      utf8Encode('not json'),
      Uint8Array.from([0xff]),
    ])
      expect((await openEnvelope(fakeCrypto, 'pair:x', bytes)).ok).toBe(false)
    expect(await openEnvelope(fakeCrypto, 'pair:x', new Uint8Array(MAX_MESSAGE_BYTES + 1))).toEqual(
      { ok: false, error: 'too-large' },
    )
  })
})

describe('names', () => {
  it('takes letters, spaces, accents and emoji, up to 32 characters', () => {
    for (const name of ['Rook', 'Mika Ren', 'Zoë', '😀👩‍💻', 'שלום', 'x'.repeat(32)])
      expect(isHandle(name), name).toBe(true)
  })

  it('refuses line breaks, control characters, reordering marks, blanks and long names', () => {
    const refused = [
      'Rook\nYou',
      'Rook\r',
      'Ro\tok',
      'Rook\u0000',
      'Rook\u0085',
      'Rook\u2028',
      'Rook\u2029',
      '\u202eRook',
      'Rook\u2066',
      'Rook\u200f',
      'Rook\u061c',
      '   ',
      '',
      'x'.repeat(33),
      42,
    ]
    for (const name of refused) expect(isHandle(name), JSON.stringify(name)).toBe(false)
  })

  it('cleans a name that arrives with them, once its signature is checked', async () => {
    for (const type of ['hello', 'profile', 'pair-request', 'pair-offer', 'link-offer'] as const) {
      const body =
        type === 'hello'
          ? { type, handle: 'Mika\n[9:41 AM] Rook\u202e' }
          : type === 'profile'
            ? { type, handle: 'Mika\n[9:41 AM] Rook\u202e', message: '', changedAt: 1 }
            : type === 'pair-request'
              ? { type, sealing, handle: 'Mika\n[9:41 AM] Rook\u202e' }
              : { type, mac: 'AAAA', handle: 'Mika\n[9:41 AM] Rook\u202e' }
      const bytes = await sealEnvelope(rook, 'pair:x', 1000, body as never)
      const opened = await openEnvelope(fakeCrypto, 'pair:x', bytes)
      expect(opened.ok && 'handle' in opened.value.body && opened.value.body.handle, type).toBe(
        'Mika[9:41 AM] Rook',
      )
    }
    const blank = await sealEnvelope(rook, 'pair:x', 1000, { type: 'hello', handle: '\u200f\n' })
    const opened = await openEnvelope(fakeCrypto, 'pair:x', blank)
    expect(opened.ok && opened.value.body).toEqual({ type: 'hello', handle: 'Friend' })
    const nobody = await sealEnvelope(rook, 'pair:x', 1000, {
      type: 'profile',
      handle: '\u200f',
      message: '',
      changedAt: 1,
    })
    expect((await openEnvelope(fakeCrypto, 'pair:x', nobody)).ok).toBe(false)
    const odd = await sealEnvelope(rook, 'pair:x', 1000, { type: 'buzz', handle: 5 } as never)
    expect((await openEnvelope(fakeCrypto, 'pair:x', odd)).ok).toBe(true)
  })

  it('takes the refused characters out of a name', () => {
    expect(cleanHandle(' \u202eRo\nok\u2066 ')).toBe('Rook')
    expect(cleanHandle('😀👩‍💻 Zoë')).toBe('😀👩‍💻 Zoë')
  })
})
