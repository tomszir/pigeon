// The Worker Lighthouse's Durable Object: one per Lighthouse, holding the mail
// in its SQLite and every client's WebSocket. Sockets hibernate while idle, so an idle
// Lighthouse costs nothing; each keeps what its connection needs (its client's address, whether
// it said hello, its nonce, its standing wait, when it last sent anything) attached to it. When
// something wakes the object, every socket's connection is picked up again from that, so the
// index of waits is whole before anything else happens. Keepalives are answered by the runtime
// without waking it, and it has no timers: a lease that has ended is answered, and a connection
// gone quiet closed, when something next wakes it.
//
// It doesn't check a connection's Origin. Pigeon is served from more than one origin (a copy
// someone hosts themselves, a dev server's port), clients outside a browser send none, and
// nothing a Lighthouse answers depends on who asks: the limits, counted by address, are what
// keep one client from taking more than its share.
import { formatLighthouseAddress, KEEPALIVE, KEEPALIVE_ANSWER, MAX_FRAME_BYTES } from '@pigeon/core'
import {
  addressRange,
  createLighthouse,
  createSqlStore,
  DEFAULT_LIMITS,
  type Lighthouse,
  type LighthouseConnection,
  type Limits,
  type MailStore,
  roomForConnection,
  type SavedConnection,
  type Scope,
  type SqlDatabase,
  wideRange,
} from '@pigeon/lighthouse'
import pigeon from '../../../../package.json' with { type: 'json' }
import { createWorkerCrypto, signerFromKey } from '../platform/worker-crypto.ts'
import type { DurableObjectState, Env, HibernatingSocket } from '../platform/worker-types.ts'

const HOUR = 60 * 60 * 1000
/** The header the front Worker passes the client's address in; a client's own is dropped. */
export const CLIENT_ADDRESS = 'x-pigeon-client-address'

/**
 * The Worker's limits: Node's, but room for 30,000 connections, under the 32,768 a Durable Object
 * takes, since a sleeping socket costs it nothing and each open Pigeon keeps one to wait on.
 */
export const WORKER_LIMITS: Limits = { ...DEFAULT_LIMITS, maxConnections: 30_000 }

/** A Durable Object's SQLite as the SqlDatabase the shared store runs on. */
export function durableSqlDatabase(sql: DurableObjectState['storage']['sql']): SqlDatabase {
  return {
    exec(query, ...values) {
      const cursor = sql.exec(query, ...values)
      const rows = cursor.toArray()
      return { rows, changes: cursor.rowsWritten }
    },
  }
}

/**
 * The one number written down about waits: the highest seq whose wakes have all been sent. A put
 * stored and then lost to a reset before its wakes went is woken again from it.
 */
const STATE_TABLE =
  'CREATE TABLE IF NOT EXISTS lighthouse_state (name TEXT PRIMARY KEY, value INTEGER NOT NULL)'

interface Attachment extends SavedConnection {
  readonly address: string
  /** When the client last sent a frame, or connected. */
  readonly seen: number
}

const isAttachment = (value: unknown): value is Attachment =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Attachment).address === 'string' &&
  typeof (value as Attachment).greeted === 'boolean' &&
  typeof (value as Attachment).nonce === 'string' &&
  typeof (value as Attachment).seen === 'number'

/** Close codes a socket may echo back; anything else (1005, 1006: no code, dropped) is 1000. */
const echoable = (code: number) => code === 1000 || (code >= 3000 && code <= 4999)

const bytesOf = (text: string) => new TextEncoder().encode(text).length

interface Opened {
  readonly lighthouse: Lighthouse
  readonly store: MailStore
  readonly address: string
}

export interface ObjectOptions {
  readonly now?: () => number
  /** How a put's wakes are run after its reply; a timer of no delay unless a test says. */
  readonly defer?: (run: () => void) => void
}

export class LighthouseObject {
  private lighthouse: Promise<Opened> | undefined
  private readonly connections = new WeakMap<WebSocket, LighthouseConnection>()
  /** When each socket last sent a frame, since the object woke. */
  private readonly seen = new WeakMap<WebSocket, number>()
  /** Sockets this object closed, which may be listed as open until the runtime lets them go. */
  private readonly closed = new WeakSet<WebSocket>()
  private readonly now: () => number

  /** The runtime makes it with the first two; tests pass limits and a clock of their own. */
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly limits: Limits = WORKER_LIMITS,
    private readonly options: ObjectOptions = {},
  ) {
    this.now = options.now ?? Date.now
    // Keepalives from waiting connections, answered without waking the object or billing it.
    if (typeof WebSocketRequestResponsePair !== 'undefined')
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE, KEEPALIVE_ANSWER))
  }

  /**
   * Made on first use after waking: the key, the store, the mailbox and its address; then every
   * socket's connection, waits and all, from what it kept, and the wakes a reset may have lost.
   */
  private open(): Promise<Opened> {
    this.lighthouse ??= (async () => {
      const signer = await signerFromKey(this.env.LIGHTHOUSE_KEY)
      const build = this.env.PIGEON_BUILD
      const address = formatLighthouseAddress({
        id: signer.id,
        name: this.env.LIGHTHOUSE_NAME,
        url: this.env.LIGHTHOUSE_URL,
      })
      const sql = this.state.storage.sql
      sql.exec(STATE_TABLE)
      // One store for the object's life: it keeps the running total of what's held.
      const store = createSqlStore(durableSqlDatabase(sql))
      const lighthouse = createLighthouse({
        signer,
        crypto: createWorkerCrypto(),
        store,
        now: this.now,
        name: this.env.LIGHTHOUSE_NAME,
        software: {
          name: 'pigeon-lighthouse-worker',
          version: pigeon.version,
          ...(build === undefined || build === '' ? {} : { build }),
        },
        limits: this.limits,
        defer: this.options.defer,
        onWoken: (seq) => this.wokeThrough(seq),
      })
      for (const socket of this.state.getWebSockets()) {
        if (this.closed.has(socket)) continue
        const saved = (socket as HibernatingSocket).deserializeAttachment()
        if (isAttachment(saved)) this.connect(lighthouse, socket as HibernatingSocket, saved)
      }
      const kept = sql.exec("SELECT value FROM lighthouse_state WHERE name = 'woke'").toArray()[0]
      if (kept === undefined) {
        // Never written: nothing put since waits began can have lost its wakes yet.
        const top = sql.exec('SELECT COALESCE(MAX(seq), 0) AS seq FROM blobs').toArray()[0]
        this.wokeThrough(Number(top?.['seq'] ?? 0))
      } else {
        const through = Number(kept['value'])
        const looked = await lighthouse.catchUp(through)
        if (looked > through) this.wokeThrough(looked)
      }
      return { lighthouse, store, address }
    })()
    return this.lighthouse
  }

  /** What every event does first: wake up whole, and answer the leases that have ended. */
  private async arrive(): Promise<Opened> {
    const opened = await this.open()
    await opened.lighthouse.expireWaits()
    return opened
  }

  private wokeThrough(seq: number) {
    this.state.storage.sql.exec(
      "INSERT INTO lighthouse_state (name, value) VALUES ('woke', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
      seq,
    )
  }

  /** The connection on `socket`, from what it kept, with what the Lighthouse needs of it. */
  private connect(lighthouse: Lighthouse, socket: HibernatingSocket, saved: Attachment) {
    const connection = lighthouse.connect(saved.address, saved, {
      push: (frame) => {
        try {
          socket.send(frame)
        } catch {
          // Closed meanwhile: nobody to tell.
        }
      },
      close: (code, reason) => this.close(socket, code, reason),
      heard: () => this.heard(socket),
      changed: () => this.keep(socket),
    })
    this.connections.set(socket, connection)
    return connection
  }

  /** Writes what the connection must remember onto its socket, for when the object sleeps. */
  private keep(socket: WebSocket) {
    const kept = (socket as HibernatingSocket).deserializeAttachment()
    const connection = this.connections.get(socket)
    if (!isAttachment(kept) || connection === undefined) return
    try {
      ;(socket as HibernatingSocket).serializeAttachment({
        ...kept,
        ...connection.saved(),
        seen: this.seen.get(socket) ?? kept.seen,
      })
    } catch {
      // Closed meanwhile.
    }
  }

  /** When a socket was last heard from: its last frame, or the runtime's last keepalive answer. */
  private heard(socket: WebSocket): number {
    const kept = (socket as HibernatingSocket).deserializeAttachment()
    const frame = this.seen.get(socket) ?? (isAttachment(kept) ? kept.seen : 0)
    const keepalive = this.state.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0
    return Math.max(frame, keepalive)
  }

  private close(socket: WebSocket, code: number, reason: string) {
    if (!this.closed.has(socket)) this.connections.get(socket)?.gone()
    this.closed.add(socket)
    try {
      socket.close(code, reason)
    } catch {
      // Already closed.
    }
  }

  /** Open sockets, all of them or those tagged with an address range. */
  private openSockets(tag?: string): number {
    return this.state.getWebSockets(tag).filter((socket) => !this.closed.has(socket)).length
  }

  /** Whether one more connection from `range` fits beside those open. */
  private room(range: string): boolean {
    const wide = wideRange(range)
    return roomForConnection(this.limits, {
      total: this.openSockets(),
      range: this.openSockets(range),
      wide: wide === undefined ? 0 : this.openSockets(wide),
    })
  }

  /** The limit that's full for a newcomer from `range`, so closing a waiter within it makes room. */
  private scope(range: string): Scope {
    const wide = wideRange(range)
    if (this.openSockets(range) >= this.limits.connectionsPerRange) return { kind: 'range', range }
    if (wide !== undefined && this.openSockets(wide) >= this.limits.connectionsPer48)
      return { kind: 'wide', wide }
    return { kind: 'any' }
  }

  /**
   * Closes connections not heard from for the idle time, neither a frame nor a keepalive, freeing
   * their places. A hibernating socket costs nothing while it sleeps, so this is done only when
   * the places are wanted, and by the hourly alarm.
   */
  private closeIdle(now: number) {
    const before = now - this.limits.idleSeconds * 1000
    for (const socket of this.state.getWebSockets()) {
      if (this.closed.has(socket)) continue
      if (this.heard(socket) <= before) this.close(socket, 1000, 'idle')
    }
  }

  async fetch(request: Request): Promise<Response> {
    const { lighthouse, address } = await this.arrive()
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(`A Pigeon Lighthouse. Add it in Pigeon:\n\n${address}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    const now = this.now()
    const client = request.headers.get(CLIENT_ADDRESS) ?? 'unknown'
    const range = addressRange(client)
    // No room: those gone quiet go first, then the waiter that has stood longest.
    if (!this.room(range)) this.closeIdle(now)
    if (!this.room(range)) lighthouse.evict(this.scope(range))
    if (!this.room(range)) return new Response('busy', { status: 503 })
    const pair = new WebSocketPair()
    const [peer, server] = [pair[0], pair[1] as HibernatingSocket]
    // Tagged with its range and /48, so the runtime can count them even after hibernation.
    const wide = wideRange(range)
    this.state.acceptWebSocket(server, wide === undefined ? [range] : [range, wide])
    const attachment: Attachment = { address: client, greeted: false, nonce: '', seen: now }
    server.serializeAttachment(attachment)
    this.seen.set(server, now)
    this.connect(lighthouse, server, attachment)
    if ((await this.state.storage.getAlarm()) === null)
      await this.state.storage.setAlarm(this.now() + HOUR)
    return new Response(null, { status: 101, webSocket: peer } as ResponseInit)
  }

  async webSocketMessage(socket: HibernatingSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || bytesOf(message) > MAX_FRAME_BYTES) {
      this.close(socket, 1003, 'text frames only')
      return
    }
    const { lighthouse } = await this.arrive()
    const saved = socket.deserializeAttachment()
    if (!isAttachment(saved)) {
      this.close(socket, 1011, 'lost')
      return
    }
    // Picked up when the object woke; one taken on since by a runtime that didn't say is too.
    const connection = this.connections.get(socket) ?? this.connect(lighthouse, socket, saved)
    this.seen.set(socket, this.now())
    // A keepalive the runtime didn't answer itself.
    if (message === KEEPALIVE) {
      this.keep(socket)
      socket.send(KEEPALIVE_ANSWER)
      return
    }
    const reply = await connection.receive(message)
    if (reply === undefined) {
      // Its range sent more frames than it may: closed, unanswered.
      this.close(socket, 1008, 'limit')
      return
    }
    this.keep(socket)
    if (reply === null) return
    try {
      socket.send(reply)
    } catch {
      // Closed while the reply was being made, by the client or a limit: nobody to answer.
    }
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    // What was due first: a lease that ended, or a wake a reset lost, is answered before it goes.
    await this.arrive().catch(() => undefined)
    this.close(socket, echoable(code) ? code : 1000, 'closing')
  }

  /** Done once every put's wakes have been answered: for tests. Nothing, before it has woken. */
  async settled(): Promise<void> {
    if (this.lighthouse !== undefined) await (await this.lighthouse).lighthouse.settled()
  }

  /**
   * Every hour while there's mail or a client: expired mail goes, and so do connections that
   * have sat idle. An empty Lighthouse with nobody connected stops waking, and the next client
   * to connect sets it going again.
   */
  async alarm(): Promise<void> {
    const { lighthouse, store } = await this.arrive()
    await lighthouse.sweep()
    this.closeIdle(this.now())
    if ((await store.totalBytes()) > 0 || this.openSockets() > 0)
      await this.state.storage.setAlarm(this.now() + HOUR)
  }
}
