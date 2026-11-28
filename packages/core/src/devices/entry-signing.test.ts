// Chat and device-log entries against the signed-entries model
// (verification/models/signed-entries/model/conformance.ts): what each entry is signed over must
// be what the current release signs, and every signature, over any entry's bytes in either form
// or over something else Pigeon signs, must be taken exactly when the current release takes it.
import { describe, expect, it } from 'vitest'
import { checkEntrySigning } from '../../../../verification/models/signed-entries/model/conformance.ts'
import type { Entry } from '../../../../verification/models/signed-entries/model/entries.ts'
import { appendMessage, emptyLog, verifyEntry } from '../chat/chat-log.ts'
import { base32Encode, utf8Decode, utf8Encode } from '../encoding/bytes.ts'
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

/** `signer`, noting the bytes it signed last. */
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

/** The log an entry of `epoch` goes on: an empty one, or one a recovery handed to `writer`. */
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

/** Appends a device-log entry with the implementation, by its epoch's writer. */
async function append(
  log: DeviceLog,
  epoch: number,
  change: Parameters<typeof appendDeviceEntry>[3],
  at: number,
  signer: Signer = writerOf(epoch),
) {
  const result = await appendDeviceEntry(fakeCrypto, log, signer, change, at)
  if (!result.ok) throw new Error(result.error)
  return result.log
}

const lastEntry = (log: DeviceLog): DeviceEntry => {
  const entries = log.epochs?.at(-1)?.entries ?? log.entries
  const entry = entries.at(-1)
  if (entry === undefined) throw new Error('no entry')
  return entry
}

/** Each epoch's first entry, which second entries name as `prev`. */
const firsts = await Promise.all(
  [0, 1].map(async (epoch) =>
    append(await baseLog(epoch), epoch, { kind: 'add', device: device.id, name: 'Phone' }, AT),
  ),
)
const prevOf = (epoch: number) => lastEntry(firsts[epoch] as DeviceLog).sig

const ids = {
  identity: identity.id,
  device: device.id,
  writer: writer.id,
  author: author.id,
  log: 'chat-one',
  otherLog: 'chat-two',
  prev: [prevOf(0), prevOf(1)] as const,
}

/** `log` with its last epoch's (or its own) entries replaced. */
function withEntries(log: DeviceLog, entries: DeviceEntry[]): DeviceLog {
  const epochs = log.epochs
  if (epochs === undefined || epochs.length === 0) return { ...log, entries }
  const last = epochs.at(-1)
  if (last === undefined) return log
  return { ...log, epochs: [...epochs.slice(0, -1), { ...last, entries }] }
}

async function sign(entry: Entry): Promise<string> {
  if (entry.kind === 'chat') {
    const { signer, last } = recording(author)
    let log = emptyLog(entry.fields.log)
    for (let seq = 1; seq <= entry.fields.seq; seq++)
      log = (await appendMessage(log, signer, entry.fields.text, AT + seq)).log
    return last()
  }
  const { epoch, seq, kind, name } = entry.fields
  const { signer, last } = recording(writerOf(epoch))
  const before = seq === 1 ? await baseLog(epoch) : (firsts[epoch] as DeviceLog)
  await append(
    before,
    epoch,
    { kind, device: device.id, ...(name === undefined ? {} : { name }) },
    entry.fields.at,
    signer,
  )
  return last()
}

async function verify(entry: Entry, over: string): Promise<boolean> {
  if (entry.kind === 'chat') {
    const sig = base32Encode(await author.sign(utf8Encode(over)))
    const { log, ...fields } = entry.fields
    return verifyEntry(fakeCrypto, log, { ...fields, sig })
  }
  const { identity: _identity, epoch, name, ...fields } = entry.fields
  const sig = base32Encode(await writerOf(epoch).sign(utf8Encode(over)))
  const signed: DeviceEntry = { ...fields, ...(name === undefined ? {} : { name }), sig }
  const first = lastEntry(firsts[epoch] as DeviceLog)
  const base = await baseLog(epoch)
  return verifyDeviceLog(
    fakeCrypto,
    withEntries(base, fields.seq === 1 ? [signed] : [first, signed]),
  )
}

describe('entry signing, against the signed-entries model', () => {
  it('signs each entry as the current release does, and takes exactly what it takes', async () => {
    expect(await checkEntrySigning({ ids, sign, verify })).toEqual([])
  })
})
