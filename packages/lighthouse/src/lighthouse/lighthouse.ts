// A Lighthouse's mailbox, with no platform in it: the Node and Worker runners
// hand each connection's frames to `connect(...).receive`, and send back what it returns. It
// holds mail it can't open or attribute, under tags only the two ends can work out, until every
// recipient device has dropped its copy or the mail expires. A connection may also leave one
// `wait` standing, answered later through the hooks its runner gave: as soon as another
// connection puts mail under one of its tags, or when its lease ends.
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
  wideRange,
} from '../limits/limits.ts'
import type { MailStore } from '../store/store.ts'
import { createWaitIndex, PRINT, printOf, type Scope, type Wait, type Waiter } from './waits.ts'

export type { Scope } from './waits.ts'

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
  /**
   * Runs what a put has to do after its reply has gone: waking the waits it's news to. A timer
   * of no delay unless a test says otherwise.
   */
  readonly defer?: ((run: () => void) => void) | undefined
  /**
   * Every wait the puts up to `seq` woke has been answered: the Worker writes it down. It only goes
   * up, and never past a put whose wakes are still being sent.
   */
  readonly onWoken?: ((seq: number) => void) | undefined
}

/** What a runner gives a connection, for what the Lighthouse says to it outside a reply. */
export interface ConnectionHooks {
  /** Sends a signed frame: a standing wait's answer. */
  push(frame: string): void
  /** Closes the connection: `room` (1013) for a newcomer, or `idle` (1000) gone quiet. */
  close(code: number, reason: string): void
  /** When the connection was last heard from, a frame or a keepalive, in ms. */
  heard(): number
  /** What `saved` says has changed: a wait began or ended. */
  changed?(): void
}

export interface LighthouseConnection {
  /**
   * One request frame in, one signed reply frame out; null for a wait that stands, whose answer
   * comes through the hooks later; or undefined once the client's address range has sent more
   * frames than its limit allows, when the runner closes the connection unanswered.
   */
  receive(frame: string): Promise<string | null | undefined>
  /**
   * What the connection must remember to carry on: whether it said hello, its nonce, and its
   * wait. A runner whose sockets sleep (the Worker's hibernating WebSockets) keeps it with the
   * socket and hands it back to `connect` when the socket wakes.
   */
  saved(): SavedConnection
  /** Its socket closed: its wait goes, unanswered. */
  gone(): void
}

export interface SavedConnection {
  readonly greeted: boolean
  readonly nonce: string
  readonly wait?: SavedWait | undefined
}

/** A standing wait as a socket keeps it: its tags' prints in one string, to stay small. */
export interface SavedWait extends Omit<Wait, 'tags'> {
  readonly prints: string
}

const toSaved = ({ tags, ...rest }: Wait): SavedWait => ({ ...rest, prints: tags.join('') })
const fromSaved = ({ prints, ...rest }: SavedWait): Wait => {
  const tags: string[] = []
  for (let at = 0; at + PRINT <= prints.length; at += PRINT) tags.push(prints.slice(at, at + PRINT))
  return { ...rest, tags }
}

export interface Lighthouse {
  /**
   * A connection from `address` (its IP address, used only for limits), or one waking up with
   * what it saved, its wait included.
   */
  connect(address: string, saved?: SavedConnection, hooks?: ConnectionHooks): LighthouseConnection
  /** Deletes expired mail; the runner calls it now and then. */
  sweep(): Promise<number>
  /**
   * Answers `lease` to every wait whose lease has passed. Node calls it on a timer; the Worker,
   * which has none, whenever something wakes it, after `catchUp`.
   */
  expireWaits(): Promise<void>
  /**
   * After a reset: wakes the standing waits that blobs put after `through` are news to, since
   * their put may not have woken them. The store doesn't say who put a blob, nor when, so a
   * blob's putter, or a wait whose lease has since passed, may hear of it too. Says how far it
   * looked.
   */
  catchUp(through: number): Promise<number>
  /**
   * Closes the waiting connection whose wait has stood longest in `scope` (1013, `room`), so a
   * newcomer finds room; says whether there was one.
   */
  evict(scope: Scope): boolean
  /** Done once every put's wakes have been answered. */
  settled(): Promise<void>
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

/** A connection in the index of waits, which can answer its own wait. */
interface Speaker extends Waiter {
  answer(wait: Wait, why: 'mail' | 'lease'): Promise<void>
}

/** Runs `run` on a timer of no delay: after whatever the current request still has to do. */
const soon = (run: () => void) =>
  void (globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }).setTimeout(
    run,
    0,
  )

/** Blobs looked at a time when catching up after a reset. */
const CATCH_UP_BATCH = 500

export function createLighthouse(options: LighthouseOptions): Lighthouse {
  const { signer, crypto, store, now } = options
  const limits = options.limits ?? DEFAULT_LIMITS
  const counter = createLimitCounter(limits)
  const error = (e: ErrorReply['error']): ErrorReply => ({ type: 'error', error: e })
  const waits = createWaitIndex({
    tagsPerRange: limits.waitedTagsPerRange,
    tagsPer48: limits.waitedTagsPer48,
    maxTags: limits.maxWaitedTags,
    idleMs: limits.idleSeconds * 1000,
  })
  const defer = options.defer ?? soon
  /** Puts between storing a blob and knowing its seq, and the seqs whose wakes are being sent. */
  let storing = 0
  const waking = new Set<number>()
  let wokenTo = 0
  let said = 0
  /**
   * Says how far every put's wakes have gone: below the least still waking, or as far as any has
   * gone when none is. Not while a put's seq isn't known yet, since it may be the least.
   */
  const sayWoken = () => {
    if (storing > 0) return
    const through = waking.size > 0 ? Math.min(...waking) - 1 : wokenTo
    if (through <= said) return
    said = through
    options.onWoken?.(through)
  }
  /** What puts still have to do after their replies: their wakes. */
  const later = new Set<Promise<void>>()
  const afterwards = (run: () => Promise<void>) => {
    const task = new Promise<void>((resolve) =>
      defer(() => {
        run().then(resolve, resolve)
      }),
    )
    later.add(task)
    void task.then(() => later.delete(task))
  }

  /**
   * Answers `mail` to the waits a blob of `seq` under `tag` is news to: past their cursor, their
   * lease not passed, and not the connection that put it. One gone quiet is closed instead. With
   * no putter given (catching up after a reset) the putter and the lease can't be told, so
   * neither is checked.
   */
  async function wake(
    tag: string,
    seq: number,
    putter: Speaker | undefined,
    fresh = putter !== undefined,
  ) {
    const at = now()
    for (const waiter of waits.on(printOf(tag))) {
      const standing = waits.get(waiter)
      if (standing === undefined || seq <= standing.cursor || waiter === putter) continue
      if (fresh && standing.until <= at) continue
      if (waits.quiet(waiter, at)) {
        waits.take(waiter)
        waiter.close(1000, 'idle')
        continue
      }
      if (waits.take(waiter, standing) !== undefined)
        await (waiter as Speaker).answer(standing, 'mail')
    }
  }

  /** A drop value's hash, as `put` stores it: SHA-256 of its 32 bytes. A claim's the same. */
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
    putter: Speaker,
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
    const owner = request.claim === undefined ? undefined : await dropHash(request.claim)
    if (request.claim !== undefined && owner === undefined) {
      refund()
      return error('malformed')
    }
    const id = await mailBlobId(crypto, request.tag, request.blob, request.drops, owner)
    storing += 1
    try {
      return await stored(request, putter, id, owner, size, cost, expires, at, refund)
    } finally {
      storing -= 1
      sayWoken()
    }
  }

  /** The rest of a put, from looking for the blob held: while it runs, no `onWoken` is said. */
  async function stored(
    request: Extract<LighthouseRequest, { type: 'put' }>,
    putter: Speaker,
    id: string,
    owner: string | undefined,
    size: number,
    cost: number,
    expires: number,
    at: number,
    refund: () => void,
  ): Promise<LighthouseReply> {
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
        ...(owner === undefined ? {} : { owner }),
      },
      at,
    )
    if (outcome === 'taken') {
      refund()
      return error('taken')
    }
    if (outcome === 'stored') {
      // The waits it's news to hear once its reply has gone, so signing theirs can't hold it up.
      const seq = (await store.get(id, at))?.seq
      if (seq !== undefined) {
        waking.add(seq)
        afterwards(async () => {
          try {
            await wake(request.tag, seq, putter)
          } finally {
            waking.delete(seq)
            wokenTo = Math.max(wokenTo, seq)
            sayWoken()
          }
        })
      }
    }
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
    request: Exclude<LighthouseRequest, { type: 'wait' }>,
    range: string,
    greeted: boolean,
    putter: Speaker,
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
    if (request.type === 'put') return put(request, range, at, putter)
    if (!counter.allowRead(range, at)) return error('limit')
    switch (request.type) {
      case 'list':
      case 'list-claimed': {
        const claimed = request.type === 'list-claimed'
        const page = await store.list(request.tags, request.cursor, LIST_PAGE, at, claimed)
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
    connect(address, saved, hooks) {
      const range = addressRange(address)
      let greeted = saved?.greeted ?? false
      /** The client's nonce from its hello: every reply after signs it. */
      let nonce = saved?.nonce ?? ''
      let pending = 0
      // One request at a time per connection, in the order they came.
      let queue = Promise.resolve()

      const reply = async (frame: string, req: number, body: LighthouseReply) =>
        sealReply(signer, now(), { req, nonce, request: await frameHash(crypto, frame) }, body)

      const waiter: Speaker = {
        range,
        wide: wideRange(range),
        heard: () => hooks?.heard() ?? now(),
        close: (code, reason) => hooks?.close(code, reason),
        async answer(wait, why) {
          const frame = await sealReply(
            signer,
            now(),
            { req: wait.req, nonce, request: wait.hash },
            { type: 'waited', why },
          )
          hooks?.push(frame)
          hooks?.changed?.()
        },
      }
      // Woken with a wait standing: it's indexed again, as it was.
      if (saved?.wait !== undefined && hooks !== undefined) waits.add(waiter, fromSaved(saved.wait))

      /** A `wait`: ends the one standing, then stands, or is answered at once, or refused. */
      async function wait(
        frame: string,
        req: number,
        request: Extract<LighthouseRequest, { type: 'wait' }>,
      ): Promise<string | null> {
        const standing = waits.take(waiter)
        if (standing !== undefined) await waiter.answer(standing, 'lease')
        if (!greeted) return reply(frame, req, error('hello-first'))
        const at = now()
        if (!counter.allowRead(range, at)) return reply(frame, req, error('limit'))
        if (hooks === undefined || !waits.fits(waiter, request.tags.length, at))
          return reply(frame, req, error('limit'))
        const standingNow: Wait = {
          req,
          hash: await frameHash(crypto, frame),
          tags: [...new Set(request.tags.map(printOf))],
          cursor: request.cursor,
          until: at + request.seconds * 1000,
          since: at,
          order: waits.next(),
        }
        // Indexed before the store is looked at, so a put that comes meanwhile wakes it.
        waits.add(waiter, standingNow)
        hooks.changed?.()
        const page = await store.list(request.tags, request.cursor, 1, at)
        if (page.items.length > 0 && waits.take(waiter, standingNow) !== undefined) {
          hooks.changed?.()
          return reply(frame, req, { type: 'waited', why: 'mail' })
        }
        return null
      }

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
            if (request.type === 'wait') return wait(frame, req, request)
            if (request.type === 'hello') nonce = request.nonce
            const body = await answer(request, range, greeted, waiter)
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
        saved: () => {
          const standing = waits.get(waiter)
          return { greeted, nonce, ...(standing === undefined ? {} : { wait: toSaved(standing) }) }
        },
        gone: () => {
          waits.take(waiter)
        },
      }
    },
    sweep: () => store.expire(now()),
    async expireWaits() {
      for (const waiter of waits.ended(now())) {
        const ended = waits.take(waiter)
        if (ended !== undefined) await (waiter as Speaker).answer(ended, 'lease')
      }
    },
    async catchUp(through) {
      let after = through
      if (waits.size() === 0) return after
      for (;;) {
        const at = now()
        const blobs = await store.after(after, at, CATCH_UP_BATCH)
        for (const blob of blobs) {
          await wake(blob.tag, blob.seq, undefined)
          after = blob.seq
        }
        if (blobs.length < CATCH_UP_BATCH) return after
      }
    },
    evict(scope) {
      const longest = waits.longest(scope)
      if (longest === undefined) return false
      waits.take(longest)
      longest.close(1013, 'room')
      return true
    },
    async settled() {
      while (later.size > 0) await Promise.all([...later])
    },
  }
}
