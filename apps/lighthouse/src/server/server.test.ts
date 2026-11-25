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
import { createLighthouse, createMemoryStore } from '@pigeon/lighthouse'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createNodeCrypto, loadSigner } from '../platform/node-crypto.ts'
import { clientAddress, type RunningServer, startServer } from './server.ts'

const NONCE = base32Encode(new Uint8Array(32).fill(7))
let running: RunningServer | undefined
afterEach(async () => {
  await running?.close()
  running = undefined
})

async function start() {
  const signer = await loadSigner(join(await mkdtemp(join(tmpdir(), 'lh-')), 'key'))
  const crypto = createNodeCrypto()
  const lighthouse = createLighthouse({
    signer,
    crypto,
    store: createMemoryStore(),
    now: Date.now,
    name: 'Test',
    software: { name: 'pigeon-lighthouse', version: '0.1.0' },
  })
  running = await startServer({
    lighthouse,
    host: '127.0.0.1',
    port: 0,
    trustForwardedFor: false,
    address: 'pigeon://lighthouse/x',
  })
  const socket = new WebSocket(`ws://127.0.0.1:${running.port}/`)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
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
  return { ask, socket, port: running.port }
}

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
})
