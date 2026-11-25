// The Worker Lighthouse's Durable Object: one per Lighthouse, holding the mail
// in its SQLite and every client's WebSocket. Sockets hibernate while idle, so an idle
// Lighthouse costs nothing; each keeps what its connection needs (its client's address, whether
// it said hello, its nonce, when it last sent anything) attached to it, and is picked up again
// when a frame wakes it.
//
// It doesn't check a connection's Origin. Pigeon is served from more than one origin (a copy
// someone hosts themselves, a dev server's port), clients outside a browser send none, and
// nothing a Lighthouse answers depends on who asks: the limits, counted by address, are what
// keep one client from taking more than its share.
import { formatLighthouseAddress, MAX_FRAME_BYTES } from '@pigeon/core'
import {
  addressRange,
  createLighthouse,
  createSqlStore,
  DEFAULT_LIMITS,
  type Lighthouse,
  type LighthouseConnection,
  type MailStore,
  roomForConnection,
  type SavedConnection,
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
 * How often a new connection that finds no room may look for idle ones to close. Looking reads
 * every socket's attachment, so a stream of refused connections doesn't each pay for it.
 */
const RECLAIM_EVERY_MS = 10 * 1000

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

export class LighthouseObject {
  private lighthouse: Promise<Opened> | undefined
  private readonly connections = new WeakMap<WebSocket, LighthouseConnection>()
  /** Sockets this object closed, which may be listed as open until the runtime lets them go. */
  private readonly closed = new WeakSet<WebSocket>()
  private reclaimedAt = -Infinity

  /** The runtime makes it with the first two; tests pass limits of their own. */
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly limits = DEFAULT_LIMITS,
  ) {}

  /** Made on first use after waking: the key, the store, the mailbox and its address. */
  private open(): Promise<Opened> {
    this.lighthouse ??= (async () => {
      const signer = await signerFromKey(this.env.LIGHTHOUSE_KEY)
      const build = this.env.PIGEON_BUILD
      const address = formatLighthouseAddress({
        id: signer.id,
        name: this.env.LIGHTHOUSE_NAME,
        url: this.env.LIGHTHOUSE_URL,
      })
      // One store for the object's life: it keeps the running total of what's held.
      const store = createSqlStore(durableSqlDatabase(this.state.storage.sql))
      const lighthouse = createLighthouse({
        signer,
        crypto: createWorkerCrypto(),
        store,
        now: Date.now,
        name: this.env.LIGHTHOUSE_NAME,
        software: {
          name: 'pigeon-lighthouse-worker',
          version: pigeon.version,
          ...(build === undefined || build === '' ? {} : { build }),
        },
        limits: this.limits,
      })
      return { lighthouse, store, address }
    })()
    return this.lighthouse
  }

  private close(socket: WebSocket, code: number, reason: string) {
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

  /**
   * Closes connections that have sent nothing for the idle time, freeing their places. A
   * hibernating socket costs nothing while it sleeps, so this is done only when the places are
   * wanted, and by the hourly alarm.
   */
  private closeIdle(now: number) {
    this.reclaimedAt = now
    const before = now - this.limits.idleSeconds * 1000
    for (const socket of this.state.getWebSockets()) {
      if (this.closed.has(socket)) continue
      const saved = (socket as HibernatingSocket).deserializeAttachment()
      if (!isAttachment(saved) || saved.seen <= before) this.close(socket, 1000, 'idle')
    }
  }

  async fetch(request: Request): Promise<Response> {
    const { lighthouse, address } = await this.open()
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(`A Pigeon Lighthouse. Add it in Pigeon:\n\n${address}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    const now = Date.now()
    const client = request.headers.get(CLIENT_ADDRESS) ?? 'unknown'
    const range = addressRange(client)
    if (!this.room(range) && now - this.reclaimedAt >= RECLAIM_EVERY_MS) this.closeIdle(now)
    if (!this.room(range)) return new Response('busy', { status: 503 })
    const pair = new WebSocketPair()
    const [peer, server] = [pair[0], pair[1] as HibernatingSocket]
    // Tagged with its range and /48, so the runtime can count them even after hibernation.
    const wide = wideRange(range)
    this.state.acceptWebSocket(server, wide === undefined ? [range] : [range, wide])
    const attachment: Attachment = { address: client, greeted: false, nonce: '', seen: now }
    server.serializeAttachment(attachment)
    this.connections.set(server, lighthouse.connect(attachment.address))
    if ((await this.state.storage.getAlarm()) === null)
      await this.state.storage.setAlarm(Date.now() + HOUR)
    return new Response(null, { status: 101, webSocket: peer } as ResponseInit)
  }

  async webSocketMessage(socket: HibernatingSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || bytesOf(message) > MAX_FRAME_BYTES) {
      this.close(socket, 1003, 'text frames only')
      return
    }
    const { lighthouse } = await this.open()
    let connection = this.connections.get(socket)
    const saved = socket.deserializeAttachment()
    if (!isAttachment(saved)) {
      this.close(socket, 1011, 'lost')
      return
    }
    if (connection === undefined) {
      // Woken from hibernation: the same connection, from what it kept.
      connection = lighthouse.connect(saved.address, saved)
      this.connections.set(socket, connection)
    }
    const seen = Date.now()
    const reply = await connection.receive(message)
    if (reply === undefined) {
      // Its range sent more frames than it may: closed, unanswered.
      this.close(socket, 1008, 'limit')
      return
    }
    try {
      socket.serializeAttachment({ ...saved, ...connection.saved(), seen })
      socket.send(reply)
    } catch {
      // Closed while the reply was being made, by the client or a limit: nobody to answer.
    }
  }

  webSocketClose(socket: WebSocket, code: number): void {
    this.close(socket, echoable(code) ? code : 1000, 'closing')
  }

  /**
   * Every hour while there's mail or a client: expired mail goes, and so do connections that
   * have sat idle. An empty Lighthouse with nobody connected stops waking, and the next client
   * to connect sets it going again.
   */
  async alarm(): Promise<void> {
    const { lighthouse, store } = await this.open()
    await lighthouse.sweep()
    this.closeIdle(Date.now())
    if ((await store.totalBytes()) > 0 || this.openSockets() > 0)
      await this.state.storage.setAlarm(Date.now() + HOUR)
  }
}
