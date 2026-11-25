// The Worker Lighthouse's Durable Object (decision 0037): one per Lighthouse, holding the mail
// in its SQLite and every client's WebSocket. Sockets hibernate while idle, so an idle
// Lighthouse costs nothing; each keeps what its connection needs (its client's address, whether
// it said hello, its nonce) attached to it, and is picked up again when a frame wakes it.
import { formatLighthouseAddress, MAX_FRAME_BYTES } from '@pigeon/core'
import {
  createLighthouse,
  createSqlStore,
  type Lighthouse,
  type LighthouseConnection,
  type SavedConnection,
  type SqlDatabase,
} from '@pigeon/lighthouse'
import pigeon from '../../../../package.json' with { type: 'json' }
import { createWorkerCrypto, signerFromKey } from '../platform/worker-crypto.ts'
import type { DurableObjectState, Env, HibernatingSocket } from '../platform/worker-types.ts'

const HOUR = 60 * 60 * 1000
/** The header the front Worker passes the client's address in; a client's own is dropped. */
export const CLIENT_ADDRESS = 'x-pigeon-client-address'

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
}

const isAttachment = (value: unknown): value is Attachment =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Attachment).address === 'string' &&
  typeof (value as Attachment).greeted === 'boolean' &&
  typeof (value as Attachment).nonce === 'string'

/** Close codes a socket may echo back; anything else (1005, 1006: no code, dropped) is 1000. */
const echoable = (code: number) => code === 1000 || (code >= 3000 && code <= 4999)

const bytesOf = (text: string) => new TextEncoder().encode(text).length

export class LighthouseObject {
  private lighthouse: Promise<{ lighthouse: Lighthouse; address: string }> | undefined
  private readonly connections = new WeakMap<WebSocket, LighthouseConnection>()

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  /** Made on first use after waking: the key, the store, the mailbox and its address. */
  private open(): Promise<{ lighthouse: Lighthouse; address: string }> {
    this.lighthouse ??= (async () => {
      const signer = await signerFromKey(this.env.LIGHTHOUSE_KEY)
      const build = this.env.PIGEON_BUILD
      const address = formatLighthouseAddress({
        id: signer.id,
        name: this.env.LIGHTHOUSE_NAME,
        url: this.env.LIGHTHOUSE_URL,
      })
      const lighthouse = createLighthouse({
        signer,
        crypto: createWorkerCrypto(),
        store: createSqlStore(durableSqlDatabase(this.state.storage.sql)),
        now: Date.now,
        name: this.env.LIGHTHOUSE_NAME,
        software: {
          name: 'pigeon-lighthouse-worker',
          version: pigeon.version,
          ...(build === undefined || build === '' ? {} : { build }),
        },
      })
      return { lighthouse, address }
    })()
    return this.lighthouse
  }

  async fetch(request: Request): Promise<Response> {
    const { lighthouse, address } = await this.open()
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(`A Pigeon Lighthouse. Add it in Pigeon:\n\n${address}\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1] as HibernatingSocket]
    this.state.acceptWebSocket(server)
    const attachment: Attachment = {
      address: request.headers.get(CLIENT_ADDRESS) ?? 'unknown',
      greeted: false,
      nonce: '',
    }
    server.serializeAttachment(attachment)
    this.connections.set(server, lighthouse.connect(attachment.address))
    if ((await this.state.storage.getAlarm()) === null)
      await this.state.storage.setAlarm(Date.now() + HOUR)
    return new Response(null, { status: 101, webSocket: client } as ResponseInit)
  }

  async webSocketMessage(socket: HibernatingSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || bytesOf(message) > MAX_FRAME_BYTES) {
      socket.close(1003, 'text frames only')
      return
    }
    const { lighthouse } = await this.open()
    let connection = this.connections.get(socket)
    const saved = socket.deserializeAttachment()
    if (connection === undefined) {
      // Woken from hibernation: the same connection, from what it kept.
      if (!isAttachment(saved)) {
        socket.close(1011, 'lost')
        return
      }
      connection = lighthouse.connect(saved.address, saved)
      this.connections.set(socket, connection)
    }
    const reply = await connection.receive(message)
    if (isAttachment(saved)) socket.serializeAttachment({ ...saved, ...connection.saved() })
    socket.send(reply)
  }

  webSocketClose(socket: WebSocket, code: number): void {
    try {
      socket.close(echoable(code) ? code : 1000, 'closing')
    } catch {
      // Already closed: nothing to answer.
    }
  }

  /**
   * Every hour while there's mail or a client: expired mail goes. An empty Lighthouse with
   * nobody connected stops waking, and the next client to connect sets it going again.
   */
  async alarm(): Promise<void> {
    const { lighthouse } = await this.open()
    await lighthouse.sweep()
    const store = createSqlStore(durableSqlDatabase(this.state.storage.sql))
    if ((await store.totalBytes()) > 0 || this.state.getWebSockets().length > 0)
      await this.state.storage.setAlarm(Date.now() + HOUR)
  }
}
