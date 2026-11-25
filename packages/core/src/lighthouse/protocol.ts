// What a Pigeon and a Lighthouse say to each other. Requests are plain JSON: a
// client signs nothing and says nothing about itself. Replies are signed by the Lighthouse's
// key over the hash of the exact request frame they answer and a nonce the client chose for the
// connection, so whoever relays a connection can neither change a request and pass on the real
// answer, nor replay an answer on another connection.
import {
  base32Decode,
  base32DecodeExact,
  base32Encode,
  base64Decode,
  utf8Decode,
  utf8Encode,
} from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'
import { err, ok, type Result } from '../result/result.ts'

/** Goes up when a change means older Pigeons can't follow. */
export const LIGHTHOUSE_PROTOCOL = 1
/** The most a blob may hold, before base64. */
export const MAX_BLOB_BYTES = 64 * 1024
/** One frame each way: a blob in base64 and room to spare. */
export const MAX_FRAME_BYTES = 96 * 1024
/** How long mail may be kept. */
export const MAX_MAIL_MS = 30 * 24 * 60 * 60 * 1000
/** Tags, drop values and their hashes are 32 bytes, 52 base32 letters. */
export const MAIL_KEY_BYTES = 32
/** One drop per recipient device; mail to 12 people with several devices each fits. */
export const MAX_DROPS = 64
/** Tags asked for in one `list`: 30 days of a few hundred friends takes several. */
export const MAX_LIST_TAGS = 512
/** Blobs named in one `listed` page. */
export const LIST_PAGE = 256

export interface LighthouseSoftware {
  readonly name: string
  readonly version: string
  /** The build's hash: the Lighthouse's own claim, which nothing relies on. */
  readonly build?: string
}

export type LighthouseRequest =
  | {
      readonly type: 'hello'
      readonly protocol: number
      /** 32 random bytes the client chose for this connection; every reply signs it. */
      readonly nonce: string
      readonly pass?: string
    }
  | {
      readonly type: 'put'
      readonly tag: string
      /** base64, at most MAX_BLOB_BYTES once decoded. */
      readonly blob: string
      readonly expires: number
      /** SHA-256 of each recipient device's drop value, base32. */
      readonly drops: readonly string[]
    }
  | { readonly type: 'list'; readonly tags: readonly string[]; readonly cursor: number }
  | { readonly type: 'get'; readonly id: string }
  | { readonly type: 'drop'; readonly id: string; readonly key: string }

export type LighthouseError =
  /** This Lighthouse doesn't speak the client's protocol. */
  | 'protocol'
  /** It needs a pass, and this wasn't it. */
  | 'pass'
  /** Anything else must come after hello. */
  | 'hello-first'
  | 'malformed'
  /** Full: try another Lighthouse, or later. */
  | 'full'
  /** This address has put too much for now. */
  | 'limit'
  | 'unknown'
  /** That drop doesn't open this blob, or was used already. */
  | 'wrong-drop'

export interface ListedItem {
  readonly id: string
  readonly tag: string
  readonly size: number
}

export type LighthouseReply =
  | {
      readonly type: 'hello'
      readonly protocol: number
      readonly name: string
      readonly software: LighthouseSoftware
    }
  /** Held until `expires`: a blob already here keeps the expiry it was first put with. */
  | { readonly type: 'stored'; readonly id: string; readonly expires: number }
  | {
      readonly type: 'listed'
      readonly items: readonly ListedItem[]
      /** Ask again from here for more, and keep it for next time. */
      readonly cursor: number
      readonly more: boolean
    }
  | {
      readonly type: 'blob'
      readonly id: string
      readonly tag: string
      readonly blob: string
      readonly expires: number
    }
  | { readonly type: 'dropped'; readonly id: string; readonly remaining: number }
  | {
      readonly type: 'error'
      readonly error: LighthouseError
      /** For 'protocol': what this Lighthouse speaks. */
      readonly protocol?: number
    }

/** A request as it travels: numbered, so its reply can say which it answers. */
export interface LighthouseFrame {
  readonly req: number
  readonly request: LighthouseRequest
}

/** A reply as it arrives, checked: signed by the Lighthouse, for request `req`. */
export interface SignedReply {
  readonly req: number
  readonly at: number
  readonly reply: LighthouseReply
}

type Fields = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
/**
 * A 32-byte value in base32, lowercase only so each has one spelling to match on: a tag, a
 * drop, a drop's hash, a blob id or a nonce.
 */
export const isMailKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^[a-z2-7]{52}$/.test(value)) return false
  const bytes = base32Decode(value)
  return bytes.ok && bytes.value.length === MAIL_KEY_BYTES
}
/** Request numbers start at 1; 0 is the reply to a frame that couldn't be read. */
const isReq = (value: unknown): value is number => isCount(value) && value >= 1
const isText = (max: number) => (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= max
/** The size a base64 string decodes to, or undefined when it isn't base64 at all. */
function blobSize(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BLOB_BYTES / 3) * 4) return
  const bytes = base64Decode(value)
  return bytes.ok && bytes.value.length <= MAX_BLOB_BYTES ? bytes.value.length : undefined
}

const REQUEST_CHECKS: Readonly<Record<LighthouseRequest['type'], (fields: Fields) => boolean>> = {
  hello: (f) =>
    isCount(f['protocol']) &&
    isMailKey(f['nonce']) &&
    (f['pass'] === undefined || isText(128)(f['pass'])),
  put: (f) => {
    const size = blobSize(f['blob'])
    const drops = f['drops']
    return (
      isMailKey(f['tag']) &&
      size !== undefined &&
      size > 0 &&
      isCount(f['expires']) &&
      Array.isArray(drops) &&
      drops.length > 0 &&
      drops.length <= MAX_DROPS &&
      drops.every(isMailKey) &&
      new Set(drops).size === drops.length
    )
  },
  list: (f) => {
    const tags = f['tags']
    return (
      Array.isArray(tags) &&
      tags.length > 0 &&
      tags.length <= MAX_LIST_TAGS &&
      tags.every(isMailKey) &&
      isCount(f['cursor'])
    )
  },
  get: (f) => isMailKey(f['id']),
  drop: (f) => isMailKey(f['id']) && isMailKey(f['key']),
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The request number of a frame that otherwise couldn't be read, so its refusal can say so. */
export function frameReq(text: string): number {
  if (text.length > MAX_FRAME_BYTES) return 0
  const value = parse(text)
  return isObject(value) && isReq(value['req']) ? value['req'] : 0
}

/** Reads a request frame; anything off its shape is malformed. */
export function parseRequest(text: string): Result<LighthouseFrame, 'malformed'> {
  if (text.length > MAX_FRAME_BYTES) return err('malformed')
  const value = parse(text)
  if (!isObject(value) || !isReq(value['req']) || !isObject(value['request']))
    return err('malformed')
  const request = value['request']
  const type = request['type']
  if (typeof type !== 'string' || !Object.hasOwn(REQUEST_CHECKS, type)) return err('malformed')
  if (!REQUEST_CHECKS[type as LighthouseRequest['type']](request)) return err('malformed')
  return ok({ req: value['req'], request: request as unknown as LighthouseRequest })
}

export const encodeRequest = (frame: LighthouseFrame): string =>
  JSON.stringify({ req: frame.req, request: frame.request })

/** What a reply answers: the connection's nonce and the hash of the exact request frame. */
export interface ReplyTo {
  readonly req: number
  /** The client's nonce from hello; empty before one was given. */
  readonly nonce: string
  /** `frameHash` of the request frame's text, exactly as it arrived. */
  readonly request: string
}

/** SHA-256 of a frame's text, base32: what a reply says it answers. */
export async function frameHash(crypto: Crypto, text: string): Promise<string> {
  return base32Encode(await crypto.sha256(utf8Encode(text)))
}

const signedPart = (from: PeerId, at: number, to: ReplyTo, reply: LighthouseReply): Json => ({
  v: 2,
  from,
  at,
  req: to.req,
  nonce: to.nonce,
  request: to.request,
  reply: reply as unknown as Json,
})

/** A Lighthouse's reply, signed over who it's from, when, what it answers and what it says. */
export async function sealReply(
  signer: Signer,
  at: number,
  to: ReplyTo,
  reply: LighthouseReply,
): Promise<string> {
  const part = signedPart(signer.id, at, to, reply)
  const sig = base32Encode(await signer.sign(canonicalBytes(part)))
  return JSON.stringify({ ...(part as Record<string, Json>), sig })
}

const ERRORS: ReadonlySet<string> = new Set<LighthouseError>([
  'protocol',
  'pass',
  'hello-first',
  'malformed',
  'full',
  'limit',
  'unknown',
  'wrong-drop',
])

const isListed = (value: unknown) =>
  isObject(value) && isMailKey(value['id']) && isMailKey(value['tag']) && isCount(value['size'])

const REPLY_CHECKS: Readonly<Record<LighthouseReply['type'], (fields: Fields) => boolean>> = {
  hello: (f) => {
    const software = f['software']
    return (
      isCount(f['protocol']) &&
      isText(64)(f['name']) &&
      isObject(software) &&
      isText(64)(software['name']) &&
      isText(64)(software['version']) &&
      (software['build'] === undefined || isText(128)(software['build']))
    )
  },
  stored: (f) => isMailKey(f['id']) && isCount(f['expires']),
  listed: (f) => {
    const items = f['items']
    return (
      Array.isArray(items) &&
      items.length <= LIST_PAGE &&
      items.every(isListed) &&
      isCount(f['cursor']) &&
      typeof f['more'] === 'boolean'
    )
  },
  blob: (f) =>
    isMailKey(f['id']) &&
    isMailKey(f['tag']) &&
    blobSize(f['blob']) !== undefined &&
    isCount(f['expires']),
  dropped: (f) => isMailKey(f['id']) && isCount(f['remaining']),
  error: (f) =>
    typeof f['error'] === 'string' &&
    ERRORS.has(f['error']) &&
    (f['protocol'] === undefined || isCount(f['protocol'])),
}

export type ReplyError = 'malformed' | 'bad-signature' | 'not-this-lighthouse' | 'not-my-request'

/**
 * Reads and checks a reply from the Lighthouse whose key is `lighthouse` to the request frame
 * `sent` on the connection with `nonce`: one from anyone else, one whose signature fails, or one
 * answering another request or connection is refused.
 *
 * This holds only if a client keeps its side: a fresh random nonce for every connection,
 * request numbers that only go up within one, and each request taking one reply. A client that
 * sent the same frame twice on one connection couldn't tell an old answer from a new one.
 */
export async function openReply(
  crypto: Crypto,
  lighthouse: PeerId,
  text: string,
  expected: { readonly nonce: string; readonly sent: string },
): Promise<Result<SignedReply, ReplyError>> {
  if (text.length > MAX_FRAME_BYTES) return err('malformed')
  const value = parse(text)
  if (!isObject(value)) return err('malformed')
  const { v, from, at, req, nonce, request, reply, sig } = value
  if (
    v !== 2 ||
    typeof nonce !== 'string' ||
    typeof request !== 'string' ||
    typeof from !== 'string' ||
    !isPeerId(from) ||
    !isCount(at) ||
    !isCount(req) ||
    !isObject(reply) ||
    typeof sig !== 'string'
  )
    return err('malformed')
  const type = reply['type']
  if (typeof type !== 'string' || !Object.hasOwn(REPLY_CHECKS, type)) return err('malformed')
  if (!REPLY_CHECKS[type as LighthouseReply['type']](reply)) return err('malformed')
  if (from !== lighthouse) return err('not-this-lighthouse')
  const signature = base32DecodeExact(sig)
  if (!signature.ok) return err('malformed')
  const typed = reply as unknown as LighthouseReply
  const to: ReplyTo = { req, nonce, request }
  const valid = await crypto.verify(
    from,
    signature.value,
    canonicalBytes(signedPart(from, at, to, typed)),
  )
  if (!valid) return err('bad-signature')
  if (nonce !== expected.nonce || request !== (await frameHash(crypto, expected.sent)))
    return err('not-my-request')
  return ok({ req, at, reply: typed })
}

/**
 * A blob's id is its content: the same blob has the same id on every Lighthouse, and its sender
 * can check the id a Lighthouse gives back.
 */
export async function mailBlobId(
  crypto: Crypto,
  tag: string,
  blob: string,
  drops: readonly string[],
): Promise<string> {
  // Sorted, so the same drops in another order are the same blob.
  const bytes = canonicalBytes({ v: 'pigeon/mail-id/v1', tag, blob, drops: [...drops].sort() })
  return base32Encode(await crypto.sha256(bytes))
}

/** The text of a frame as bytes arrive, for transports that carry bytes. */
export function frameText(bytes: Uint8Array): Result<string, 'malformed'> {
  if (bytes.length > MAX_FRAME_BYTES) return err('malformed')
  return utf8Decode(bytes)
}
