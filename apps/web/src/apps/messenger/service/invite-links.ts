// Invite links through Lighthouses: links this device made, with the requests that came through
// them, and requests this device sent through someone else's link, waiting for an answer.
//
// A link's card waits at this device's Lighthouses until the link expires; requests come as
// `mail:invite` under the link's ask tags, and wait here until you add or decline each one; the
// answer goes back as `mail:invite-answer` under the asker's reply secret. Only the device that
// made a link answers through it, and only it can take its cards down: the drop value never
// leaves it. Your other devices hear of your links in the self mailbox, and close those of a
// device taken off your list with a closed card signed on the newer list, which wins.
import {
  base32Decode,
  base32Encode,
  type Crypto,
  DEFAULT_INVITE_LINK_LIFETIME,
  DEFAULT_INVITE_LINK_USES,
  type DeviceLog,
  decodeInviteLink,
  deviceState,
  encodeInviteLinkFragment,
  fingerprint,
  formatFingerprint,
  INVITE_LINK_LIFETIMES,
  INVITE_LINK_USES,
  type InviteCard,
  type InviteLink,
  inviteAnswerBody,
  inviteCardTag,
  inviteRequestBody,
  isInviteSecret,
  isLighthouseAddress,
  isPairSecret,
  isPeerId,
  isSealingKey,
  type Json,
  type Letter,
  type LighthouseAddress,
  type LighthouseClient,
  linkFingerprint,
  MAX_INVITE_REQUEST_BYTES,
  MAX_INVITE_REQUESTS_PER_DAY,
  MAX_MAIL_MS,
  newestCard,
  openInviteCard,
  type PeerId,
  readInviteAnswer,
  readInviteRequest,
  type SealCrypto,
  type SealingKey,
  type Signer,
  sealInviteCard,
  speakerIdentity,
  verifySealingKey,
} from '@pigeon/core'
import { createSignal } from 'solid-js'
import type { Store } from '../../../platform/storage/storage.ts'
import type { Mailbox, Recipient, Source } from './mailbox.ts'

const HOUR = 60 * 60 * 1000
/** A card asks for a little less than a Lighthouse keeps, as every put does. */
const CARD_EXPIRES_SLACK = HOUR
/** How long a link or a sent request is remembered after it expired, for late mail. */
const KEEP_AFTER_EXPIRY = 2 * 24 * HOUR
/** Items under a card tag read when a link is opened, and cards got of them, newest first. */
const MAX_CARD_ITEMS = 500
const MAX_CARD_GETS = 100
/** A card bigger than this is junk: a real one is a few kilobytes. */
const MAX_CARD_BYTES = 32 * 1024
/** Requests waiting on one link at most: more are left unread until some are answered. */
export const MAX_WAITING_REQUESTS = 50
/** "Closed" answers one link sends at most, to requests that came after it closed. */
const MAX_CLOSED_ANSWERS = 20
/** Lighthouses an answer goes to at most: the asker names them, so they're kept few. */
const MAX_ANSWER_LIGHTHOUSES = 2
/** Devices of one person whose requests are answered. */
const MAX_REPLIES = 4

const KEYS = {
  links: 'invite-links',
  others: 'invite-links-elsewhere',
  asks: 'invite-asks',
} as const

/** Where one of an asker's devices waits for the answer. */
export interface Reply {
  readonly reply: string
  readonly device: PeerId
}

/** Someone who asked to be friends through one of your links. */
export interface LinkRequest {
  readonly identity: PeerId
  readonly name: string
  /** "7f3a 91c2 04be d817", to compare with them some other way. */
  readonly fingerprint: string
  readonly deviceLog: DeviceLog
  readonly keys: readonly SealingKey[]
  readonly lighthouses: readonly LighthouseAddress[]
  readonly replies: readonly Reply[]
  readonly at: number
  /** `adding` between Add and the answer being on its way; picked up again after a restart. */
  readonly state: 'waiting' | 'adding' | 'added' | 'declined' | 'closed'
  /** The pair secret, once Add was chosen. */
  readonly pairSecret?: string | undefined
}

/** A link this device made. */
export interface OwnLink {
  readonly secret: string
  /** 32 random bytes, base32: what takes its cards down. It never leaves this device. */
  readonly drop: string
  /** Each Lighthouse's id for the card it holds now. */
  readonly cards: Readonly<Record<string, string>>
  readonly madeAt: number
  readonly expires: number
  readonly uses: number
  readonly used: number
  readonly open: boolean
  readonly url: string
  readonly requests: readonly LinkRequest[]
  /** "Closed" answers sent so far, to requests after it closed. */
  readonly closedAnswers: number
}

/** A link another of your devices made, as it last said. */
export interface OtherLink {
  readonly secret: string
  readonly owner: PeerId
  readonly expires: number
  readonly uses: number
  readonly used: number
  readonly open: boolean
}

/** A request this device sent through someone's link, waiting for their answer. */
export interface SentAsk {
  readonly secret: string
  readonly identity: PeerId
  readonly name: string
  readonly fingerprint: string
  readonly keys: readonly SealingKey[]
  readonly lighthouses: readonly LighthouseAddress[]
  readonly reply: string
  readonly expires: number
  readonly at: number
  readonly state: 'waiting' | 'declined' | 'closed' | 'busy'
}

/** What opening someone's link found: their card, or why there's nothing to ask. */
export type OpenedLink =
  | {
      readonly ok: true
      readonly link: InviteLink
      readonly card: InviteCard
      readonly fingerprint: string
    }
  | {
      readonly ok: false
      readonly error: 'malformed' | 'not-found' | 'closed' | 'expired' | 'own' | 'friend'
    }

export type MakeLinkError = 'no-lighthouse' | 'not-stored' | 'no-name' | 'removed'
export type AskResult = 'sent' | 'no-lighthouse' | 'not-sent'

/** Someone new to be friends with, through a link, either way round. */
export interface LinkFriend {
  readonly id: PeerId
  readonly handle: string
  readonly secret: string
  readonly deviceLog: DeviceLog
  readonly keys: readonly SealingKey[]
  readonly lighthouses: readonly LighthouseAddress[]
}

export interface InviteLinksDeps {
  readonly crypto: Crypto
  readonly seal: SealCrypto
  readonly signer: Signer
  /** This device's identity. */
  readonly self: PeerId
  readonly store: Store
  readonly now: () => number
  readonly random: (length: number) => Uint8Array
  readonly mailbox: Mailbox
  readonly client: (address: LighthouseAddress) => LighthouseClient
  /** The official Lighthouses: where a link that names none is looked up. */
  readonly official: readonly LighthouseAddress[]
  readonly lighthouses: () => readonly LighthouseAddress[]
  readonly inviteBase: string
  readonly name: () => string
  readonly deviceLog: () => DeviceLog
  /** This device is on its identity's list. */
  readonly active: () => boolean
  /** Sealing keys of your devices on your list, this one's included. */
  readonly ownKeys: () => Promise<readonly SealingKey[]>
  readonly knownLog: (id: PeerId) => Promise<DeviceLog | undefined>
  readonly isFriend: (id: PeerId) => boolean
  readonly isBlocked: (id: PeerId) => boolean
  readonly newSecret: () => string
  /** Makes them a friend, with the pair secret, their devices and their mail book. */
  readonly befriend: (friend: LinkFriend) => Promise<void>
  /** A friend to mail: for receipts once a link has made them one. */
  readonly friendRecipient: (id: PeerId) => Promise<Recipient | undefined>
  /** Your links changed: tell your other devices. */
  readonly changed: () => void
  readonly stopped: () => boolean
}

const REQUEST_STATES = new Set(['waiting', 'adding', 'added', 'declined', 'closed'])

const isRequest = (value: unknown): value is LinkRequest => {
  if (typeof value !== 'object' || value === null) return false
  const r = value as LinkRequest
  return (
    typeof r.identity === 'string' &&
    typeof r.name === 'string' &&
    typeof r.fingerprint === 'string' &&
    Array.isArray(r.replies) &&
    r.replies.every((reply) => isInviteSecret(reply?.reply) && typeof reply.device === 'string') &&
    Array.isArray(r.keys) &&
    r.keys.every(isSealingKey) &&
    Array.isArray(r.lighthouses) &&
    r.lighthouses.every(isLighthouseAddress) &&
    REQUEST_STATES.has(r.state)
  )
}

const isOwnLink = (value: unknown): value is OwnLink => {
  if (typeof value !== 'object' || value === null) return false
  const l = value as OwnLink
  return (
    isInviteSecret(l.secret) &&
    typeof l.drop === 'string' &&
    typeof l.cards === 'object' &&
    l.cards !== null &&
    typeof l.expires === 'number' &&
    typeof l.uses === 'number' &&
    typeof l.used === 'number' &&
    typeof l.open === 'boolean' &&
    typeof l.url === 'string' &&
    typeof l.closedAnswers === 'number' &&
    Array.isArray(l.requests) &&
    l.requests.every(isRequest)
  )
}

/** A link another device of yours said, as it travels in the self mailbox. */
export function isOtherLink(value: unknown): value is OtherLink {
  if (typeof value !== 'object' || value === null) return false
  const l = value as OtherLink
  return (
    isInviteSecret(l.secret) &&
    typeof l.owner === 'string' &&
    isPeerId(l.owner) &&
    Number.isSafeInteger(l.expires) &&
    Number.isSafeInteger(l.uses) &&
    Number.isSafeInteger(l.used) &&
    typeof l.open === 'boolean'
  )
}

const isAsk = (value: unknown): value is SentAsk => {
  if (typeof value !== 'object' || value === null) return false
  const a = value as SentAsk
  return (
    isInviteSecret(a.secret) &&
    typeof a.identity === 'string' &&
    isInviteSecret(a.reply) &&
    Array.isArray(a.keys) &&
    a.keys.every(isSealingKey) &&
    Array.isArray(a.lighthouses) &&
    a.lighthouses.every(isLighthouseAddress) &&
    typeof a.expires === 'number' &&
    ['waiting', 'declined', 'closed', 'busy'].includes(a.state)
  )
}

const unique = (list: readonly LighthouseAddress[]) =>
  list.filter((address, i) => list.findIndex((other) => other.id === address.id) === i)

/** One of the presets, so a link is only ever one of them. */
function preset(value: number, presets: readonly number[], fallback: number): number {
  return presets.includes(value) ? value : fallback
}

export async function loadInviteLinks(deps: InviteLinksDeps) {
  const { crypto, store, now } = deps
  const stored = await store.get(KEYS.links)
  const [links, setLinksSignal] = createSignal<readonly OwnLink[]>(
    Array.isArray(stored) ? stored.filter(isOwnLink) : [],
  )
  const storedOthers = await store.get(KEYS.others)
  let others: readonly OtherLink[] = Array.isArray(storedOthers)
    ? storedOthers.filter(isOtherLink)
    : []
  const storedAsks = await store.get(KEYS.asks)
  const [asks, setAsksSignal] = createSignal<readonly SentAsk[]>(
    Array.isArray(storedAsks) ? storedAsks.filter(isAsk) : [],
  )

  // One change to the lists at a time, so a request arriving never undoes an approval. Nothing
  // run under it waits on the mailbox, which may be fetching and waiting on this.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  async function saveLinks(next: readonly OwnLink[]) {
    const at = now()
    // Forgotten a while after they expire: late requests are answered "closed" until then.
    const kept = next.filter((link) => link.expires + KEEP_AFTER_EXPIRY > at)
    setLinksSignal(kept)
    if (!deps.stopped()) await store.set(KEYS.links, kept)
  }
  async function saveAsks(next: readonly SentAsk[]) {
    const kept = next.filter((ask) => ask.expires + KEEP_AFTER_EXPIRY > now())
    setAsksSignal(kept)
    if (!deps.stopped()) await store.set(KEYS.asks, kept)
  }
  const updateLink = (secret: string, change: (link: OwnLink) => OwnLink) =>
    saveLinks(links().map((link) => (link.secret === secret ? change(link) : link)))
  const linkOf = (secret: string) => links().find((link) => link.secret === secret)

  /** Where a card goes: your Lighthouses without a pass. */
  const cardLighthouses = () => deps.lighthouses().filter((address) => address.pass === undefined)

  const dropHashOf = async (drop: string) => {
    const bytes = base32Decode(drop)
    return bytes.ok ? base32Encode(await crypto.sha256(bytes.value)) : undefined
  }

  /**
   * Puts the link's card as things are now, open or closed, at your Lighthouses, and takes down
   * the cards it replaces with `drop`, which only this device has. Says where each now is.
   */
  async function putCard(
    link: { secret: string; expires: number },
    open: boolean,
    drop: string,
    before: Readonly<Record<string, string>> = {},
  ): Promise<Record<string, string>> {
    const where = cardLighthouses()
    const cards: Record<string, string> = {}
    const hash = await dropHashOf(drop)
    const expires = Math.min(link.expires, now() + MAX_MAIL_MS - CARD_EXPIRES_SLACK)
    const sealed =
      hash === undefined
        ? undefined
        : await sealInviteCard(crypto, deps.seal, deps.signer, link.secret, {
            identity: deps.self,
            deviceLog: deps.deviceLog(),
            keys: await deps.ownKeys(),
            name: deps.name(),
            lighthouses: where,
            expires: link.expires,
            open,
          })
    const tag = await inviteCardTag(crypto, link.secret)
    for (const lighthouse of where) {
      if (sealed === undefined || !sealed.ok || hash === undefined || expires <= now()) break
      const put = await deps.client(lighthouse).request({
        type: 'put',
        tag,
        blob: sealed.value,
        expires,
        drops: [hash],
      })
      if (put.ok && put.value.type === 'stored') cards[lighthouse.id] = put.value.id
    }
    // The old cards come down once the new ones are up, wherever they were.
    for (const [id, blob] of Object.entries(before)) {
      if (cards[id] === blob) continue
      const lighthouse = [...where, ...deps.official, ...deps.lighthouses()].find(
        (address) => address.id === id,
      )
      if (lighthouse !== undefined)
        await deps.client(lighthouse).request({ type: 'drop', id: blob, key: drop })
    }
    return cards
  }

  /** What the link names: your official Lighthouses, or one of yours when you've none of them. */
  function linkUrl(secret: string, print: string): string {
    const where = cardLighthouses()
    const official = new Set(deps.official.map((address) => address.id))
    const named = where.some((address) => official.has(address.id)) ? undefined : where[0]
    const fragment = encodeInviteLinkFragment({ secret, fingerprint: print, lighthouse: named })
    return `${deps.inviteBase}#${fragment}`
  }

  /** Each of the asker's devices that's waiting, as somewhere to send the answer. */
  function answerTo(request: LinkRequest, reply: Reply): Recipient {
    return {
      identity: request.identity,
      secret: reply.reply,
      tags: 'invite-answer',
      keys: request.keys,
      lighthouses: (request.lighthouses.length > 0 ? request.lighthouses : deps.official).slice(
        0,
        MAX_ANSWER_LIGHTHOUSES,
      ),
    }
  }

  /** Answers every device that asked; `kept` ones wait for that device's receipt. */
  async function answer(request: LinkRequest, body: Json, kept: boolean) {
    for (const reply of request.replies)
      await deps.mailbox.send('invite-answer', answerTo(request, reply), body, {
        once: !kept,
        waitFor: [reply.device],
      })
  }

  /** Tells everyone still waiting on a link that closed: it won't add them. */
  async function answerWaiting(link: OwnLink) {
    const waiting = link.requests.filter((request) => request.state === 'waiting')
    if (waiting.length === 0) return
    await serial(() =>
      updateLink(link.secret, (other) => ({
        ...other,
        requests: other.requests.map((r) =>
          r.state === 'waiting' ? { ...r, state: 'closed' as const } : r,
        ),
      })),
    )
    for (const request of waiting)
      await answer(request, inviteAnswerBody({ answer: 'closed' }), false)
  }

  /** Puts a closed card for a link, under the lock: it says so to whoever opens it next. */
  const closeLink = (secret: string) =>
    serial(async () => {
      const link = linkOf(secret)
      if (link === undefined || !link.open) return undefined
      await updateLink(secret, (other) => ({ ...other, open: false }))
      const cards = await putCard(link, false, link.drop, link.cards)
      await updateLink(secret, (other) => ({ ...other, cards }))
      return linkOf(secret)
    })

  /** After Add: befriends them and sends the answer. Picked up again if Pigeon closed between. */
  async function finishAdding(secret: string, identity: PeerId) {
    const request = linkOf(secret)?.requests.find((other) => other.identity === identity)
    if (request?.state !== 'adding' || request.pairSecret === undefined) return
    await deps.befriend({
      id: identity,
      handle: request.name,
      secret: request.pairSecret,
      deviceLog: request.deviceLog,
      keys: request.keys,
      lighthouses: request.lighthouses,
    })
    // Every device that has asked by now, one that asked during the add included.
    const latest = linkOf(secret)?.requests.find((other) => other.identity === identity) ?? request
    await answer(
      latest,
      inviteAnswerBody({
        answer: 'added',
        secret: request.pairSecret,
        name: deps.name(),
        deviceLog: deps.deviceLog(),
      }),
      true,
    )
    await serial(() =>
      updateLink(secret, (other) => ({
        ...other,
        requests: other.requests.map((r) =>
          r.identity === identity ? { ...r, state: 'added' as const } : r,
        ),
      })),
    )
  }

  /** Takes a request through one of your links. True once it's been looked at for good. */
  async function takeRequest(source: Source, letter: Letter): Promise<boolean> {
    if (!deps.active()) return false
    const link = linkOf(source.secret)
    if (link === undefined) return true
    const sender = letter.sender
    if (sender === deps.self || deps.isBlocked(sender)) return true
    const request = readInviteRequest(sender, letter.body)
    if (request === undefined || request.link !== (await inviteCardTag(crypto, link.secret)))
      return true
    const speaks = await speakerIdentity(
      crypto,
      letter.from,
      { identity: sender, devices: request.deviceLog },
      await deps.knownLog(sender),
    )
    if (speaks !== sender) return true
    const active = deviceState(request.deviceLog).active
    const keys: SealingKey[] = []
    for (const key of request.keys)
      if (active.has(key.device) && (await verifySealingKey(crypto, key))) keys.push(key)
    if (!keys.some((key) => key.device === letter.from)) return true
    const reply: Reply = { reply: request.reply, device: letter.from }
    const view: LinkRequest = {
      identity: sender,
      name: request.name,
      fingerprint: formatFingerprint(await fingerprint(crypto, sender)),
      deviceLog: request.deviceLog,
      keys,
      lighthouses: request.lighthouses
        .filter((address) => address.pass === undefined)
        .slice(0, MAX_ANSWER_LIGHTHOUSES),
      replies: [reply],
      at: letter.at,
      state: 'waiting',
    }
    const addedAnswer = (pairSecret: string) =>
      inviteAnswerBody({
        answer: 'added',
        secret: pairSecret,
        name: deps.name(),
        deviceLog: deps.deviceLog(),
      })
    // What to send once the lock is let go, since this runs inside a fetch and the mailbox does
    // one thing at a time: never waited on.
    const outcome = await serial(
      async (): Promise<{ to: LinkRequest; body: Json; kept: boolean } | undefined> => {
        const current = linkOf(link.secret)
        if (current === undefined) return undefined
        const before = current.requests.find((other) => other.identity === sender)
        const replies = [
          ...(before?.replies ?? []).filter((other) => other.device !== reply.device),
          reply,
        ].slice(-MAX_REPLIES)
        // Added already: this device gets the same answer, whatever the link says now.
        if (before?.state === 'added' || before?.state === 'adding') {
          await updateLink(link.secret, (other) => ({
            ...other,
            requests: other.requests.map((r) => (r.identity === sender ? { ...r, replies } : r)),
          }))
          return before.state === 'added' && before.pairSecret !== undefined
            ? {
                to: { ...before, replies: [reply] },
                body: addedAnswer(before.pairSecret),
                kept: true,
              }
            : undefined
        }
        if (!current.open || current.expires <= now()) {
          if (current.closedAnswers >= MAX_CLOSED_ANSWERS) return undefined
          await updateLink(link.secret, (other) => ({
            ...other,
            closedAnswers: other.closedAnswers + 1,
          }))
          return { to: view, body: inviteAnswerBody({ answer: 'closed' }), kept: false }
        }
        if (before?.state === 'waiting') {
          await updateLink(link.secret, (other) => ({
            ...other,
            requests: other.requests.map((r) => (r.identity === sender ? { ...r, replies } : r)),
          }))
          return undefined
        }
        const waiting = current.requests.filter((other) => other.state === 'waiting').length
        // Full: told so, to ask again later, so a request is never just lost.
        if (waiting >= MAX_WAITING_REQUESTS) {
          if (current.closedAnswers >= MAX_CLOSED_ANSWERS) return undefined
          await updateLink(link.secret, (other) => ({
            ...other,
            closedAnswers: other.closedAnswers + 1,
          }))
          return { to: view, body: inviteAnswerBody({ answer: 'busy' }), kept: false }
        }
        // New, or asking again after a decline: waiting for you.
        await updateLink(link.secret, (other) => ({
          ...other,
          requests: [...other.requests.filter((r) => r.identity !== sender), { ...view, replies }],
        }))
        return undefined
      },
    )
    if (outcome !== undefined)
      void answer(outcome.to, outcome.body, outcome.kept).catch(() => undefined)
    return true
  }

  /** Takes the answer to a request you sent. True once it's been looked at for good. */
  async function takeAnswer(source: Source, letter: Letter): Promise<boolean> {
    const ask = asks().find((other) => other.reply === source.secret)
    if (ask === undefined || letter.sender !== ask.identity) return true
    if (deps.isBlocked(ask.identity)) return true
    const body = readInviteAnswer(letter.sender, letter.body)
    if (body === undefined) return true
    if (body.answer !== 'added') {
      // Only from one of the devices their card named.
      if (!ask.keys.some((key) => key.device === letter.from)) return false
      await serial(() =>
        saveAsks(
          asks().map((other) =>
            other.reply === ask.reply ? { ...other, state: body.answer } : other,
          ),
        ),
      )
      return true
    }
    if (!isPairSecret(body.secret)) return true
    const speaks = await speakerIdentity(
      crypto,
      letter.from,
      { identity: ask.identity, devices: body.deviceLog },
      await deps.knownLog(ask.identity),
    )
    // From a device not on their list as this one knows it: left, to be looked at again.
    if (speaks !== ask.identity) return false
    await deps.befriend({
      id: ask.identity,
      handle: body.name,
      secret: body.secret,
      deviceLog: body.deviceLog,
      keys: ask.keys,
      lighthouses: ask.lighthouses,
    })
    await serial(() => saveAsks(asks().filter((other) => other.reply !== ask.reply)))
    return true
  }

  // Adds Pigeon closed in the middle of: finished once it's running.
  const unfinished = links().flatMap((link) =>
    link.requests
      .filter((request) => request.state === 'adding')
      .map((request) => [link.secret, request.identity] as const),
  )

  const api = {
    links,
    asks,

    /** Finishes adds a closed Pigeon left half done. */
    async resume() {
      if (!deps.active()) return
      for (const [secret, identity] of unfinished)
        await finishAdding(secret, identity).catch(() => undefined)
      // A link whose last place was taken just before Pigeon closed: closed now.
      for (const link of links())
        if (link.open && link.used >= link.uses) await api.cancel(link.secret)
    },

    /** Makes a link for `uses` people, lasting `lifetime`, and leaves its card. */
    async make(options: {
      readonly lifetime: number
      readonly uses: number
    }): Promise<{ ok: true; link: OwnLink } | { ok: false; error: MakeLinkError }> {
      if (!deps.active()) return { ok: false, error: 'removed' }
      if (deps.name() === '') return { ok: false, error: 'no-name' }
      if (cardLighthouses().length === 0) return { ok: false, error: 'no-lighthouse' }
      const at = now()
      const secret = base32Encode(deps.random(16))
      const drop = base32Encode(deps.random(32))
      const lifetime = preset(options.lifetime, INVITE_LINK_LIFETIMES, DEFAULT_INVITE_LINK_LIFETIME)
      const expires = at + lifetime
      const cards = await putCard({ secret, expires }, true, drop)
      if (Object.keys(cards).length === 0) return { ok: false, error: 'not-stored' }
      const link: OwnLink = {
        secret,
        drop,
        cards,
        madeAt: at,
        expires,
        uses: preset(options.uses, INVITE_LINK_USES, DEFAULT_INVITE_LINK_USES),
        used: 0,
        open: true,
        url: linkUrl(secret, await linkFingerprint(crypto, deps.self)),
        requests: [],
        closedAnswers: 0,
      }
      await serial(() => saveLinks([...links(), link]))
      deps.changed()
      return { ok: true, link }
    },

    /** Closes a link: its card says so, and whoever is waiting is told. */
    async cancel(secret: string) {
      const closed = await closeLink(secret)
      if (closed === undefined) return
      deps.changed()
      await answerWaiting(closed)
    },

    /** Adds whoever asked through `secret`'s link, if it still has places and time. */
    async approve(secret: string, identity: PeerId): Promise<boolean> {
      if (!deps.active()) return false
      const started = await serial(async () => {
        const link = linkOf(secret)
        const request = link?.requests.find((other) => other.identity === identity)
        if (link === undefined || request?.state !== 'waiting') return undefined
        if (!link.open || link.expires <= now() || link.used >= link.uses) return undefined
        const used = link.used + 1
        // Kept before anything else, so a tab that closes now finishes it when it opens.
        await updateLink(secret, (other) => ({
          ...other,
          used,
          requests: other.requests.map((r) =>
            r.identity === identity
              ? { ...r, state: 'adding' as const, pairSecret: deps.newSecret() }
              : r,
          ),
        }))
        return { full: used >= link.uses }
      })
      if (started === undefined) return false
      await finishAdding(secret, identity)
      if (started.full) await api.cancel(secret)
      else deps.changed()
      return true
    },

    /** Says no to whoever asked; it uses none of the link's places. */
    async decline(secret: string, identity: PeerId) {
      const request = await serial(async () => {
        const found = linkOf(secret)?.requests.find((other) => other.identity === identity)
        if (found?.state !== 'waiting') return undefined
        await updateLink(secret, (other) => ({
          ...other,
          requests: other.requests.map((r) =>
            r.identity === identity ? { ...r, state: 'declined' as const } : r,
          ),
        }))
        return found
      })
      if (request !== undefined)
        await answer(request, inviteAnswerBody({ answer: 'declined' }), false)
    },

    /** Looks up someone's link: their card, checked, or why there's nothing to ask. */
    async open(text: string): Promise<OpenedLink> {
      const decoded = decodeInviteLink(text)
      if (!decoded.ok) return { ok: false, error: 'malformed' }
      const link = decoded.value
      const where = unique([
        ...deps.official,
        ...(link.lighthouse === undefined ? [] : [link.lighthouse]),
      ])
      const tag = await inviteCardTag(crypto, link.secret)
      const cards: InviteCard[] = []
      for (const lighthouse of where) {
        const client = deps.client(lighthouse)
        const items: { id: string; size: number }[] = []
        for (let cursor = 0, more = true; more && items.length < MAX_CARD_ITEMS; ) {
          const listed = await client.request({ type: 'list', tags: [tag], cursor })
          if (!listed.ok || listed.value.type !== 'listed') break
          items.push(...listed.value.items)
          cursor = listed.value.cursor
          more = listed.value.more
        }
        // Newest first: a card put again, or closed, comes after anything put to hide it.
        const worth = items.filter((item) => item.size <= MAX_CARD_BYTES).reverse()
        for (const item of worth.slice(0, MAX_CARD_GETS)) {
          const got = await client.request({ type: 'get', id: item.id })
          if (!got.ok || got.value.type !== 'blob') continue
          const opened = await openInviteCard(crypto, deps.seal, link, got.value.blob)
          if (!opened.ok) continue
          // Checked again against the log you keep for them, if you know them.
          const known = await deps.knownLog(opened.value.identity)
          const checked =
            known === undefined
              ? opened
              : await openInviteCard(crypto, deps.seal, link, got.value.blob, known)
          if (checked.ok) cards.push(checked.value)
        }
      }
      const card = newestCard(cards)
      if (card === undefined) return { ok: false, error: 'not-found' }
      if (card.identity === deps.self) return { ok: false, error: 'own' }
      if (card.expires <= now()) return { ok: false, error: 'expired' }
      if (!card.open || card.keys.length === 0) return { ok: false, error: 'closed' }
      if (deps.isFriend(card.identity)) return { ok: false, error: 'friend' }
      return {
        ok: true,
        link,
        card,
        fingerprint: formatFingerprint(await fingerprint(crypto, card.identity)),
      }
    },

    /** Asks to be friends through a link you opened. */
    async ask(opened: Extract<OpenedLink, { ok: true }>): Promise<AskResult> {
      if (!deps.active() || deps.name() === '') return 'not-sent'
      const { link, card } = opened
      // The answer comes where you fetch mail, and a pass can't go in a request.
      const mine = deps.lighthouses().filter((address) => address.pass === undefined)
      if (mine.length === 0) return 'no-lighthouse'
      // Asking again through the same link keeps the reply secret, so an answer already on its
      // way still finds this device.
      const reply =
        asks().find((other) => other.secret === link.secret)?.reply ?? base32Encode(deps.random(16))
      const to: Recipient = {
        identity: card.identity,
        secret: link.secret,
        tags: 'invite-ask',
        keys: card.keys,
        lighthouses: card.lighthouses.length > 0 ? card.lighthouses : deps.official,
      }
      const body = inviteRequestBody({
        name: deps.name(),
        deviceLog: deps.deviceLog(),
        keys: await deps.ownKeys(),
        lighthouses: mine.slice(0, MAX_ANSWER_LIGHTHOUSES),
        reply,
        link: await inviteCardTag(crypto, link.secret),
      })
      if (!(await deps.mailbox.send('invite', to, body, { once: true }))) return 'not-sent'
      const sent: SentAsk = {
        secret: link.secret,
        identity: card.identity,
        name: card.name,
        fingerprint: opened.fingerprint,
        keys: card.keys,
        lighthouses: card.lighthouses,
        reply,
        expires: card.expires,
        at: now(),
        state: 'waiting',
      }
      await serial(() =>
        saveAsks([...asks().filter((other) => other.secret !== link.secret), sent]),
      )
      return 'sent'
    },

    /** Forgets a request you sent, answered or not. */
    forgetAsk: (secret: string) =>
      serial(() => saveAsks(asks().filter((other) => other.secret !== secret))),

    /** Whose mail to look for: requests through your links, answers to your requests. */
    sources(): Source[] {
      if (!deps.active()) return []
      const at = now()
      const out: Source[] = []
      for (const link of links())
        if (link.expires + KEEP_AFTER_EXPIRY > at)
          out.push({
            sender: undefined,
            secret: link.secret,
            tags: 'invite-ask',
            kinds: ['invite'],
            maxBytes: MAX_INVITE_REQUEST_BYTES,
            maxItems: MAX_INVITE_REQUESTS_PER_DAY,
          })
      // Until a while after the link ends: an answer put just before it may come late.
      for (const ask of asks())
        if (ask.state === 'waiting' && ask.expires + KEEP_AFTER_EXPIRY > at)
          out.push({
            sender: ask.identity,
            secret: ask.reply,
            tags: 'invite-answer',
            kinds: ['invite-answer'],
            replyTo: () => deps.friendRecipient(ask.identity),
          })
      return out
    },

    /** Something is waiting on the Lighthouses: an open link, or a request sent. */
    waiting(): boolean {
      if (!deps.active()) return false
      const at = now()
      return (
        links().some((link) => link.open && link.expires > at) ||
        asks().some((ask) => ask.state === 'waiting' && ask.expires > at)
      )
    },

    take(source: Source, letter: Letter): Promise<boolean> {
      if (letter.kind === 'invite' && source.tags === 'invite-ask')
        return takeRequest(source, letter)
      if (letter.kind === 'invite-answer' && source.tags === 'invite-answer')
        return takeAnswer(source, letter)
      return Promise.resolve(false)
    },

    /**
     * Your device log, name or Lighthouses changed: each open link's card is put again as you
     * are now, and a link another device made is closed if that device is no longer on the list.
     */
    refresh: () =>
      serial(async () => {
        if (!deps.active()) return
        const at = now()
        for (const link of links()) {
          if (!link.open || link.expires <= at) continue
          const cards = await putCard(link, true, link.drop, link.cards)
          await updateLink(link.secret, (other) => ({ ...other, cards }))
        }
        const active = deviceState(deps.deviceLog()).active
        const gone = others.filter(
          (link) => link.open && link.expires > at && !active.has(link.owner),
        )
        // Closed with a drop of this device's own: the owner's cards stay, but lose to this one.
        // Tried again at the next change if no Lighthouse took it.
        const closed: OtherLink[] = []
        for (const link of gone) {
          const cards = await putCard(link, false, base32Encode(deps.random(32)))
          if (Object.keys(cards).length > 0) closed.push(link)
        }
        if (closed.length > 0) {
          others = others.map((link) => (closed.includes(link) ? { ...link, open: false } : link))
          if (!deps.stopped()) await store.set(KEYS.others, others)
        }
      }),

    /** Your links, for your other devices: what they are, never what takes their cards down. */
    shared(): readonly OtherLink[] {
      return links().map((link) => ({
        secret: link.secret,
        owner: deps.signer.id,
        expires: link.expires,
        uses: link.uses,
        used: link.used,
        open: link.open,
      }))
    },

    /** Links another device of yours said, from the device that made them. */
    async takeShared(from: PeerId, list: readonly OtherLink[]) {
      const at = now()
      const theirs = list.filter((link) => link.owner === from && link.expires > at)
      const kept = others.filter((link) => link.owner !== from && link.expires > at)
      others = [...kept, ...theirs]
      if (!deps.stopped()) await store.set(KEYS.others, others)
    },

    /** Links your other devices made. */
    elsewhere: (): readonly OtherLink[] => others,
  }
  return api
}

export type InviteLinks = Awaited<ReturnType<typeof loadInviteLinks>>
