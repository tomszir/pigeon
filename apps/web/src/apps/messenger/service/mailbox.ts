// The Messenger's mail through Lighthouses: sealed letters left for friends who are offline, and
// letters fetched for this device. A letter is sealed to each of its recipient's devices and put
// at every Lighthouse they named; it stays in this Pigeon's outbox, put again every few days,
// until each of those devices sends a receipt or 30 days pass. Fetching asks each Lighthouse for
// this identity's tags since the last time, opens what's there, takes each (sender, id) once,
// drops its own copy and sends a receipt back.
import {
  base32Decode,
  base32Encode,
  type Crypto,
  dropHashes,
  isLighthouseAddress,
  isSealingKey,
  type Json,
  type Letter,
  type LighthouseAddress,
  type LighthouseClient,
  type LogHead,
  MAX_LIST_TAGS,
  MAX_MAIL_MS,
  type MailKind,
  mailTag,
  openMail,
  type PeerId,
  type SealCrypto,
  type Sealer,
  type SealingKey,
  type Signer,
  sealMail,
  utcDate,
} from '@pigeon/core'
import type { Store } from '../../../platform/storage/storage.ts'

const DAY = 24 * 60 * 60 * 1000
/** How long a letter waits for its receipts before it's put again. */
export const RESEND_AFTER_MS = 3 * DAY
/** How far back a fetch looks, at most: no mail is kept longer. */
const LOOK_BACK_DAYS = 30
/**
 * Asked for a little short of the longest a Lighthouse keeps mail, so a clock that runs ahead of
 * the Lighthouse's doesn't make every put too long to take.
 */
const EXPIRES_MS = MAX_MAIL_MS - 60 * 60 * 1000

const KEYS = {
  outbox: 'mail-outbox',
  /** Per Lighthouse: the `list` cursor, and when this device last fetched there. */
  fetched: 'mail-fetched',
  /** (sender, id) of letters already taken, with when, kept as long as mail can be. */
  seen: 'mail-seen',
} as const

/** Someone to send to: where their mail goes and what it's sealed to. */
export interface Recipient {
  readonly identity: PeerId
  /** The pair or self secret their tags come from, base32. */
  readonly secret: string
  readonly keys: readonly SealingKey[]
  readonly lighthouses: readonly LighthouseAddress[]
}

/** A letter still waiting for receipts: everything needed to put it again. */
interface Outgoing {
  readonly id: string
  readonly kind: MailKind
  readonly body: Json
  readonly to: Recipient
  /** The devices whose receipt hasn't come yet. */
  readonly waiting: readonly PeerId[]
  readonly sentAt: number
  readonly putAt: number
}

/** Whose mail to look for: a sender, the secret their tags to you come from, and what they send. */
export interface Source {
  readonly sender: PeerId
  readonly secret: string
  readonly kinds: readonly MailKind[]
  /** Where to send receipts: the sender's devices and Lighthouses, if known. */
  readonly replyTo?: Recipient | undefined
}

export interface MailboxDeps {
  readonly crypto: Crypto
  readonly seal: SealCrypto
  readonly sealer: Sealer
  readonly signer: Signer
  /** This device's identity. */
  readonly self: PeerId
  readonly store: Store
  readonly now: () => number
  readonly random: (length: number) => Uint8Array
  /** A client for a Lighthouse, kept by the caller so each has one connection. */
  readonly client: (address: LighthouseAddress) => LighthouseClient
  /** True once the Messenger has closed: nothing more is fetched, put or written. */
  readonly stopped: () => boolean
  /** Where this device's log stands, said in every letter it writes. */
  readonly head: () => LogHead
}

export interface Mailbox {
  /** Seals a letter to `to`'s devices and puts it at their Lighthouses; true if one took it. */
  send(kind: Exclude<MailKind, 'receipt'>, to: Recipient, body: Json): Promise<boolean>
  /** Puts again what's waited long enough for its receipts, and forgets what expired. */
  resend(): Promise<void>
  /**
   * Fetches this device's mail from `lighthouses` for `sources`, handing each new letter to
   * `take`, which says whether it counted. One that counted is taken once, dropped, and
   * answered with a receipt, again each time it's put again, in case the receipt was lost. One
   * that didn't (from a device not on its sender's list as this device knows it, say) is left,
   * to be looked at again when it's put again. Says whose letters every device has now
   * receipted.
   */
  fetch(
    lighthouses: readonly LighthouseAddress[],
    sources: readonly Source[],
    take: (source: Source, letter: Letter) => Promise<boolean>,
  ): Promise<readonly PeerId[]>
  /** Who an outgoing letter still waits on receipts from: senders whose receipts to look for. */
  waitingOn(): Promise<readonly Recipient[]>
  /** Stops waiting on `identity`'s receipts: they heard some other way. */
  forget(identity: PeerId): Promise<void>
}

const secretBytes = (secret: string): Uint8Array | undefined => {
  const bytes = base32Decode(secret)
  return bytes.ok ? bytes.value : undefined
}

const isRecipient = (value: unknown): value is Recipient => {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Recipient
  return (
    typeof r.identity === 'string' &&
    typeof r.secret === 'string' &&
    Array.isArray(r.keys) &&
    r.keys.every(isSealingKey) &&
    Array.isArray(r.lighthouses) &&
    r.lighthouses.every(isLighthouseAddress)
  )
}

const isOutgoing = (value: unknown): value is Outgoing =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Outgoing).id === 'string' &&
  isRecipient((value as Outgoing).to) &&
  Array.isArray((value as Outgoing).waiting)

/**
 * The UTC dates from the day before `from` to `to`, at most 30 days back, and tomorrow in the
 * last two hours of today, when a sender whose clock runs ahead may already be there.
 */
function datesBetween(from: number, to: number): string[] {
  const out: string[] = []
  const start = Math.max(from - DAY, to - LOOK_BACK_DAYS * DAY)
  for (let at = start; at <= to; at += DAY) out.push(utcDate(at))
  out.push(utcDate(to))
  if (utcDate(to + 2 * 60 * 60 * 1000) !== utcDate(to)) out.push(utcDate(to + DAY))
  return [...new Set(out)]
}

export function createMailbox(deps: MailboxDeps): Mailbox {
  const { crypto, store, now } = deps
  // One operation at a time, so a send never lands between a resend's read and its write.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  async function outbox(): Promise<Outgoing[]> {
    const stored = await store.get(KEYS.outbox)
    return Array.isArray(stored) ? stored.filter(isOutgoing) : []
  }
  const saveOutbox = (letters: readonly Outgoing[]) => store.set(KEYS.outbox, letters)

  /** Seals and puts one letter to `to`'s waiting devices; true if a Lighthouse stored it. */
  async function put(
    kind: MailKind,
    id: string,
    body: Json,
    to: Recipient,
    devices: readonly SealingKey[],
  ): Promise<boolean> {
    const secret = secretBytes(to.secret)
    if (secret === undefined || devices.length === 0) return false
    const at = now()
    const date = utcDate(at)
    const sealed = await sealMail(
      deps.seal,
      deps.signer,
      { kind, sender: deps.self, to: to.identity, date, id, head: deps.head(), at, body },
      devices,
    )
    if (!sealed.ok) return false
    const tag = await mailTag(crypto, secret, to.identity, date)
    const drops = await dropHashes(crypto, sealed.value)
    let stored = false
    for (const lighthouse of to.lighthouses) {
      const answer = await deps.client(lighthouse).request({
        type: 'put',
        tag,
        blob: sealed.value.blob,
        expires: at + EXPIRES_MS,
        drops,
      })
      if (answer.ok && answer.value.type === 'stored') stored = true
    }
    return stored
  }

  const newId = () => base32Encode(deps.random(10))

  async function receipt(to: Recipient, id: string) {
    // A receipt waits for none of its own: it's sent once, and a lost one only means a resend.
    await put('receipt', newId(), { for: id }, to, to.keys)
  }

  async function seen(): Promise<Record<string, number>> {
    const stored = await store.get(KEYS.seen)
    const at = now()
    const kept: Record<string, number> = {}
    if (typeof stored === 'object' && stored !== null)
      for (const [key, when] of Object.entries(stored as Record<string, unknown>))
        if (typeof when === 'number' && when > at - MAX_MAIL_MS - 2 * DAY) kept[key] = when
    return kept
  }

  /** A receipt from one of `sender`'s devices for letter `id`; true when that was the last. */
  async function received(sender: PeerId, device: PeerId, id: string): Promise<boolean> {
    const letters = await outbox()
    let completed = false
    const next: Outgoing[] = []
    for (const letter of letters) {
      if (letter.id !== id || letter.to.identity !== sender) {
        next.push(letter)
        continue
      }
      const waiting = letter.waiting.filter((other) => other !== device)
      if (waiting.length === 0) completed = true
      else next.push({ ...letter, waiting })
    }
    await saveOutbox(next)
    return completed
  }

  return {
    send: (kind, to, body) =>
      serial(async () => {
        if (deps.stopped()) return false
        const id = newId()
        const stored = await put(kind, id, body, to, to.keys)
        const at = now()
        const letters = await outbox()
        letters.push({
          id,
          kind,
          body,
          to,
          waiting: to.keys.map((key) => key.device),
          sentAt: at,
          // Put nowhere yet: tried again at the next check, not days later.
          putAt: stored ? at : 0,
        })
        if (!deps.stopped()) await saveOutbox(letters)
        return stored
      }),

    resend: () =>
      serial(async () => {
        const at = now()
        const letters = (await outbox()).filter((letter) => letter.sentAt + MAX_MAIL_MS > at)
        const next: Outgoing[] = []
        for (const letter of letters) {
          if (deps.stopped()) return
          if (letter.putAt + RESEND_AFTER_MS > at) {
            next.push(letter)
            continue
          }
          const devices = letter.to.keys.filter((key) => letter.waiting.includes(key.device))
          // The same id under today's tag: a device that has it already takes it once.
          const stored = await put(letter.kind, letter.id, letter.body, letter.to, devices)
          next.push({ ...letter, putAt: stored ? at : letter.putAt })
        }
        if (!deps.stopped()) await saveOutbox(next)
      }),

    fetch: (lighthouses, sources, take) =>
      serial(async () => {
        const completed: PeerId[] = []
        const fetchedStored = await store.get(KEYS.fetched)
        const fetched: Record<string, { cursor: number; at: number }> =
          typeof fetchedStored === 'object' && fetchedStored !== null
            ? { ...(fetchedStored as Record<string, { cursor: number; at: number }>) }
            : {}
        const taken = await seen()
        const at = now()
        for (const lighthouse of lighthouses) {
          if (deps.stopped()) return completed
          const last = fetched[lighthouse.id] ?? { cursor: 0, at: at - LOOK_BACK_DAYS * DAY }
          // Every source's tag for every day since the last fetch, and what each one is.
          const tags = new Map<string, { source: Source; date: string }>()
          for (const date of datesBetween(last.at, at))
            for (const source of sources) {
              const secret = secretBytes(source.secret)
              if (secret === undefined) continue
              tags.set(await mailTag(crypto, secret, deps.self, date), { source, date })
            }
          if (tags.size === 0) continue
          const client = deps.client(lighthouse)
          const all = [...tags.keys()]
          let cursor = last.cursor
          let reachable = true
          // In chunks a Lighthouse takes in one list; each read to its end from the last cursor,
          // so the cursor kept is the furthest any reached.
          for (let start = 0; start < all.length && reachable; start += MAX_LIST_TAGS) {
            const chunk = all.slice(start, start + MAX_LIST_TAGS)
            let chunkCursor = last.cursor
            for (let more = true; more && reachable; ) {
              if (deps.stopped()) return completed
              const listed = await client.request({
                type: 'list',
                tags: chunk,
                cursor: chunkCursor,
              })
              if (!listed.ok || listed.value.type !== 'listed') {
                reachable = false
                break
              }
              for (const item of listed.value.items) {
                const where = tags.get(item.tag)
                if (where === undefined) continue
                const got = await client.request({ type: 'get', id: item.id })
                if (!got.ok || got.value.type !== 'blob') {
                  // Read again next time: the cursor isn't moved past what couldn't be got.
                  reachable = false
                  break
                }
                const dayOf = Date.parse(`${where.date}T00:00:00Z`)
                const opened = await openMail(crypto, deps.seal, deps.sealer, got.value.blob, {
                  to: deps.self,
                  kinds: where.source.kinds,
                  dates: [utcDate(dayOf - DAY), where.date, utcDate(dayOf + DAY)],
                })
                if (!opened.ok || opened.value.letter.sender !== where.source.sender) continue
                const { letter, drop } = opened.value
                const key = `${letter.sender} ${letter.id}`
                if (letter.kind === 'receipt') {
                  const body = letter.body as { for?: unknown }
                  if (
                    taken[key] === undefined &&
                    typeof body?.for === 'string' &&
                    (await received(letter.sender, letter.from, body.for))
                  )
                    completed.push(letter.sender)
                  taken[key] = at
                } else {
                  const counted = taken[key] !== undefined || (await take(where.source, letter))
                  // One that didn't count is left, to be looked at again when it's put again.
                  if (!counted) continue
                  taken[key] = at
                  // Again for a letter put again: its last receipt may have been lost.
                  if (where.source.replyTo !== undefined)
                    await receipt(where.source.replyTo, letter.id)
                }
                await client.request({ type: 'drop', id: item.id, key: drop })
              }
              if (!reachable) break
              chunkCursor = listed.value.cursor
              more = listed.value.more
            }
            cursor = Math.max(cursor, chunkCursor)
          }
          if (reachable) fetched[lighthouse.id] = { cursor, at }
        }
        if (deps.stopped()) return completed
        await store.set(KEYS.fetched, fetched)
        await store.set(KEYS.seen, taken)
        return completed
      }),

    async waitingOn() {
      const letters = await outbox()
      const byIdentity = new Map<PeerId, Recipient>()
      for (const letter of letters) byIdentity.set(letter.to.identity, letter.to)
      return [...byIdentity.values()]
    },

    forget: (identity) =>
      serial(async () => {
        const letters = await outbox()
        if (!deps.stopped())
          await saveOutbox(letters.filter((letter) => letter.to.identity !== identity))
      }),
  }
}
