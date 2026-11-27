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
import { createMemoryStore } from '../../../platform/storage/memory-storage.ts'
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

describe('a letter in flight', () => {
  it('is work in flight from the moment a message is written until it has been put', async () => {
    const { entry } = await appendMessage(emptyLog('pair:x'), me, 'hello', 1)
    let wake: () => void = () => undefined
    const sent: unknown[] = []
    let chat = emptyLog('pair:x')
    chat = { ...chat, entries: [entry] }
    const letters = createLetters({
      store: createMemoryStore(),
      device: me.id,
      random: (length) => new Uint8Array(length),
      now: () => 0,
      // Held until the test says the few seconds are up.
      sleep: () => new Promise<void>((resolve) => (wake = resolve)),
      stopped: () => false,
      chat: () => chat,
      connected: () => false,
      recipient: async () => ({ identity: friend.id }) as never,
      ownDevices: async () => undefined,
      takeEntries: async () => true,
      mailbox: {
        send: async (_kind: unknown, _to: unknown, body: unknown) => {
          sent.push(body)
          return true
        },
      } as never,
    })
    expect(letters.busy()).toBe(false)
    letters.wrote(friend.id)
    expect(letters.busy()).toBe(true)
    wake()
    await flush()
    await flush()
    expect(sent).toHaveLength(1)
    expect(letters.busy()).toBe(false)
  })
})

describe('what says they have a message', () => {
  const ownEntries = async (count: number) => {
    let log = emptyLog('pair:x')
    const entries: LogEntry[] = []
    for (let i = 1; i <= count; i++) {
      const next = await appendMessage(log, me, `message ${i}`, i)
      log = next.log
      entries.push(next.entry)
    }
    return { log, entries }
  }
  const around = (log: ChatLog, store = createMemoryStore()) => {
    const letters = createLetters({
      store,
      device: me.id,
      random: (length) => new Uint8Array(length),
      now: () => 0,
      sleep: async () => undefined,
      stopped: () => false,
      chat: () => log,
      // Their Pigeon is online: what is written goes straight to it.
      connected: () => true,
      recipient: async () => undefined,
      ownDevices: async () => undefined,
      takeEntries: async () => true,
      mailbox: undefined as never,
    })
    return { letters, store }
  }

  it('is a sync of theirs that holds the message, also for one that went straight to them', async () => {
    const { log, entries } = await ownEntries(3)
    const { letters } = around(log)
    await letters.load(friend.id)
    expect(entries.map((entry) => letters.route(friend.id, entry))).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    letters.synced(friend.id, { [me.id]: 2 })
    await flush()
    expect(entries.map((entry) => letters.route(friend.id, entry))).toEqual([
      { kind: 'has' },
      { kind: 'has' },
      undefined,
    ])
  })

  it('isn’t a sync answered, or a friend seen to stay connected', async () => {
    const { log, entries } = await ownEntries(2)
    const { letters } = around(log)
    await letters.load(friend.id)
    // Their sync without what they hold, and their staying on: it counts as delivered for what
    // is mailed, but nothing says they have it.
    letters.synced(friend.id)
    await letters.delivered(friend.id, 2)
    await flush()
    expect(entries.map((entry) => letters.route(friend.id, entry))).toEqual([undefined, undefined])
  })

  it('stays higher, ignores what isn’t a whole number, and is never for their own messages', async () => {
    const { log, entries } = await ownEntries(2)
    const theirs = (await appendMessage(log, friend, 'hi', 3)).entry
    const { letters } = around({ ...log, entries: [...log.entries, theirs] })
    await letters.load(friend.id)
    letters.synced(friend.id, { [me.id]: 2, [friend.id]: 1 })
    letters.synced(friend.id, { [me.id]: 1 })
    letters.synced(friend.id, { [me.id]: Number.NaN })
    letters.synced(friend.id, { [me.id]: 1.5 })
    await flush()
    expect(entries.map((entry) => letters.route(friend.id, entry))).toEqual([
      { kind: 'has' },
      { kind: 'has' },
    ])
    // They hold their own message, of course; that isn't a message of yours they have.
    expect(letters.route(friend.id, theirs)).toBeUndefined()
  })

  it('is kept for the next time Pigeon opens', async () => {
    const { log, entries } = await ownEntries(1)
    const first = around(log)
    await first.letters.load(friend.id)
    first.letters.synced(friend.id, { [me.id]: 1 })
    await flush()
    const again = around(log, first.store)
    await again.letters.load(friend.id)
    expect(again.letters.route(friend.id, entries[0] as LogEntry)).toEqual({ kind: 'has' })
  })

  it('covers your other devices’ messages once told they are yours', async () => {
    const other = fakeSigner('other-device')
    const mine = (author: string) => author === me.id || author === other.id
    const { entry } = await appendMessage(emptyLog('pair:x'), other, 'from my laptop', 1)
    const log = { ...emptyLog('pair:x'), entries: [entry] }
    const build = (isMine?: (author: string) => boolean) =>
      createLetters({
        store: createMemoryStore(),
        device: me.id,
        ...(isMine === undefined ? {} : { isMine }),
        random: (length) => new Uint8Array(length),
        now: () => 0,
        sleep: async () => undefined,
        stopped: () => false,
        chat: () => log,
        connected: () => true,
        recipient: async () => undefined,
        ownDevices: async () => undefined,
        takeEntries: async () => true,
        mailbox: undefined as never,
      })
    const told = build(mine)
    await told.load(friend.id)
    told.synced(friend.id, { [other.id]: 1 })
    await flush()
    expect(told.route(friend.id, entry)).toEqual({ kind: 'has' })
    // Without being told, an entry of someone else's isn't a message of yours.
    const untold = build()
    await untold.load(friend.id)
    untold.synced(friend.id, { [other.id]: 1 })
    await flush()
    expect(untold.route(friend.id, entry)).toBeUndefined()
  })

  it('only takes their word for entries that existed when they said it', async () => {
    const { log, entries } = await ownEntries(1)
    let chat = log
    const letters = createLetters({
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
      takeEntries: async () => true,
      mailbox: undefined as never,
    })
    await letters.load(friend.id)
    // They claim to hold far more than there is.
    letters.synced(friend.id, { [me.id]: 100 })
    await flush()
    const later = await appendMessage(chat, me, 'written after', 2)
    chat = later.log
    expect(letters.route(friend.id, entries[0] as LogEntry)).toEqual({ kind: 'has' })
    // A message written after their claim isn't covered by it, so it is waiting, not received.
    expect(letters.route(friend.id, later.entry)).toEqual({ kind: 'waiting' })
  })

  it('never lets a claim hide that a later message is sealing or failing', async () => {
    const { log } = await ownEntries(1)
    let chat = log
    const letters = createLetters({
      store: createMemoryStore(),
      device: me.id,
      random: (length) => new Uint8Array(length),
      now: () => 0,
      sleep: () => new Promise<void>(() => undefined),
      stopped: () => false,
      chat: () => chat,
      connected: () => false,
      recipient: async () => ({ identity: friend.id }) as never,
      ownDevices: async () => undefined,
      takeEntries: async () => true,
      mailbox: undefined as never,
    })
    await letters.load(friend.id)
    letters.synced(friend.id, { [me.id]: 9_000 })
    await flush()
    const later = await appendMessage(chat, me, 'written after', 2)
    chat = later.log
    letters.wrote(friend.id)
    expect(letters.route(friend.id, later.entry)).toEqual({ kind: 'sealing' })
  })

  it('keeps only whole numbers for real authors, with their own keys', async () => {
    const { log, entries } = await ownEntries(2)
    const store = createMemoryStore()
    const { letters } = around(log, store)
    await letters.load(friend.id)
    const hostile = JSON.parse(
      `{"__proto__": 2, "constructor": 2, "${me.id}": 1, "not-a-peer": 2, "${friend.id}": 1.5}`,
    ) as Record<string, number>
    letters.synced(friend.id, hostile)
    await flush()
    expect(entries.map((entry) => letters.route(friend.id, entry))).toEqual([
      { kind: 'has' },
      undefined,
    ])
    const kept = (await store.get(`letters:${friend.id}`)) as { held: Record<string, number> }
    expect(Object.keys(kept.held)).toEqual([me.id])
    expect(Object.getPrototypeOf(kept.held)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('loads a record from before it was kept, and drops a malformed one', async () => {
    const { log, entries } = await ownEntries(1)
    const old = createMemoryStore()
    await old.set(`letters:${friend.id}`, { delivered: 0, mailed: 0, sent: [], arrived: {} })
    const before = around(log, old)
    await before.letters.load(friend.id)
    expect(before.letters.route(friend.id, entries[0] as LogEntry)).toBeUndefined()
    for (const held of [[1, 2], { [me.id]: 'x' }, { [me.id]: -1 }, 'nope', { bad: 1 }]) {
      const store = createMemoryStore()
      await store.set(`letters:${friend.id}`, {
        delivered: 0,
        mailed: 0,
        sent: [],
        arrived: {},
        held,
      })
      const loaded = around(log, store)
      await loaded.letters.load(friend.id)
      expect(loaded.letters.route(friend.id, entries[0] as LogEntry)).toBeUndefined()
    }
  })

  it('keeps no more than a few authors', async () => {
    const { log } = await ownEntries(1)
    const store = createMemoryStore()
    const { letters } = around(log, store)
    await letters.load(friend.id)
    const many: Record<string, number> = { [me.id]: 1 }
    for (let i = 0; i < 200; i++) many[fakeSigner(`device-${i}`).id] = 1
    letters.synced(friend.id, many)
    await flush()
    const kept = (await store.get(`letters:${friend.id}`)) as { held?: Record<string, number> }
    expect(Object.keys(kept.held ?? {}).length).toBeLessThanOrEqual(32)
  })
})
