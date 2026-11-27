// A Pigeon's side of talking to one Lighthouse, over a socket the platform
// opens: a WebSocket in the browser. It keeps what makes the Lighthouse's signed replies mean
// anything: a fresh random nonce for every connection, request numbers that only go up within
// one, and each request taking exactly one reply, checked against the Lighthouse's key and the
// exact frame sent. One connection at a time; it opens again when the last one closed.
import { base32Encode } from '../encoding/bytes.ts'
import type { Crypto } from '../identity/crypto.ts'
import { err, ok, type Result } from '../result/result.ts'
import type { LighthouseAddress } from './address.ts'
import {
  encodeRequest,
  KEEPALIVE,
  LIGHTHOUSE_PROTOCOL,
  type LighthouseReply,
  type LighthouseRequest,
  type LighthouseSoftware,
  openReply,
} from './protocol.ts'

/** A socket the platform opened to a Lighthouse's URL: text frames each way. */
export interface LighthouseSocket {
  send(text: string): void
  close(): void
}

export interface SocketEvents {
  readonly onOpen: () => void
  readonly onMessage: (text: string) => void
  /** Closed, or failed to open: either way, it's gone. The close code, when there was one. */
  readonly onClose: (code?: number) => void
}

/** The close code a Lighthouse closes a waiting connection with to make room for a newcomer. */
export const ROOM_CLOSE = 1013

/** How often a connection with a wait standing sends a keepalive: well inside two minutes. */
export const KEEPALIVE_MS = 50_000

/**
 * How long past its lease a wait is given before it's taken as answered: a Lighthouse may answer
 * a lease late (the Worker, when something next wakes it), and an answer lost on the way must
 * never hold one of a connection's request slots for good.
 */
export const WAIT_GRACE_MS = 30_000

export type OpenSocket = (url: string, events: SocketEvents) => LighthouseSocket

export type ClientError =
  /** It couldn't be reached, or the connection dropped before the answer. */
  | 'unreachable'
  /** No answer in time. */
  | 'timeout'
  /** It speaks a protocol this Pigeon doesn't: one of you needs an update. */
  | 'protocol'
  /** It needs a pass, and this address doesn't have the right one. */
  | 'pass'
  /** It answered something that wasn't a reply it signed to this request. */
  | 'bad-reply'
  /** As many requests as a Lighthouse takes from one connection are already waiting. */
  | 'busy'
  /** The Lighthouse closed the connection to make room for another: wait for the next look. */
  | 'room'

export interface ClientOptions {
  readonly address: LighthouseAddress
  readonly crypto: Crypto
  readonly open: OpenSocket
  /** 32 random bytes, a fresh nonce for each connection. */
  readonly random: (length: number) => Uint8Array
  readonly sleep: (ms: number) => Promise<void>
  /** How long a request waits for its answer. */
  readonly timeoutMs?: number
}

type Answer = Result<LighthouseReply, ClientError>

/** Requests waiting at once, as many as a Lighthouse takes from one connection (MAX_PENDING). */
export const MAX_WAITING = 16

interface Connection {
  socket: LighthouseSocket | undefined
  readonly nonce: string
  /** Once it's open and said hello: what it runs, or why not. */
  ready: Promise<Result<LighthouseSoftware, ClientError>>
  /** Requests sent and waiting, by number, with the frame each was sent as. */
  readonly waiting: Map<
    number,
    {
      readonly sent: string
      readonly settle: (answer: Answer) => void
      /** A `wait`, which has no time limit, and keeps the connection alive while it stands. */
      readonly held: boolean
    }
  >
  /** A keepalive loop is running. */
  keeping: boolean
  next: number
  closed: boolean
  /** Requests in a row that got no answer. */
  timeouts: number
  /** Lets `ready` go on, opened or not. */
  readonly opened: () => void
}

export interface LighthouseClient {
  /** What the Lighthouse says it runs, once it's said hello: its own claim. */
  hello(): Promise<Result<LighthouseSoftware, ClientError>>
  request(request: Exclude<LighthouseRequest, { type: 'hello' }>): Promise<Answer>
  close(): void
}

export function createLighthouseClient(options: ClientOptions): LighthouseClient {
  const { address, crypto } = options
  const timeoutMs = options.timeoutMs ?? 15_000
  let current: Connection | undefined

  /**
   * Closes a connection for good: what waits on it is unreachable (or was closed for room), the
   * next call opens anew.
   */
  function drop(connection: Connection, why: ClientError = 'unreachable') {
    if (connection.closed) return
    connection.closed = true
    if (current === connection) current = undefined
    for (const { settle } of [...connection.waiting.values()]) settle(err(why))
    connection.waiting.clear()
    connection.opened()
    try {
      connection.socket?.close()
    } catch {
      // Gone already.
    }
  }

  function greeting(answer: Answer): Result<LighthouseSoftware, ClientError> {
    if (!answer.ok) return answer
    const reply = answer.value
    if (reply.type === 'hello')
      return reply.protocol === LIGHTHOUSE_PROTOCOL ? ok(reply.software) : err('protocol')
    if (reply.type === 'error' && (reply.error === 'protocol' || reply.error === 'pass'))
      return err(reply.error)
    return err('bad-reply')
  }

  function connect(): Connection {
    let opened: () => void = () => undefined
    const isOpen = new Promise<void>((resolve) => {
      opened = resolve
    })
    // Made before the socket, so a socket that fails at once still finds it.
    const connection: Connection = {
      socket: undefined,
      nonce: base32Encode(options.random(32)),
      waiting: new Map(),
      next: 1,
      closed: false,
      keeping: false,
      timeouts: 0,
      opened: () => opened(),
      ready: Promise.resolve(err('unreachable')),
    }
    // A socket that neither opens nor closes would hold every request to it, and whatever waits
    // behind them, for good: one that hasn't opened in the time a request has is given up.
    let isOpened = false
    void options.sleep(timeoutMs).then(() => {
      if (!isOpened) drop(connection)
    })
    connection.ready = isOpen.then(async () => {
      if (connection.closed) return err('unreachable')
      const hello: LighthouseRequest = {
        type: 'hello',
        protocol: LIGHTHOUSE_PROTOCOL,
        nonce: connection.nonce,
        ...(address.pass === undefined ? {} : { pass: address.pass }),
      }
      const greeted = greeting(await send(connection, hello))
      // A connection that couldn't say hello is no use: closed, so the next call opens anew.
      if (!greeted.ok) drop(connection)
      return greeted
    })
    try {
      connection.socket = options.open(address.url, {
        onOpen: () => {
          isOpened = true
          opened()
        },
        onMessage: (text) => void receive(connection, text),
        onClose: (code) => drop(connection, code === ROOM_CLOSE ? 'room' : 'unreachable'),
      })
    } catch {
      drop(connection)
    }
    return connection
  }

  /** Matches a frame to the one request it answers; anything else is dropped unread. */
  async function receive(connection: Connection, text: string) {
    let req: unknown
    try {
      req = (JSON.parse(text) as { req?: unknown }).req
    } catch {
      return
    }
    const waiting = typeof req === 'number' ? connection.waiting.get(req) : undefined
    if (waiting === undefined) return
    const opened = await openReply(crypto, address.id, text, {
      nonce: connection.nonce,
      sent: waiting.sent,
    })
    // Only a signed answer to this very frame settles it: a forged one leaves it waiting.
    if (!opened.ok || opened.value.req !== req) return
    connection.timeouts = 0
    waiting.settle(ok(opened.value.reply))
  }

  /** A request's settling, kept apart from its frame so a late timer holds nothing big. */
  function settler(connection: Connection, req: number, resolve: (answer: Answer) => void) {
    let settled = false
    return (answer: Answer) => {
      if (settled) return
      settled = true
      connection.waiting.delete(req)
      resolve(answer)
    }
  }

  function timer(connection: Connection, req: number, hello: boolean, settle: (a: Answer) => void) {
    void options.sleep(timeoutMs).then(() => {
      if (!connection.waiting.has(req)) return
      settle(err('timeout'))
      // A connection that stops answering is replaced, not waited on again and again.
      connection.timeouts += 1
      if (hello || connection.timeouts >= 2) drop(connection)
    })
  }

  /** Sends `ping` every so often while a wait stands on the connection, so it isn't idle. */
  async function keepAlive(connection: Connection) {
    if (connection.keeping) return
    connection.keeping = true
    while (!connection.closed && [...connection.waiting.values()].some((entry) => entry.held)) {
      await options.sleep(KEEPALIVE_MS)
      if (connection.closed || ![...connection.waiting.values()].some((entry) => entry.held)) break
      try {
        connection.socket?.send(KEEPALIVE)
      } catch {
        drop(connection)
      }
    }
    connection.keeping = false
  }

  function send(connection: Connection, request: LighthouseRequest): Promise<Answer> {
    if (connection.closed) return Promise.resolve(err('unreachable'))
    if (connection.waiting.size >= MAX_WAITING) return Promise.resolve(err('busy'))
    const req = connection.next
    connection.next += 1
    const sent = encodeRequest({ req, request })
    // A wait is answered when mail comes or its lease ends, not within the usual time.
    const held = request.type === 'wait'
    // A new wait ends the one standing (the Lighthouse answers it `lease`): it's settled so here
    // too, so a connection never holds more than one, whatever becomes of that answer.
    if (held)
      for (const entry of [...connection.waiting.values()])
        if (entry.held) entry.settle(ok({ type: 'waited', why: 'lease' }))
    return new Promise<Answer>((resolve) => {
      const settle = settler(connection, req, resolve)
      connection.waiting.set(req, { sent, settle, held })
      if (request.type === 'wait') {
        void keepAlive(connection)
        void options.sleep(request.seconds * 1000 + WAIT_GRACE_MS).then(() => {
          if (connection.waiting.has(req)) settle(err('timeout'))
        })
      } else timer(connection, req, request.type === 'hello', settle)
      try {
        connection.socket?.send(sent)
      } catch {
        settle(err('unreachable'))
      }
    })
  }

  const ready = () => {
    current ??= connect()
    return current
  }

  return {
    hello: () => ready().ready,
    async request(request) {
      const connection = ready()
      const greeted = await connection.ready
      if (!greeted.ok) return greeted
      return send(connection, request)
    },
    close() {
      if (current !== undefined) drop(current)
    },
  }
}
