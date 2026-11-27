// The Worker Lighthouse against the waiting model's conformance traces
// (verification/models/lighthouse-wait/model/conformance.ts): the Durable Object on a runtime
// that keeps its sockets, their attachments and its SQLite while the object itself sleeps (a new
// object, with nothing in memory) or resets between a put and its wakes, and answers keepalives
// itself. It must send every connection what the model's reference sends for the Worker.
import { DatabaseSync } from 'node:sqlite'
import type { Limits } from '@pigeon/lighthouse'
import {
  createTranslator,
  lighthouseLimitsFor,
  TRACE_LIGHTHOUSE_LIMITS,
} from '@pigeon/lighthouse/wait-traces'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BIG_TRACE_LIMITS,
  conform,
  type Subject,
  TRACE_CONNS,
  TRACE_LIMITS,
  TRACE_TAGS,
} from '../../../../verification/models/lighthouse-wait/model/conformance.ts'
import type { Output } from '../../../../verification/models/lighthouse-wait/model/lighthouse.ts'
import { createWorkerCrypto } from '../platform/worker-crypto.ts'
import type { DurableObjectState, Env, HibernatingSocket } from '../platform/worker-types.ts'
import { CLIENT_ADDRESS, LighthouseObject } from './lighthouse-object.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

const key = await (async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  return Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
})()

interface Held {
  readonly socket: HibernatingSocket
  readonly tags: readonly string[]
  open: boolean
  /** When the runtime last answered a keepalive on it. */
  pinged: number | null
}

/** What Cloudflare keeps with a hibernating socket at most. */
const ATTACHMENT_BYTES = 2048

async function workerSubject(limits: Limits = TRACE_LIGHTHOUSE_LIMITS): Promise<Subject> {
  let now = 0
  let tasks: (() => void)[] = []
  const db = new DatabaseSync(':memory:')
  const held: Held[] = []
  let alarm: number | null = null
  const state: DurableObjectState = {
    storage: {
      sql: {
        exec(query, ...bindings) {
          const statement = db.prepare(query)
          if (statement.columns().length > 0) {
            const rows = statement.all(...bindings) as Record<string, string | number | null>[]
            return { toArray: () => rows, rowsWritten: 0 }
          }
          return { toArray: () => [], rowsWritten: Number(statement.run(...bindings).changes) }
        },
      },
      setAlarm: async (at) => {
        alarm = at
      },
      getAlarm: async () => alarm,
    },
    acceptWebSocket: (socket, tags = []) =>
      void held.push({ socket: socket as HibernatingSocket, tags, open: true, pinged: null }),
    getWebSockets: (tag) =>
      held
        .filter((entry) => entry.open && (tag === undefined || entry.tags.includes(tag)))
        .map((entry) => entry.socket),
    setWebSocketAutoResponse: () => undefined,
    getWebSocketAutoResponseTimestamp: (socket) => {
      const at = held.find((entry) => entry.socket === socket)?.pinged
      return at === null || at === undefined ? null : new Date(at)
    },
  }
  const env = {
    LIGHTHOUSE_KEY: key,
    LIGHTHOUSE_NAME: 'Trace',
    LIGHTHOUSE_URL: 'wss://lighthouse.example/',
  } as unknown as Env
  const wake = () =>
    new LighthouseObject(state, env, limits, {
      now: () => now,
      defer: (run) => void tasks.push(run),
    })
  let object = wake()
  const translator = createTranslator(createWorkerCrypto())
  const sockets = new Map<string, HibernatingSocket>()
  let out: Output[] = []
  let next: HibernatingSocket | undefined
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = next
      1 = next
    },
  )
  vi.stubGlobal(
    'Response',
    class {
      constructor(
        readonly body: unknown,
        readonly init: { status?: number } = {},
      ) {}
      get status() {
        return this.init.status ?? 200
      }
    },
  )
  const socketFor = (conn: string): HibernatingSocket => {
    let attachment: unknown
    const socket = {
      send: (text: string) => {
        const read = translator.read(conn, text)
        if (read !== undefined) out.push(read)
      },
      close: (_code: number, reason: string) => {
        const entry = held.find((one) => one.socket === socket)
        if (entry !== undefined) entry.open = false
        // Every close the Lighthouse makes is said, but the echo of the client's own.
        if (reason !== 'closing') out.push({ kind: 'close', conn, why: reason as 'idle' })
      },
      serializeAttachment: (value: unknown) => {
        // The runtime keeps at most 2,048 bytes with a socket, and throws past it.
        if (new TextEncoder().encode(JSON.stringify(value)).length > ATTACHMENT_BYTES)
          throw new Error('attachment too big')
        attachment = structuredClone(value)
      },
      deserializeAttachment: () => attachment,
    } as unknown as HibernatingSocket
    return socket
  }
  const flush = async () => {
    for (;;) {
      const run = tasks.shift()
      if (run !== undefined) run()
      await object.settled()
      if (tasks.length === 0) return
    }
  }
  return {
    async apply(event) {
      out = []
      if (event.kind === 'connect') {
        next = socketFor(event.conn)
        const response = await object.fetch(
          new Request('https://lighthouse.example/', {
            headers: { upgrade: 'websocket', [CLIENT_ADDRESS]: translator.address(event.range) },
          }),
        )
        if (response.status === 503) out.push({ kind: 'refuse', conn: event.conn })
        else {
          sockets.set(event.conn, next)
          await object.webSocketMessage(next, translator.hello())
        }
      } else if (event.kind === 'frame') {
        const socket = sockets.get(event.conn)
        if (socket !== undefined)
          await object.webSocketMessage(
            socket,
            await translator.request(event.req, event.request, now),
          )
        if (event.crash === true) {
          // Reset after the put's reply: its wakes never run, and memory goes.
          tasks = []
          object = wake()
        }
      } else if (event.kind === 'ping') {
        // The runtime answers it, never the object.
        const entry = held.find((one) => one.socket === sockets.get(event.conn))
        if (entry?.open === true) {
          entry.pinged = now
          out.push({ kind: 'pong', conn: event.conn })
        }
      } else if (event.kind === 'close') {
        const socket = sockets.get(event.conn)
        if (socket !== undefined) await object.webSocketClose(socket, 1000)
      } else if (event.kind === 'tick') now += event.seconds * 1000
      else if (event.kind === 'hibernate') object = wake()
      else if (event.kind === 'alarm') await object.alarm()
      await flush()
      return out
    },
  }
}

describe('the Worker Lighthouse against the waiting model', () => {
  it('sends every connection what the reference does, across sleeps and resets', async () => {
    const mismatch = await conform(workerSubject, {
      variant: 'worker',
      limits: TRACE_LIMITS,
      conns: TRACE_CONNS,
      tags: TRACE_TAGS,
      length: 80,
      count: Number(process.env['PIGEON_TRACES'] ?? 200),
    })
    expect(
      mismatch,
      mismatch === undefined ? '' : JSON.stringify(mismatch, null, 1),
    ).toBeUndefined()
  }, 300_000)

  it('keeps waits of 128 tags across sleeps, within what a socket may keep', async () => {
    const mismatch = await conform(() => workerSubject(lighthouseLimitsFor(BIG_TRACE_LIMITS)), {
      variant: 'worker',
      limits: BIG_TRACE_LIMITS,
      conns: TRACE_CONNS,
      tags: TRACE_TAGS,
      length: 80,
      bigWaits: true,
      count: Number(process.env['PIGEON_TRACES'] ?? 200),
    })
    expect(
      mismatch,
      mismatch === undefined ? '' : JSON.stringify(mismatch, null, 1),
    ).toBeUndefined()
  }, 300_000)
})
