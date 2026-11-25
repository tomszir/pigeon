// The Lighthouse's WebSocket server: one connection per client, each frame one request, each
// reply one frame back. Clients reach Lighthouses over WebSocket only, so the
// Lighthouse sees each client's address and nobody else does.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { MAX_FRAME_BYTES } from '@pigeon/core'
import type { Lighthouse } from '@pigeon/lighthouse'
import { WebSocketServer } from 'ws'

export interface ServerOptions {
  readonly lighthouse: Lighthouse
  readonly host: string
  readonly port: number
  readonly trustForwardedFor: boolean
  /** What a plain HTTP visit to it shows: its address, so it can be added to Pigeon. */
  readonly address: string
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

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const http: Server = createServer((request, response) => {
    response.writeHead(request.url === '/' ? 200 : 404, {
      'content-type': 'text/plain; charset=utf-8',
    })
    response.end(
      request.url === '/' ? `A Pigeon Lighthouse. Add it in Pigeon:\n\n${options.address}\n` : '',
    )
  })
  const sockets = new WebSocketServer({ server: http, maxPayload: MAX_FRAME_BYTES })
  sockets.on('connection', (socket, request) => {
    const connection = options.lighthouse.connect(clientAddress(request, options.trustForwardedFor))
    socket.on('message', (data, binary) => {
      if (binary) {
        socket.close(1003, 'text frames only')
        return
      }
      void connection.receive(data.toString()).then(
        (reply) => {
          if (socket.readyState === socket.OPEN) socket.send(reply)
        },
        () => socket.close(1011, 'error'),
      )
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
            for (const client of sockets.clients) client.terminate()
            sockets.close(() => http.close(() => done()))
          }),
      })
    })
  })
}
