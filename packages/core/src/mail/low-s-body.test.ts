import { describe, expect, it } from 'vitest'
import { appendMessage, emptyLog, mergeEntries } from '../chat/chat-log.ts'
import {
  appendDeviceEntry,
  type DeviceLog,
  emptyDeviceLog,
  speakerIdentity,
} from '../devices/device-log.ts'
import { base32DecodeExact } from '../encoding/bytes.ts'
import type { Json } from '../encoding/canonical.ts'
import { isHighS, p256Crypto, p256Signer } from '../testing/p256.ts'
import { fakeSealCrypto, fakeSigner } from '../testing/testing.ts'
import { lowSBody } from './low-s-body.ts'
import { bindSealingKey, verifySealingKey } from './mail.ts'

const high = (sig: string) => {
  const bytes = base32DecodeExact(sig)
  return bytes.ok && isHighS(bytes.value)
}

describe('a kept letter body', () => {
  it('goes out with what a Pigeon from before low-S signed, spelled low-S and taken', async () => {
    const old = await p256Signer('high')
    const strict = p256Crypto()
    const added = await appendDeviceEntry(
      strict,
      emptyDeviceLog(old.id),
      old,
      { kind: 'add', device: fakeSigner('d2').id, name: 'D2' },
      1,
    )
    if (!added.ok) throw new Error(added.error)
    const chat = (await appendMessage(emptyLog('pair:x'), old, 'queued before', 0)).log
    const key = await bindSealingKey(old, fakeSealCrypto().sealer('old'))
    const body = {
      answer: 'added',
      deviceLog: added.log,
      keys: [key],
      log: 'pair:x',
      entries: chat.entries,
    } as unknown as Json
    expect(high(added.log.entries[0]?.sig ?? '')).toBe(true)
    expect(high(key.sig)).toBe(true)
    // As it was kept: each signed part is refused by a Pigeon that takes only low-S.
    expect(
      await speakerIdentity(strict, old.id, { identity: old.id, devices: added.log }),
    ).toBeUndefined()
    expect(await verifySealingKey(strict, key)).toBe(false)

    const sent = lowSBody(body) as unknown as {
      answer: string
      deviceLog: DeviceLog
      keys: (typeof key)[]
      entries: typeof chat.entries
    }
    expect(sent.answer).toBe('added')
    expect(
      await speakerIdentity(strict, old.id, { identity: old.id, devices: sent.deviceLog }),
    ).toBe(old.id)
    expect(sent.keys[0] !== undefined && (await verifySealingKey(strict, sent.keys[0]))).toBe(true)
    const taken = await mergeEntries(strict, emptyLog('pair:x'), sent.entries, new Set([old.id]))
    expect(taken.entries.map((entry) => entry.text)).toEqual(['queued before'])
    expect(lowSBody(sent as unknown as Json)).toEqual(sent)
  })
})
