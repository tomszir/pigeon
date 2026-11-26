// Invite links through Lighthouses: links this device made, with the requests that came through
// them, and requests this device sent through someone else's link, waiting for an answer.
//
// A link's card waits at this device's Lighthouses until the link expires; requests come as
// `mail:invite` under the link's ask tags, and wait here until you add or decline each one; the
// answer goes back as `mail:invite-answer` under the asker's reply secret. Only the device that
// made a link answers through it, and only it can take its cards down: the drop value never
// leaves it. Your other devices hear of your links in the self mailbox, and close those of a
// device taken off your list with a closed card signed on the newer list, which wins.
//
// Anyone holding a link can put blobs under its card tag, enough to bury the card among them. So
// your devices put its cards claimed, with a claim key each link has and your devices share, and
// whoever opens it reads the tag's claimed cards first, which nobody else can add to.
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
  inviteCardClaim,
  inviteCardTag,
  inviteRequestBody,
  isDeviceLog,
  isInviteClaimKey,
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
  mergeDeviceLogs,
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
/**
 * The same for the tag's claimed cards, which only the inviter's devices can put: the card as it
 * is now, the one it replaces until that's dropped, and closed ones from the other devices.
 */
const MAX_CLAIMED_ITEMS = 256
const MAX_CLAIMED_GETS = 16
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
  /**
   * Closed cards this device put for your other devices' links, by link: the drop that takes
   * them down and each Lighthouse's id for the one it holds, so a close tried again puts only
   * where none is up yet.
   */
  closedElsewhere: 'invite-links-closed-elsewhere',
} as const

/** Closed cards this device put for another device's link. */
interface ClosedElsewhere {
  readonly drop: string
  readonly cards: Readonly<Record<string, string>>
  readonly expires: number
}

const isClosedElsewhere = (value: unknown): value is ClosedElsewhere =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ClosedElsewhere).drop === 'string' &&
  typeof (value as ClosedElsewhere).cards === 'object' &&
  (value as ClosedElsewhere).cards !== null &&
  typeof (value as ClosedElsewhere).expires === 'number'

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
  /**
   * 32 random bytes, base32: what its cards are claimed with, shared with your other devices so
   * the closed cards they put count too. Missing on a link made before cards were claimed,
   * until its card is put again.
   */
  readonly claim?: string | undefined
  /** Each Lighthouse's id for the card it holds now. */
  readonly cards: Readonly<Record<string, string>>
  /**
   * Lighthouses the card as it is now didn't reach when last put: each keeps the card it had,
   * if any, and the card is put there again at the next start or mail check.
   */
  readonly behind?: readonly string[] | undefined
  readonly madeAt: number
  readonly expires: number
  readonly uses: number
  readonly used: number
  readonly open: boolean
  readonly url: string
  readonly requests: readonly LinkRequest[]
  /** "Closed" answers sent so far, to requests after it closed. */
  readonly closedAnswers: number
  /**
   * Closed here, but not yet with a closed card up at every Lighthouse that held one of its
   * cards: put again until it is. Kept before the first try, so a tab that closes meanwhile
   * tries again when it opens.
   */
  readonly closing?: boolean | undefined
}

/** A link another of your devices made, as it last said. */
export interface OtherLink {
  readonly secret: string
  readonly owner: PeerId
  readonly expires: number
  readonly uses: number
  readonly used: number
  readonly open: boolean
  /** What its cards are claimed with; missing from a device that doesn't claim them. */
  readonly claim?: string | undefined
  /**
   * Kept only here: "closed" answers this device sent to requests through it, once the device
   * that made it was taken off your list.
   */
  readonly answered?: number | undefined
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
  /**
   * `added` once they added you: kept, and its answers still looked for, until a while after
   * the link expires, in case another of their devices says the one that added you was removed.
   * Not shown.
   */
  readonly state: 'waiting' | 'declined' | 'closed' | 'busy' | 'added'
  /** Their device log, the newest an answer carried, merged with what you knew. */
  readonly log?: DeviceLog | undefined
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

/**
 * Why a link wasn't made. `not-stored`: no official Lighthouse on your list took its card, and
 * they're where whoever opens it looks; `named-not-stored`: the same for the Lighthouse a link
 * names when your list has no official one.
 */
export type MakeLinkError =
  | 'no-lighthouse'
  | 'not-stored'
  | 'named-not-stored'
  | 'no-name'
  | 'removed'
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
  /**
   * A friend's device log, newer than yours perhaps, from an answer to a request: merged into
   * the one kept for them, so a device it took off their list stops counting.
   */
  readonly friendLogHeard: (id: PeerId, log: DeviceLog) => Promise<void>
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
    (l.claim === undefined || isInviteClaimKey(l.claim)) &&
    typeof l.cards === 'object' &&
    l.cards !== null &&
    typeof l.expires === 'number' &&
    typeof l.uses === 'number' &&
    typeof l.used === 'number' &&
    typeof l.open === 'boolean' &&
    typeof l.url === 'string' &&
    typeof l.closedAnswers === 'number' &&
    (l.closing === undefined || typeof l.closing === 'boolean') &&
    (l.behind === undefined ||
      (Array.isArray(l.behind) && l.behind.every((id) => typeof id === 'string'))) &&
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
    typeof l.open === 'boolean' &&
    (l.claim === undefined || isInviteClaimKey(l.claim)) &&
    (l.answered === undefined || Number.isSafeInteger(l.answered))
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
    ['waiting', 'declined', 'closed', 'busy', 'added'].includes(a.state) &&
    (a.log === undefined || (isDeviceLog(a.log) && a.log.identity === a.identity))
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
   * Puts the link's card as things are now, open or closed, at your Lighthouses (only at
   * `targets`, if given), claimed with the link's claim key if it has one, and takes down the cards
   * it replaces with `drop`, which only this device has. Says where each card now is, and which
   * Lighthouses it was meant for but didn't reach: each of those keeps the card it had, if any,
   * until a later put there takes its place.
   */
  async function putCardAt(
    link: { secret: string; expires: number; claim?: string | undefined },
    open: boolean,
    drop: string,
    before: Readonly<Record<string, string>> = {},
    /**
     * `before` are closed cards: each stays where no new card replaced it, even at a Lighthouse
     * no longer yours, or an older open card could win there.
     */
    keepClosed = false,
    /** Where to put it, when not at every one of your Lighthouses. */
    targets?: readonly LighthouseAddress[],
  ): Promise<{ cards: Record<string, string>; missed: string[] }> {
    const where = cardLighthouses()
    const tried = targets ?? where
    const cards: Record<string, string> = {}
    const missed: string[] = []
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
            lighthouses: cardLighthouses(),
            expires: link.expires,
            open,
          })
    const tag = await inviteCardTag(crypto, link.secret)
    for (const lighthouse of tried) {
      if (sealed === undefined || !sealed.ok || hash === undefined || expires <= now()) {
        missed.push(lighthouse.id)
        continue
      }
      const client = deps.client(lighthouse)
      const request = { type: 'put', tag, blob: sealed.value, expires, drops: [hash] } as const
      const claim =
        link.claim === undefined
          ? undefined
          : await inviteCardClaim(crypto, link.claim, lighthouse.id)
      let put = await client.request(claim === undefined ? request : { ...request, claim })
      // Claimed by someone else first, which only a link made before cards were claimed can be:
      // left unclaimed there, as it was.
      if (put.ok && put.value.type === 'error' && put.value.error === 'taken')
        put = await client.request(request)
      if (put.ok && put.value.type === 'stored') cards[lighthouse.id] = put.value.id
      else missed.push(lighthouse.id)
    }
    // The old cards come down once the new ones are up, wherever they were. Where the new one
    // wasn't put, or didn't get there, the old one stays up, to come down once one does: taken
    // down with nothing in its place, that Lighthouse would have no card at all. Elsewhere, where
    // no new card went up, an old one stays known until a Lighthouse says it's gone, so it can be
    // taken down, or replaced, next time: forgotten while still up, it would go on being read.
    const triedIds = new Set(tried.map((address) => address.id))
    const kept = new Set([
      ...missed,
      ...where.filter((address) => !triedIds.has(address.id)).map((address) => address.id),
    ])
    for (const [id, blob] of Object.entries(before)) {
      if (cards[id] === blob) continue
      if (cards[id] === undefined && (kept.has(id) || keepClosed)) {
        cards[id] = blob
        continue
      }
      const lighthouse = [...where, ...deps.official, ...deps.lighthouses()].find(
        (address) => address.id === id,
      )
      const dropped =
        lighthouse === undefined
          ? undefined
          : await deps.client(lighthouse).request({ type: 'drop', id: blob, key: drop })
      const gone =
        dropped?.ok === true &&
        (dropped.value.type === 'dropped' ||
          (dropped.value.type === 'error' && dropped.value.error === 'unknown'))
      if (!gone && cards[id] === undefined) cards[id] = blob
    }
    return { cards, missed }
  }

  /** `putCardAt`, saying only where the card now is. */
  const putCard = async (...args: Parameters<typeof putCardAt>) => (await putCardAt(...args)).cards

  /**
   * Puts an own link's card, as `putCardAt` does, and says where it now is and where it still
   * has to go, so `catchUp` tries those again. Cards held before are closed ones only if the
   * link was closed already.
   */
  async function putOwnCard(link: OwnLink, open: boolean, only?: ReadonlySet<string>) {
    const targets =
      only === undefined ? undefined : cardLighthouses().filter((address) => only.has(address.id))
    const put = await putCardAt(link, open, link.drop, link.cards, !link.open, targets)
    const tried = (id: string) => only === undefined || only.has(id)
    const behind = [...(link.behind ?? []).filter((id) => !tried(id)), ...put.missed]
    return { cards: put.cards, behind: behind.length === 0 ? undefined : behind }
  }

  /** Lighthouses of yours where an own link's card, as it is now, isn't yet. */
  function behindAt(link: OwnLink): Set<string> {
    const behind = new Set(link.behind ?? [])
    return new Set(
      cardLighthouses()
        .map((address) => address.id)
        .filter((id) => link.cards[id] === undefined || behind.has(id)),
    )
  }

  /**
   * "Closed", with your device log: someone who asked through a card a device since taken off
   * your list put learns it's off, and stops taking what it says.
   */
  const closedAnswer = () => inviteAnswerBody({ answer: 'closed', deviceLog: deps.deviceLog() })

  /** Another device's link, whose maker has since been taken off your list. */
  function orphanOf(secret: string): OtherLink | undefined {
    const active = deviceState(deps.deviceLog()).active
    return others.find((link) => link.secret === secret && !active.has(link.owner))
  }

  /** Where whoever opens a new link looks: your official Lighthouses, or the one it names. */
  function readLighthouses(): LighthouseAddress[] {
    const where = cardLighthouses()
    const official = new Set(deps.official.map((address) => address.id))
    const yours = where.filter((address) => official.has(address.id))
    return yours.length > 0 ? yours : where.slice(0, 1)
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
    for (const request of waiting) await answer(request, closedAnswer(), false)
  }

  /**
   * Puts a closed card for a link, under the lock: it says so to whoever opens it next. Each
   * card it had stays known until a closed card has taken its place at that Lighthouse, and the
   * link stays `closing` until every one has; `closing` is kept before anything is put. Undefined
   * when the link is gone or was already closed everywhere.
   */
  const closeLink = (secret: string) =>
    serial(async () => {
      const link = linkOf(secret)
      if (link === undefined || !(link.open || link.closing === true)) return undefined
      await updateLink(secret, (other) => ({ ...other, open: false, closing: true }))
      const { cards, missed } = await putCardAt(link, false, link.drop, link.cards, true)
      // Closed only once every Lighthouse it's put at, and every one that held a card of it,
      // holds the closed card just put: one still holding an old card could show it open.
      const places = new Set([
        ...cardLighthouses().map((address) => address.id),
        ...Object.keys(cards),
      ])
      const closing =
        places.size === 0 ||
        [...places].some((id) => cards[id] === undefined || cards[id] === link.cards[id])
      await updateLink(secret, (other) => ({
        ...other,
        cards,
        behind: missed.length === 0 ? undefined : missed,
        closing: closing ? true : undefined,
      }))
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
    const orphan = link === undefined ? orphanOf(source.secret) : undefined
    if (link === undefined && orphan === undefined) return true
    const sender = letter.sender
    if (sender === deps.self || deps.isBlocked(sender)) return true
    const request = readInviteRequest(sender, letter.body)
    if (request === undefined || request.link !== (await inviteCardTag(crypto, source.secret)))
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
    if (link === undefined) {
      // Through a card its removed maker put, or one from before: told it's closed, with your
      // list as it is now, a few times a link at most.
      const told = await serial(async () => {
        const current = orphanOf(source.secret)
        if (current === undefined || (current.answered ?? 0) >= MAX_CLOSED_ANSWERS) return false
        others = others.map((other) =>
          other.secret === current.secret
            ? { ...other, answered: (other.answered ?? 0) + 1 }
            : other,
        )
        if (!deps.stopped()) await store.set(KEYS.others, others)
        return true
      })
      if (told) void answer(view, closedAnswer(), false).catch(() => undefined)
      return true
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
          return { to: view, body: closedAnswer(), kept: false }
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
    // What you know of their list: the log you keep for them, and what answers said.
    const kept = await deps.knownLog(ask.identity)
    const known =
      kept === undefined || ask.log === undefined
        ? (ask.log ?? kept)
        : await mergeDeviceLogs(crypto, kept, ask.log)
    if (body.answer !== 'added') {
      // Only from one of the devices their card named, or with a list it's on.
      const log = body.answer === 'closed' ? body.deviceLog : undefined
      const merged =
        log === undefined ||
        (await speakerIdentity(
          crypto,
          letter.from,
          { identity: ask.identity, devices: log },
          known,
        )) !== ask.identity
          ? undefined
          : known === undefined
            ? log
            : await mergeDeviceLogs(crypto, known, log)
      if (merged === undefined && !ask.keys.some((key) => key.device === letter.from)) return false
      await serial(() =>
        saveAsks(
          asks().map((other) =>
            other.reply !== ask.reply
              ? other
              : {
                  ...other,
                  // Once added, only what it says of their list counts.
                  state: other.state === 'added' ? 'added' : body.answer,
                  ...(merged === undefined ? {} : { log: merged }),
                },
          ),
        ),
      )
      // Added by a device this says was removed: it stops counting for that friend.
      if (merged !== undefined) await deps.friendLogHeard(ask.identity, merged)
      return true
    }
    // Answered already, or closed by another of their devices: nothing more is taken.
    if (ask.state !== 'waiting') return true
    if (!isPairSecret(body.secret)) return true
    const speaks = await speakerIdentity(
      crypto,
      letter.from,
      { identity: ask.identity, devices: body.deviceLog },
      known,
    )
    // From a device not on their list as this one knows it: left, to be looked at again, unless
    // an answer already said it was taken off.
    if (speaks !== ask.identity) return ask.log !== undefined
    await deps.befriend({
      id: ask.identity,
      handle: body.name,
      secret: body.secret,
      deviceLog: body.deviceLog,
      keys: ask.keys,
      lighthouses: ask.lighthouses,
    })
    await serial(() =>
      saveAsks(
        asks().map((other) =>
          other.reply === ask.reply ? { ...other, state: 'added' as const } : other,
        ),
      ),
    )
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
    /** Requests you sent and haven't been added through. */
    asks: () => asks().filter((ask) => ask.state !== 'added'),

    /** Finishes adds a closed Pigeon left half done. */
    async resume() {
      if (!deps.active()) return
      for (const [secret, identity] of unfinished)
        await finishAdding(secret, identity).catch(() => undefined)
      // A link whose last place was taken just before Pigeon closed: closed now.
      for (const link of links())
        if (link.open && link.used >= link.uses) await api.cancel(link.secret)
      await api.catchUp()
    },

    /**
     * Puts each link's card again where it didn't get to, as it is now: at a Lighthouse that
     * was out of reach or refused it last time. A link still closing is closed again everywhere,
     * as `closeLink` does. A link made before cards were claimed is given a claim key first, and
     * its card put again everywhere with it. Run at each start and mail check.
     */
    async catchUp() {
      if (!deps.active()) return
      let claimed = false
      for (const { secret } of links()) {
        const link = linkOf(secret)
        if (link === undefined || link.expires <= now()) continue
        if (link.closing === true) {
          await closeLink(secret)
          continue
        }
        await serial(async () => {
          const current = linkOf(secret)
          if (current === undefined) return
          if (current.claim === undefined) {
            if (!current.open) return
            const withClaim = { ...current, claim: base32Encode(deps.random(32)) }
            const put = await putOwnCard(withClaim, true)
            await updateLink(secret, (other) => ({ ...other, claim: withClaim.claim, ...put }))
            claimed = true
            return
          }
          const targets = behindAt(current)
          if (targets.size === 0) return
          const put = await putOwnCard(current, current.open, targets)
          await updateLink(secret, (other) => ({ ...other, ...put }))
        })
      }
      if (claimed) deps.changed()
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
      // Claimed before the link is shown to anyone, so nobody holding it can claim it first.
      const claim = base32Encode(deps.random(32))
      const lifetime = preset(options.lifetime, INVITE_LINK_LIFETIMES, DEFAULT_INVITE_LINK_LIFETIME)
      const expires = at + lifetime
      const { cards, missed } = await putCardAt({ secret, expires, claim }, true, drop)
      // Shown only once a Lighthouse that everyone opening it reads holds its card, claimed:
      // where the first put missed, someone holding the link could claim the tag before it's
      // put again, and the card would have nowhere it can't be buried.
      const read = readLighthouses()
      if (!read.some((address) => cards[address.id] !== undefined)) {
        for (const lighthouse of cardLighthouses()) {
          const id = cards[lighthouse.id]
          if (id !== undefined)
            await deps.client(lighthouse).request({ type: 'drop', id, key: drop })
        }
        const official = new Set(deps.official.map((address) => address.id))
        const named = !read.some((address) => official.has(address.id))
        return { ok: false, error: named ? 'named-not-stored' : 'not-stored' }
      }
      const link: OwnLink = {
        secret,
        drop,
        claim,
        cards,
        ...(missed.length === 0 ? {} : { behind: missed }),
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
        const seen = new Set<string>()
        // The claimed cards first, which only the inviter's devices can put. Then everything
        // under the tag, as far as the limits go: a Lighthouse from before claims, a card put
        // before its link was claimed, or a closed one from a device that doesn't claim them.
        for (const [type, maxItems, maxGets] of [
          ['list-claimed', MAX_CLAIMED_ITEMS, MAX_CLAIMED_GETS],
          ['list', MAX_CARD_ITEMS, MAX_CARD_GETS],
        ] as const) {
          const items: { id: string; size: number }[] = []
          for (let cursor = 0, more = true; more && items.length < maxItems; ) {
            const listed = await client.request({ type, tags: [tag], cursor })
            if (!listed.ok || listed.value.type !== 'listed') break
            items.push(...listed.value.items)
            cursor = listed.value.cursor
            more = listed.value.more
          }
          // Newest first: a card put again, or closed, comes after anything put to hide it.
          const worth = items
            .filter((item) => item.size <= MAX_CARD_BYTES && !seen.has(item.id))
            .reverse()
          for (const item of worth.slice(0, maxGets)) {
            seen.add(item.id)
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
      // Links of a device since taken off your list: whoever asks through a card it put is
      // told they're closed, until a while after they end.
      const active = deviceState(deps.deviceLog()).active
      for (const link of others)
        if (!active.has(link.owner) && link.expires + KEEP_AFTER_EXPIRY > at)
          out.push({
            sender: undefined,
            secret: link.secret,
            tags: 'invite-ask',
            kinds: ['invite'],
            maxBytes: MAX_INVITE_REQUEST_BYTES,
            maxItems: MAX_INVITE_REQUESTS_PER_DAY,
          })
      // Until a while after the link ends: an answer put just before it may come late, and
      // after being added, another device of theirs may say the one that added you was removed.
      for (const ask of asks())
        if (
          (ask.state === 'waiting' || ask.state === 'added') &&
          ask.expires + KEEP_AFTER_EXPIRY > at
        )
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
     * With `closedToo`, closed cards that may still be out are put again as well: one put before
     * Pigeon took only low-S signatures may be refused, and the open card before it would win.
     */
    refresh: ({ closedToo = false } = {}) =>
      serial(async () => {
        if (!deps.active()) return
        const at = now()
        for (const link of links()) {
          if (link.expires <= at || !(link.open || closedToo)) continue
          const put = await putOwnCard(link, link.open)
          await updateLink(link.secret, (other) => ({ ...other, ...put }))
        }
        const active = deviceState(deps.deviceLog()).active
        const gone = others.filter(
          (link) => (link.open || closedToo) && link.expires > at && !active.has(link.owner),
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

    /**
     * The links a device taken off your list now may know: every one still open, this device's
     * own and those your other devices said, and this device's own still closing.
     */
    openNow(): readonly string[] {
      const at = now()
      return [
        ...links().filter((link) => (link.open || link.closing === true) && link.expires > at),
        ...others.filter((link) => link.open && link.expires > at),
      ].map((link) => link.secret)
    },

    /**
     * Closes the links `secrets` names, after a device that may know them was taken off your
     * list: this device's own as Cancel closes them, telling whoever is still waiting, and the
     * others with a closed card of this device's own, signed on the newer list, which wins over
     * any card on the list from before. Says which are still to close, because a Lighthouse
     * didn't take the closed card: they're tried again.
     */
    async closeLinks(secrets: readonly string[]): Promise<readonly string[]> {
      if (!deps.active()) return secrets
      const at = now()
      const left: string[] = []
      for (const secret of secrets) {
        const own = linkOf(secret)
        if (own !== undefined) {
          if (own.expires <= at || !(own.open || own.closing === true)) continue
          const wasOpen = own.open
          const closed = await closeLink(secret).catch(() => undefined)
          if (closed === undefined || closed.closing === true) left.push(secret)
          if (closed !== undefined && wasOpen) {
            deps.changed()
            // Not waited on: this can run while a fetch holds the mailbox, which a send waits
            // for, and a removal learned in that fetch waits for this.
            void answerWaiting(closed).catch(() => undefined)
          }
          continue
        }
        const other = others.find((link) => link.secret === secret)
        if (other === undefined || other.expires <= at) continue
        // Closed by a card of this device's own at each of its Lighthouses: the owner's own
        // cards stay, but lose to it. Put only where none of this device's is up yet, so trying
        // again puts nothing twice.
        const done = await serial(async () => {
          const stored = await store.get(KEYS.closedElsewhere)
          const all: Record<string, ClosedElsewhere> = {}
          if (typeof stored === 'object' && stored !== null)
            for (const [key, value] of Object.entries(stored))
              if (isClosedElsewhere(value) && value.expires > at) all[key] = value
          const before = all[secret] ?? {
            drop: base32Encode(deps.random(32)),
            cards: {},
            expires: other.expires,
          }
          const where = cardLighthouses()
          const missing = where.filter((address) => before.cards[address.id] === undefined)
          const put =
            missing.length === 0 ? {} : await putCard(other, false, before.drop, {}, false, missing)
          const cards = { ...before.cards, ...put }
          all[secret] = { ...before, cards }
          if (!deps.stopped()) await store.set(KEYS.closedElsewhere, all)
          if (where.length === 0 || where.some((address) => cards[address.id] === undefined))
            return false
          others = others.map((link) => (link.secret === secret ? { ...link, open: false } : link))
          if (!deps.stopped()) await store.set(KEYS.others, others)
          return true
        })
        if (!done) left.push(secret)
      }
      return left
    },

    /** Your links, for your other devices: what they are, never what takes their cards down. */
    shared(): readonly OtherLink[] {
      return links().map((link) => ({
        secret: link.secret,
        owner: deps.signer.id,
        expires: link.expires,
        uses: link.uses,
        used: link.used,
        open: link.open,
        ...(link.claim === undefined ? {} : { claim: link.claim }),
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
