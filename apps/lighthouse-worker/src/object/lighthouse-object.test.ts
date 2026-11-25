import { DatabaseSync } from 'node:sqlite'
import {
  base32Encode,
  encodeRequest,
  LIGHTHOUSE_PROTOCOL,
  type LighthouseRequest,
  openReply,
  parseLighthouseAddress,
} from '@pigeon/core'
import { describe, expect, it } from 'vitest'
import { createWorkerCrypto, signerFromKey } from '../platform/worker-crypto.ts'
import type { DurableObjectState, Env, HibernatingSocket } from '../platform/worker-types.ts'
import { CLIENT_ADDRESS, LighthouseObject } from './lighthouse-object.ts'

async function makeKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  return Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
}

/** A Durable Object's state, its SQL on node:sqlite in the shape of the runtime's cursor. */
function fakeState(): DurableObjectState & { alarmAt(): number | null } {
  const db = new DatabaseSync(':memory:')
  let alarm: number | null = null
  return {
    alarmAt: () => alarm,
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
    acceptWebSocket: () => undefined,
    getWebSockets: () => [],
  }
}

/** A socket as the runtime hands it to webSocketMessage, keeping its attachment. */
function fakeSocket(attachment: unknown) {
  let kept = attachment
  const sent: string[] = []
  const socket = {
    send: (text: string) => sent.push(text),
    close: () => undefined,
    serializeAttachment: (value: unknown) => {
      kept = value
    },
    deserializeAttachment: () => kept,
  } as unknown as HibernatingSocket
  return { socket, sent, kept: () => kept }
}

async function setup() {
  const key = await makeKey()
  const signer = await signerFromKey(key)
  const env = {
    LIGHTHOUSE_KEY: key,
    LIGHTHOUSE_NAME: 'Pigeon Lighthouse',
    LIGHTHOUSE_URL: 'wss://lighthouse.example/',
  } as unknown as Env
  const state = fakeState()
  return { signer, env, state, object: new LighthouseObject(state, env) }
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
    const socket = fakeSocket({ address: '203.0.113.7', greeted: false, nonce: '' })
    expect(
      await ask(new LighthouseObject(state, env), socket, 1, {
        type: 'hello',
        protocol: LIGHTHOUSE_PROTOCOL,
        nonce,
      }),
    ).toMatchObject({ type: 'hello', name: 'Pigeon Lighthouse' })
    expect(socket.kept()).toEqual({ address: '203.0.113.7', greeted: true, nonce })

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
})
