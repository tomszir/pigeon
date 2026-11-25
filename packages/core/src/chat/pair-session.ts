// Talking to one friend in your pair rooms: say hello, catch each other up on the chat log, and
// pass typing, buzz and presence along. A friend can be in several rooms at once (today's and
// yesterday's around midnight, or the old room while moving; decision 0026), so a session spans
// rooms that come and go. Pure protocol over Rooms; the app stores the log and draws the events.

import { AVATAR_VERSION } from '../avatar/avatar.ts'
import type { DeviceLog } from '../devices/device-log.ts'
import { base32Encode } from '../encoding/bytes.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import {
  type Body,
  MAX_MESSAGE_BYTES,
  openEnvelope,
  type Status,
  sealEnvelope,
} from '../messages/envelope.ts'
import type { ConnectionId, Room, RoomName } from '../transport/transport.ts'
import {
  appendMessage,
  batchEntries,
  type ChatLog,
  type LogEntry,
  mergeEntries,
  missingFrom,
  summarize,
} from './chat-log.ts'

/** Random bytes in a run's id (decision 0028): 16 base32 characters. */
export const INSTANCE_BYTES = 10
/** A run's id, said in every hello, from `INSTANCE_BYTES` random bytes. */
export const encodeInstance = (random: Uint8Array): string => base32Encode(random)

/** Room left in an envelope for everything around the entries. */
const ENTRY_BATCH_BYTES = MAX_MESSAGE_BYTES - 4 * 1024

export interface Presence {
  readonly status: Status
  readonly message: string
}

export type PairEvent =
  /**
   * `avatar`: the version the friend's bird is drawn with. `current`: their Pigeon knows device
   * logs, so it accepts your other devices too.
   */
  | {
      readonly type: 'online'
      readonly handle: string
      readonly avatar: number
      readonly current: boolean
    }
  | { readonly type: 'offline' }
  /** The friend, already online, changed their handle: a later `hello` with another one. */
  | { readonly type: 'renamed'; readonly handle: string }
  | { readonly type: 'presence'; readonly presence: Presence }
  | { readonly type: 'typing'; readonly active: boolean }
  | { readonly type: 'buzz' }
  | { readonly type: 'log'; readonly log: ChatLog }
  /** The friend removed you. */
  | { readonly type: 'unfriended' }
  /** The friend proved who they are in `room`: sent on their first hello in each room. */
  | { readonly type: 'met'; readonly room: RoomName }
  /** The friend gave the pair secret, moving you both out of the old room. */
  | { readonly type: 'secret'; readonly secret: string }
  /** The friend has the secret you gave. */
  | { readonly type: 'secret-ok' }

export interface PairSessionOptions {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly friend: PeerId
  /** What every envelope is signed for: the chat's id, the same in every room. */
  readonly chat: string
  readonly rooms: readonly Room[]
  readonly handle: () => string
  readonly presence: () => Presence
  /** The version your bird is drawn with; the newest unless you've kept an older one. */
  readonly avatar?: () => number
  /** The chat as stored. The session keeps its own copy and reports every change. */
  readonly log: ChatLog
  readonly now: () => number
  readonly onEvent: (event: PairEvent) => void
  /**
   * Who a device is (decision 0024): one of the friend's, one of your own others, or nobody.
   * Without it only the friend's own key is the friend.
   */
  readonly accepts?: ((device: PeerId) => 'friend' | 'self' | undefined) | undefined
  /**
   * Whose chat entries count: your devices and theirs, or a test per entry (a removed device's
   * older ones). Without it, you and the friend.
   */
  readonly authors?: (() => ReadonlySet<PeerId> | ((entry: LogEntry) => boolean)) | undefined
  /** Your device log, sent ahead of hello so a friend knows this device is yours. */
  readonly deviceLog?: (() => DeviceLog | undefined) | undefined
  /** A device log arrived; resolves once it's been taken in, before anything after it is read. */
  readonly onDeviceLog?: ((log: DeviceLog) => Promise<void>) | undefined
  /**
   * The friend's own device log as you keep it. Sent back to them when it holds a recovery, so a
   * device brought back by its recovery key gets its whole log from the first friend it meets
   * (decision 0027).
   */
  readonly theirLog?: (() => DeviceLog | undefined) | undefined
  /**
   * Your name and personal message with when they changed, for your own devices only (decision
   * 0036): sent after hello and on `announce`, while it has a time.
   */
  readonly profile?: (() => ProfileChange | undefined) | undefined
  /** Another of your devices said its name and personal message. */
  readonly onProfile?: ((change: ProfileChange) => void) | undefined
  /** This run's id, said in every hello (decision 0028). */
  readonly instance?: string | undefined
  /** A hello signed with this device's own key came from another run: a copied profile. */
  readonly onTwin?: (() => void) | undefined
}

/** A name and personal message, and when they were changed (decision 0036). */
export interface ProfileChange {
  readonly handle: string
  readonly message: string
  readonly changedAt: number
}

export interface PairSession {
  readonly online: () => boolean
  send(text: string): Promise<void>
  typing(active: boolean): void
  buzz(): void
  /**
   * Tells the friend you're leaving, synchronously, for a closing tab: the envelope is signed
   * ahead of time because there's no time to sign while the page unloads.
   */
  goodbye(): void
  /** Tells the friend about a new handle or presence. */
  announce(): void
  /** Tells the friend you've removed them; resolves once it's been sent to them. */
  unfriend(): Promise<void>
  /** Sends your device log again to everyone here, after it changed. */
  shareDevices(): void
  /** Lets go of connections from devices `accepts` no longer takes, as after a removal. */
  recheck(): void
  /** Gives the friend the pair secret, in every room they're in. */
  sendSecret(secret: string): Promise<void>
  /** Tells the friend their secret arrived; resolves once it's been sent. */
  confirmSecret(): Promise<void>
  /** The rooms the session is in now. */
  rooms(): readonly RoomName[]
  /** Starts talking in another room, greeting whoever is there. */
  addRoom(room: Room): void
  /** Stops talking in a room and leaves it. */
  removeRoom(name: RoomName): Promise<void>
  close(): Promise<void>
}

/** A connection in one of the session's rooms. */
type Link = string
const link = (room: RoomName, connection: ConnectionId): Link => `${room}\n${connection}`

export function startPairSession(options: PairSessionOptions): PairSession {
  const { crypto, signer, friend, chat } = options
  const hello = (): Body => ({
    type: 'hello',
    handle: options.handle(),
    avatar: options.avatar?.() ?? AVATAR_VERSION,
    devices: true,
    ...(options.instance === undefined ? {} : { instance: options.instance }),
  })
  const accepts =
    options.accepts ?? ((device: PeerId) => (device === friend ? 'friend' : undefined))
  const authors = options.authors ?? (() => new Set([signer.id, friend]))
  let log = options.log
  const rooms = new Map<RoomName, { room: Room; off: () => void }>()
  /** Connections that have proved, by a signed envelope, to be the friend. */
  const friendConnections = new Set<Link>()
  /** Connections that have proved to be another of your own devices: they only catch up. */
  const selfConnections = new Set<Link>()
  /** Which device each proved connection is, so a removal can cut it off. */
  const deviceOf = new Map<Link, PeerId>()
  /** When the presence shown was sent: with several devices, the newest wins. */
  let presenceAt = Number.NEGATIVE_INFINITY
  // Sends go out in order even though sealing is async.
  let queue = Promise.resolve()

  const deliver = (to: Link, bytes: Uint8Array) => {
    const cut = to.indexOf('\n')
    rooms.get(to.slice(0, cut) as RoomName)?.room.send(to.slice(cut + 1), bytes)
  }
  const seal = (body: Body) => sealEnvelope(signer, chat, options.now(), body)
  /** `all`: the friend's devices; `everyone`: those and your own others, for chat entries. */
  const sendTo = (to: Link | 'all' | 'everyone', body: Body) => {
    queue = queue.then(async () => {
      const bytes = await seal(body)
      if (to === 'all' || to === 'everyone') {
        for (const id of friendConnections) deliver(id, bytes)
        if (to === 'everyone') for (const id of selfConnections) deliver(id, bytes)
      } else deliver(to, bytes)
    })
  }

  // Re-signed whenever it's sent, so a fresh one is always ready.
  let bye: Uint8Array | undefined
  const prepareBye = () => {
    void seal({ type: 'bye' }).then((bytes) => {
      bye = bytes
    })
  }
  prepareBye()

  const devicesBody = (): Body | undefined => {
    const devices = options.deviceLog?.()
    // A log with nothing in it says nothing a friend doesn't know.
    const empty =
      devices === undefined ||
      (devices.entries.length === 0 &&
        devices.recovery === undefined &&
        (devices.epochs?.length ?? 0) === 0)
    return empty || devices === undefined ? undefined : { type: 'device-log', log: devices }
  }
  const sendProfile = (to: Link | 'all') => {
    const change = options.profile?.()
    if (change !== undefined) sendTo(to, { type: 'profile', ...change })
  }
  const greet = (to: Link) => {
    const devices = devicesBody()
    if (devices !== undefined) sendTo(to, devices)
    const theirs = options.theirLog?.()
    if (theirs !== undefined && (theirs.epochs?.length ?? 0) > 0)
      sendTo(to, { type: 'device-log', log: theirs })
    sendTo(to, hello())
    sendTo(to, { type: 'presence', ...options.presence() })
    sendProfile(to)
    sendTo(to, { type: 'log-sync', have: summarize(log) })
  }

  const setLog = (next: ChatLog) => {
    if (next === log) return
    log = next
    options.onEvent({ type: 'log', log })
  }

  const drop = (from: Link) => {
    deviceOf.delete(from)
    selfConnections.delete(from)
    if (friendConnections.delete(from) && friendConnections.size === 0)
      options.onEvent({ type: 'offline' })
  }

  // Merges run one after another so two batches can't race on `log`.
  let merging = Promise.resolve()
  /** The handle in the friend's last hello. */
  let heardHandle: string | undefined
  const handlers: {
    [T in Body['type']]?: (from: Link, body: Extract<Body, { type: T }>, at: number) => void
  } = {
    hello: (from, body) => {
      const first = friendConnections.size === 0
      const room = from.slice(0, from.indexOf('\n')) as RoomName
      const firstHere = ![...friendConnections].some((id) => id.startsWith(`${room}\n`))
      friendConnections.add(from)
      if (first)
        options.onEvent({
          type: 'online',
          handle: body.handle,
          avatar: body.avatar ?? 1,
          current: body.devices === true,
        })
      // `announce` sends hello again after a rename, on connections that are already open.
      else if (body.handle !== heardHandle)
        options.onEvent({ type: 'renamed', handle: body.handle })
      heardHandle = body.handle
      if (firstHere) options.onEvent({ type: 'met', room })
    },
    presence: (_from, body, at) => {
      if (at < presenceAt) return
      presenceAt = at
      options.onEvent({
        type: 'presence',
        presence: { status: body.status, message: body.message },
      })
    },
    profile: (_from, body) =>
      options.onProfile?.({
        handle: body.handle,
        message: body.message,
        changedAt: body.changedAt,
      }),
    typing: (_from, body) => options.onEvent({ type: 'typing', active: body.active }),
    buzz: () => options.onEvent({ type: 'buzz' }),
    unfriend: () => options.onEvent({ type: 'unfriended' }),
    'pair-secret': (_from, body) => options.onEvent({ type: 'secret', secret: body.secret }),
    'pair-secret-ok': () => options.onEvent({ type: 'secret-ok' }),
    bye: drop,
    'log-sync': (from, body) => {
      for (const batch of batchEntries(missingFrom(log, body.have), ENTRY_BATCH_BYTES))
        sendTo(from, { type: 'log-entries', entries: batch })
    },
    'log-entries': (_from, body) => {
      merging = merging.then(async () =>
        setLog(await mergeEntries(crypto, log, body.entries, authors())),
      )
    },
  }

  /**
   * A friend in two rooms gets everything twice, once per room. Hellos and byes count per
   * connection, the log dedupes itself, and these happen once: the same envelope (author, time
   * and type) is taken only the first time.
   */
  const ONCE: ReadonlySet<Body['type']> = new Set([
    'buzz',
    'unfriend',
    'pair-secret',
    'pair-secret-ok',
  ])
  const taken: string[] = []
  const firstTime = (key: string) => {
    if (taken.includes(key)) return false
    taken.push(key)
    if (taken.length > 64) taken.shift()
    return true
  }

  function recheck() {
    for (const [from, device] of [...deviceOf]) {
      const was = friendConnections.has(from) ? 'friend' : 'self'
      if (accepts(device) !== was) drop(from)
    }
  }

  /** What your own other devices may send: they only catch the chat up. */
  const SELF: ReadonlySet<Body['type']> = new Set(['log-sync', 'log-entries'])
  let inbound = Promise.resolve()

  let closed = false
  function addRoom(room: Room) {
    if (closed || rooms.has(room.name)) {
      void room.leave()
      return
    }
    const offMessage = room.onMessage((connection, bytes) => {
      // One at a time, in order: a device log must be taken in before the hello after it.
      inbound = inbound
        .then(async () => {
          const opened = await openEnvelope(crypto, chat, bytes)
          if (!opened.ok || !rooms.has(room.name)) return
          const from = link(room.name, connection)
          const { body, at } = opened.value
          if (body.type === 'device-log') {
            await options.onDeviceLog?.(body.log)
            recheck()
            return
          }
          // Our own key, from a run that isn't this one: this device is open somewhere else.
          if (opened.value.from === signer.id) {
            if (
              body.type === 'hello' &&
              body.instance !== undefined &&
              options.instance !== undefined &&
              body.instance !== options.instance
            )
              options.onTwin?.()
            return
          }
          const who = accepts(opened.value.from)
          if (who === undefined) return
          if (body.type === 'hello') deviceOf.set(from, opened.value.from)
          if (who === 'self') {
            if (body.type === 'hello') selfConnections.add(from)
            else if (selfConnections.has(from) && SELF.has(body.type))
              (handlers[body.type] as (from: Link, body: Body, at: number) => void)(from, body, at)
            return
          }
          // Anything but hello from a connection that hasn't said hello yet is ignored.
          if (body.type !== 'hello' && !friendConnections.has(from)) return
          if (ONCE.has(body.type) && !firstTime(`${opened.value.from} ${at} ${body.type}`)) return
          const handler = handlers[body.type] as
            | ((from: Link, body: Body, at: number) => void)
            | undefined
          handler?.(from, body, at)
        })
        // A message that breaks something must not stop the ones after it.
        .catch(() => undefined)
    })
    const offJoin = room.onPeerJoin((peer) => greet(link(room.name, peer)))
    // Behind the messages already in, so a hello read late can't bring a gone connection back.
    const offLeave = room.onPeerLeave((peer) => {
      inbound = inbound.then(() => drop(link(room.name, peer)))
    })
    rooms.set(room.name, {
      room,
      off: () => {
        offMessage()
        offJoin()
        offLeave()
      },
    })
    for (const peer of room.peers()) greet(link(room.name, peer))
  }

  async function removeRoom(name: RoomName) {
    const entry = rooms.get(name)
    if (entry === undefined) return
    await queue
    rooms.delete(name)
    entry.off()
    for (const id of [...friendConnections]) if (id.startsWith(`${name}\n`)) drop(id)
    await entry.room.leave()
  }

  for (const room of options.rooms) addRoom(room)

  return {
    online: () => friendConnections.size > 0,
    async send(text) {
      const { log: next, entry } = await appendMessage(log, signer, text, options.now())
      setLog(next)
      sendTo('everyone', { type: 'log-entries', entries: [entry] })
    },
    typing: (active) => sendTo('all', { type: 'typing', active }),
    buzz: () => sendTo('all', { type: 'buzz' }),
    goodbye() {
      if (bye === undefined) return
      for (const id of friendConnections) deliver(id, bye)
      prepareBye()
    },
    announce() {
      sendTo('all', hello())
      sendTo('all', { type: 'presence', ...options.presence() })
      sendProfile('all')
    },
    async unfriend() {
      sendTo('all', { type: 'unfriend' })
      await queue
    },
    recheck,
    shareDevices() {
      const devices = devicesBody()
      if (devices === undefined) return
      for (const [name, entry] of rooms)
        for (const peer of entry.room.peers()) sendTo(link(name, peer), devices)
    },
    async sendSecret(secret) {
      sendTo('all', { type: 'pair-secret', secret })
      await queue
    },
    async confirmSecret() {
      sendTo('all', { type: 'pair-secret-ok' })
      await queue
    },
    rooms: () => [...rooms.keys()],
    addRoom,
    removeRoom,
    async close() {
      closed = true
      await queue
      // Closing isn't the friend going offline, so it says nothing.
      friendConnections.clear()
      selfConnections.clear()
      await Promise.all([...rooms.keys()].map(removeRoom))
    },
  }
}
