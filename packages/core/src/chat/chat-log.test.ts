import { describe, expect, it } from 'vitest'
import { base32DecodeExact, base32Encode } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import { isHighS, p256Crypto, p256Signer } from '../testing/p256.ts'
import { fakeCrypto, fakeSigner, untypedSigner } from '../testing/testing.ts'
import {
  appendMessage,
  batchEntries,
  type ChatLog,
  emptyLog,
  entryKey,
  isLogEntry,
  type LogEntry,
  MAX_LAMPORT_LEAD,
  mergeEntries,
  missingFrom,
  sameEntry,
  summarize,
} from './chat-log.ts'

const rook = fakeSigner('rook')
const mika = fakeSigner('mika')
const both = new Set([rook.id, mika.id])

async function write(log: ChatLog, ...lines: [typeof rook, string][]): Promise<ChatLog> {
  let next = log
  for (const [signer, text] of lines) next = (await appendMessage(next, signer, text, 0)).log
  return next
}

/** An entry signed with any Lamport time, as a friend making one up could. */
async function signed(
  signer: typeof rook,
  log: string,
  seq: number,
  lamport: number,
  text: string,
): Promise<LogEntry> {
  const unsigned = { author: signer.id, seq, lamport, at: 0, text }
  const sig = await signer.sign(canonicalBytes({ log, ...unsigned }))
  return { ...unsigned, sig: base32Encode(sig) }
}

describe('appendMessage', () => {
  it('numbers each author from 1 and advances the Lamport clock past everything held', async () => {
    const log = await write(emptyLog('pair:x'), [rook, 'hi'], [mika, 'hey'], [rook, 'buzz?'])
    expect(log.entries.map((e) => [e.text, e.seq, e.lamport])).toEqual([
      ['hi', 1, 1],
      ['hey', 1, 2],
      ['buzz?', 2, 3],
    ])
  })
})

describe('sync', () => {
  it('converges two diverged copies to the same sorted view', async () => {
    const start = await write(emptyLog('pair:x'), [rook, 'one'])
    const rooks = await write(start, [rook, 'two'], [rook, 'three'])
    const mikas = await write(start, [mika, 'uno'])

    const toMika = missingFrom(rooks, summarize(mikas))
    const toRook = missingFrom(mikas, summarize(rooks))
    expect(toMika.map((e) => e.text)).toEqual(['two', 'three'])
    expect(toRook.map((e) => e.text)).toEqual(['uno'])

    const mikaAfter = await mergeEntries(fakeCrypto, mikas, toMika, both)
    const rookAfter = await mergeEntries(fakeCrypto, rooks, toRook, both)
    expect(mikaAfter.entries).toEqual(rookAfter.entries)
    expect(summarize(mikaAfter)).toEqual({ [rook.id]: 3, [mika.id]: 1 })
  })

  it('summarizes only the contiguous run, so a gap is asked for again', async () => {
    const full = await write(emptyLog('pair:x'), [rook, 'a'], [rook, 'b'], [rook, 'c'])
    const gappy: ChatLog = { ...full, entries: full.entries.filter((e) => e.seq !== 2) }
    expect(summarize(gappy)).toEqual({ [rook.id]: 1 })
    expect(missingFrom(full, summarize(gappy)).map((e) => e.seq)).toEqual([2, 3])
  })
})

describe('mergeEntries', () => {
  it('drops forged, tampered, foreign-log and stranger entries', async () => {
    const theirs = await write(emptyLog('pair:x'), [mika, 'real'])
    const real = theirs.entries[0] as LogEntry
    const elsewhere = (await appendMessage(emptyLog('pair:y'), mika, 'replayed', 0)).entry
    const stranger = (await appendMessage(emptyLog('pair:x'), fakeSigner('eve'), 'hi', 0)).entry

    const merged = await mergeEntries(
      fakeCrypto,
      emptyLog('pair:x'),
      [{ ...real, text: 'tampered' }, elsewhere, stranger, { ...real, author: rook.id }, real],
      both,
    )
    expect(merged.entries).toEqual([real])
  })

  it('keeps the first entry seen for a seq', async () => {
    const first = (await appendMessage(emptyLog('pair:x'), mika, 'first', 0)).entry
    const second = (await appendMessage(emptyLog('pair:x'), mika, 'second', 5)).entry
    const merged = await mergeEntries(fakeCrypto, emptyLog('pair:x'), [first, second], both)
    expect(merged.entries.map((e) => e.text)).toEqual(['first'])
  })

  it('takes a made-up Lamport time, but leaves it out of the clock', async () => {
    const log = await write(emptyLog('pair:x'), [rook, 'hi'])
    const poisoned = await signed(mika, 'pair:x', 1, Number.MAX_SAFE_INTEGER, 'poison')
    const unsafe = await signed(mika, 'pair:x', 2, Number.MAX_SAFE_INTEGER + 1, 'unsafe')
    const merged = await mergeEntries(fakeCrypto, log, [poisoned, unsafe], both)
    expect(merged.entries.map((e) => e.text)).toEqual(['hi', 'poison'])

    const { log: after, entry } = await appendMessage(merged, rook, 'still here', 0)
    expect(entry.lamport).toBe(2)
    expect(isLogEntry(entry)).toBe(true)
    // A peer that took the made-up time takes this one too.
    const theirs = await mergeEntries(
      fakeCrypto,
      merged,
      missingFrom(after, summarize(merged)),
      both,
    )
    expect(theirs.entries.map((e) => e.text)).toEqual(['hi', 'still here', 'poison'])
  })

  it('follows honest times, however far one device is behind', async () => {
    const entries = await Promise.all([1, 2, 3].map((n) => signed(mika, 'pair:x', n, n, `m${n}`)))
    const merged = await mergeEntries(fakeCrypto, emptyLog('pair:x'), entries, both)
    expect((await appendMessage(merged, rook, 'next', 0)).entry.lamport).toBe(4)
  })

  it('writes a reply after its question when only the asker holds a made-up time', async () => {
    // Mika sends the phone a far-ahead entry and the laptop nothing; the laptop gets the
    // phone's question by letter, without it.
    const phone = fakeSigner('phone')
    const laptop = fakeSigner('laptop')
    const devices = new Set([phone.id, laptop.id, mika.id])
    const shared = await write(emptyLog('pair:x'), [mika, 'm0'], [mika, 'm1'], [mika, 'm2'])
    const poison = await signed(mika, 'pair:x', 4, Number.MAX_SAFE_INTEGER, 'poison')
    const phones = await mergeEntries(fakeCrypto, shared, [poison], devices)
    const { entry: question } = await appendMessage(phones, phone, 'question', 0)
    const laptops = await mergeEntries(fakeCrypto, shared, [question], devices)
    const { entry: answer } = await appendMessage(laptops, laptop, 'answer', 0)
    expect(answer.lamport).toBeGreaterThan(question.lamport)
  })

  it("keeps a device's replies after what they answer when a friend tells devices apart", async () => {
    // Mika sends the phone her seqs 1 and 2 at far-ahead times, and the laptop low ones.
    const phone = fakeSigner('phone')
    const laptop = fakeSigner('laptop')
    const devices = new Set([phone.id, laptop.id, mika.id])
    const shared = await write(emptyLog('pair:x'), [phone, 'hi'])
    const high = [MAX_LAMPORT_LEAD, 2 * MAX_LAMPORT_LEAD]
    let phones = await mergeEntries(
      fakeCrypto,
      shared,
      await Promise.all(high.map((t, i) => signed(mika, 'pair:x', i + 1, t, 'to phone'))),
      devices,
    )
    let laptops = await mergeEntries(
      fakeCrypto,
      shared,
      await Promise.all([2, 3].map((t, i) => signed(mika, 'pair:x', i + 1, t, 'to laptop'))),
      devices,
    )
    phones = (await appendMessage(phones, phone, 'question', 0)).log
    laptops = await mergeEntries(
      fakeCrypto,
      laptops,
      missingFrom(phones, summarize(laptops)),
      devices,
    )
    const { entry: answer } = await appendMessage(laptops, laptop, 'answer', 0)
    const question = phones.entries.find((e) => e.text === 'question') as LogEntry
    expect(answer.lamport).toBeGreaterThan(question.lamport)
  })

  it('leaves out of a catch-up a time a log already holds past a safe integer', async () => {
    // As a log could hold from before: the friend's entry, then your own reply to it, appended
    // locally past a safe integer.
    const huge = await signed(mika, 'pair:x', 1, Number.MAX_SAFE_INTEGER, 'poison')
    const reply = await signed(rook, 'pair:x', 1, Number.MAX_SAFE_INTEGER + 1, 'reply')
    const log: ChatLog = { id: 'pair:x', entries: [huge, reply] }
    const { log: after, entry } = await appendMessage(log, rook, 'hi', 0)
    expect(entry.lamport).toBe(1)
    expect(missingFrom(after, { [mika.id]: 1 })).toEqual([entry])
  })
})

describe('an entry’s signed bytes', () => {
  it('are signed saying they’re a chat entry, and taken as Pigeons before 0.8.4 signed them too', async () => {
    const signedBy = async (signer: typeof rook, bytes: (u: object) => Uint8Array) => {
      const { entry } = await appendMessage(emptyLog('pair:x'), signer, 'hi', 5)
      const { sig, ...unsigned } = entry
      const signature = base32DecodeExact(sig)
      const holds =
        signature.ok && (await fakeCrypto.verify(rook.id, signature.value, bytes(unsigned)))
      const taken = await mergeEntries(fakeCrypto, emptyLog('pair:x'), [entry], both)
      return holds && taken.entries.length === 1
    }
    // Signed saying what it is, and of which chat.
    expect(
      await signedBy(rook, (u) =>
        canonicalBytes({
          v: 'pigeon/chat-entry/v1',
          log: 'pair:x',
          ...(u as Record<string, Json>),
        }),
      ),
    ).toBe(true)
    // One a Pigeon from before 0.8.4 signed, with no `v`, is taken too.
    expect(
      await signedBy(untypedSigner(rook), (u) =>
        canonicalBytes({ log: 'pair:x', ...(u as Record<string, Json>) }),
      ),
    ).toBe(true)
  })

  it('are taken in either shape, and in no other', async () => {
    const unsigned = { author: mika.id, seq: 1, lamport: 1, at: 0, text: 'hi' }
    const over = async (value: Record<string, string | number>) => ({
      ...unsigned,
      sig: base32Encode(await mika.sign(canonicalBytes(value))),
    })
    const take = async (entry: LogEntry) =>
      (await mergeEntries(fakeCrypto, emptyLog('pair:x'), [entry], both)).entries.length
    // With no `v`, and saying it's a chat entry.
    expect(await take(await over({ log: 'pair:x', ...unsigned }))).toBe(1)
    expect(await take(await over({ v: 'pigeon/chat-entry/v1', log: 'pair:x', ...unsigned }))).toBe(
      1,
    )
    for (const value of [
      { v: 'pigeon/device-entry/v1', log: 'pair:x', ...unsigned },
      { v: 'pigeon/chat-entry/v2', log: 'pair:x', ...unsigned },
      { type: 'chat-entry', log: 'pair:x', ...unsigned },
      { v: 'pigeon/chat-entry/v1', ...unsigned },
    ])
      expect(await take(await over(value))).toBe(0)
  })
})

it('batches entries under a byte budget, never splitting one', async () => {
  const log = await write(emptyLog('pair:x'), [rook, 'x'.repeat(300)], [rook, 'y'], [rook, 'z'])
  const batches = batchEntries(log.entries, 400)
  expect(batches.map((b) => b.length)).toEqual([1, 2])
  expect(batchEntries([], 400)).toEqual([])
})

describe('a P-256 author', () => {
  it('has a high-S entry from before low-S refused as it arrives, and sent low-S, so it still reaches a device that lacks it', async () => {
    const old = await p256Signer('high')
    const kept = (await appendMessage(emptyLog('pair:x'), old, 'from before', 0)).log
    const entry = kept.entries[0]
    const signature = base32DecodeExact(entry?.sig ?? '')
    expect(signature.ok && isHighS(signature.value)).toBe(true)
    const strict = p256Crypto()
    const authors = new Set([old.id])
    expect((await mergeEntries(strict, emptyLog('pair:x'), kept.entries, authors)).entries).toEqual(
      [],
    )
    const sent = missingFrom(kept, {})
    expect(sent[0]?.sig).not.toBe(entry?.sig)
    const taken = await mergeEntries(strict, emptyLog('pair:x'), sent, authors)
    expect(taken.entries.map((e) => e.text)).toEqual(['from before'])
    // One who holds it already in the old spelling keeps one copy, and knows it by one key.
    expect((await mergeEntries(strict, kept, sent, authors)).entries.length).toBe(1)
    expect(entryKey(sent[0] as LogEntry)).toBe(entryKey(entry as LogEntry))
    // Both spellings are the same entry; other words under that signature are not.
    expect(sameEntry(sent[0] as LogEntry, entry as LogEntry)).toBe(true)
    expect(sameEntry({ ...(entry as LogEntry), text: 'other' }, entry as LogEntry)).toBe(false)
  })
})
