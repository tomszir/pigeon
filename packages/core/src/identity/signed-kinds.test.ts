// Every kind of object Pigeon signs says what it's for, in a `v` or a `type`, so no signature can
// be taken as another kind. This drives each signing function with a signer that records what it's asked to sign, so a kind that loses its marker fails here.
import { describe, expect, it } from 'vitest'
import { appendMessage, emptyLog } from '../chat/chat-log.ts'
import {
  appendDeviceEntry,
  emptyDeviceLog,
  recoverDeviceLog,
  setRecoveryKey,
} from '../devices/device-log.ts'
import { base32Encode, utf8Decode } from '../encoding/bytes.ts'
import { sealReply } from '../lighthouse/protocol.ts'
import { bindSealingKey, sealMail } from '../mail/mail.ts'
import { sealEnvelope } from '../messages/envelope.ts'
import { sealInviteCard } from '../pairing/mailed-invite.ts'
import { signRekey } from '../pairing/rekey.ts'
import { signEntry } from '../shared-log/entry.ts'
import { fakeCrypto, fakeSealCrypto, fakeSigner } from '../testing/testing.ts'
import type { Signer } from './crypto.ts'

/** A signer that keeps the field names of every object it signs, under the kind it's told. */
function recorder() {
  const shapes = new Map<string, Record<string, unknown>>()
  let kind = ''
  const wrap = (signer: Signer): Signer => ({
    id: signer.id,
    sign: async (data) => {
      const text = utf8Decode(data)
      if (!text.ok) throw new Error(`${kind}: not UTF-8`)
      shapes.set(kind, JSON.parse(text.value) as Record<string, unknown>)
      return signer.sign(data)
    },
  })
  const as = (name: string) => {
    kind = name
  }
  return { shapes, wrap, as }
}

const MARKERS = ['v', 'type']
const marker = (shape: Record<string, unknown>) => MARKERS.find((key) => key in shape)

describe('what Pigeon signs', () => {
  it('says what it is in every kind', async () => {
    const { shapes, wrap, as } = recorder()
    const rook = wrap(fakeSigner('rook'))
    const seal = fakeSealCrypto()
    const key = wrap(fakeSigner('recovery'))

    as('envelope')
    await sealEnvelope(rook, 'pair:x', 1, { type: 'typing' } as never)
    as('lighthouse-reply')
    await sealReply(rook, 1, { req: 1, nonce: 'n', request: 'r' } as never, { ok: true } as never)
    as('sealing-key')
    const sealing = await bindSealingKey(rook, seal.sealer('rook'))
    as('letter')
    const letter = {
      kind: 'farewell',
      sender: rook.id,
      to: rook.id,
      date: '2026-11-25',
      id: 'abc12345',
      head: { epoch: 0, seq: 1 },
      at: 1,
      body: {},
    } as const
    await sealMail(seal, rook, letter, [sealing])
    as('invite-card')
    await sealInviteCard(fakeCrypto, seal, rook, base32Encode(new Uint8Array(16).fill(7)), {
      identity: rook.id,
      deviceLog: emptyDeviceLog(rook.id),
      keys: [sealing],
      name: 'Rook',
      lighthouses: [],
      expires: 10,
      open: true,
    })
    as('rekey')
    await signRekey(rook, { replaces: 'pair', secret: 'secret', at: 1 } as never)
    as('chat-entry')
    await appendMessage(emptyLog('pair:x'), rook, 'hi', 1)
    as('device-entry')
    const phone = fakeSigner('phone').id
    const add = { kind: 'add', device: phone, name: 'Phone' } as const
    await appendDeviceEntry(fakeCrypto, emptyDeviceLog(rook.id), rook, add, 1)
    as('your-data-entry')
    await signEntry(rook, rook.id, 1, 1, { kind: 'setting', key: 'relay', value: true })
    as('recovery-key')
    const committed = await setRecoveryKey(emptyDeviceLog(rook.id), rook, key.id, 1)
    as('recover')
    const keep = [{ device: phone, name: 'Phone' }]
    await recoverDeviceLog(
      rook.id,
      committed,
      key,
      { epoch: 1, writer: phone, keep, next: key.id },
      2,
    )

    expect([...shapes.keys()].sort()).toEqual(
      [
        'envelope',
        'lighthouse-reply',
        'sealing-key',
        'letter',
        'invite-card',
        'rekey',
        'chat-entry',
        'device-entry',
        'recovery-key',
        'recover',
        'your-data-entry',
      ].sort(),
    )
    const unmarked = [...shapes].filter(([, shape]) => marker(shape) === undefined)
    expect(unmarked.map(([kind]) => kind)).toEqual([])
    // And every marker names one kind only.
    const named = [...shapes.values()].flatMap((shape) => {
      const field = marker(shape)
      return field === undefined ? [] : [String(shape[field])]
    })
    expect(new Set(named).size).toBe(named.length)
  })
})
