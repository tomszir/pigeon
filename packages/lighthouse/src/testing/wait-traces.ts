// Turns the wait conformance traces (`./wait-conformance.ts`) into real frames, and the frames a
// Lighthouse sends back into trace outputs. Tag and blob names become 32-byte keys, a put's
// blob the bytes of its name with one drop, ranges real addresses, and request numbers move up
// by one, since each connection says hello first.
import {
  base32Decode,
  base32Encode,
  base64Encode,
  type Crypto,
  encodeRequest,
  KEEPALIVE_ANSWER,
  LIGHTHOUSE_PROTOCOL,
  MAX_MAIL_MS,
  mailBlobId,
  utf8Encode,
} from '@pigeon/core'
import { DEFAULT_LIMITS, type Limits } from '../limits/limits.ts'
import { TRACE_LIMITS } from './wait-conformance.ts'
import type { Body, Output, Request, WaitLimits } from './wait-reference.ts'

const MANY = 1_000_000

/**
 * A trace's limits as a Lighthouse's own. What the model leaves out (frames, puts, the /48's
 * reads and connections) is set out of reach.
 */
export function lighthouseLimitsFor(limits: WaitLimits): Limits {
  return {
    ...DEFAULT_LIMITS,
    framesPerMinute: MANY,
    framesPerMinutePer48: MANY,
    putsPerHour: MANY,
    putsPerHourPer48: MANY,
    totalPutsPerHour: MANY,
    bytesPerHour: MANY,
    blobsPerTagPerDay: MANY,
    readsPerMinute: limits.readsPerMinute,
    readsPerMinutePer48: MANY,
    waitedTagsPerRange: limits.tagsPerRange,
    waitedTagsPer48: limits.tagsPer48,
    maxWaitedTags: limits.maxWaitedTags,
    idleSeconds: limits.idleSeconds,
    maxConnections: limits.maxConnections,
    connectionsPerRange: limits.connectionsPerRange,
    connectionsPer48: MANY,
  }
}

/** The usual traces' limits as a Lighthouse's own. */
export const TRACE_LIGHTHOUSE_LIMITS: Limits = lighthouseLimitsFor(TRACE_LIMITS)

export interface Translator {
  /** An address in the trace's range: one IPv4 address, or two /64s in one /48. */
  address(range: string): string
  /** A connection's hello, request 1. */
  hello(): string
  /** The frame for the trace's request `req` on a connection, put at `now` (ms). */
  request(req: number, request: Request, now: number): Promise<string>
  /** What `text`, sent to `conn`, says in the model's terms; nothing for a hello's answer. */
  read(conn: string, text: string): Output | undefined
}

const ADDRESSES: Readonly<Record<string, string>> = {
  v4: '203.0.113.9',
  v6a: '2001:db8:1:1::5',
  v6b: '2001:db8:1:2::5',
}

const DAY = 24 * 60 * 60 * 1000

export function createTranslator(crypto: Crypto): Translator {
  const names = new Map<string, string>()
  const keys = new Map<string, string>()
  /** A 32-byte key for a name, the same each time, and the name back from it. */
  const key = async (name: string) => {
    const held = keys.get(name)
    if (held !== undefined) return held
    const made = base32Encode(await crypto.sha256(utf8Encode(`trace ${name}`)))
    keys.set(name, made)
    names.set(made, name)
    return made
  }
  const nameOf = (value: string) => names.get(value) ?? value
  const body = (reply: Record<string, unknown>): Body => {
    switch (reply['type']) {
      case 'listed':
        return {
          type: 'listed',
          items: (reply['items'] as { id: string; tag: string }[]).map((item) => ({
            id: nameOf(item.id),
            tag: nameOf(item.tag),
          })),
          cursor: reply['cursor'] as number,
          more: reply['more'] as boolean,
        }
      case 'waited':
        return { type: 'waited', why: reply['why'] as 'mail' | 'lease' }
      case 'stored':
        return { type: 'stored' }
      case 'dropped':
        return { type: 'dropped' }
      default:
        return { type: 'error', error: reply['error'] as 'malformed' }
    }
  }
  return {
    address: (range) => ADDRESSES[range] ?? range,
    hello: () =>
      encodeRequest({
        req: 1,
        request: { type: 'hello', protocol: LIGHTHOUSE_PROTOCOL, nonce: 'a'.repeat(52) },
      }),
    async request(req, request, now) {
      const real = req + 1
      if (request.type === 'wait')
        return JSON.stringify({
          req: real,
          request: {
            type: 'wait',
            tags: await Promise.all(request.tags.map(key)),
            cursor: request.cursor,
            seconds: request.seconds,
          },
        })
      if (request.type === 'list')
        return encodeRequest({
          req: real,
          request: {
            type: 'list',
            tags: await Promise.all(request.tags.map(key)),
            cursor: request.cursor,
          },
        })
      const drop = await key(`drop ${request.id}`)
      const dropBytes = base32Decode(drop)
      const dropHash = base32Encode(
        await crypto.sha256(dropBytes.ok ? dropBytes.value : new Uint8Array()),
      )
      const blob = base64Encode(utf8Encode(`blob ${request.id}`))
      if (request.type === 'put') {
        const tag = await key(request.tag)
        const id = await mailBlobId(crypto, tag, blob, [dropHash])
        keys.set(`blob ${request.id}`, id)
        names.set(id, request.id)
        return encodeRequest({
          req: real,
          request: { type: 'put', tag, blob, expires: now + MAX_MAIL_MS - DAY, drops: [dropHash] },
        })
      }
      return encodeRequest({
        req: real,
        request: {
          type: 'drop',
          id: keys.get(`blob ${request.id}`) ?? (await key(request.id)),
          key: drop,
        },
      })
    },
    read(conn, text) {
      if (text === KEEPALIVE_ANSWER) return { kind: 'pong', conn }
      const frame = JSON.parse(text) as { req: number; reply: Record<string, unknown> }
      if (frame.req === 1) return undefined
      return { kind: 'reply', conn, req: frame.req - 1, body: body(frame.reply) }
    },
  }
}
