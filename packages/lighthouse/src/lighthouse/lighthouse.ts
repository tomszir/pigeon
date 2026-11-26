// A Lighthouse's mailbox, with no platform in it: the Node and Worker runners
// hand each connection's frames to `connect(...).receive`, and send back what it returns. It
// holds mail it can't open or attribute, under tags only the two ends can work out, until every
// recipient device has dropped its copy or the mail expires.
import {
  base32Decode,
  base32Encode,
  base64Decode,
  type Crypto,
  frameHash,
  frameReq,
  LIGHTHOUSE_PROTOCOL,
  LIST_PAGE,
  type LighthouseReply,
  type LighthouseRequest,
  type LighthouseSoftware,
  MAX_MAIL_MS,
  mailBlobId,
  parseRequest,
  type Signer,
  sealReply,
  utf8Encode,
} from '@pigeon/core'
import {
  addressRange,
  blobCost,
  createLimitCounter,
  DEFAULT_LIMITS,
  type Limits,
} from '../limits/limits.ts'
import type { MailStore } from '../store/store.ts'

const HOUR = 60 * 60 * 1000

/** Requests one connection may have waiting; more are refused, not queued. */
export const MAX_PENDING = 16

export interface LighthouseOptions {
  readonly signer: Signer
  readonly crypto: Crypto
  readonly store: MailStore
  readonly now: () => number
  /** Its operator's name for it. */
  readonly name: string
  readonly software: LighthouseSoftware
  /** A personal Lighthouse's pass: without it, it answers only refusals. */
  readonly pass?: string | undefined
  readonly limits?: Limits | undefined
}

export interface LighthouseConnection {
  /**
   * One request frame in, one signed reply frame out; or undefined once the client's address
   * range has sent more frames than its limit allows, when the runner closes the connection
   * unanswered.
   */
  receive(frame: string): Promise<string | undefined>
  /**
   * What the connection must remember to carry on: whether it said hello, and its nonce. A
   * runner whose sockets sleep (the Worker's hibernating WebSockets) keeps it with the socket
   * and hands it back to `connect` when the socket wakes.
   */
  saved(): SavedConnection
}

export interface SavedConnection {
  readonly greeted: boolean
  readonly nonce: string
}

export interface Lighthouse {
  /** A connection from `address` (its IP address, used only for limits), or one waking up. */
  connect(address: string, saved?: SavedConnection): LighthouseConnection
  /** Deletes expired mail; the runner calls it now and then. */
  sweep(): Promise<number>
}

/** Equal strings, compared in time that doesn't depend on where they differ. */
function sameText(a: string, b: string): boolean {
  const x = utf8Encode(a)
  const y = utf8Encode(b)
  let difference = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) difference |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return difference === 0
}

type ErrorReply = Extract<LighthouseReply, { type: 'error' }>

export function createLighthouse(options: LighthouseOptions): Lighthouse {
  const { signer, crypto, store, now } = options
  const limits = options.limits ?? DEFAULT_LIMITS
  const counter = createLimitCounter(limits)
  const error = (e: ErrorReply['error']): ErrorReply => ({ type: 'error', error: e })

  /** A drop value's hash, as `put` stores it: SHA-256 of its 32 bytes. */
  async function dropHash(key: string): Promise<string | undefined> {
    const bytes = base32Decode(key)
    return bytes.ok ? base32Encode(await crypto.sha256(bytes.value)) : undefined
  }

  /**
   * When mail put at `at` and asked to expire at `expires` is kept until: the next whole hour, so
   * what's stored doesn't say to the millisecond when it was put. Mail asked to live as long as
   * mail may is kept to the hour before instead, so it never outlives that.
   */
  function roundedExpiry(expires: number, at: number): number {
    const up = Math.ceil(expires / HOUR) * HOUR
    return up > at + MAX_MAIL_MS ? up - HOUR : up
  }

  async function put(
    request: Extract<LighthouseRequest, { type: 'put' }>,
    range: string,
    at: number,
  ): Promise<LighthouseReply> {
    if (request.expires <= at || request.expires > at + MAX_MAIL_MS) return error('malformed')
    const expires = roundedExpiry(request.expires, at)
    const bytes = base64Decode(request.blob)
    if (!bytes.ok) return error('malformed')
    const size = bytes.value.length
    const cost = blobCost(size, request.drops.length)
    // The limits come first, so a refused put costs no hash and nothing from the store. That
    // means a sender's retry of mail already held is refused too while its range is over a
    // limit; it tries again later, as it would after any refusal.
    if (!counter.allowPut(range, request.tag, cost, at)) return error('limit')
    const refund = () => counter.refundPut(range, request.tag, cost, at)
    if ((await store.totalBytes()) + cost > limits.maxBytes) {
      refund()
      return error('full')
    }
    const id = await mailBlobId(crypto, request.tag, request.blob, request.drops)
    // A sender's retry finds it held: the same id, and the expiry it was first put with. It
    // stores nothing, so it isn't counted.
    const held = await store.get(id, at)
    if (held !== undefined) {
      refund()
      return { type: 'stored', id, expires: held.expires }
    }
    const outcome = await store.put(
      {
        id,
        tag: request.tag,
        blob: request.blob,
        size,
        cost,
        expires,
        drops: request.drops,
      },
      at,
    )
    if (outcome === 'exists') {
      // Put by someone else a moment ago: say what's actually held.
      refund()
      const now = await store.get(id, at)
      if (now === undefined) return error('unknown')
      return { type: 'stored', id, expires: now.expires }
    }
    return { type: 'stored', id, expires }
  }

  async function answer(
    request: LighthouseRequest,
    range: string,
    greeted: boolean,
  ): Promise<LighthouseReply> {
    if (request.type === 'hello') {
      // Counted like a read, so a pass can't be guessed at speed.
      if (!counter.allowRead(range, now())) return error('limit')
      if (request.protocol !== LIGHTHOUSE_PROTOCOL)
        return { type: 'error', error: 'protocol', protocol: LIGHTHOUSE_PROTOCOL }
      if (options.pass !== undefined && !sameText(request.pass ?? '', options.pass))
        return error('pass')
      return {
        type: 'hello',
        protocol: LIGHTHOUSE_PROTOCOL,
        name: options.name,
        software: options.software,
      }
    }
    if (!greeted) return error('hello-first')
    const at = now()
    if (request.type === 'put') return put(request, range, at)
    if (!counter.allowRead(range, at)) return error('limit')
    switch (request.type) {
      case 'list': {
        const page = await store.list(request.tags, request.cursor, LIST_PAGE, at)
        return { type: 'listed', items: page.items, cursor: page.cursor, more: page.more }
      }
      case 'get': {
        const blob = await store.get(request.id, at)
        if (blob === undefined) return error('unknown')
        return { type: 'blob', id: blob.id, tag: blob.tag, blob: blob.blob, expires: blob.expires }
      }
      case 'drop': {
        const hash = await dropHash(request.key)
        if (hash === undefined) return error('malformed')
        const outcome = await store.useDrop(request.id, hash, at)
        if (outcome.kind === 'unknown') return error('unknown')
        if (outcome.kind === 'wrong') return error('wrong-drop')
        return { type: 'dropped', id: request.id, remaining: outcome.remaining }
      }
    }
  }

  return {
    connect(address, saved) {
      const range = addressRange(address)
      let greeted = saved?.greeted ?? false
      /** The client's nonce from its hello: every reply after signs it. */
      let nonce = saved?.nonce ?? ''
      let pending = 0
      // One request at a time per connection, in the order they came.
      let queue = Promise.resolve()

      const reply = async (frame: string, req: number, body: LighthouseReply) =>
        sealReply(signer, now(), { req, nonce, request: await frameHash(crypto, frame) }, body)

      /** Set once the range has sent more frames than it may: nothing more is answered. */
      let over = false

      return {
        receive(frame) {
          // Every frame is counted before it's parsed, hashed or answered, so none, not even one
          // that's refused or can't be read, costs a signature beyond the range's budget. Past
          // it the runner closes the connection rather than sign a refusal.
          if (over || !counter.allowFrame(range, now())) {
            over = true
            return Promise.resolve(undefined)
          }
          if (pending >= MAX_PENDING) return reply(frame, frameReq(frame), error('limit'))
          pending += 1
          const answered = queue.then(async () => {
            const parsed = parseRequest(frame)
            if (!parsed.ok) return reply(frame, frameReq(frame), error('malformed'))
            const { req, request } = parsed.value
            if (request.type === 'hello') nonce = request.nonce
            const body = await answer(request, range, greeted)
            if (request.type === 'hello') greeted = body.type === 'hello'
            return reply(frame, req, body)
          })
          queue = answered.then(
            () => undefined,
            () => undefined,
          )
          return answered.finally(() => {
            pending -= 1
          })
        },
        saved: () => ({ greeted, nonce }),
      }
    },
    sweep: () => store.expire(now()),
  }
}
