import { describe, expect, it } from 'vitest'
import { base32Encode, base64Encode } from '../encoding/bytes.ts'
import { fakeCrypto, fakeSigner } from '../testing/testing.ts'
import {
  formatLighthouseAddress,
  type LighthouseAddress,
  parseLighthouseAddress,
} from './address.ts'
import {
  encodeRequest,
  frameHash,
  frameReq,
  LIGHTHOUSE_PROTOCOL,
  MAX_BLOB_BYTES,
  MAX_WAIT_SECONDS,
  MAX_WAIT_TAGS,
  mailBlobId,
  openReply,
  parseRequest,
  sealReply,
} from './protocol.ts'

const key = (n: number) => base32Encode(new Uint8Array(32).fill(n))
const lighthouse = fakeSigner('lighthouse')

describe('requests', () => {
  it('round-trip, each kind', () => {
    for (const request of [
      { type: 'hello', protocol: LIGHTHOUSE_PROTOCOL, nonce: key(8) },
      { type: 'hello', protocol: 1, nonce: key(8), pass: 'secret' },
      {
        type: 'put',
        tag: key(1),
        blob: base64Encode(new Uint8Array([1, 2, 3])),
        expires: 99,
        drops: [key(2), key(3)],
      },
      {
        type: 'put',
        tag: key(1),
        blob: base64Encode(new Uint8Array([1, 2, 3])),
        expires: 99,
        drops: [key(2)],
        claim: key(6),
      },
      { type: 'list', tags: [key(1)], cursor: 0 },
      { type: 'list-claimed', tags: [key(1)], cursor: 0 },
      { type: 'get', id: key(4) },
      { type: 'drop', id: key(4), key: key(5) },
      { type: 'wait', tags: [key(1), key(2)], cursor: 12, seconds: 600 },
    ] as const) {
      expect(parseRequest(encodeRequest({ req: 7, request }))).toEqual({
        ok: true,
        value: { req: 7, request },
      })
    }
  })

  it('refuses anything off its shape', () => {
    const put = {
      type: 'put',
      tag: key(1),
      blob: 'AQID',
      expires: 99,
      drops: [key(2)],
    }
    for (const request of [
      { type: 'nope' },
      { type: 'hello', protocol: 1 },
      { type: 'hello', protocol: 1, nonce: key(8).toUpperCase() },
      { type: 'get', id: key(1).toUpperCase() },
      { ...put, tag: 'short' },
      { ...put, blob: '' },
      { ...put, blob: 'not base64!' },
      { ...put, blob: base64Encode(new Uint8Array(MAX_BLOB_BYTES + 1)) },
      { ...put, drops: [] },
      { ...put, drops: [key(2), key(2)] },
      { ...put, claim: 'short' },
      { ...put, claim: key(6).toUpperCase() },
      { type: 'list', tags: [], cursor: 0 },
      { type: 'list-claimed', tags: [], cursor: 0 },
      { type: 'list', tags: [key(1)], cursor: -1 },
      { type: 'drop', id: key(1) },
    ])
      expect(parseRequest(JSON.stringify({ req: 1, request })).ok).toBe(false)
    expect(parseRequest('{').ok).toBe(false)
    expect(parseRequest(JSON.stringify({ request: { type: 'get', id: key(1) } })).ok).toBe(false)
    expect(parseRequest(JSON.stringify({ req: 0, request: { type: 'get', id: key(1) } })).ok).toBe(
      false,
    )
  })
})

describe('a wait', () => {
  const tags = (count: number) => Array.from({ length: count }, (_, i) => key(i + 1))
  const wait = (fields: Record<string, unknown>) =>
    parseRequest(JSON.stringify({ req: 1, request: { type: 'wait', ...fields } })).ok

  it('takes 1 to 128 distinct tags and a lease of 1 to 600 seconds', () => {
    expect(wait({ tags: tags(1), cursor: 0, seconds: 1 })).toBe(true)
    expect(wait({ tags: tags(MAX_WAIT_TAGS), cursor: 0, seconds: MAX_WAIT_SECONDS })).toBe(true)
  })

  it('refuses no tags, too many, the same twice, a lease out of range, or a bad cursor', () => {
    for (const fields of [
      { tags: [], cursor: 0, seconds: 5 },
      { tags: tags(MAX_WAIT_TAGS + 1), cursor: 0, seconds: 5 },
      { tags: [key(1), key(1)], cursor: 0, seconds: 5 },
      { tags: [key(1).toUpperCase()], cursor: 0, seconds: 5 },
      { tags: tags(1), cursor: 0, seconds: 0 },
      { tags: tags(1), cursor: 0, seconds: MAX_WAIT_SECONDS + 1 },
      { tags: tags(1), cursor: 0, seconds: 1.5 },
      { tags: tags(1), cursor: -1, seconds: 5 },
      { tags: tags(1), seconds: 5 },
    ])
      expect(wait(fields), JSON.stringify(fields)).toBe(false)
  })

  it('is answered by a waited that says only mail or lease', async () => {
    const sent = encodeRequest({
      req: 2,
      request: { type: 'wait', tags: tags(1), cursor: 0, seconds: 9 },
    })
    const to = { req: 2, nonce: key(8), request: await frameHash(fakeCrypto, sent) }
    for (const why of ['mail', 'lease'] as const) {
      const text = await sealReply(lighthouse, 5, to, { type: 'waited', why })
      const opened = await openReply(fakeCrypto, lighthouse.id, text, { nonce: key(8), sent })
      expect(opened.ok && opened.value.reply).toEqual({ type: 'waited', why })
    }
    for (const reply of [
      { type: 'waited', why: 'soon' },
      { type: 'waited', why: 'mail', tag: key(1) },
    ]) {
      const text = await sealReply(lighthouse, 5, to, reply as never)
      expect((await openReply(fakeCrypto, lighthouse.id, text, { nonce: key(8), sent })).ok).toBe(
        false,
      )
    }
  })
})

describe('replies', () => {
  const sent = encodeRequest({ req: 3, request: { type: 'get', id: key(9) } })
  const to = async (frame = sent, nonce = key(8)) => ({
    req: 3,
    nonce,
    request: await frameHash(fakeCrypto, frame),
  })
  const stored = { type: 'stored', id: key(9), expires: 50 } as const

  it('are signed by the Lighthouse, for one request on one connection', async () => {
    const text = await sealReply(lighthouse, 5, await to(), stored)
    expect(await openReply(fakeCrypto, lighthouse.id, text, { nonce: key(8), sent })).toEqual({
      ok: true,
      value: { req: 3, at: 5, reply: stored },
    })
  })

  it("refuse another key's reply, and any that was changed", async () => {
    const text = await sealReply(lighthouse, 5, await to(), stored)
    expect(
      await openReply(fakeCrypto, fakeSigner('other').id, text, { nonce: key(8), sent }),
    ).toEqual({ ok: false, error: 'not-this-lighthouse' })
    const moved = text.replace('"req":3', '"req":4')
    expect(await openReply(fakeCrypto, lighthouse.id, moved, { nonce: key(8), sent })).toEqual({
      ok: false,
      error: 'bad-signature',
    })
    expect((await openReply(fakeCrypto, lighthouse.id, '[]', { nonce: key(8), sent })).ok).toBe(
      false,
    )
  })

  it('refuse the answer to a request changed on the way, or to another connection', async () => {
    // A relay rewrote the request it passed on; the real answer to that doesn't answer ours.
    const changed = encodeRequest({ req: 3, request: { type: 'get', id: key(7) } })
    const answer = await sealReply(lighthouse, 5, await to(changed), stored)
    expect(await openReply(fakeCrypto, lighthouse.id, answer, { nonce: key(8), sent })).toEqual({
      ok: false,
      error: 'not-my-request',
    })
    const elsewhere = await sealReply(lighthouse, 5, await to(sent, key(6)), stored)
    expect(await openReply(fakeCrypto, lighthouse.id, elsewhere, { nonce: key(8), sent })).toEqual({
      ok: false,
      error: 'not-my-request',
    })
  })

  it('check the shape of what they carry', async () => {
    const bad = await sealReply(lighthouse, 5, await to(), {
      type: 'error',
      error: 'nonsense' as 'full',
    })
    expect(await openReply(fakeCrypto, lighthouse.id, bad, { nonce: key(8), sent })).toEqual({
      ok: false,
      error: 'malformed',
    })
  })

  it('say which request a frame they couldn’t read was, when they can tell', () => {
    expect(frameReq('{"req":4,"request":{}}')).toBe(4)
    expect(frameReq('nonsense')).toBe(0)
  })
})

describe('blob ids', () => {
  it('come from the content, so every Lighthouse names a blob alike', async () => {
    const a = await mailBlobId(fakeCrypto, key(1), 'AQID', [key(2)])
    expect(a).toBe(await mailBlobId(fakeCrypto, key(1), 'AQID', [key(2)]))
    expect(a).not.toBe(await mailBlobId(fakeCrypto, key(1), 'AQID', [key(3)]))
  })
})

describe('addresses', () => {
  const address: LighthouseAddress = {
    id: lighthouse.id,
    name: 'Pigeon Lighthouse',
    url: 'wss://lighthouse.example/mail',
  }

  it('round-trip, with a pass or without', () => {
    expect(parseLighthouseAddress(formatLighthouseAddress(address))).toEqual({
      ok: true,
      value: address,
    })
    const withPass = { ...address, pass: 'p4ss' }
    expect(parseLighthouseAddress(`  ${formatLighthouseAddress(withPass)} `)).toEqual({
      ok: true,
      value: withPass,
    })
  })

  it('take wss anywhere and ws only on this computer', () => {
    const at = (url: string) =>
      parseLighthouseAddress(formatLighthouseAddress({ ...address, url })).ok
    expect(at('ws://localhost:8787/')).toBe(true)
    expect(at('ws://lighthouse.example/')).toBe(false)
    expect(at('https://lighthouse.example/')).toBe(false)
    expect(at('wss://user:pw@lighthouse.example/')).toBe(false)
  })

  it('refuse anything else', () => {
    const named = (name: string) =>
      `pigeon://lighthouse/${lighthouse.id}?url=wss%3A%2F%2Fa.example&name=${encodeURIComponent(name)}`
    expect(parseLighthouseAddress(named('Fine')).ok).toBe(true)
    for (const text of [
      named('Evil\u202eKcab'),
      named('Line\nbreak'),
      `${named('A')}&url=wss%3A%2F%2Fb.example`,
      `pigeon://lighthouse/${lighthouse.id}?url=wss%3A%2F%2F.&name=A`,
      `pigeon://lighthouse/${lighthouse.id}?url=wss%3A%2F%2F-&name=A`,
      'https://pigeon.example/',
      'pigeon://lighthouse/',
      `pigeon://lighthouse/${lighthouse.id}`,
      'pigeon://lighthouse/notakey?url=wss%3A%2F%2Fa.example&name=A',
      `pigeon://lighthouse/${lighthouse.id}?url=wss%3A%2F%2Fa.example`,
    ])
      expect(parseLighthouseAddress(text).ok).toBe(false)
  })
})
