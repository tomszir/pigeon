import { describe, expect, it } from 'vitest'
import { utf8Decode, utf8Encode } from '../encoding/bytes.ts'
import { canonicalBytes } from '../encoding/canonical.ts'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import { MAX_MESSAGE_BYTES, openEnvelope, sealEnvelope } from './envelope.ts'

const rook = fakeSigner('rook')

describe('envelopes', () => {
  it('round-trips each body type', async () => {
    const bodies = [
      { type: 'hello', handle: 'Rook' },
      { type: 'hello', handle: 'Rook', avatar: 2 },
      { type: 'hello', handle: 'Rook', devices: true, instance: 'abcdefgh234567' },
      { type: 'presence', status: 'away', message: 'brb' },
      { type: 'typing', active: true },
      { type: 'buzz' },
      { type: 'bye' },
      { type: 'log-sync', have: { [rook.id]: 3 } },
      { type: 'log-entries', entries: [] },
      { type: 'pair-request', code: 'abc', handle: 'Mika' },
      { type: 'pair-offer', code: 'abc', handle: 'Rook' },
      { type: 'pair-confirm', code: 'abc' },
      { type: 'pair-accept', code: 'abc' },
    ] as const
    for (const body of bodies) {
      const bytes = await sealEnvelope(rook, 'pair:x', 1000, body)
      expect(await openEnvelope(fakeCrypto, 'pair:x', bytes)).toEqual({
        ok: true,
        value: { v: 1, from: rook.id, room: 'pair:x', at: 1000, body },
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
      utf8Encode('not json'),
      Uint8Array.from([0xff]),
    ])
      expect((await openEnvelope(fakeCrypto, 'pair:x', bytes)).ok).toBe(false)
    expect(await openEnvelope(fakeCrypto, 'pair:x', new Uint8Array(MAX_MESSAGE_BYTES + 1))).toEqual(
      { ok: false, error: 'too-large' },
    )
  })
})
