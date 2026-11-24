// Talking to one friend in your pair room: say hello, catch each other up on the chat log, and
// pass typing, buzz and presence along. Pure protocol over a Room; the app stores the log and
// draws the events.

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
import type { ConnectionId, Room } from '../transport/transport.ts'
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

export interface PairSessionOptions {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly friend: PeerId
  readonly room: Room
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
  close(): Promise<void>
}

export function startPairSession(options: PairSessionOptions): PairSession {
  const { crypto, signer, friend, room } = options
  const hello = (): Body => ({
    type: 'hello',
    handle: options.handle(),
    avatar: options.avatar?.() ?? AVATAR_VERSION,
  })
  let log = options.log
  /** Connections that have proved, by a signed envelope, to be the friend. */
  const friendConnections = new Set<ConnectionId>()
  const authors = new Set([signer.id, friend])
  // Sends go out in order even though sealing is async.
  let queue = Promise.resolve()

  const seal = (body: Body) => sealEnvelope(signer, room.name, options.now(), body)
  const sendTo = (to: ConnectionId | 'all', body: Body) => {
    queue = queue.then(async () => {
      const bytes = await seal(body)
      if (to === 'all') for (const id of friendConnections) room.send(id, bytes)
      else room.send(to, bytes)
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

  const greet = (to: ConnectionId) => {
    sendTo(to, hello())
    sendTo(to, { type: 'presence', ...options.presence() })
    sendTo(to, { type: 'log-sync', have: summarize(log) })
  }

  const setLog = (next: ChatLog) => {
    if (next === log) return
    log = next
    options.onEvent({ type: 'log', log })
  }

  // Merges run one after another so two batches can't race on `log`.
  let merging = Promise.resolve()
  const handlers: {
    [T in Body['type']]?: (from: ConnectionId, body: Extract<Body, { type: T }>) => void
  } = {
    hello: (from, body) => {
      const first = friendConnections.size === 0
      friendConnections.add(from)
      if (first) options.onEvent({ type: 'online', handle: body.handle, avatar: body.avatar ?? 1 })
    },
    presence: (_from, body) =>
      options.onEvent({
        type: 'presence',
        presence: { status: body.status, message: body.message },
      }),
    typing: (_from, body) => options.onEvent({ type: 'typing', active: body.active }),
    buzz: () => options.onEvent({ type: 'buzz' }),
    unfriend: () => options.onEvent({ type: 'unfriended' }),
    bye: (from) => {
      if (friendConnections.delete(from) && friendConnections.size === 0)
        options.onEvent({ type: 'offline' })
    },
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

  const offMessage = room.onMessage((from, bytes) => {
    void openEnvelope(crypto, room.name, bytes).then((opened) => {
      if (!opened.ok || opened.value.from !== friend) return
      const body = opened.value.body
      // Anything but hello from a connection that hasn't said hello yet is ignored.
      if (body.type !== 'hello' && !friendConnections.has(from)) return
      const handler = handlers[body.type] as ((from: ConnectionId, body: Body) => void) | undefined
      handler?.(from, body)
    })
  })
  const offJoin = room.onPeerJoin(greet)
  const offLeave = room.onPeerLeave((peer) => {
    if (!friendConnections.delete(peer) || friendConnections.size > 0) return
    options.onEvent({ type: 'offline' })
  })
  for (const peer of room.peers()) greet(peer)

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
      for (const id of friendConnections) room.send(id, bye)
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
    async close() {
      offMessage()
      offJoin()
      offLeave()
      await queue
      await room.leave()
    },
  }
}
