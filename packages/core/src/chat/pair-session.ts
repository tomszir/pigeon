// Talking to one friend in your pair rooms: say hello, catch each other up on the chat log, and
// pass typing, buzz and presence along. A friend can be in several rooms at once (today's and
// yesterday's around midnight, or the old room while moving; decision 0026), so a session spans
// rooms that come and go. Pure protocol over Rooms; the app stores the log and draws the events.

import { AVATAR_VERSION } from '../avatar/avatar.ts'
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
  mergeEntries,
  missingFrom,
  summarize,
} from './chat-log.ts'

/** Room left in an envelope for everything around the entries. */
const ENTRY_BATCH_BYTES = MAX_MESSAGE_BYTES - 4 * 1024

export interface Presence {
  readonly status: Status
  readonly message: string
}

export type PairEvent =
  /** `avatar`: the version the friend's bird is drawn with. */
  | { readonly type: 'online'; readonly handle: string; readonly avatar: number }
  | { readonly type: 'offline' }
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
  })
  let log = options.log
  const rooms = new Map<RoomName, { room: Room; off: () => void }>()
  /** Connections that have proved, by a signed envelope, to be the friend. */
  const friendConnections = new Set<Link>()
  const authors = new Set([signer.id, friend])
  // Sends go out in order even though sealing is async.
  let queue = Promise.resolve()

  const deliver = (to: Link, bytes: Uint8Array) => {
    const cut = to.indexOf('\n')
    rooms.get(to.slice(0, cut) as RoomName)?.room.send(to.slice(cut + 1), bytes)
  }
  const seal = (body: Body) => sealEnvelope(signer, chat, options.now(), body)
  const sendTo = (to: Link | 'all', body: Body) => {
    queue = queue.then(async () => {
      const bytes = await seal(body)
      if (to === 'all') for (const id of friendConnections) deliver(id, bytes)
      else deliver(to, bytes)
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

  const greet = (to: Link) => {
    sendTo(to, hello())
    sendTo(to, { type: 'presence', ...options.presence() })
    sendTo(to, { type: 'log-sync', have: summarize(log) })
  }

  const setLog = (next: ChatLog) => {
    if (next === log) return
    log = next
    options.onEvent({ type: 'log', log })
  }

  const drop = (from: Link) => {
    if (friendConnections.delete(from) && friendConnections.size === 0)
      options.onEvent({ type: 'offline' })
  }

  // Merges run one after another so two batches can't race on `log`.
  let merging = Promise.resolve()
  const handlers: {
    [T in Body['type']]?: (from: Link, body: Extract<Body, { type: T }>) => void
  } = {
    hello: (from, body) => {
      const first = friendConnections.size === 0
      const room = from.slice(0, from.indexOf('\n')) as RoomName
      const firstHere = ![...friendConnections].some((id) => id.startsWith(`${room}\n`))
      friendConnections.add(from)
      if (first) options.onEvent({ type: 'online', handle: body.handle, avatar: body.avatar ?? 1 })
      if (firstHere) options.onEvent({ type: 'met', room })
    },
    presence: (_from, body) =>
      options.onEvent({
        type: 'presence',
        presence: { status: body.status, message: body.message },
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
        setLog(await mergeEntries(crypto, log, body.entries, authors)),
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

  let closed = false
  function addRoom(room: Room) {
    if (closed || rooms.has(room.name)) {
      void room.leave()
      return
    }
    const offMessage = room.onMessage((connection, bytes) => {
      void openEnvelope(crypto, chat, bytes).then((opened) => {
        if (!opened.ok || opened.value.from !== friend || !rooms.has(room.name)) return
        const from = link(room.name, connection)
        const body = opened.value.body
        // Anything but hello from a connection that hasn't said hello yet is ignored.
        if (body.type !== 'hello' && !friendConnections.has(from)) return
        if (ONCE.has(body.type) && !firstTime(`${opened.value.at} ${body.type}`)) return
        const handler = handlers[body.type] as ((from: Link, body: Body) => void) | undefined
        handler?.(from, body)
      })
    })
    const offJoin = room.onPeerJoin((peer) => greet(link(room.name, peer)))
    const offLeave = room.onPeerLeave((peer) => drop(link(room.name, peer)))
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
      sendTo('all', { type: 'log-entries', entries: [entry] })
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
    },
    async unfriend() {
      sendTo('all', { type: 'unfriend' })
      await queue
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
      await Promise.all([...rooms.keys()].map(removeRoom))
    },
  }
}
