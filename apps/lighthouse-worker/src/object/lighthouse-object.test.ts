import { DatabaseSync } from 'node:sqlite'
import {
  base32Encode,
  encodeRequest,
  LIGHTHOUSE_PROTOCOL,
  type LighthouseRequest,
  openReply,
  parseLighthouseAddress,
} from '@pigeon/core'
import { createSqlStore, DEFAULT_LIMITS, type Limits } from '@pigeon/lighthouse'
import { describeMailStore } from '@pigeon/lighthouse/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCrypto, signerFromKey } from '../platform/worker-crypto.ts'
import type { DurableObjectState, Env, HibernatingSocket } from '../platform/worker-types.ts'
import { CLIENT_ADDRESS, durableSqlDatabase, LighthouseObject } from './lighthouse-object.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function makeKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  return Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
}

/**
 * A Durable Object's state, its SQL on node:sqlite in the shape of the runtime's cursor, and
 * the sockets it took on, with their tags.
 */
function fakeState(): DurableObjectState & {
  alarmAt(): number | null
  accepted: { socket: WebSocket; tags: string[] }[]
} {
  const db = new DatabaseSync(':memory:')
  let alarm: number | null = null
  const accepted: { socket: WebSocket; tags: string[] }[] = []
  return {
    alarmAt: () => alarm,
    accepted,
    storage: {
      sql: {
        exec(query, ...bindings) {
          const statement = db.prepare(query)
          if (statement.columns().length > 0) {
            const rows = statement.all(...bindings) as Record<string, string | number | null>[]
            return { toArray: () => rows, rowsWritten: 0 }
          }
          const changes = Number(statement.run(...bindings).changes)
          return { toArray: () => [], rowsWritten: changes }
        },
      },
      setAlarm: async (at) => {
        alarm = at
      },
      getAlarm: async () => alarm,
    },
    acceptWebSocket: (socket, tags = []) => void accepted.push({ socket, tags }),
    getWebSockets: (tag) =>
      accepted
        .filter((entry) => tag === undefined || entry.tags.includes(tag))
        .map((entry) => entry.socket),
  }
}

/** A socket as the runtime hands it to webSocketMessage, keeping its attachment. */
function fakeSocket(attachment: unknown) {
  let kept = attachment
  const sent: string[] = []
  const closed: number[] = []
  const socket = {
    send: (text: string) => sent.push(text),
    close: (code: number) => void closed.push(code),
    serializeAttachment: (value: unknown) => {
      kept = value
    },
    deserializeAttachment: () => kept,
  } as unknown as HibernatingSocket
  return { socket, sent, closed, kept: () => kept }
}

async function setup(limits: Limits = DEFAULT_LIMITS) {
  const key = await makeKey()
  const signer = await signerFromKey(key)
  const env = {
    LIGHTHOUSE_KEY: key,
    LIGHTHOUSE_NAME: 'Pigeon Lighthouse',
    LIGHTHOUSE_URL: 'wss://lighthouse.example/',
  } as unknown as Env
  const state = fakeState()
  return { signer, env, state, object: new LighthouseObject(state, env, limits) }
}

const nonce = base32Encode(new Uint8Array(32).fill(3))

describe('the Worker Lighthouse', () => {
  it('shows its address to a plain visit', async () => {
    const { object, signer } = await setup()
    const text = await (await object.fetch(new Request('https://lighthouse.example/'))).text()
    const line = text.split('\n').find((part) => part.startsWith('pigeon://')) ?? ''
    const address = parseLighthouseAddress(line)
    expect(address.ok && address.value.id).toBe(signer.id)
  })

  it('answers frames on a socket that woke from hibernation, keeping its connection', async () => {
    const { state, env, signer } = await setup()
    const crypto = createWorkerCrypto()
    const ask = async (
      object: LighthouseObject,
      socket: ReturnType<typeof fakeSocket>,
      req: number,
      request: LighthouseRequest,
    ) => {
      const sent = encodeRequest({ req, request })
      await object.webSocketMessage(socket.socket, sent)
      const opened = await openReply(crypto, signer.id, socket.sent.at(-1) ?? '', { nonce, sent })
      return opened.ok ? opened.value.reply : opened.error
    }
    const socket = fakeSocket({ address: '203.0.113.7', greeted: false, nonce: '', seen: 0 })
    expect(
      await ask(new LighthouseObject(state, env), socket, 1, {
        type: 'hello',
        protocol: LIGHTHOUSE_PROTOCOL,
        nonce,
      }),
    ).toMatchObject({ type: 'hello', name: 'Pigeon Lighthouse' })
    expect(socket.kept()).toMatchObject({ address: '203.0.113.7', greeted: true, nonce })

    // The object was evicted while the socket slept: a new one picks the connection back up.
    const tag = base32Encode(new Uint8Array(32).fill(1))
    const drop = base32Encode(new Uint8Array(32).fill(2))
    const woken = new LighthouseObject(state, env)
    expect(
      await ask(woken, socket, 2, {
        type: 'put',
        tag,
        blob: 'AQID',
        expires: Date.now() + 60_000,
        drops: [drop],
      }),
    ).toMatchObject({ type: 'stored' })
    expect(await ask(woken, socket, 3, { type: 'list', tags: [tag], cursor: 0 })).toMatchObject({
      type: 'listed',
      items: [{ tag, size: 3 }],
    })
  })

  it('answers a close with no code, which it may not echo, with a plain one', async () => {
    const { object } = await setup()
    const codes: number[] = []
    const socket = {
      close: (code: number) => {
        if (code === 1005) throw new Error('InvalidAccessError')
        codes.push(code)
      },
    } as unknown as WebSocket
    object.webSocketClose(socket, 1005)
    object.webSocketClose(socket, 4001)
    expect(codes).toEqual([1000, 4001])
  })

  it('stops waking once it holds no mail and nobody is connected', async () => {
    const { object, state } = await setup()
    await object.alarm()
    expect(state.alarmAt()).toBeNull()
  })

  it('takes the client’s address from Cloudflare, never from the client', async () => {
    const { default: worker } = await import('../index.ts')
    let seen: string | null = null
    const env = {
      LIGHTHOUSE: {
        idFromName: () => 'id',
        get: () => ({
          fetch: async (request: Request) => {
            seen = request.headers.get(CLIENT_ADDRESS)
            return new Response('')
          },
        }),
      },
    } as unknown as Env
    await worker.fetch(
      new Request('https://lighthouse.example/', {
        headers: { 'cf-connecting-ip': '203.0.113.7', [CLIENT_ADDRESS]: '6.6.6.6' },
      }),
      env,
    )
    expect(seen).toBe('203.0.113.7')
  })

  it('closes, unanswered, a socket whose address sends more frames than it may', async () => {
    const { object } = await setup({ ...DEFAULT_LIMITS, framesPerMinute: 1 })
    const socket = fakeSocket({ address: '203.0.113.7', greeted: false, nonce: '', seen: 0 })
    const hello = encodeRequest({
      req: 1,
      request: { type: 'hello', protocol: LIGHTHOUSE_PROTOCOL, nonce },
    })
    await object.webSocketMessage(socket.socket, hello)
    await object.webSocketMessage(socket.socket, hello)
    expect(socket.sent).toHaveLength(1)
    expect(socket.closed).toEqual([1008])
  })

  it('refuses a connection past what its range, its /48 or everyone may hold', async () => {
    const upgrade = (address: string) =>
      new Request('https://lighthouse.example/', {
        headers: { upgrade: 'websocket', [CLIENT_ADDRESS]: address },
      })
    const fresh = { address: '', greeted: true, nonce, seen: Date.now() }
    const { object, state } = await setup({
      ...DEFAULT_LIMITS,
      connectionsPerRange: 1,
      connectionsPer48: 2,
      maxConnections: 3,
    })
    state.acceptWebSocket(fakeSocket(fresh).socket, ['203.0.113.7'])
    expect((await object.fetch(upgrade('203.0.113.7'))).status).toBe(503)
    state.acceptWebSocket(fakeSocket(fresh).socket, ['2001:db8:1:1::/64', '2001:db8:1::/48'])
    state.acceptWebSocket(fakeSocket(fresh).socket, ['2001:db8:1:2::/64', '2001:db8:1::/48'])
    expect((await object.fetch(upgrade('2001:db8:1:3::1'))).status).toBe(503)
    expect((await object.fetch(upgrade('198.51.100.1'))).status).toBe(503)
  })

  it('closes idle sockets to make room, and takes the new one on', async () => {
    const { object, state } = await setup({ ...DEFAULT_LIMITS, maxConnections: 1 })
    const old = fakeSocket({ address: '198.51.100.1', greeted: true, nonce, seen: 0 })
    state.acceptWebSocket(old.socket, ['198.51.100.1'])
    // The runtime's own pair and upgrade response, which Node doesn't have.
    const taken = fakeSocket(undefined)
    vi.stubGlobal(
      'WebSocketPair',
      class {
        0 = fakeSocket(undefined).socket
        1 = taken.socket
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
    const response = await object.fetch(
      new Request('https://lighthouse.example/', {
        headers: { upgrade: 'websocket', [CLIENT_ADDRESS]: '203.0.113.7' },
      }),
    )
    expect(response.status).toBe(101)
    expect(old.closed).toEqual([1000])
    expect(state.accepted.at(-1)).toEqual({ socket: taken.socket, tags: ['203.0.113.7'] })
    expect(taken.kept()).toMatchObject({ address: '203.0.113.7', greeted: false })
  })

  it('closes idle sockets on its hourly alarm, and keeps busy ones', async () => {
    const { object, state } = await setup()
    const idle = fakeSocket({ address: '198.51.100.1', greeted: true, nonce, seen: 0 })
    const busy = fakeSocket({ address: '198.51.100.2', greeted: true, nonce, seen: Date.now() })
    state.acceptWebSocket(idle.socket, ['198.51.100.1'])
    state.acceptWebSocket(busy.socket, ['198.51.100.2'])
    await object.alarm()
    expect(idle.closed).toEqual([1000])
    expect(busy.closed).toEqual([])
    expect(state.alarmAt()).not.toBeNull()
  })
})

// The shared store on a Durable Object's SQL; reopened as it is when the object is evicted and
// wakes again.
const sqlOf = new WeakMap<object, DurableObjectState['storage']['sql']>()
describeMailStore(
  'the Durable Object store',
  () => {
    const sql = fakeState().storage.sql
    const store = createSqlStore(durableSqlDatabase(sql))
    sqlOf.set(store, sql)
    return store
  },
  (store) => {
    const sql = sqlOf.get(store)
    if (sql === undefined) throw new Error('not made here')
    const again = createSqlStore(durableSqlDatabase(sql))
    sqlOf.set(again, sql)
    return again
  },
)
