// Checks that chat and device-log entries sign canonical domain-separated bytes, reject replays
// across chats/epochs/kinds, tampered fields, or untyped bytes.
import { describe, expect, it } from 'vitest'
import { appendMessage, emptyLog, verifyEntry } from '../chat/chat-log.ts'
import { base32Encode, utf8Decode } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Signer } from '../identity/crypto.ts'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import {
  appendDeviceEntry,
  type DeviceEntry,
  type DeviceLog,
  emptyDeviceLog,
  recoverDeviceLog,
  setRecoveryKey,
  verifyDeviceLog,
} from './device-log.ts'

const identity = fakeSigner('identity')
const device = fakeSigner('device')
const writer = fakeSigner('writer')
const author = fakeSigner('author')
const recovery = fakeSigner('recovery')
const AT = 1000

function recording(signer: Signer) {
  let last: Uint8Array = new Uint8Array()
  return {
    signer: {
      id: signer.id,
      sign: async (data: Uint8Array) => {
        last = data
        return signer.sign(data)
      },
    } satisfies Signer,
    last: () => {
      const text = utf8Decode(last)
      if (!text.ok) throw new Error('signed bytes not UTF-8')
      return text.value
    },
  }
}

async function baseLog(epoch: number): Promise<DeviceLog> {
  const empty = emptyDeviceLog(identity.id)
  if (epoch === 0) return empty
  const committed = await setRecoveryKey(empty, identity, recovery.id, AT - 10)
  const keep = [{ device: writer.id, name: 'Writer' }]
  const next = fakeSigner('next recovery').id
  const recovered =
    committed &&
    (await recoverDeviceLog(
      identity.id,
      committed,
      recovery,
      { epoch: 1, writer: writer.id, keep, next },
      AT - 5,
    ))
  if (recovered === undefined) throw new Error('no recovery')
  return recovered
}

const writerOf = (epoch: number) => (epoch === 0 ? identity : writer)

function withEntries(log: DeviceLog, entries: DeviceEntry[]): DeviceLog {
  const epochs = log.epochs
  if (epochs === undefined || epochs.length === 0) return { ...log, entries }
  const last = epochs.at(-1)
  if (last === undefined) return log
  return { ...log, epochs: [...epochs.slice(0, -1), { ...last, entries }] }
}

const decodeText = (bytes: Uint8Array): string => {
  const text = utf8Decode(bytes)
  if (!text.ok) throw new Error('expected UTF-8 bytes')
  return text.value
}

describe('entry signing', () => {
  it('signs each entry as the current release does, and takes exactly what it takes', async () => {
    // Chat entries: typed signing, and refusal of untyped/cross-kind/tampered sigs.
    const recAuthor = recording(author)
    const chat = await appendMessage(emptyLog('chat-one'), recAuthor.signer, 'hello', AT + 1)
    const chatFields = {
      log: 'chat-one',
      author: author.id,
      seq: chat.entry.seq,
      lamport: chat.entry.lamport,
      at: chat.entry.at,
      text: chat.entry.text,
    }
    expect(recAuthor.last()).toBe(
      decodeText(canonicalBytes({ v: 'pigeon/chat-entry/v1', ...chatFields })),
    )
    expect(await verifyEntry(fakeCrypto, 'chat-one', chat.entry)).toBe(true)

    // Wrong chat room, no or wrong domain tag, or tampered field must be refused.
    expect(await verifyEntry(fakeCrypto, 'chat-two', chat.entry)).toBe(false)
    for (const bad of [
      canonicalBytes(chatFields),
      canonicalBytes({ v: 'pigeon/device-entry/v1', ...chatFields }),
      canonicalBytes({ v: 'pigeon/other/v1', ...chatFields }),
      canonicalBytes({ v: 'pigeon/chat-entry/v1', ...chatFields, text: 'tampered' }),
      canonicalBytes({ v: 'pigeon/chat-entry/v1', ...chatFields, seq: 99 }),
    ]) {
      const sig = base32Encode(await author.sign(bad))
      expect(await verifyEntry(fakeCrypto, 'chat-one', { ...chat.entry, sig })).toBe(false)
    }

    // Device-log entries across epoch 0 and epoch 1: typed signing, and isolation.
    for (const epoch of [0, 1] as const) {
      const signer = writerOf(epoch)
      const recWriter = recording(signer)
      const base = await baseLog(epoch)
      const appended = await appendDeviceEntry(
        fakeCrypto,
        base,
        recWriter.signer,
        { kind: 'add', device: device.id, name: 'Phone' },
        AT,
      )
      if (!appended.ok) throw new Error(appended.error)
      const entry = (appended.log.epochs?.at(-1)?.entries ?? appended.log.entries).at(-1)
      if (entry === undefined) throw new Error('missing entry')

      const deviceFields: Record<string, Json> = {
        identity: identity.id,
        seq: entry.seq,
        prev: entry.prev,
        kind: entry.kind,
        device: entry.device,
        ...(entry.name === undefined ? {} : { name: entry.name }),
        at: entry.at,
      }

      expect(recWriter.last()).toBe(
        decodeText(canonicalBytes({ v: 'pigeon/device-entry/v1', epoch, ...deviceFields })),
      )
      expect(await verifyDeviceLog(fakeCrypto, appended.log)).toBe(true)

      // Untyped, wrong epoch, wrong kind/context, wrong identity, or tampered fields: refused.
      for (const bad of [
        canonicalBytes(epoch === 0 ? deviceFields : { epoch, ...deviceFields }),
        canonicalBytes({ epoch, ...deviceFields }),
        canonicalBytes({
          v: 'pigeon/device-entry/v1',
          epoch: epoch === 0 ? 1 : 0,
          ...deviceFields,
        }),
        canonicalBytes({ v: 'pigeon/chat-entry/v1', epoch, ...deviceFields }),
        canonicalBytes({ v: 'pigeon/other/v1', epoch, ...deviceFields }),
        canonicalBytes({
          v: 'pigeon/device-entry/v1',
          epoch,
          ...deviceFields,
          identity: author.id,
        }),
        canonicalBytes({ v: 'pigeon/device-entry/v1', epoch, ...deviceFields, name: 'Tablet' }),
      ]) {
        const sig = base32Encode(await signer.sign(bad))
        expect(await verifyDeviceLog(fakeCrypto, withEntries(base, [{ ...entry, sig }]))).toBe(
          false,
        )
      }

      // Second entry in chain (`name` and `remove` kinds).
      const recSecond = recording(signer)
      const renamed = await appendDeviceEntry(
        fakeCrypto,
        appended.log,
        recSecond.signer,
        { kind: 'name', device: device.id, name: 'Laptop' },
        AT + 1,
      )
      if (!renamed.ok) throw new Error(renamed.error)
      const second = (renamed.log.epochs?.at(-1)?.entries ?? renamed.log.entries).at(-1)
      if (second === undefined) throw new Error('missing second entry')
      expect(recSecond.last()).toBe(
        decodeText(
          canonicalBytes({
            v: 'pigeon/device-entry/v1',
            epoch,
            identity: identity.id,
            seq: second.seq,
            prev: second.prev,
            kind: 'name',
            device: device.id,
            name: 'Laptop',
            at: AT + 1,
          }),
        ),
      )
      expect(await verifyDeviceLog(fakeCrypto, renamed.log)).toBe(true)

      const recThird = recording(signer)
      const removed = await appendDeviceEntry(
        fakeCrypto,
        renamed.log,
        recThird.signer,
        { kind: 'remove', device: device.id },
        AT + 2,
      )
      if (!removed.ok) throw new Error(removed.error)
      const third = (removed.log.epochs?.at(-1)?.entries ?? removed.log.entries).at(-1)
      if (third === undefined) throw new Error('missing third entry')
      expect(recThird.last()).toBe(
        decodeText(
          canonicalBytes({
            v: 'pigeon/device-entry/v1',
            epoch,
            identity: identity.id,
            seq: third.seq,
            prev: third.prev,
            kind: 'remove',
            device: device.id,
            at: AT + 2,
          }),
        ),
      )
      expect(await verifyDeviceLog(fakeCrypto, removed.log)).toBe(true)
    }
  })
})
