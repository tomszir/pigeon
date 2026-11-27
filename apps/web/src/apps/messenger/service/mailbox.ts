// The Messenger's mail through Lighthouses: sealed letters left for friends who are offline, and
// letters fetched for this device. A letter goes into this Pigeon's outbox before it's sealed to
// each of its recipient's devices and put at every Lighthouse they named, so one whose tab closed
// before the put goes at the next start; it stays there, put again every few days, until each of
// those devices sends a receipt or 30 days pass. Fetching asks each Lighthouse for
// this identity's tags since the last time, opens what's there, takes each (sender, id) once,
// drops its own copy and sends a receipt back.
import {
  base32Decode,
  base32Encode,
  base64Decode,
  type Crypto,
  dropHashes,
  inviteAnswerTag,
  inviteAskTag,
  type Json,
  type Letter,
  type LighthouseAddress,
  type LighthouseClient,
  type LogHead,
  lowSBody,
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
import { readLighthouse } from './look.ts'
import { createOutbox, letterKey, type Outgoing, type Recipient, type TagScheme } from './outbox.ts'

export type { Recipient, TagScheme } from './outbox.ts'

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

/** Whose mail to look for: a sender, the secret their tags to you come from, and what they send. */
export interface Source {
  /** Undefined for anyone: requests through an invite come from people not met yet. */
  readonly sender: PeerId | undefined
  readonly secret: string
  readonly tags?: TagScheme | undefined
  readonly kinds: readonly MailKind[]
  /** Blobs bigger than this are skipped unread. */
  readonly maxBytes?: number | undefined
  /** At most this many blobs are got each fetch. */
  readonly maxItems?: number | undefined
  /**
   * Where to send receipts: the sender's devices and Lighthouses, if known. Asked each time, as
   * a key heard while fetching (from your own other devices, say) can make it known.
   */
  readonly replyTo?: Recipient | (() => Promise<Recipient | undefined>) | undefined
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
  /** A receipt came: `device` of `sender` has letter `id`. */
  readonly onReceipt?: ((sender: PeerId, id: string, device: PeerId) => void) | undefined
  /**
   * Where mail to `to` goes now, as far as this Pigeon knows and may reach: a letter to a friend
   * put again goes there too, besides where it was put before, since they may have moved their
   * mail since it was sealed. Nothing for anyone who isn't a friend.
   */
  readonly lighthousesOf?: ((to: PeerId) => Promise<readonly LighthouseAddress[]>) | undefined
  /** A letter waiting for receipts was put again, and these Lighthouses took it. */
  readonly onStored?:
    | ((to: PeerId, id: string, where: readonly LighthouseAddress[]) => void)
    | undefined
  /** Where this device's log stands, said in every letter it writes. */
  readonly head: () => LogHead
  /**
   * The devices on a letter's recipient's list now, and the sealing keys known for them, for a
   * letter put after it was sealed; undefined for one whose list this Pigeon doesn't keep, which
   * goes to the devices it was sealed to.
   */
  readonly listOf?:
    | ((letter: {
        readonly kind: MailKind
        readonly to: Recipient
        readonly body: Json
      }) => Promise<RecipientList | undefined>)
    | undefined
}

/** A recipient's devices as their list stands, and the sealing keys known for them. */
export interface RecipientList {
  readonly devices: readonly PeerId[]
  readonly keys: readonly SealingKey[]
}

export interface Mailbox {
  /**
   * Seals a letter to `to`'s devices and puts it at their Lighthouses; true if one took it.
   * With `supersede`, it takes the place of letters of the same kind to them that still wait
   * only on devices this one goes to: it says all they did.
   */
  send(
    kind: Exclude<MailKind, 'receipt'>,
    to: Recipient,
    body: Json,
    options?: {
      readonly supersede?: boolean
      /** Put once and not kept: nothing waits for its receipts. */
      readonly once?: boolean
      /**
       * The devices whose receipts it waits for, when not all it's sealed to: only the device that
       * asked through an invite link can fetch the answer, so only its receipt can come.
       */
      readonly waitFor?: readonly PeerId[]
      /**
       * Sealed to exactly `to`'s devices each time it's put, whatever their list says: for
       * devices just taken off your list, told so.
       */
      readonly fixed?: boolean
      /** For `to`'s devices alone, while they stay on their list: none linked since is added. */
      readonly pinned?: boolean
      /** Its id, when the caller keeps track of it; a new random one otherwise. */
      readonly id?: string
      /** Told which Lighthouses took it, when any did. */
      readonly onStored?: (where: readonly LighthouseAddress[]) => void
    },
  ): Promise<boolean>
  /**
   * Like `send`, but done once the letter is in the outbox, saying whether it is: it's put in the
   * background, after any fetch under way. For a letter that must not be lost to a tab that
   * closes, written before whatever made it is kept, while a fetch, which `send` would wait
   * for, is still running. False when the Messenger has closed; it rejects when the store does.
   */
  queue(kind: Exclude<MailKind, 'receipt'>, to: Recipient, body: Json): Promise<boolean>
  /** Puts again what's waited long enough for its receipts, and forgets what expired. */
  resend(): Promise<void>
  /**
   * Puts at once the letters to `to` that no Lighthouse has taken yet, rather than at the next
   * mail check. Says whether every one of them was taken now (also true when none waited).
   */
  retry(to: PeerId): Promise<boolean>
  /**
   * Fetches this device's mail from `lighthouses` for `sources`, handing each new letter to
   * `take`, which says whether it counted. One that counted is taken once, dropped, and
   * answered with a receipt, again each time it's put again, in case the receipt was lost. One
   * that didn't (from a device not on its sender's list as this device knows it, say) is left,
   * to be looked at again when it's put again. `look`, if given, sees every letter opened at a
   * Lighthouse before any is taken. Says whose letters every device has now receipted.
   */
  fetch(
    lighthouses: readonly LighthouseAddress[],
    sources: readonly Source[],
    take: (source: Source, letter: Letter, lighthouse: LighthouseAddress) => Promise<boolean>,
    look?: (letters: readonly { source: Source; letter: Letter }[]) => Promise<void>,
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

/** The tag mail to `identity` under `secret` waits under on `date`, by `scheme`. */
async function tagFor(
  crypto: Crypto,
  scheme: TagScheme | undefined,
  secret: string,
  identity: PeerId,
  date: string,
): Promise<string | undefined> {
  if (scheme === 'invite-ask') return inviteAskTag(crypto, secret, date)
  if (scheme === 'invite-answer') return inviteAnswerTag(crypto, secret, date)
  const bytes = secretBytes(secret)
  return bytes === undefined ? undefined : mailTag(crypto, bytes, identity, date)
}

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
  // One operation with the Lighthouses at a time: puts, resends and fetches.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  const outbox = createOutbox(store, KEYS.outbox, deps.stopped)

  /** Seals and puts one letter to `to`'s waiting devices; says which Lighthouses stored it. */
  async function put(
    kind: MailKind,
    id: string,
    body: Json,
    to: Recipient,
    devices: readonly SealingKey[],
  ): Promise<LighthouseAddress[]> {
    const stored: LighthouseAddress[] = []
    if (secretBytes(to.secret) === undefined || devices.length === 0) return stored
    const at = now()
    const date = utcDate(at)
    const sealed = await sealMail(
      deps.seal,
      deps.signer,
      { kind, sender: deps.self, to: to.identity, date, id, head: deps.head(), at, body },
      devices,
    )
    if (!sealed.ok) return stored
    const tag = await tagFor(crypto, to.tags, to.secret, to.identity, date)
    if (tag === undefined) return stored
    const drops = await dropHashes(crypto, sealed.value)
    for (const lighthouse of to.lighthouses) {
      const answer = await deps.client(lighthouse).request({
        type: 'put',
        tag,
        blob: sealed.value.blob,
        expires: at + EXPIRES_MS,
        drops,
      })
      if (answer.ok && answer.value.type === 'stored') stored.push(lighthouse)
    }
    return stored
  }

  const newId = () => base32Encode(deps.random(10))

  const addressKey = (address: LighthouseAddress) =>
    `${address.id} ${address.url} ${address.pass ?? ''}`

  /**
   * Who a waiting letter is put to again: for a letter or a secret's proposal to a friend, the Lighthouses it went to
   * before and the ones their mail goes to now. Where it was put stays on the list until its
   * receipt comes, as a copy there may be the only one the friend's other devices still read.
   */
  async function reaching(letter: Outgoing): Promise<Recipient> {
    if (
      (letter.kind !== 'letter' && letter.kind !== 'rekey') ||
      letter.to.tags !== undefined ||
      deps.lighthousesOf === undefined
    )
      return letter.to
    const current = await deps.lighthousesOf(letter.to.identity).catch(() => [])
    const known = new Set(letter.to.lighthouses.map(addressKey))
    const added = current.filter((address) => !known.has(addressKey(address)))
    return added.length === 0
      ? letter.to
      : { ...letter.to, lighthouses: [...letter.to.lighthouses, ...added] }
  }

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
    let completed = false
    await outbox.change((letters) =>
      letters.flatMap((letter) => {
        if (letter.id !== id || letter.to.identity !== sender) return [letter]
        const waiting = letter.waiting.filter((other) => other !== device)
        if (waiting.length > 0) return [{ ...letter, waiting }]
        completed = true
        return []
      }),
    )
    return completed
  }

  type SendOptions = Parameters<Mailbox['send']>[3]

  /**
   * Puts `letter` in the outbox, put nowhere yet, so the next check tries it if nothing else
   * does first, taking the place of the letters it supersedes.
   */
  function enqueue(letter: Outgoing, options: SendOptions): Promise<boolean> {
    const reaches = new Set(letter.to.keys.map((key) => key.device))
    return outbox.change((letters) => [
      ...letters.filter(
        (other) =>
          options?.supersede !== true ||
          other.kind !== letter.kind ||
          other.to.identity !== letter.to.identity ||
          !other.waiting.every((device) => reaches.has(device)),
      ),
      letter,
    ])
  }

  /**
   * `letter` sealed to its recipient's list as it stands now: to the devices on it with a key
   * known here, waiting on those it waited on that are still on it and on those linked since,
   * so one removed since is neither sealed to nor waited on. A pinned letter adds no device, and
   * a fixed one, or one whose list this Pigeon doesn't keep, goes as it was sealed. Undefined
   * when the list can't be read now: nothing is put, rather than put to the devices from before.
   */
  async function resealed(letter: Outgoing): Promise<Outgoing | undefined> {
    if (letter.fixed === true || deps.listOf === undefined) return letter
    let list: RecipientList | undefined
    try {
      list = await deps.listOf(letter)
    } catch {
      return undefined
    }
    if (list === undefined) return letter
    const listed = new Set(list.devices)
    const keys = list.keys.filter((key) => listed.has(key.device))
    const before = new Set(letter.to.keys.map((key) => key.device))
    const added =
      letter.pinned === true
        ? []
        : keys
            .map((key) => key.device)
            .filter((device) => !before.has(device) && !letter.waiting.includes(device))
    return {
      ...letter,
      to: {
        ...letter.to,
        keys: letter.pinned === true ? keys.filter((key) => before.has(key.device)) : keys,
      },
      waiting: [...letter.waiting.filter((device) => listed.has(device)), ...added],
    }
  }

  /**
   * Puts `kept` once, sealed to the list as it stands (to `everyone` it's sealed to, as its
   * first put is, or only to those it waits on), and the letter as it's kept after; none once
   * nobody it waits on is left on the list. Under the same id each time, so a device that has it
   * takes it once and its receipt still names it; what was put before is left to expire.
   */
  async function putLetter(
    kept: Outgoing,
    everyone: boolean,
  ): Promise<{ readonly after: Outgoing | undefined; readonly where: LighthouseAddress[] }> {
    const letter = await resealed(kept)
    if (letter === undefined) return { after: kept, where: [] }
    if (letter.waiting.length === 0) return { after: undefined, where: [] }
    const devices = everyone
      ? letter.to.keys
      : letter.to.keys.filter((key) => letter.waiting.includes(key.device))
    // Kept here, perhaps since before Pigeon took only low-S signatures: what's signed in it
    // goes out spelled as it's taken now, or it would be refused at every put.
    const body = lowSBody(letter.body)
    // The same id under today's tag: a device that has it already takes it once.
    const reach = await reaching(letter)
    const where = await put(letter.kind, letter.id, body, reach, devices)
    const putAt = where.length > 0 ? now() : letter.putAt
    return { after: { ...letter, body, to: reach, putAt }, where }
  }

  /**
   * The first put of a letter in the outbox; true if a Lighthouse took it, then or in a resend
   * that came first. Nothing for one superseded or receipted meanwhile.
   */
  async function putQueued(letter: Outgoing, options: SendOptions): Promise<boolean> {
    if (deps.stopped()) return false
    const kept = (await outbox.read()).find((other) => letterKey(other) === letterKey(letter))
    if (kept === undefined) return false
    if (kept.putAt !== 0) return true
    const { after, where } = await putLetter(kept, true)
    if (where.length > 0) options?.onStored?.(where)
    await outbox.update([{ before: kept, after }], () => true)
    return where.length > 0
  }

  /** A new letter, as the outbox keeps it until its receipts come. */
  const outgoing = (kind: MailKind, to: Recipient, body: Json, options: SendOptions): Outgoing => ({
    id: options?.id ?? newId(),
    kind,
    body,
    to,
    waiting: options?.waitFor ?? to.keys.map((key) => key.device),
    sentAt: now(),
    putAt: 0,
    ...(options?.fixed === true ? { fixed: true } : {}),
    ...(options?.pinned === true ? { pinned: true } : {}),
  })

  return {
    async send(kind, to, body, options) {
      if (deps.stopped()) return false
      if (options?.once === true)
        return serial(async () => {
          if (deps.stopped()) return false
          const where = await put(kind, options.id ?? newId(), body, to, to.keys)
          if (where.length > 0) options.onStored?.(where)
          return where.length > 0
        })
      const letter = outgoing(kind, to, body, options)
      if (!(await enqueue(letter, options))) return false
      return serial(() => putQueued(letter, options))
    },

    async queue(kind, to, body) {
      if (deps.stopped()) return false
      const letter = outgoing(kind, to, body, undefined)
      if (!(await enqueue(letter, undefined))) return false
      void serial(() => putQueued(letter, undefined)).catch(() => undefined)
      return true
    },

    resend: () =>
      serial(async () => {
        const at = now()
        const live = (letter: Outgoing) => letter.sentAt + MAX_MAIL_MS > at
        const changes: { before: Outgoing; after: Outgoing | undefined }[] = []
        for (const kept of (await outbox.read()).filter(live)) {
          if (deps.stopped()) return
          if (kept.putAt + RESEND_AFTER_MS > at) continue
          const { after, where } = await putLetter(kept, false)
          if (where.length > 0) deps.onStored?.(kept.to.identity, kept.id, where)
          changes.push({ before: kept, after })
        }
        await outbox.update(changes, live)
      }),

    retry: (to) =>
      serial(async () => {
        const at = now()
        let allTaken = true
        const changes: { before: Outgoing; after: Outgoing | undefined }[] = []
        for (const kept of await outbox.read()) {
          // Only a letter put nowhere yet: one a Lighthouse holds waits for its receipts instead.
          if (
            deps.stopped() ||
            kept.to.identity !== to ||
            kept.putAt !== 0 ||
            kept.sentAt + MAX_MAIL_MS <= at
          )
            continue
          const { after, where } = await putLetter(kept, false)
          if (where.length > 0) deps.onStored?.(kept.to.identity, kept.id, where)
          // One with nobody left to hear it isn't waiting to be taken.
          else if (after !== undefined) allTaken = false
          changes.push({ before: kept, after })
        }
        await outbox.update(changes, () => true)
        return allTaken
      }),

    fetch: (lighthouses, sources, take, look) =>
      serial(async () => {
        const completed: PeerId[] = []
        const fetchedStored = await store.get(KEYS.fetched)
        const fetched: Record<string, { cursor: number; at: number }> =
          typeof fetchedStored === 'object' && fetchedStored !== null
            ? { ...(fetchedStored as Record<string, { cursor: number; at: number }>) }
            : {}
        const taken = await seen()
        const at = now()
        // Everything waiting, at every Lighthouse, is opened first and acted on after, so what a
        // letter means can depend on all of them (a removal, say), never on which Lighthouse
        // was asked first or the order one happened to list them in.
        const opened: {
          client: LighthouseClient
          lighthouse: LighthouseAddress
          id: string
          source: Source
          letter: Letter
          drop: string
        }[] = []
        const reached: Record<string, { cursor: number; at: number }> = {}
        // Blobs got per source this fetch, for its `maxItems`.
        const got = new Map<Source, number>()
        for (const lighthouse of lighthouses) {
          if (deps.stopped()) return completed
          const last = fetched[lighthouse.id] ?? { cursor: 0, at: at - LOOK_BACK_DAYS * DAY }
          // Every source's tag for every day since the last fetch, and what each one is.
          const tags = new Map<string, { source: Source; date: string }>()
          for (const date of datesBetween(last.at, at))
            for (const source of sources) {
              const tag = await tagFor(crypto, source.tags, source.secret, deps.self, date)
              if (tag !== undefined) tags.set(tag, { source, date })
            }
          if (tags.size === 0) continue
          const client = deps.client(lighthouse)
          const read = await readLighthouse(
            [...tags.keys()],
            last.cursor,
            async (chunk, cursor) => {
              const listed = await client.request({ type: 'list', tags: chunk, cursor })
              return listed.ok && listed.value.type === 'listed' ? listed.value : undefined
            },
            async (item) => {
              const where = tags.get(item.tag)
              if (where === undefined) return { kind: 'done' }
              const { maxBytes, maxItems } = where.source
              if (maxBytes !== undefined && item.size > maxBytes) return { kind: 'done' }
              const count = got.get(where.source) ?? 0
              // Read next time: the cursor isn't moved past what was left for later.
              if (maxItems !== undefined && count >= maxItems) return { kind: 'held' }
              const blob = await client.request({ type: 'get', id: item.id })
              // Gone since it was listed (taken by another device, dropped, expired): there's
              // nothing to read and nothing to wait for, so the rest of the list goes on, and
              // the cursor moves past it with the rest.
              if (blob.ok && blob.value.type === 'error' && blob.value.error === 'unknown')
                return { kind: 'done' }
              // Read again next time: the cursor isn't moved past what couldn't be got.
              if (!blob.ok || blob.value.type !== 'blob') return { kind: 'failed' }
              got.set(where.source, count + 1)
              // The size listed is only the Lighthouse's word: the blob itself is measured too,
              // so one that lists a small size can't hand over a big blob to open.
              if (maxBytes !== undefined) {
                const bytes = base64Decode(blob.value.blob)
                if (!bytes.ok || bytes.value.length > maxBytes) return { kind: 'done' }
              }
              const dayOf = Date.parse(`${where.date}T00:00:00Z`)
              const open = await openMail(crypto, deps.seal, deps.sealer, blob.value.blob, {
                to: deps.self,
                kinds: where.source.kinds,
                dates: [utcDate(dayOf - DAY), where.date, utcDate(dayOf + DAY)],
              })
              const { sender } = where.source
              if (open.ok && (sender === undefined || open.value.letter.sender === sender))
                opened.push({
                  client,
                  lighthouse,
                  id: item.id,
                  source: where.source,
                  ...open.value,
                })
              return { kind: 'done' }
            },
            { stopped: deps.stopped },
          )
          if (deps.stopped()) return completed
          // One that didn't finish saves nothing, keeping its days: the next reads them again.
          if (read.complete) reached[lighthouse.id] = { cursor: read.cursor, at }
        }
        if (deps.stopped()) return completed
        await look?.(opened.map(({ source, letter }) => ({ source, letter })))
        for (const {
          client,
          id: blobId,
          source,
          letter,
          drop,
          lighthouse: lighthouseOf,
        } of opened) {
          if (deps.stopped()) return completed
          const key = `${letter.sender} ${letter.id}`
          if (letter.kind === 'receipt') {
            const body = letter.body as { for?: unknown }
            if (
              taken[key] === undefined &&
              typeof body?.for === 'string' &&
              (await received(letter.sender, letter.from, body.for))
            )
              completed.push(letter.sender)
            if (taken[key] === undefined && typeof body?.for === 'string')
              deps.onReceipt?.(letter.sender, body.for, letter.from)
            taken[key] = at
          } else {
            const counted = taken[key] !== undefined || (await take(source, letter, lighthouseOf))
            // One that didn't count is left, to be looked at again when it's put again.
            if (!counted) continue
            taken[key] = at
            // Again for a letter put again: its last receipt may have been lost.
            const { replyTo } = source
            const to = typeof replyTo === 'function' ? await replyTo() : replyTo
            if (to !== undefined) await receipt(to, letter.id)
          }
          await client.request({ type: 'drop', id: blobId, key: drop })
        }
        if (deps.stopped()) return completed
        await store.set(KEYS.fetched, { ...fetched, ...reached })
        await store.set(KEYS.seen, taken)
        return completed
      }),

    async waitingOn() {
      const letters = await outbox.read()
      const byIdentity = new Map<PeerId, Recipient>()
      for (const letter of letters) byIdentity.set(letter.to.identity, letter.to)
      return [...byIdentity.values()]
    },

    async forget(identity) {
      await outbox.change((letters) => letters.filter((letter) => letter.to.identity !== identity))
    },
  }
}
