// Your shared log on this device: the signed entries of the changes you made on each of your
// devices (friends added and ended, petnames, mutes, blocks, settings), kept here, folded into
// what this device shows, and passed to your other devices in the self room and by `mail:sync`
// letters in the self mailbox.
//
// A letter goes 5 seconds after the last change, so a burst goes as one, and after a mail check
// that took something your other devices may lack. It's sealed only to your devices that said
// they read `mail:sync` (in their self news or by sending a summary in the self room), so a
// device on an older Pigeon isn't left letters it can't open. Each carries this device's device
// log, its summary and the entries its recipients aren't known to hold, padded so a Lighthouse
// sees one of three sizes.
import {
  appendShared,
  batchShared,
  behindShared,
  type Crypto,
  type DeviceLog,
  deviceState,
  everDevices,
  type FoldContext,
  foldShared,
  heardFrom,
  inTurn,
  type Json,
  type Letter,
  MAX_SYNC_BATCH,
  type MailKind,
  missingShared,
  newPeer,
  type PeerId,
  type PeerSync,
  planLetter,
  readSharedSummary,
  readSyncBody,
  removalAt,
  removalsOf,
  type SharedEntry,
  type SharedLog,
  type SharedOp,
  type SharedSummary,
  type SharedView,
  type Signer,
  SYNC_MAIL_KIND,
  type SyncOptions,
  summarizeShared,
  syncBody,
  syncCounts,
  takeSharedEntries,
} from '@pigeon/core'
import { type Accessor, createSignal } from 'solid-js'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Store } from '../../../platform/storage/storage.ts'
import type { Mailbox, Recipient } from './mailbox.ts'
import { KEYS } from './stored.ts'

/** How long after a change a letter waits, for the changes made right after it. */
export const SYNC_WAIT_MS = 5000

/** The sizes a `mail:sync` letter's body is padded to, so its size says little. */
export const SYNC_PADS: readonly number[] = [4096, 16_384, 40_960]

/** Entries' bytes in one `sync-entries` message, well inside one envelope. */
const ROOM_ENTRY_BYTES = 40_000

/** What a device that reads `mail:sync` says it reads, in its self news. */
export const READS: readonly string[] = ['sync']

export interface SharedLogDeps {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly store: Store
  readonly clock: Clock
  /** Your identity: the log's. */
  readonly self: PeerId
  /** Your device log as this device keeps it, and whether this device is still on it. */
  readonly devices: { readonly own: () => DeviceLog; readonly status: () => string }
  readonly stopped: () => boolean
  /** Where `mail:sync` letters are left; without it, the log goes only in the self room. */
  readonly mailbox?: Pick<Mailbox, 'send'> | undefined
  /** Your devices among `only` to mail: under the self secret, at your Lighthouses. */
  readonly recipient: (only: readonly PeerId[]) => Promise<Recipient | undefined>
  /** Tells your other devices in the self room what the log holds now. */
  readonly announce?: (() => void) | undefined
  /** What this device shows changed. */
  readonly onChange?: ((view: SharedView, before: SharedView) => Promise<void>) | undefined
}

export interface SharedLogKeeper {
  readonly view: Accessor<SharedView>
  readonly log: () => SharedLog
  readonly context: () => FoldContext
  /**
   * Writes each op as this device's next entry, in order, and passes them on; at `stamps[i]` when
   * given, as the update writes what a device held before.
   */
  readonly write: (ops: readonly SharedOp[], stamps?: readonly number[]) => Promise<void>
  /** A `mail:sync` letter from another of your devices, its device log already merged. */
  readonly takeLetter: (letter: Letter) => Promise<boolean>
  /** Another of your devices said which kinds of mail it reads. */
  readonly heardReads: (device: PeerId, kinds: readonly string[]) => Promise<void>
  /** Whether a letter of `kind` may be sealed to `device`: `mail:sync` only to one that reads it. */
  readonly reads: (kind: MailKind, device: PeerId) => boolean
  /** The device log a `mail:sync` letter carries, to be merged before anything is taken. */
  readonly carried: (letter: Letter) => DeviceLog | undefined
  /** What the self room passes. */
  readonly selfRoom: SyncOptions
  /** Sends now what waits to be sent, as at a mail check. */
  readonly flush: () => Promise<void>
  /** Your device log changed: what this device shows is worked out again. */
  readonly deviceLogChanged: () => Promise<void>
  /**
   * The `at` to sign a removal of `removed` with: now, or later than every entry held from them
   * that counts, so what they delivered before keeps counting however fast their clocks ran.
   */
  readonly removalAt: (removed: readonly PeerId[]) => number
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The signature of a view, to tell whether anything shown changed. */
const viewKey = (view: SharedView): string =>
  JSON.stringify([
    [...view.friendships.keys()].sort(),
    [...view.shown].map(([friend, f]) => `${friend}:${f.inc}`).sort(),
    [...view.petnames].sort(),
    [...view.mutes].sort(),
    [...view.blocked.keys()].sort(),
    view.relay,
  ])

/** `body` with a `pad` that brings its JSON to the next of `SYNC_PADS`, or as it is past them. */
export function padded(body: Json): Json {
  const size = JSON.stringify(body).length
  const target = SYNC_PADS.find((pad) => pad >= size + 16)
  if (target === undefined || !isObject(body)) return body
  const empty = JSON.stringify({ ...body, pad: '' }).length
  return { ...body, pad: ' '.repeat(target - empty) } as Json
}

export async function loadSharedLog(deps: SharedLogDeps): Promise<SharedLogKeeper> {
  const { crypto, signer, store, clock, self } = deps
  const storedEntries = await store.get(KEYS.sharedLog)
  // Entries were checked when they were taken; read back, they only need their shape.
  const kept = await takeSharedEntries(
    { ...crypto, verify: async () => true },
    { identity: self, entries: [] },
    Array.isArray(storedEntries) ? storedEntries : [],
    everDevices(deps.devices.own()),
  )
  let log: SharedLog = kept.log
  const storedKnown = await store.get(KEYS.sharedKnown)
  /** What this device keeps about each of your other devices, to decide what to mail it. */
  const peers = new Map<PeerId, PeerSync>(
    isObject(storedKnown)
      ? Object.entries(storedKnown).map(([device, summary]) => [
          device,
          newPeer(readSharedSummary(summary)),
        ])
      : [],
  )
  const storedReaders = await store.get(KEYS.syncReaders)
  const readers = new Set<PeerId>(
    Array.isArray(storedReaders)
      ? storedReaders.filter((id): id is PeerId => typeof id === 'string')
      : [],
  )

  const active = () => deps.devices.status() === 'active'
  const context = (): FoldContext => {
    const devices = deps.devices.own()
    return { authors: everDevices(devices), removals: removalsOf(devices) }
  }
  const [view, setView] = createSignal<SharedView>(foldShared(log, context()))

  /** One change to the log at a time, in the order they came. */
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  async function refresh() {
    const before = view()
    const next = foldShared(log, context())
    if (viewKey(next) === viewKey(before)) return
    setView(next)
    await deps.onChange?.(next, before)
  }

  async function changed(entries: readonly SharedEntry[]) {
    if (entries.length === 0) return
    await store.set(KEYS.sharedLog, log.entries)
    deps.announce?.()
    soon()
    await refresh()
  }

  /** Your other devices on the list now that read `mail:sync`. */
  const reading = (): PeerId[] => {
    const active = deviceState(deps.devices.own()).active
    return [...readers].filter((device) => device !== signer.id && active.has(device)).sort()
  }

  let waiting = false
  /** May hold something its other devices lack: worked out at the next send. */
  let owed = false
  function soon() {
    owed = true
    if (waiting) return
    waiting = true
    void clock.sleep(SYNC_WAIT_MS).then(() => {
      waiting = false
      return flush()
    })
  }

  /**
   * Mails your other devices what's due to them (exchange.ts says what that is). A device is
   * marked as sent to only once the letter is queued, so one that couldn't be sealed for now goes
   * at the next mail check; a page that didn't fit goes after the next wait.
   */
  async function flush(): Promise<void> {
    if (!owed || deps.stopped() || !active() || deps.mailbox === undefined) return
    const to = reading()
    if (to.length === 0) return
    owed = false
    const listed = new Set(deviceState(deps.devices.own()).active.keys())
    const due = new Map(to.map((device) => [device, peers.get(device) ?? newPeer()]))
    const letter = await planLetter(crypto, log, due, listed)
    if (letter === undefined) return
    const recipient = await deps.recipient(to)
    if (recipient === undefined) {
      owed = true
      return
    }
    const body = syncBody({
      log: deps.devices.own(),
      summary: letter.summary,
      entries: letter.entries,
    })
    // For them alone when put again, and kept until each has taken it: each letter carries only
    // what earlier ones didn't, so none takes another's place.
    await deps.mailbox.send(SYNC_MAIL_KIND, recipient, padded(body), { pinned: true })
    for (const [device, peer] of letter.peers) peers.set(device, peer)
    if (letter.more) soon()
  }

  async function markReader(device: PeerId) {
    if (readers.has(device) || device === signer.id) return
    readers.add(device)
    await store.set(KEYS.syncReaders, [...readers])
    // It may lack everything: what it lacks goes at the next send.
    soon()
  }

  /** `device` said what it holds; `behind`, it holds more than this device does now. */
  async function heardSummary(device: PeerId, summary: SharedSummary, behind = false) {
    peers.set(device, heardFrom(peers.get(device), summary, behind))
    const known = [...peers].flatMap(([id, peer]) =>
      peer.known === undefined ? [] : [[id, peer.known]],
    )
    await store.set(KEYS.sharedKnown, Object.fromEntries(known))
  }

  const take = (entries: readonly unknown[]) =>
    serial(async () => {
      const taken = await takeSharedEntries(crypto, log, entries, everDevices(deps.devices.own()))
      log = taken.log
      await changed(taken.taken)
    })

  /** A device that sent from your list as it is now, merged with what it carried. */
  const counts = (device: PeerId) => syncCounts(deps.devices.own(), device, signer.id)

  return {
    view,
    log: () => log,
    context,
    write: (ops, stamps) =>
      serial(async () => {
        if (!active() || ops.length === 0) return
        const written: SharedEntry[] = []
        for (const [i, op] of ops.entries()) {
          const next = await appendShared(log, signer, op, clock.now(), context(), stamps?.[i])
          if (next === undefined) break
          log = next.log
          written.push(next.entry)
        }
        await changed(written)
      }),
    async takeLetter(letter) {
      const body = readSyncBody(self, letter.body)
      // Nothing that could ever be taken: dropped, so it isn't fetched again.
      if (body === undefined) return true
      if (deps.stopped() || !counts(letter.from)) return false
      await markReader(letter.from)
      await take(body.entries)
      // It holds more than it carried, perhaps for what it thought this device held: it's
      // answered with this device's summary, so it learns what to send.
      const behind = await behindShared(crypto, log, body.summary)
      await heardSummary(letter.from, body.summary, behind)
      // Or it lacks something this device holds: sent at the next send.
      if (behind || (await missingShared(crypto, log, body.summary)).length > 0) soon()
      return true
    },
    async heardReads(device, kinds) {
      if (kinds.includes('sync') && counts(device)) await markReader(device)
    },
    reads: (kind, device) => kind !== SYNC_MAIL_KIND || readers.has(device),
    carried: (letter) =>
      letter.kind === SYNC_MAIL_KIND ? readSyncBody(self, letter.body)?.log : undefined,
    selfRoom: {
      summary: () => summarizeShared(crypto, log),
      async missing(device, summary) {
        if (!counts(device)) return []
        await markReader(device)
        const theirs = readSharedSummary(summary)
        await heardSummary(device, theirs)
        const listed = new Set(deviceState(deps.devices.own()).active.keys())
        const entries = inTurn(await missingShared(crypto, log, theirs), listed)
        return batchShared(entries, ROOM_ENTRY_BYTES).flatMap((batch) => {
          const out: SharedEntry[][] = []
          for (let i = 0; i < batch.length; i += MAX_SYNC_BATCH)
            out.push(batch.slice(i, i + MAX_SYNC_BATCH))
          return out
        }) as unknown as readonly (readonly Json[])[]
      },
      async take(device, entries) {
        if (counts(device)) await take(entries)
      },
      behind: async (device, summary) =>
        counts(device) && behindShared(crypto, log, readSharedSummary(summary)),
    },
    flush,
    deviceLogChanged: () => serial(refresh),
    removalAt: (removed) => removalAt(log, removed, clock.now()),
  }
}
