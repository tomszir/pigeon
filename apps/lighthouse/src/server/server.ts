// The Lighthouse's WebSocket server: one connection per client, each frame one request, each
// reply one frame back. Clients reach Lighthouses over WebSocket only, so the
// Lighthouse sees each client's address and nobody else does.
//
// It doesn't check a connection's Origin. Pigeon is served from more than one origin (a copy
// someone hosts themselves, a dev server's port), clients outside a browser send none, and
// nothing a Lighthouse answers depends on who asks: the limits below, counted by address, are
// what keep one client from taking more than its share.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { MAX_FRAME_BYTES } from '@pigeon/core'
import {
  addressRange,
  DEFAULT_LIMITS,
  type Lighthouse,
  type Limits,
  wideRange,
} from '@pigeon/lighthouse'
import { type WebSocket, WebSocketServer } from 'ws'
import { createConnections } from './connections.ts'

/**
 * Replies a client may leave unread before it's cut off. Replies are made whether or not the
 * last ones were read, so a client that never reads would otherwise have them kept for it
 * without end.
 */
export const MAX_BUFFERED_BYTES = 1024 * 1024

/**
 * Replies all clients together may have waiting to be sent. Once they add up to this, a client
 * that still has replies of its own unread is cut off when it asks for more; one that has read
 * everything is still answered, so clients that keep up aren't cut off for those that don't.
 */
export const MAX_SERVER_BUFFERED_BYTES = 64 * 1024 * 1024

/**
 * Replies one address range, and one IPv6 /48, may have waiting across all its connections, so
 * no one address can fill the server's share by itself.
 */
export const MAX_RANGE_BUFFERED_BYTES = 8 * 1024 * 1024
export const MAX_WIDE_BUFFERED_BYTES = 16 * 1024 * 1024

/** Replies waiting to be sent, in all and by range, counted as each is sent and written. */
export class SendBudget {
  used = 0
  private readonly byKey = new Map<string, number>()
  readonly max: number
  readonly maxRange: number
  readonly maxWide: number
  constructor(
    max = MAX_SERVER_BUFFERED_BYTES,
    maxRange = MAX_RANGE_BUFFERED_BYTES,
    maxWide = MAX_WIDE_BUFFERED_BYTES,
  ) {
    this.max = max
    this.maxRange = maxRange
    this.maxWide = maxWide
  }
  held(key: string | undefined): number {
    return key === undefined ? 0 : (this.byKey.get(key) ?? 0)
  }
  move(keys: readonly (string | undefined)[], by: number): void {
    this.used += by
    for (const key of keys) {
      if (key === undefined) continue
      const held = this.held(key) + by
      if (held <= 0) this.byKey.delete(key)
      else this.byKey.set(key, held)
    }
  }
}

export interface ServerOptions {
  readonly lighthouse: Lighthouse
  readonly host: string
  readonly port: number
  readonly trustForwardedFor: boolean
  /** What a plain HTTP visit to it shows: its address, so it can be added to Pigeon. */
  readonly address: string
  /** The connection limits and idle time it keeps to; the rest are the Lighthouse's own. */
  readonly limits?: Limits | undefined
}

export interface RunningServer {
  readonly port: number
  close(): Promise<void>
}

/** The client's address: the socket's, or the proxy's X-Forwarded-For when that's trusted. */
export function clientAddress(request: IncomingMessage, trustForwardedFor: boolean): string {
  const forwarded = request.headers['x-forwarded-for']
  if (trustForwardedFor && typeof forwarded === 'string') {
    // The last hop is the one the trusted proxy added.
    const hops = forwarded.split(',').map((hop) => hop.trim())
    const last = hops.at(-1)
    if (last !== undefined && last !== '') return last
  }
  return request.socket.remoteAddress ?? 'unknown'
}

/**
 * Sends a reply, or cuts the socket off: when the client has left too much unread, when its
 * range or /48 has, or when all clients together are over the server's budget and this one
 * still has replies unread.
 */
export function sendOrCut(
  socket: Pick<WebSocket, 'readyState' | 'OPEN' | 'bufferedAmount' | 'send' | 'terminate'>,
  reply: string,
  max = MAX_BUFFERED_BYTES,
  budget: SendBudget = new SendBudget(),
  range?: string,
  wide?: string,
): void {
  if (socket.readyState !== socket.OPEN) return
  const size = Buffer.byteLength(reply)
  const over =
    socket.bufferedAmount + size > max ||
    budget.held(range) + size > budget.maxRange ||
    budget.held(wide) + size > budget.maxWide ||
    (budget.used + size > budget.max && socket.bufferedAmount > 0)
  // Terminated, not closed: a closing handshake would only queue behind what's unread.
  if (over) {
    socket.terminate()
    return
  }
  const keys = [range, wide]
  budget.move(keys, size)
  // Called once the reply is written out, or with an error when the socket goes first.
  socket.send(reply, () => budget.move(keys, -size))
}

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const limits = options.limits ?? DEFAULT_LIMITS
  const http: Server = createServer((request, response) => {
    response.writeHead(request.url === '/' ? 200 : 404, {
      'content-type': 'text/plain; charset=utf-8',
    })
    response.end(
      request.url === '/' ? `A Pigeon Lighthouse. Add it in Pigeon:\n\n${options.address}\n` : '',
    )
  })
  const sockets = new WebSocketServer({ server: http, maxPayload: MAX_FRAME_BYTES })
  const budget = new SendBudget()
  const connections = createConnections({
    lighthouse: options.lighthouse,
    limits,
    now: Date.now,
  })
  // Leases that ended are answered, and connections gone quiet closed, within a second.
  const ticker = setInterval(() => void connections.tick().catch(() => undefined), 1000)
  ticker.unref()

  sockets.on('connection', (socket, request) => {
    const address = clientAddress(request, options.trustForwardedFor)
    const range = addressRange(address)
    const wide = wideRange(range)
    const connection = connections.open(
      {
        send: (frame) => sendOrCut(socket, frame, MAX_BUFFERED_BYTES, budget, range, wide),
        close: (code, reason) => socket.close(code, reason),
      },
      address,
    )
    if (connection === undefined) {
      // Terminated, not closed: a client that never answers the close would otherwise keep the
      // socket for ws's 30 seconds, uncounted.
      socket.terminate()
      return
    }
    socket.on('close', () => connection.closed())
    socket.on('message', (data, binary) => {
      if (binary) {
        socket.close(1003, 'text frames only')
        return
      }
      void connection.message(data.toString()).catch(() => socket.close(1011, 'error'))
    })
  })
  return new Promise((resolve, reject) => {
    http.once('error', reject)
    http.listen(options.port, options.host, () => {
      const address = http.address()
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : options.port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(ticker)
            for (const client of sockets.clients) client.terminate()
            sockets.close(() => http.close(() => done()))
          }),
      })
    })
  })
}
