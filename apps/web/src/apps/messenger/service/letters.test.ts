import {
  appendMessage,
  type ChatLog,
  emptyLog,
  fakeCrypto,
  fakeSigner,
  type Letter,
  type LogEntry,
  mergeEntries,
} from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../../platform/storage/storage.ts'
import { createLetters, type LettersDeps } from './letters.ts'

const me = fakeSigner('me')
const friend = fakeSigner('friend')
const lighthouse = { id: fakeSigner('lighthouse').id, name: 'Harbour', url: 'wss://harbour.test' }
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Letters around one chat, whose `takeEntries` merges with a sync's checks after `meanwhile`
 * runs, as a live sync can bring entries while a letter is being taken.
 */
function harness(meanwhile: (chat: ChatLog) => Promise<ChatLog> = async (chat) => chat) {
  let chat = emptyLog('pair:x')
  const authors = new Set([me.id, friend.id])
  const deps: Omit<LettersDeps, 'mailbox'> = {
    store: createMemoryStore(),
    device: me.id,
    random: (length) => new Uint8Array(length),
    now: () => 0,
    sleep: async () => undefined,
    stopped: () => false,
    chat: () => chat,
    connected: () => false,
    recipient: async () => undefined,
    ownDevices: async () => undefined,
    takeEntries: async (_friend, entries) => {
      chat = await meanwhile(chat)
      chat = await mergeEntries(fakeCrypto, chat, entries, authors)
      return true
    },
  }
  // Taking a letter in never puts or fetches mail.
  const letters = createLetters({ ...deps, mailbox: undefined as never })
  return { letters, chat: () => chat }
}

const letterWith = (entries: readonly LogEntry[]): Letter =>
  ({
    kind: 'chat',
    sender: friend.id,
    to: me.id,
    date: '2026-11-26',
    id: 'letter-one',
    head: { epoch: 0, seq: 0 },
    from: friend.id,
    at: 0,
    body: { log: 'pair:x', entries },
  }) as unknown as Letter

describe('a letter taken in', () => {
  it('says which Lighthouse brought the entries it carried', async () => {
    const { entry } = await appendMessage(emptyLog('pair:x'), friend, 'hello', 1)
    const { letters } = harness()
    await letters.take(friend.id, letterWith([entry]), lighthouse)
    await flush()
    expect(letters.route(friend.id, entry)).toEqual({ kind: 'arrived', through: 'Harbour' })
  })

  it('doesn’t claim an entry a live sync brought meanwhile, under the same author and number', async () => {
    const { entry: genuine } = await appendMessage(emptyLog('pair:x'), friend, 'hello', 1)
    // Refused when merged, but naming the same (author, seq): one with the genuine signature
    // over other words, and one signed by someone else.
    const forged = (await appendMessage(emptyLog('pair:x'), fakeSigner('eve'), 'hello', 1)).entry
    for (const bogus of [
      { ...genuine, text: 'not theirs' },
      { ...genuine, sig: forged.sig },
    ]) {
      const { letters, chat } = harness(async (held) =>
        mergeEntries(fakeCrypto, held, [genuine], new Set([friend.id])),
      )
      await letters.take(friend.id, letterWith([bogus]), lighthouse)
      await flush()
      expect(chat().entries).toEqual([genuine])
      expect(letters.route(friend.id, genuine)).toBeUndefined()
    }
  })
})
