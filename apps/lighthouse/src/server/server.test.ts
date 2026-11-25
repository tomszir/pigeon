import { mkdtemp } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  base32Encode,
  encodeRequest,
  LIGHTHOUSE_PROTOCOL,
  type LighthouseRequest,
  openReply,
} from '@pigeon/core'
import {
  createLighthouse,
  createMemoryStore,
  DEFAULT_LIMITS,
  type Limits,
} from '@pigeon/lighthouse'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createNodeCrypto, loadSigner } from '../platform/node-crypto.ts'
import { clientAddress, type RunningServer, SendBudget, sendOrCut, startServer } from './server.ts'

const NONCE = base32Encode(new Uint8Array(32).fill(7))
let running: RunningServer | undefined
afterEach(async () => {
  await running?.close()
  running = undefined
})

async function start(extra: Partial<Limits> = {}) {
  const limits = { ...DEFAULT_LIMITS, ...extra }
  const signer = await loadSigner(join(await mkdtemp(join(tmpdir(), 'lh-')), 'key'))
  const crypto = createNodeCrypto()
  const lighthouse = createLighthouse({
    signer,
    crypto,
    store: createMemoryStore(),
    now: Date.now,
    name: 'Test',
    software: { name: 'pigeon-lighthouse', version: '0.1.0' },
    limits,
  })
  running = await startServer({
    lighthouse,
    host: '127.0.0.1',
    port: 0,
    trustForwardedFor: false,
    address: 'pigeon://lighthouse/x',
    limits,
  })
  const port = running.port
  const socket = await connect(port)
  let req = 0
  const ask = (request: LighthouseRequest) =>
    new Promise<unknown>((resolve) => {
      req += 1
      const sent = encodeRequest({ req, request })
      socket.once('message', (data) => {
        void openReply(crypto, signer.id, data.toString(), { nonce: NONCE, sent }).then((reply) =>
          resolve(reply.ok ? reply.value.reply : reply.error),
        )
      })
      socket.send(sent)
    })
  return { ask, socket, port }
}

async function connect(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

/** The code a socket is closed with. */
const closing = (socket: WebSocket) =>
  new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)))

describe('the server', () => {
  it('carries requests and signed replies over a WebSocket', async () => {
    const { ask, socket } = await start()
    expect(await ask({ type: 'hello', protocol: LIGHTHOUSE_PROTOCOL, nonce: NONCE })).toMatchObject(
      {
        type: 'hello',
        name: 'Test',
      },
    )
    const tag = base32Encode(new Uint8Array(32).fill(1))
    const drop = base32Encode(new Uint8Array(32).fill(2))
    expect(
      await ask({ type: 'put', tag, blob: 'AQID', expires: Date.now() + 60_000, drops: [drop] }),
    ).toMatchObject({ type: 'stored' })
    expect(await ask({ type: 'list', tags: [tag], cursor: 0 })).toMatchObject({
      type: 'listed',
      items: [{ tag, size: 3 }],
    })
    socket.close()
  })

  it('says its address to a plain visit', async () => {
    const { port, socket } = await start()
    const response = await fetch(`http://127.0.0.1:${port}/`)
    expect(await response.text()).toContain('pigeon://lighthouse/x')
    socket.close()
  })

  it('trusts X-Forwarded-For only when told to, and then only the last hop', () => {
    const request = {
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage
    expect(clientAddress(request, false)).toBe('127.0.0.1')
    expect(clientAddress(request, true)).toBe('203.0.113.7')
  })

  it('closes a connection whose address sends more frames than it may, unanswered', async () => {
    const { ask, socket } = await start({ framesPerMinute: 2 })
    const hello = { type: 'hello', protocol: LIGHTHOUSE_PROTOCOL, nonce: NONCE } as const
    expect(await ask(hello)).toMatchObject({ type: 'hello' })
    expect(await ask(hello)).toMatchObject({ type: 'hello' })
    const closed = closing(socket)
    let answered = false
    socket.once('message', () => {
      answered = true
    })
    socket.send(encodeRequest({ req: 3, request: hello }))
    expect(await closed).toBe(1008)
    expect(answered).toBe(false)
  })

  it('takes no more connections from one address, or in all, than it may', async () => {
    const { socket, port } = await start({ connectionsPerRange: 2 })
    const second = await connect(port)
    expect(await closing(await connect(port))).toBe(1006)
    // A place is free again once one closes.
    const gone = closing(second)
    second.close()
    await gone
    const third = await connect(port)
    third.close()
    socket.close()
    await running?.close()
    const all = await start({ maxConnections: 1 })
    expect(await closing(await connect(all.port))).toBe(1006)
    all.socket.close()
  })

  it('closes a connection that sends nothing for the idle time, and keeps one that does', async () => {
    const { ask, socket, port } = await start({ idleSeconds: 0.4 })
    const quiet = await connect(port)
    const closedQuiet = closing(quiet)
    let busyClosed = false
    socket.once('close', () => {
      busyClosed = true
    })
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await ask({ type: 'hello', protocol: LIGHTHOUSE_PROTOCOL, nonce: NONCE })
    }
    expect(await closedQuiet).toBe(1000)
    expect(busyClosed).toBe(false)
    socket.close()
  })
})

describe('sending a reply', () => {
  const socket = (bufferedAmount: number) => {
    const seen: string[] = []
    return {
      seen,
      socket: {
        OPEN: 1 as const,
        readyState: 1 as const,
        bufferedAmount,
        send: (text: string, done?: () => void) => {
          seen.push(`sent ${text}`)
          done?.()
        },
        terminate: () => void seen.push('terminated'),
      } as unknown as Parameters<typeof sendOrCut>[0],
    }
  }

  it('sends to a client that keeps up', () => {
    const { socket: open, seen } = socket(0)
    sendOrCut(open, 'reply', 100)
    expect(seen).toEqual(['sent reply'])
  })

  it('cuts off a client that leaves too much unread, rather than keep it', () => {
    const { socket: slow, seen } = socket(98)
    sendOrCut(slow, 'reply', 100)
    expect(seen).toEqual(['terminated'])
  })

  it('past the server’s budget, cuts off only clients with replies of their own unread', () => {
    const budget = new SendBudget(100, 1000, 1000)
    budget.move([], 96)
    const keepingUp = socket(0)
    sendOrCut(keepingUp.socket, 'reply', 100, budget)
    expect(keepingUp.seen).toEqual(['sent reply'])
    const behind = socket(1)
    sendOrCut(behind.socket, 'reply', 100, budget)
    expect(behind.seen).toEqual(['terminated'])
  })

  it('keeps one address range from holding more than its share', () => {
    const budget = new SendBudget(1000, 8, 1000)
    budget.move(['203.0.113.7'], 4)
    const mine = socket(0)
    sendOrCut(mine.socket, 'reply', 100, budget, '203.0.113.7')
    expect(mine.seen).toEqual(['terminated'])
    const other = socket(0)
    sendOrCut(other.socket, 'reply', 100, budget, '198.51.100.1')
    expect(other.seen).toEqual(['sent reply'])
  })

  it('gives the budget back once a reply is written', () => {
    const budget = new SendBudget(100)
    const { socket: open, seen } = socket(0)
    sendOrCut(open, 'reply', 100, budget)
    expect(seen).toEqual(['sent reply'])
    expect(budget.used).toBe(0)
  })
})
