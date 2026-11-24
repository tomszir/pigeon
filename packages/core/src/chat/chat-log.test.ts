import { describe, expect, it } from 'vitest'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import {
  appendMessage,
  batchEntries,
  type ChatLog,
  emptyLog,
  type LogEntry,
  mergeEntries,
  missingFrom,
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
})

it('batches entries under a byte budget, never splitting one', async () => {
  const log = await write(emptyLog('pair:x'), [rook, 'x'.repeat(300)], [rook, 'y'], [rook, 'z'])
  const batches = batchEntries(log.entries, 400)
  expect(batches.map((b) => b.length)).toEqual([1, 2])
  expect(batchEntries([], 400)).toEqual([])
})
