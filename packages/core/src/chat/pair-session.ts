// Talking to one friend in your pair rooms: say hello, catch each other up on the chat log, and
// pass typing, buzz and presence along. A friend can be in several rooms at once (today's and
// yesterday's around midnight, or the old room while moving), so a session spans
// rooms that come and go. Pure protocol over Rooms; the app stores the log and draws the events.
//
// A connection counts as a device only once that device's hello signs the nonce this side sent
// on it and the channel's certificate fingerprints (see `ChannelBinding`). A hello forwarded
// from another connection, or replayed from an old one, names a different channel and is
// ignored, and nothing else counts from a connection until its hello does, so a relay in the
// room can't stand in for a friend or one of your own devices.

import { AVATAR_VERSION } from '../avatar/avatar.ts'
import type { DeviceLog } from '../devices/device-log.ts'
import { base32DecodeExact, base32Encode, bytesEqual, hexDecode } from '../encoding/bytes.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import type { LighthouseAddress } from '../lighthouse/address.ts'
import { type SealingKey, verifySealingKey } from '../mail/mail.ts'
import {
  type Body,
  MAX_MESSAGE_BYTES,
  NONCE_BYTES,
  openEnvelope,
  type Status,
  sealEnvelope,
} from '../messages/envelope.ts'
import type { ChannelBinding, ConnectionId, Room, RoomName } from '../transport/transport.ts'
import {
  appendMessage,
  batchEntries,
  type ChatLog,
  type LogEntry,
  type LogSummary,
  mergeEntries,
  missingFrom,
  summarize,
} from './chat-log.ts'

/** Random bytes in a run's id: 16 base32 characters. */
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
  /**
   * One of the friend's devices said its sealing key (checked: signed by that very device) or
   * where to leave mail. Said on each hello; the Messenger keeps the newest.
   */
  | {
      readonly type: 'keys'
      readonly device: PeerId
      readonly sealing?: SealingKey
      readonly lighthouses?: readonly LighthouseAddress[]
    }
  | { readonly type: 'presence'; readonly presence: Presence }
  | { readonly type: 'typing'; readonly active: boolean }
  | { readonly type: 'buzz' }
  | { readonly type: 'log'; readonly log: ChatLog }
  /**
   * One of the friend's devices said how far it has the chat (its `log-sync`): what it holds
   * of each author's entries, so letters need only carry what it lacks.
   */
  | { readonly type: 'has'; readonly have: LogSummary }
  /** The friend removed you. */
  | { readonly type: 'unfriended' }
  /** The friend proved who they are in `room`: sent on their first hello in each room. */
  | { readonly type: 'met'; readonly room: RoomName }
  /** One of the friend's devices proved itself with a hello in `room`: sent on every one. */
  | { readonly type: 'seen'; readonly room: RoomName; readonly device: PeerId }
  /** The friend gave the pair secret in the old room, moving you both out of it. */
  | { readonly type: 'secret'; readonly secret: string }
  /** The friend has the secret you gave, they said in the old room. */
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
  /** Random bytes, for the nonce each connection is sent. */
  readonly random: (length: number) => Uint8Array
  readonly onEvent: (event: PairEvent) => void
  /**
   * Who a device is: one of the friend's, one of your own others, or nobody.
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
   * device brought back by its recovery key gets its whole log from the first friend it meets.
   */
  readonly theirLog?: (() => DeviceLog | undefined) | undefined
  /**
   * Your name and personal message with when they changed, for your own devices only:
   * sent after hello and on `announce`, while it has a time.
   */
  readonly profile?: (() => ProfileChange | undefined) | undefined
  /** Another of your devices said its name and personal message. */
  readonly onProfile?: ((change: ProfileChange) => void) | undefined
  /** This device's sealing key, said in every hello, so mail for it can be sealed to it. */
  readonly sealing?: (() => SealingKey | undefined) | undefined
  /** Where to leave mail for this Pigeon, said in every hello. */
  readonly lighthouses?: (() => readonly LighthouseAddress[]) | undefined
  /** This run's id, said in every hello. */
  readonly instance?: string | undefined
  /** A hello signed with this device's own key came from another run: a copied profile. */
  readonly onTwin?: (() => void) | undefined
}

/** A name and personal message, and when they were changed. */
export interface ProfileChange {
  readonly handle: string
  readonly message: string
  readonly changedAt: number
}

export interface PairSession {
  readonly online: () => boolean
  send(text: string): Promise<void>
  /**
   * Takes in entries that came another way (by letter), with the checks a sync uses, so the
   * session's chat and what it syncs include them.
   */
  takeEntries(entries: readonly LogEntry[]): Promise<void>
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
  /** Gives the friend the pair secret, in the old room. */
  sendSecret(secret: string): Promise<void>
  /** Tells the friend, in the old room, their secret arrived; resolves once it's been sent. */
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

/** Most nonces answered on one connection: one per greeting, and a greeting is rare. */
const MAX_ANSWERED = 8

/** One connection id's time in a room, from when it's first heard or greeted until it leaves. */
interface Token {
  /** The nonce sent on it, which its hello must sign. */
  sent?: Uint8Array
  /** The nonce it sent last, which this side's hello to it signs. */
  theirs?: string
  /** Every nonce answered on it, each answered once. */
  readonly answered: Set<string>
  /** The device whose bound hello proved it, and as whom, until it says bye or is dropped. */
  proved?: { readonly device: PeerId; readonly who: 'friend' | 'self' }
}
const newToken = (): Token => ({ answered: new Set() })

export function startPairSession(options: PairSessionOptions): PairSession {
  const { crypto, signer, friend, chat } = options
  const hello = (): Extract<Body, { type: 'hello' }> => ({
    type: 'hello',
    handle: options.handle(),
    avatar: options.avatar?.() ?? AVATAR_VERSION,
    devices: true,
    ...(options.instance === undefined ? {} : { instance: options.instance }),
    ...((sealing) => (sealing === undefined ? {} : { sealing }))(options.sealing?.()),
    ...((lighthouses) =>
      lighthouses === undefined || lighthouses.length === 0 ? {} : { lighthouses })(
      options.lighthouses?.(),
    ),
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
  /**
   * Each connection id while it's here, from its first message or greeting until it leaves.
   * Every envelope is read against the token current when it arrived, so one received before a
   * leave still counts once its connection is gone, nothing from before counts for whoever takes
   * the id next, and a gone connection's token goes once the envelopes holding it are read.
   */
  const tokens = new Map<Link, Token>()
  const tokenOf = (from: Link) => {
    const current = tokens.get(from) ?? newToken()
    tokens.set(from, current)
    return current
  }
  /** When the presence shown was sent: with several devices, the newest wins. */
  let presenceAt = Number.NEGATIVE_INFINITY
  // Sends go out in order even though sealing is async.
  let queue = Promise.resolve()

  const split = (to: Link) => {
    const cut = to.indexOf('\n')
    return { room: to.slice(0, cut) as RoomName, connection: to.slice(cut + 1) }
  }
  const deliver = (to: Link, bytes: Uint8Array) => {
    const { room, connection } = split(to)
    rooms.get(room)?.room.send(connection, bytes)
  }
  const seal = (body: Body) => sealEnvelope(signer, chat, options.now(), body)
  /**
   * `all`: the friend's devices; `everyone`: those and your own others, for chat entries; `old`:
   * the friend's devices in the old room alone.
   */
  const sendTo = (to: Link | 'all' | 'everyone' | 'old', body: Body) => {
    // A send to one connection is for that connection, not for whoever holds its id when the
    // queue gets to it.
    const many = to === 'all' || to === 'everyone' || to === 'old'
    const token = many ? undefined : tokens.get(to)
    queue = queue.then(async () => {
      const bytes = await seal(body)
      if (to === 'old') {
        for (const id of friendConnections) if (id.startsWith(`${chat}\n`)) deliver(id, bytes)
      } else if (to === 'all' || to === 'everyone') {
        for (const id of friendConnections) deliver(id, bytes)
        if (to === 'everyone') for (const id of selfConnections) deliver(id, bytes)
      } else if (token !== undefined && tokens.get(to) === token) deliver(to, bytes)
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
  /** A hello for one connection, bound to its nonce and channel; none while either is missing. */
  const sayHello = (to: Link) => {
    const token = tokens.get(to)
    queue = queue.then(async () => {
      const nonce = token?.theirs
      const { room, connection } = split(to)
      const view = await rooms
        .get(room)
        ?.room.binding(connection)
        .catch(() => undefined)
      if (nonce === undefined || view === undefined || tokens.get(to) !== token) return
      const bytes = await seal({ ...hello(), binding: { nonce, ...view } })
      if (tokens.get(to) === token) deliver(to, bytes)
    })
  }
  /**
   * A new connection: your device logs, then the nonce its hello must sign. Once per connection,
   * though a peer already here can be both listed and announced, so a hello signing the first
   * nonce still counts.
   */
  const greet = (to: Link) => {
    const token = tokenOf(to)
    if (token.sent !== undefined) return
    const devices = devicesBody()
    if (devices !== undefined) sendTo(to, devices)
    const theirs = options.theirLog?.()
    if (theirs !== undefined && (theirs.epochs?.length ?? 0) > 0)
      sendTo(to, { type: 'device-log', log: theirs })
    const nonce = options.random(NONCE_BYTES)
    token.sent = nonce
    sendTo(to, { type: 'nonce', nonce: base32Encode(nonce) })
  }
  /** A connection just proved who it is: catch it up. Nothing of this goes to one that hasn't. */
  const catchUp = (to: Link) => {
    sendTo(to, { type: 'presence', ...options.presence() })
    sendProfile(to)
    sendTo(to, { type: 'log-sync', have: summarize(log) })
  }
  /**
   * Whether a hello signs the nonce sent on its connection and the channel's fingerprints as this
   * side saw them when it arrived, swapped: then it was signed for that very channel.
   */
  async function bound(
    body: Extract<Body, { type: 'hello' }>,
    sent: Uint8Array | undefined,
    channel: Promise<ChannelBinding | undefined>,
  ): Promise<boolean> {
    const claim = body.binding
    if (sent === undefined || claim === undefined) return false
    const nonce = base32DecodeExact(claim.nonce)
    if (!nonce.ok || !bytesEqual(nonce.value, sent)) return false
    const view = await channel
    if (view === undefined) return false
    const same = (a: string, b: string) => {
      const x = hexDecode(a)
      const y = hexDecode(b)
      return x.ok && y.ok && bytesEqual(x.value, y.value)
    }
    return same(claim.local, view.remote) && same(claim.remote, view.local)
  }

  const setLog = (next: ChatLog) => {
    if (next === log) return
    log = next
    options.onEvent({ type: 'log', log })
  }

  const drop = (from: Link) => {
    const token = tokens.get(from)
    if (token !== undefined) delete token.proved
    deviceOf.delete(from)
    selfConnections.delete(from)
    if (friendConnections.delete(from) && friendConnections.size === 0)
      options.onEvent({ type: 'offline' })
  }
  /**
   * The connection is gone: nothing is sent to it, and no hello signing a nonce from before counts
   * on it, so whoever takes its id next starts unproven.
   */
  const forget = (from: Link) => {
    const token = tokens.get(from)
    const proved = token?.proved
    drop(from)
    // Envelopes received before the leave still hold the token and read who it proved to be.
    if (token !== undefined && proved !== undefined) token.proved = proved
    tokens.delete(from)
  }

  // Merges run one after another so two batches can't race on `log`.
  let merging = Promise.resolve()
  /** The handle in the friend's last hello. */
  let heardHandle: string | undefined
  /**
   * What a hello says about mail: a sealing key counts only if signed by the very device that
   * sent the hello, so nobody can hand out a key for a device that isn't theirs.
   */
  async function heardKeys(from: Link, body: Extract<Body, { type: 'hello' }>) {
    const device = deviceOf.get(from)
    if (device === undefined || (body.sealing === undefined && body.lighthouses === undefined))
      return
    const sealing =
      body.sealing !== undefined &&
      body.sealing.device === device &&
      (await verifySealingKey(crypto, body.sealing))
        ? body.sealing
        : undefined
    options.onEvent({
      type: 'keys',
      device,
      ...(sealing === undefined ? {} : { sealing }),
      ...(body.lighthouses === undefined ? {} : { lighthouses: body.lighthouses }),
    })
  }

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
      const device = deviceOf.get(from)
      if (device !== undefined) options.onEvent({ type: 'seen', room, device })
      void heardKeys(from, body)
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
      if (friendConnections.has(from)) options.onEvent({ type: 'has', have: body.have })
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
  /**
   * What still counts when it was received before its connection left: nothing that answers the
   * connection or changes who it is (hello, bye, `log-sync`), and no typing from someone gone.
   */
  const LATE: ReadonlySet<Body['type']> = new Set([
    'presence',
    'profile',
    'buzz',
    'unfriend',
    'pair-secret',
    'pair-secret-ok',
    'log-entries',
  ])
  /**
   * Said only in the old room, the one named from both ids that is also the chat's id: the pair
   * secret moves friends from before pair secrets out of it, and counts nowhere else. Checked
   * before anything is taken once, so a copy in another room can't use up the one that counts.
   */
  const OLD_ROOM: ReadonlySet<Body['type']> = new Set(['pair-secret', 'pair-secret-ok'])
  let inbound = Promise.resolve()

  let closed = false
  function addRoom(room: Room) {
    if (closed || rooms.has(room.name)) {
      void room.leave()
      return
    }
    const offMessage = room.onMessage((connection, bytes) => {
      const from = link(room.name, connection)
      // Taken as it arrives: the connection, its nonce and its channel may be gone by the time
      // it's read. The channel is read now for the same reason, in case this is its hello.
      const token = tokenOf(from)
      const sent = token.sent
      const channel = room.binding(connection).catch(() => undefined)
      // One at a time, in order: a device log must be taken in before the hello after it.
      inbound = inbound
        .then(async () => {
          const opened = await openEnvelope(crypto, chat, bytes)
          if (!opened.ok || !rooms.has(room.name)) return
          const { body, at } = opened.value
          const device = opened.value.from
          if (OLD_ROOM.has(body.type) && room.name !== chat) return
          if (body.type === 'device-log') {
            await options.onDeviceLog?.(body.log)
            recheck()
            return
          }
          // Our own key is another run of this device, a copied profile, so it gets a hello too.
          const who = device === signer.id ? 'own' : accepts(device)
          if (who === undefined) return
          const late = () => tokens.get(from) !== token
          // Received before its connection left: only what the device proved then still counts,
          // and nothing goes back to the id, which may be someone else's by now.
          if (late() && body.type !== 'hello') {
            const was = token.proved
            if (was?.device !== device || was.who !== who) return
            if (!LATE.has(body.type) || (who === 'self' && !SELF.has(body.type))) return
            if (ONCE.has(body.type) && !firstTime(`${device} ${at} ${body.type}`)) return
            ;(handlers[body.type] as ((from: Link, body: Body, at: number) => void) | undefined)?.(
              from,
              body,
              at,
            )
            return
          }
          // A new nonce on a connection is a new greeting, as after a reconnection that kept its id.
          if (body.type === 'nonce') {
            if (token.answered.has(body.nonce) || token.answered.size >= MAX_ANSWERED) return
            token.answered.add(body.nonce)
            token.theirs = body.nonce
            sayHello(from)
            return
          }
          if (body.type === 'hello') {
            if (!(await bound(body, sent, channel)) || !rooms.has(room.name)) return
            // Asked again after the wait, so a removal taken in meanwhile still counts.
            const now = device === signer.id ? 'own' : accepts(device)
            if (now !== who) return
            // Our own key, from a run that isn't this one: this device is open somewhere else.
            if (who === 'own') {
              if (
                body.instance !== undefined &&
                options.instance !== undefined &&
                body.instance !== options.instance
              )
                options.onTwin?.()
              return
            }
            // A connection is one device: another's hello can't take it over.
            if (token.proved !== undefined && token.proved.device !== device) return
            // It left before its hello was read: what it sent after the hello still counts.
            if (late()) {
              token.proved = { device, who }
              return
            }
            const proved = deviceOf.get(from)
            if (proved !== undefined && proved !== device) return
            token.proved = { device, who }
            deviceOf.set(from, device)
            if (who === 'self') selfConnections.add(from)
            else handlers.hello?.(from, body, at)
            if (proved === undefined) catchUp(from)
            return
          }
          // Anything else counts only from the device whose bound hello proved this connection.
          if (who === 'own' || deviceOf.get(from) !== device) return
          if (who === 'self') {
            if (selfConnections.has(from) && SELF.has(body.type))
              (handlers[body.type] as (from: Link, body: Body, at: number) => void)(from, body, at)
            return
          }
          if (!friendConnections.has(from)) return
          if (ONCE.has(body.type) && !firstTime(`${device} ${at} ${body.type}`)) return
          const handler = handlers[body.type] as
            | ((from: Link, body: Body, at: number) => void)
            | undefined
          handler?.(from, body, at)
        })
        // A message that breaks something must not stop the ones after it.
        .catch(() => undefined)
    })
    const offJoin = room.onPeerJoin((peer) => greet(link(room.name, peer)))
    // At once, not behind the messages still being read: nothing more is sent to the id, which
    // someone else may take next, and a peer that reconnects under it is greeted afresh. What was
    // received before still counts, read against the token it arrived under.
    const offLeave = room.onPeerLeave((peer) => forget(link(room.name, peer)))
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
    for (const id of new Set([...deviceOf.keys(), ...tokens.keys()]))
      if (id.startsWith(`${name}\n`)) forget(id)
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
    takeEntries(entries) {
      merging = merging.then(async () =>
        setLog(await mergeEntries(crypto, log, entries, authors())),
      )
      return merging
    },
    typing: (active) => sendTo('all', { type: 'typing', active }),
    buzz: () => sendTo('all', { type: 'buzz' }),
    goodbye() {
      if (bye === undefined) return
      for (const id of friendConnections) deliver(id, bye)
      prepareBye()
    },
    announce() {
      for (const id of friendConnections) sayHello(id)
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
      sendTo('old', { type: 'pair-secret', secret })
      await queue
    },
    async confirmSecret() {
      sendTo('old', { type: 'pair-secret-ok' })
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
