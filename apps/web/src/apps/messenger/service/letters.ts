// Letters: chat messages left at a friend's Lighthouses while they aren't connected, so they
// reach them when they next open Pigeon, whether or not you're online then.
//
// A letter carries this device's own signed chat entries, the ones the friend isn't known to
// have: sent while they stayed connected, answered to their `log-sync`, or receipted. A burst
// of messages is one letter, sent 5 seconds after the last. Letters that come in are merged
// into the chat with the checks a sync uses. Each message remembers where it went, or which
// Lighthouse brought it, for the chat to say.
import {
  base32Encode,
  batchEntries,
  type ChatLog,
  isLogEntry,
  type Json,
  type Letter,
  type LighthouseAddress,
  type LogEntry,
  lowSEntry,
  MAX_MAIL_MS,
  type PeerId,
} from '@pigeon/core'
import { createSignal } from 'solid-js'
import type { Store } from '../../../platform/storage/storage.ts'
import type { Mailbox, Recipient } from './mailbox.ts'

/** How long after a message a letter waits, for the ones written right after it. */
export const LETTER_WAIT_MS = 5000
/** How long a friend must stay connected after a message for it to count as theirs. */
export const DELIVERED_AFTER_MS = 3000
/** Entries in one letter at most, and their size: the sealed blob must fit a Lighthouse. */
export const MAX_LETTER_ENTRIES = 50
export const MAX_LETTER_BYTES = 40 * 1024
/** Letters kept waiting for receipts per friend at most; more wait until some are receipted. */
export const MAX_LETTERS_WAITING = 50
/** Letters remembered per friend, and messages remembered as having come by letter. */
const MAX_SENT_KEPT = 200
const MAX_ARRIVED_KEPT = 500

const key = (friend: PeerId) => `letters:${friend}`

/** One letter sent: which of your entries it carried, and where it was left. */
interface SentLetter {
  readonly id: string
  /** The sequences it carried, of this device's entries. */
  readonly from: number
  readonly upTo: number
  readonly at: number
  /** The Lighthouses that took it, by name. */
  readonly where: readonly string[]
  readonly received: boolean
}

/** What this device knows of letters with one friend. */
interface FriendLetters {
  /** The highest sequence of this device's entries the friend is known to have. */
  readonly delivered: number
  /** The highest put in a letter. */
  readonly mailed: number
  readonly sent: readonly SentLetter[]
  /** Entries that came by letter: their signature, and the Lighthouse that brought them. */
  readonly arrived: Readonly<Record<string, string>>
}

const EMPTY: FriendLetters = { delivered: 0, mailed: 0, sent: [], arrived: {} }

const isFriendLetters = (value: unknown): value is FriendLetters => {
  if (typeof value !== 'object' || value === null) return false
  const f = value as FriendLetters
  return (
    typeof f.delivered === 'number' &&
    typeof f.mailed === 'number' &&
    Array.isArray(f.sent) &&
    typeof f.arrived === 'object' &&
    f.arrived !== null
  )
}

/** What a chat says under one message about its way. */
export type MessageRoute =
  | { readonly kind: 'sealing' }
  | { readonly kind: 'left'; readonly where: readonly string[] }
  | { readonly kind: 'has' }
  | { readonly kind: 'arrived'; readonly through: string }
  /** Written while they're away, with nowhere to leave it: it goes when they're back. */
  | { readonly kind: 'waiting' }
  /** Sealed, but no Lighthouse took it yet: it's tried again at each mail check. */
  | { readonly kind: 'retrying' }

export interface LettersDeps {
  readonly store: Store
  readonly mailbox: Mailbox
  /** This device: whose entries letters from here carry. */
  readonly device: PeerId
  readonly random: (length: number) => Uint8Array
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly stopped: () => boolean
  /** The friend's chat as this device has it now. */
  readonly chat: (friend: PeerId) => ChatLog | undefined
  /** Whether any of the friend's devices is connected now. */
  readonly connected: (friend: PeerId) => boolean
  /** Who they are to mail, under their pair secret; undefined when they can't be mailed. */
  readonly recipient: (friend: PeerId) => Promise<Recipient | undefined>
  /** Your own other devices, under the self secret: each letter's copy goes to them. */
  readonly ownDevices: () => Promise<Recipient | undefined>
  /** Merges entries into the chat with a sync's checks; false when there's no chat to merge into. */
  readonly takeEntries: (friend: PeerId, entries: readonly LogEntry[]) => Promise<boolean>
}

export function createLetters(deps: LettersDeps) {
  const { store } = deps
  const known = new Map<PeerId, FriendLetters>()
  const loading = new Map<PeerId, Promise<FriendLetters>>()
  const forgotten = new Set<PeerId>()
  // Bumped on every change, so the chat says each message's way as it changes.
  const [version, bump] = createSignal(0)
  const waiting = new Set<PeerId>()
  /** Friends a letter is being sealed and put for right now. */
  const mailing = new Set<PeerId>()

  // One change at a time, so a receipt landing during a load or a mail isn't lost. Nothing
  // under it is awaited from inside a mailbox fetch: what a fetch hands over is queued.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  function load(friend: PeerId): Promise<FriendLetters> {
    const have = known.get(friend)
    if (have !== undefined) return Promise.resolve(have)
    let pending = loading.get(friend)
    if (pending === undefined) {
      pending = store.get(key(friend)).then((stored) => {
        const letters = known.get(friend) ?? (isFriendLetters(stored) ? stored : EMPTY)
        known.set(friend, letters)
        loading.delete(friend)
        return letters
      })
      loading.set(friend, pending)
    }
    return pending
  }
  async function save(friend: PeerId, next: FriendLetters) {
    if (forgotten.has(friend)) return
    // Old letters and arrivals go first: only the recent ones are worth saying.
    const sent = next.sent.slice(-MAX_SENT_KEPT)
    const arrived = Object.fromEntries(Object.entries(next.arrived).slice(-MAX_ARRIVED_KEPT))
    const kept = { ...next, sent, arrived }
    known.set(friend, kept)
    bump((n) => n + 1)
    if (!deps.stopped()) await store.set(key(friend), kept)
  }
  const update = (friend: PeerId, change: (letters: FriendLetters) => FriendLetters) =>
    serial(async () => save(friend, change(await load(friend))))

  /** This device's own entries in the chat, oldest first. */
  const ownEntries = (friend: PeerId) =>
    (deps.chat(friend)?.entries ?? []).filter((entry) => entry.author === deps.device)

  /** Whether a letter can still reach them: receipted, or not yet expired at the Lighthouses. */
  const good = (letter: SentLetter) => letter.received || letter.at + MAX_MAIL_MS > deps.now()
  /** How far letters that can still reach them go: an expired one's entries are mailed again. */
  const stillOut = (letters: FriendLetters) =>
    letters.sent.filter(good).reduce((high, letter) => Math.max(high, letter.upTo), 0)

  /**
   * How far the friend has this device's entries, from receipts: only through letters received
   * one after another, so a receipt for a later letter doesn't vouch for an earlier one.
   */
  const throughReceipts = (letters: FriendLetters) => {
    let high = letters.delivered
    for (const letter of [...letters.sent].sort((a, b) => a.from - b.from))
      if (letter.received && letter.from <= high + 1) high = Math.max(high, letter.upTo)
    return high
  }

  /** Letters still out: not receipted, not overtaken by a sync, not expired. */
  const outstanding = (letters: FriendLetters) =>
    letters.sent.filter(
      (letter) =>
        !letter.received && letter.upTo > letters.delivered && letter.at + MAX_MAIL_MS > deps.now(),
    ).length

  /** Puts what the friend lacks in letters, a batch at a time. */
  const mail = (friend: PeerId) =>
    serial(async () => {
      if (deps.stopped() || forgotten.has(friend) || deps.connected(friend)) return
      const chat = deps.chat(friend)
      const to = await deps.recipient(friend)
      if (chat === undefined || to === undefined) return
      let letters = await load(friend)
      const from = Math.max(letters.delivered, stillOut(letters))
      const missing = ownEntries(friend).filter((entry) => entry.seq > from)
      const batches = batchEntries(missing, MAX_LETTER_BYTES).flatMap((batch) => {
        const out: (readonly LogEntry[])[] = []
        for (let i = 0; i < batch.length; i += MAX_LETTER_ENTRIES)
          out.push(batch.slice(i, i + MAX_LETTER_ENTRIES))
        return out
      })
      for (const batch of batches) {
        if (outstanding(letters) >= MAX_LETTERS_WAITING) return
        const first = batch[0]
        const last = batch[batch.length - 1]
        if (first === undefined || last === undefined) return
        const id = base32Encode(deps.random(10))
        const where: string[] = []
        // Plain copies: the chat lives in a reactive store, which storage can't keep as it is.
        // Spelled as they're taken, so a message kept from before low-S signatures still counts.
        const entries = batch.map((entry) => ({ ...lowSEntry(entry) }))
        const body = { log: chat.id, entries } as unknown as Json
        await deps.mailbox.send('letter', to, body, {
          id,
          onStored: (stored) => where.push(...stored.map((address) => address.name)),
        })
        // A copy for your other devices, so the chat there has what you wrote here even when
        // the friend is never online with them.
        const own = await deps.ownDevices()
        if (own !== undefined && !deps.stopped())
          await deps.mailbox.send('letter', own, {
            log: chat.id,
            entries,
            friend,
          } as unknown as Json)
        // Closed meanwhile: it may not be queued, so it isn't counted as mailed.
        if (deps.stopped()) return
        const sent: SentLetter = {
          id,
          from: first.seq,
          upTo: last.seq,
          at: deps.now(),
          where,
          received: false,
        }
        letters = { ...letters, mailed: last.seq, sent: [...letters.sent, sent] }
        await save(friend, letters)
      }
    })

  return {
    version,

    /**
     * A message was written: when the friend isn't connected, a letter goes in a moment; when
     * they are, it counts as theirs once they've stayed a moment, and goes by letter if not.
     */
    wrote(friend: PeerId) {
      const last = ownEntries(friend).at(-1)
      if (deps.connected(friend)) {
        if (last === undefined) return
        void deps.sleep(DELIVERED_AFTER_MS).then(() => {
          if (deps.connected(friend)) void this.delivered(friend, last.seq)
          else this.wrote(friend)
        })
        return
      }
      if (waiting.has(friend)) return
      waiting.add(friend)
      bump((n) => n + 1)
      void deps.sleep(LETTER_WAIT_MS).then(async () => {
        waiting.delete(friend)
        mailing.add(friend)
        await mail(friend).catch(() => undefined)
        mailing.delete(friend)
        bump((n) => n + 1)
      })
    },

    /** They went: anything of yours they weren't seen to have goes by letter. */
    left(friend: PeerId) {
      void this.resume(friend)
    },

    /** The friend has this device's entries up to `seq`. */
    delivered: (friend: PeerId, seq: number) =>
      update(friend, (letters) =>
        seq <= letters.delivered ? letters : { ...letters, delivered: seq },
      ),

    /**
     * One of their devices synced: it has what it said, and gets the rest of this device's
     * entries in answer, so it has them all.
     */
    synced(friend: PeerId) {
      const last = ownEntries(friend).at(-1)
      if (last !== undefined) void this.delivered(friend, last.seq)
    },

    /** A receipt for letter `id` came from one of the friend's devices. */
    receipted: (friend: PeerId, id: string) =>
      update(friend, (letters) => {
        const letter = letters.sent.find((other) => other.id === id)
        if (letter === undefined) return letters
        const next = {
          ...letters,
          sent: letters.sent.map((other) =>
            other.id === id ? { ...other, received: true } : other,
          ),
        }
        return { ...next, delivered: throughReceipts(next) }
      }),

    /** A letter waiting for receipts was put again, at `where`. */
    stored: (friend: PeerId, id: string, where: readonly LighthouseAddress[]) =>
      update(friend, (letters) => ({
        ...letters,
        sent: letters.sent.map((letter) =>
          letter.id === id
            ? {
                ...letter,
                where: [...new Set([...letter.where, ...where.map((address) => address.name)])],
              }
            : letter,
        ),
      })),

    /**
     * Takes a letter in: its entries go into the chat. True once it's been looked at; false
     * when there's no chat to take it into yet, so it's left for the next look.
     */
    async take(
      friend: PeerId,
      letter: Letter,
      through: LighthouseAddress,
      /** A copy from another of your devices: your own words, not something that came to you. */
      own = false,
    ): Promise<boolean> {
      const chat = deps.chat(friend)
      if (chat === undefined) return true
      const body = letter.body as { log?: unknown; entries?: unknown }
      if (body?.log !== chat.id || !Array.isArray(body.entries)) return true
      const entries = body.entries.filter(isLogEntry).slice(0, MAX_LETTER_ENTRIES)
      const had = new Set(chat.entries.map((entry) => entry.sig))
      if (!(await deps.takeEntries(friend, entries))) return false
      const now = new Set(deps.chat(friend)?.entries.map((entry) => entry.sig) ?? [])
      const arrived = entries.filter((entry) => !had.has(entry.sig) && now.has(entry.sig))
      // Not waited on: this runs inside a mailbox fetch.
      if (arrived.length > 0 && !own)
        void update(friend, (letters) => ({
          ...letters,
          arrived: {
            ...letters.arrived,
            ...Object.fromEntries(arrived.map((entry) => [entry.sig, through.name])),
          },
        }))
      return true
    },

    /** Loads what's kept for a friend, so `route` can say it. */
    load: (friend: PeerId) => load(friend).then(() => bump((n) => n + 1)),

    /** Where one message is, for the chat to say under it; nothing for one that went live. */
    route(friend: PeerId, entry: LogEntry): MessageRoute | undefined {
      version()
      const letters = known.get(friend) ?? EMPTY
      const through = letters.arrived[entry.sig]
      if (through !== undefined) return { kind: 'arrived', through }
      if (entry.author !== deps.device) return undefined
      // The latest letter that carried it: an expired one's entries go again in a newer one.
      const letter = letters.sent.findLast(
        (other) => entry.seq >= other.from && entry.seq <= other.upTo,
      )
      // Went by letter and they have it: worth saying; went live: nothing to say.
      if (letter?.received === true) return { kind: 'has' }
      if (entry.seq <= letters.delivered) return letter === undefined ? undefined : { kind: 'has' }
      if (waiting.has(friend) || mailing.has(friend)) return { kind: 'sealing' }
      if (letter !== undefined && good(letter))
        return letter.where.length > 0
          ? { kind: 'left', where: letter.where }
          : { kind: 'retrying' }
      return deps.connected(friend) ? undefined : { kind: 'waiting' }
    },

    /** A friend, new or paired again: their letters are kept from now on. */
    remember(friend: PeerId) {
      forgotten.delete(friend)
    },

    /**
     * After a mail check, and when Pigeon starts: anything of yours a friend who isn't connected
     * lacks, and no letter carries, is mailed (written just before Pigeon closed, say, or held
     * back by the cap until receipts came).
     */
    async resume(friend: PeerId) {
      if (deps.stopped() || forgotten.has(friend) || deps.connected(friend)) return
      if (waiting.has(friend) || mailing.has(friend)) return
      const letters = await load(friend)
      const last = ownEntries(friend).at(-1)
      if (last !== undefined && last.seq > Math.max(letters.delivered, stillOut(letters)))
        this.wrote(friend)
    },

    /** Forgets a friend's letters, when they're removed. */
    async forget(friend: PeerId) {
      forgotten.add(friend)
      known.delete(friend)
      await store.delete(key(friend))
    },
  }
}

export type Letters = ReturnType<typeof createLetters>
