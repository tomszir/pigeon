// The Messenger's state: who you are, your friends, your chats, and a pair session per friend.
// It reads and writes storage, runs core's protocol over the transport, and exposes Solid state
// the windows draw. Everything it touches comes in through platform interfaces. Friends meet in
// rooms named from their pair secret, renamed each UTC day; friends from before the secret move
// there the next time they meet.
import {
  avatarFor,
  bindSealingKey,
  type ChatLog,
  type ClientError,
  CODE_RANDOM_BYTES,
  type CodeRequest,
  type Crypto,
  canonicalBytes,
  cleanHandle,
  type DeviceLog,
  deviceState,
  emptyLog,
  encodeDeviceLink,
  encodeInstance,
  encodeInviteLink,
  encodePairSecret,
  entryKey,
  err,
  everDevices,
  fingerprint,
  formatCode,
  hostInvite,
  hostLink,
  INSTANCE_BYTES,
  INVITE_LIFETIME_MS,
  type Invite,
  isDeviceLog,
  isLighthouseAddress,
  isOwnCode,
  isPairSecret,
  isPublicLighthouseUrl,
  isTailLog,
  type Json,
  type Letter,
  type LighthouseAddress,
  type LighthouseClient,
  type LighthouseSoftware,
  type LinkRequest,
  type LiveCode,
  type LogEntry,
  lowSDeviceLog,
  MAX_HANDLE_LENGTH,
  MAX_PERSONAL_MESSAGE_LENGTH,
  MAX_WRONG_TRIES,
  type NewFriend,
  newCode,
  type OpenStep,
  openInvite,
  PAIR_SECRET_BYTES,
  type PairEvent,
  type PairPlace,
  type PairRoomSpec,
  type PairSession,
  type Pake,
  type PeerId,
  type ProfileChange,
  pairRoom,
  pairRoomOn,
  pairRoomsAt,
  type Rekey,
  type Result,
  type RoomName,
  readRekey,
  rekeyBody,
  type SealCrypto,
  type Sealer,
  type Signer,
  sealingKeyToKeep,
  selfRoomsAt,
  startPairSession,
  type Transport,
  untilPairDaysChange,
  utcDay,
  verifyDeviceLog,
  verifyRekey,
  verifySealingKey,
} from '@pigeon/core'
import { batch, createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Store } from '../../../platform/storage/storage.ts'
import type { Wake } from '../../../platform/wake/wake.ts'
import { DEVICE_KEYS, loadDevices } from './devices.ts'
import { createFriends, type FriendStore, nameOf } from './friends.ts'
import { createIdentityMoves } from './identity-moves.ts'
import {
  type InviteLinks,
  type LinkFriend,
  loadInviteLinks,
  type OpenedLink,
} from './invite-links.ts'
import { createLetters, type Letters } from './letters.ts'
import { createMailSchedule, MAIL_AFTER_SEND_MS } from './mail-schedule.ts'
import { createMailbox, type Mailbox, type Recipient, type Source } from './mailbox.ts'
import type {
  CodeAsk,
  FriendView,
  LinkingState,
  MessengerEvents,
  Note,
  OpenedInvite,
} from './messenger.ts'
import {
  begin,
  consider,
  fetchSecrets,
  heardFrom,
  heldBefore,
  isReplacing,
  mailSecret,
  needsReplacing,
  priorWinner,
  propose,
  proposerGone,
  roomSecrets,
  type SecretState,
  type Sender,
  settle,
  winner,
} from './rekeys.ts'
import { type LighthousesChange, readSelfNews, selfNewsBody } from './self-mail.ts'
import {
  type FarewellRecord,
  type FriendRecord,
  type HostedInvite,
  isBlockedRecords,
  isChatLog,
  isFriendRecords,
  isHostedInvite,
  isMailBook,
  isMessengerSettings,
  isProfile,
  KEYS,
  type MailBook,
  type MessengerSettings,
  type Profile,
  splitBlockedRecords,
  splitFarewells,
  splitFriendRecords,
} from './stored.ts'
import { createYourData } from './your-data.ts'

/** How long a "typing" lasts without a refresh, and how often the sender refreshes it. */
export const TYPING_EXPIRES_MS = 6000
export const TYPING_REFRESH_MS = 3000

export interface MessengerDeps {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly store: Store
  readonly transport: Transport
  readonly clock: Clock
  /**
   * When the person may have come back or the network returned (a tab shown, a window focused,
   * a connection restored): mail is looked for then rather than at the next check. Without it,
   * only the timers and sending look.
   */
  readonly wake?: Wake | undefined
  readonly random: (length: number) => Uint8Array
  /** The key exchange live codes run: SPAKE2, in the browser. */
  readonly pake: Pake
  /** The page address invite links start with: "https://pigeon.tomszir.com/". */
  readonly inviteBase: string
  /** What to call this device in My Devices when it's linked: "Firefox on Linux". */
  readonly deviceName?: string
  readonly events?: MessengerEvents
  /**
   * This device's sealing key and the sealing it does, for mail sealed to devices. Without it
   * the Messenger says no key and seals nothing, as before Lighthouses.
   */
  readonly seal?: { readonly crypto: SealCrypto; readonly sealer: Sealer } | undefined
  /** The Lighthouses a Pigeon uses until it's told otherwise: the official ones. */
  readonly lighthouses?: readonly LighthouseAddress[] | undefined
  /**
   * A client for a Lighthouse (one each; the Messenger keeps them). Without it, or without
   * `seal`, no mail goes through Lighthouses and goodbyes wait to be said in person.
   */
  readonly lighthouseClient?: ((address: LighthouseAddress) => LighthouseClient) | undefined
}

const DEFAULT_PROFILE: Profile = { handle: '', status: 'online', message: '' }
const DAY_MS = 24 * 60 * 60 * 1000

/** A friend's pair secret as rekeys.ts sees it; none for a friend not yet given one. */
function secretState(record: FriendRecord): SecretState | undefined {
  const { secret, sealed, replacing, prior, renew, begun } = record
  return secret === undefined ? undefined : { secret, sealed, replacing, prior, renew, begun }
}

export const inviteLink = (base: string, code: LiveCode, fingerprint: string): string =>
  `${base}#${encodeInviteLink(code, fingerprint)}`

/** How far ahead of this device's clock another of yours may stamp a name. */
export const PROFILE_CLOCK_SLACK_MS = 24 * 60 * 60 * 1000

/** How long a link code is shown before it lapses. */
export const LINK_LIFETIME_MS = 10 * 60 * 1000

/**
 * The most a new device can be handed: what fits one sealed letter (at most a Lighthouse's
 * 64 KB blob, which base64 makes a third bigger), with room for the add about to be signed.
 */
export const MAX_LINK_BUNDLE_BYTES = 44 * 1024

export async function createMessenger(deps: MessengerDeps) {
  const { crypto, signer, store, clock } = deps
  const events = deps.events ?? {}
  // What acting on a removal keeps, declared before anything waits: a device log can arrive, and
  // be acted on, while the rest of this is still being set up.
  /** The removals already acted on here; read from storage further down. */
  let removalsSeen: Set<PeerId> | undefined
  /** Acting on removals, one run at a time. */
  let acting: Promise<unknown> = Promise.resolve()
  const devices = await loadDevices({ crypto, signer, store, clock })
  /** The identity you are: your first device's key, on every device. */
  const self = devices.self

  const storedSettings = await store.get(KEYS.settings)
  const [settings, setSettings] = createSignal<MessengerSettings>(
    isMessengerSettings(storedSettings) ? storedSettings : { relayOnly: false },
  )
  /** Every room, pair and invite alike, joined the way the settings say. */
  const transport: Transport = {
    join: (name, options = {}) =>
      deps.transport.join(name, settings().relayOnly ? { ...options, relayOnly: true } : options),
  }
  const newSecret = () => encodePairSecret(deps.random(PAIR_SECRET_BYTES))

  // A copied profile: this run's id goes in every hello, and our own key heard
  // from another run means this device is open somewhere else too.
  const instance = encodeInstance(deps.random(INSTANCE_BYTES))
  const [twin, setTwin] = createSignal(false)
  const twinOptions = {
    instance,
    onTwin: () => {
      if (twin()) return
      setTwin(true)
      events.onTwin?.()
    },
  }

  const [checkDevices, setCheckDevices] = createSignal(
    (await store.get(KEYS.checkDevices)) === true,
  )

  const storedProfile = await store.get(KEYS.profile)
  // A name saved before names were checked may hold characters a name may not; they're taken out,
  // and a name with nothing left is asked for again.
  const [profile, setProfileSignal] = createSignal<Profile>(
    isProfile(storedProfile)
      ? { ...storedProfile, handle: cleanHandle(storedProfile.handle) }
      : DEFAULT_PROFILE,
  )
  const storedChangedAt = await store.get(KEYS.profileChangedAt)
  let profileChangedAt =
    typeof storedChangedAt === 'number' && Number.isSafeInteger(storedChangedAt)
      ? storedChangedAt
      : 0
  /** Your name and personal message for your other devices, once either has been changed. */
  const profileChange = () =>
    profileChangedAt === 0 || profile().handle === ''
      ? undefined
      : { handle: profile().handle, message: profile().message, changedAt: profileChangedAt }
  const selfFingerprint = await fingerprint(crypto, self)

  // Mail sealed to devices: this device's sealing key, signed by it, and where to leave mail
  // for this Pigeon, both said in every hello; and what friends' devices said of theirs.
  const ownSealing =
    deps.seal === undefined ? undefined : await bindSealingKey(signer, deps.seal.sealer)
  const storedLighthouses = await store.get(KEYS.lighthouses)
  const [lighthouses, setLighthousesSignal] = createSignal<readonly LighthouseAddress[]>(
    Array.isArray(storedLighthouses) && storedLighthouses.every(isLighthouseAddress)
      ? storedLighthouses
      : (deps.lighthouses ?? []),
  )
  const storedLighthousesAt = await store.get(KEYS.lighthousesChangedAt)
  let lighthousesChangedAt =
    typeof storedLighthousesAt === 'number' && Number.isSafeInteger(storedLighthousesAt)
      ? storedLighthousesAt
      : 0
  // A list changed before your devices shared theirs has no time: it counts as changed now, and
  // is said to your other devices once this Pigeon is running, so it isn't lost to theirs.
  const unsharedLighthouses =
    lighthousesChangedAt === 0 &&
    Array.isArray(storedLighthouses) &&
    storedLighthouses.every(isLighthouseAddress)
  if (unsharedLighthouses) {
    lighthousesChangedAt = clock.now()
    await store.set(KEYS.lighthousesChangedAt, lighthousesChangedAt)
  }
  /** Your Lighthouse list for your other devices, once it's been changed from the default. */
  const lighthousesChange = (): LighthousesChange | undefined =>
    lighthousesChangedAt === 0 || lighthouses().length === 0
      ? undefined
      : { list: lighthouses(), changedAt: lighthousesChangedAt }
  const mailOptions = { sealing: () => ownSealing, lighthouses }
  const mailBooks = new Map<PeerId, MailBook>()
  async function mailBook(id: PeerId): Promise<MailBook> {
    const known = mailBooks.get(id)
    if (known !== undefined) return known
    const stored = await store.get(KEYS.mailBook(id))
    const book = isMailBook(stored) ? stored : { keys: {}, lighthouses: [] }
    mailBooks.set(id, book)
    return book
  }
  /**
   * A device of `id`'s said its sealing key or Lighthouses: the newest is kept. True when the
   * sealing key is one this device didn't have.
   */
  let keysQueue: Promise<unknown> = Promise.resolve()
  function heardKeys(id: PeerId, event: Extract<PairEvent, { type: 'keys' }>): Promise<boolean> {
    // One at a time, so two heard together (in the self room and by mail) both stick.
    const next = keysQueue.then(() => keepKeys(id, event))
    keysQueue = next.catch(() => undefined)
    return next
  }
  async function keepKeys(
    id: PeerId,
    event: Extract<PairEvent, { type: 'keys' }>,
  ): Promise<boolean> {
    const book = await mailBook(id)
    const keys =
      event.sealing === undefined
        ? book.keys
        : { ...book.keys, [event.device]: sealingKeyToKeep(book.keys[event.device], event.sealing) }
    const next: MailBook = { keys, lighthouses: event.lighthouses ?? book.lighthouses }
    if (JSON.stringify(next) === JSON.stringify(book)) return false
    mailBooks.set(id, next)
    await store.set(KEYS.mailBook(id), next)
    return JSON.stringify(keys[event.device]) !== JSON.stringify(book.keys[event.device])
  }

  /**
   * Whether this Pigeon may connect to a Lighthouse, whoever named it. Connecting shows it your
   * IP address, and points your browser at its host. One you chose is always fine: on your list,
   * on the list your other devices said, or an official one. Anyone else's is reached only at a
   * public wss:// address, never a private, loopback or link-local one on your own network, and
   * not at all while relay-only is on, since its operator would see the IP the relay hides.
   */
  function mayReach(address: LighthouseAddress): boolean {
    const chosen = [
      ...lighthouses(),
      ...(deps.lighthouses ?? []),
      ...(mailBooks.get(self)?.lighthouses ?? []),
    ]
    // Only the same URL: another path on the same host can be someone else's service behind it.
    if (chosen.some((other) => other.url === address.url)) return true
    return !settings().relayOnly && isPublicLighthouseUrl(address.url)
  }

  // Mail through Lighthouses, when this Pigeon can seal and reach them.
  const lighthouseClients = new Map<string, LighthouseClient>()
  /** The address each client is for, so the ones relay-only refuses can be closed. */
  const clientAddresses = new Map<string, LighthouseAddress>()
  /** The same clients unchecked, for a Lighthouse you're choosing in Network. */
  const chosenClients = new Map<string, LighthouseClient>()
  const makeClient = deps.lighthouseClient
  /**
   * One client per key, URL and pass: an address a friend names never takes over yours. Each
   * call is checked against `mayReach` as it's made, so a Lighthouse that stops being one this
   * Pigeon may reach (relay-only turned on) isn't contacted again; refused, it's unreachable.
   */
  function lighthouseClient(address: LighthouseAddress): LighthouseClient | undefined {
    if (makeClient === undefined) return undefined
    const key = `${address.id} ${address.url} ${address.pass ?? ''}`
    let client = lighthouseClients.get(key)
    if (client === undefined) {
      const inner = makeClient(address)
      chosenClients.set(key, inner)
      clientAddresses.set(key, address)
      client = {
        hello: () => (mayReach(address) ? inner.hello() : Promise.resolve(err('unreachable'))),
        request: (request) =>
          mayReach(address) ? inner.request(request) : Promise.resolve(err('unreachable')),
        close: () => inner.close(),
      }
      lighthouseClients.set(key, client)
    }
    return client
  }
  const mailbox: Mailbox | undefined =
    deps.seal === undefined || makeClient === undefined
      ? undefined
      : createMailbox({
          crypto,
          seal: deps.seal.crypto,
          sealer: deps.seal.sealer,
          signer,
          self,
          store,
          now: clock.now,
          random: deps.random,
          client: (address) => lighthouseClient(address) as LighthouseClient,
          head: () => ({ epoch: devices.epoch(), seq: devices.own().entries.length }),
          stopped: () => closed,
          lighthousesOf: async (id) =>
            friend(id) === undefined
              ? []
              : ((await recipient(id, friendMailSecret(id)))?.lighthouses ?? []),
          onReceipt: (sender, id) => void letters?.receipted(sender, id).catch(() => undefined),
          onStored: (to, id, where) => void letters?.stored(to, id, where).catch(() => undefined),
        })
  /** Messages left at friends' Lighthouses while they're away, once friends are loaded. */
  let letters: Letters | undefined
  /** Invite links through Lighthouses, once friends are loaded. */
  let inviteLinks: InviteLinks | undefined

  /**
   * Who `id` is to mail: their pair secret, the sealing keys of their devices still on their
   * list, and their Lighthouses (the official ones, if they never said) that this Pigeon may
   * reach. Undefined when there's no secret, no key to seal to or no Lighthouse to leave it at.
   */
  async function recipient(id: PeerId, secret: string | undefined): Promise<Recipient | undefined> {
    if (secret === undefined) return undefined
    const book = await mailBook(id)
    const keys = Object.values(book.keys).filter(
      (key) => devices.classify(id, key.device) === 'friend',
    )
    if (keys.length === 0) return undefined
    const named = book.lighthouses.length > 0 ? book.lighthouses : (deps.lighthouses ?? [])
    // None this Pigeon may reach: their mail waits until you meet.
    const lighthouses = named.filter(mayReach)
    if (lighthouses.length === 0) return undefined
    return { identity: id, secret, keys, lighthouses }
  }

  /**
   * A farewell by mail counts only from a device on that friend's list as this device knows
   * it; one from a device it doesn't know yet is left, to be looked at again when it's put
   * again. From someone you've removed too, it's simply heard.
   */
  async function takeLetter(
    source: Source,
    letter: Letter,
    through: LighthouseAddress,
  ): Promise<boolean> {
    if (closed) return false
    if (letter.kind === 'rekey') return takeRekey(letter)
    if (letter.kind === 'letter') {
      if (letters === undefined) return true
      // A copy of a letter another of your devices sent: into the chat with that friend.
      if (letter.sender === self) {
        if (source.sender !== self || !devices.isOwnOther(letter.from)) return false
        const to = (letter.body as { friend?: unknown })?.friend
        if (typeof to !== 'string' || friend(to) === undefined) return true
        return letters.take(to, letter, through, true)
      }
      // Only from a device on their list, and only into a chat with them.
      if (friend(letter.sender) === undefined) return true
      if (devices.classify(letter.sender, letter.from) !== 'friend') return false
      return letters.take(letter.sender, letter, through)
    }
    if (letter.kind === 'self') return source.sender === self && takeSelfNews(letter)
    if (letter.kind === 'invite' || letter.kind === 'invite-answer')
      return inviteLinks?.take(source, letter) ?? Promise.resolve(false)
    if (letter.kind !== 'farewell') return false
    const view = friend(letter.sender)
    if (view === undefined) return true
    if (devices.classify(letter.sender, letter.from) !== 'friend') return false
    if (view.removedYouAt === undefined) handlers.unfriended(letter.sender, { type: 'unfriended' })
    return true
  }

  /**
   * Your own other devices to mail: the self secret (the old one while one is replaced, or
   * `under`), the sealing keys of your devices still on your list (or of `only` those devices),
   * and every Lighthouse on this device's list and the one your other devices last said.
   */
  async function selfRecipient(
    only?: readonly PeerId[],
    under?: string,
  ): Promise<Recipient | undefined> {
    const kept = devices.selfSecretState()
    const secret = under ?? (kept === undefined ? undefined : mailSecret(kept))
    if (secret === undefined) return undefined
    const book = await mailBook(self)
    const keys = Object.values(book.keys).filter(
      (key) =>
        key.device !== signer.id &&
        (only === undefined ? devices.isOwnOther(key.device) : only.includes(key.device)),
    )
    if (keys.length === 0) return undefined
    const all = [...lighthouses(), ...book.lighthouses]
    const where = all.filter((address, i) => all.findIndex((o) => o.id === address.id) === i)
    return { identity: self, secret, keys, lighthouses: where }
  }

  /**
   * Leaves your other devices what changed here: your device log, name and Lighthouse list as
   * they are now, and the sealing keys of your devices, so one that was offline catches up when
   * it opens. Each takes the place of the last one still waiting. `removed`, devices a change
   * made here has just taken off your list, get the device log alone, so they hear and stop.
   * Sent in the background: nothing waits on the Lighthouses.
   */
  function tellOwnDevices(removed: readonly PeerId[] = []) {
    if (mailbox === undefined || closed || devices.status() !== 'active') return
    // Everything as it is now, before anything waits, so two sent close together each say theirs.
    const log = devices.own()
    const profile = profileChange()
    const list = lighthousesChange()
    const invites = inviteLinks?.shared()
    void (async () => {
      const keys = await ownKeys()
      const to = await selfRecipient()
      if (to !== undefined) {
        const news = { log, keys, profile, lighthouses: list, invites }
        await mailbox.send('self', to, selfNewsBody(news), { supersede: true })
      }
      const off = removed.filter((device) => !devices.isOwnOther(device))
      const gone = off.length === 0 ? undefined : await selfRecipient(off)
      if (gone !== undefined) await mailbox.send('self', gone, selfNewsBody({ log, keys: [] }))
    })().catch(() => undefined)
  }

  /**
   * News from another of your devices. The device log in it is signed by whoever wrote it, so
   * it's merged first, whoever brought it: a device linked or removed while this one was away
   * then counts as it should. The rest counts only from a device on that list.
   */
  async function takeSelfNews(letter: Letter): Promise<boolean> {
    const news = readSelfNews(self, letter.body)
    // Nothing that could ever be taken: dropped, so it isn't fetched again.
    if (news === undefined) return true
    await takeOwnLog(news.log)
    if (closed || !devices.isOwnOther(letter.from)) return false
    if (devices.status() !== 'active') return true
    for (const key of news.keys)
      if (
        key.device !== signer.id &&
        devices.isOwnOther(key.device) &&
        (await verifySealingKey(crypto, key))
      )
        await heardKeys(self, { type: 'keys', device: key.device, sealing: key })
    if (news.profile !== undefined) await takeProfile(news.profile)
    if (news.lighthouses !== undefined) await takeLighthouses(news.lighthouses)
    if (news.invites !== undefined) await inviteLinks?.takeShared(letter.from, news.invites)
    return true
  }

  /**
   * Before any letter is taken: the device logs in your devices' news and in proposals for a
   * new secret, merged, so a removal counts for every letter fetched with it, whichever came
   * first.
   */
  async function lookAt(letters: readonly { source: Source; letter: Letter }[]) {
    for (const { source, letter } of letters) {
      if (closed) return
      // And the logs that ride with proposals for a new secret, so a removal in one counts for
      // a proposal from that device in another.
      if (letter.kind === 'rekey') await takeRekeyLogs(readRekey(letter.body)?.logs)
      if (source.sender !== self || letter.kind !== 'self') continue
      const news = readSelfNews(self, letter.body)
      if (news !== undefined) await takeOwnLog(news.log)
    }
  }

  /** Keeps a Lighthouse list and says it to everyone; `changedAt` when it was changed. */
  async function saveLighthouses(next: readonly LighthouseAddress[], changedAt: number) {
    const unique = next.filter(
      (address, i) => next.findIndex((other) => other.id === address.id) === i,
    )
    lighthousesChangedAt = changedAt
    setLighthousesSignal(unique)
    await store.set(KEYS.lighthouses, unique)
    await store.set(KEYS.lighthousesChangedAt, changedAt)
    for (const session of sessions.values()) session.announce()
    selfSession?.announce()
    // Each open link's card names where requests go now.
    void inviteLinks?.refresh().catch(() => undefined)
  }

  /** Your Lighthouse list from another of your devices: the newest change wins. */
  async function takeLighthouses(change: LighthousesChange) {
    if (change.changedAt <= lighthousesChangedAt) return
    // A time far ahead would outrank every later change, even after its device is removed.
    if (change.changedAt > clock.now() + PROFILE_CLOCK_SLACK_MS) return
    await saveLighthouses(change.list, change.changedAt)
  }

  /** Looks for mail at this Pigeon's Lighthouses, puts again what waits, and acts on what came. */
  async function lookForMail(): Promise<void> {
    if (mailbox === undefined) return
    await settleSecrets()
    const sources: Source[] = []
    // Your own other devices, under the self secret (and one being replaced): what they
    // changed, and their receipts.
    const selfState = devices.selfSecretState()
    if (selfState !== undefined && devices.status() === 'active')
      for (const secret of fetchSecrets(selfState))
        sources.push({
          sender: self,
          secret,
          kinds: ['self', 'receipt', 'letter', 'rekey'],
          replyTo: () => selfRecipient(),
        })
    for (const view of friendList()) {
      const kept = secretState(view)
      if (kept === undefined || view.removedYouAt !== undefined) continue
      const replyTo = await recipient(view.id, mailSecret(kept))
      for (const secret of fetchSecrets(kept))
        sources.push({
          sender: view.id,
          secret,
          kinds: ['farewell', 'receipt', 'letter', 'rekey'],
          replyTo,
        })
    }
    // Friends you removed: their receipts for your farewell come under the same secret, and
    // so does a farewell of theirs if they removed you too.
    const asked = new Set(sources.map((source) => source.sender))
    for (const waiting of await mailbox.waitingOn())
      if (!asked.has(waiting.identity)) {
        const record = farewells().find((other) => other.id === waiting.identity)
        // Under the new secret too, when they may have moved to it before hearing.
        const secrets = new Set([waiting.secret, record?.secret, record?.old])
        for (const secret of secrets)
          if (secret !== undefined)
            sources.push({
              sender: waiting.identity,
              secret,
              kinds: ['receipt', 'farewell'],
              replyTo: waiting,
            })
      }
    await mailbox.resend()
    // Invite cards that didn't reach a Lighthouse last time are put there again, as mail is.
    await inviteLinks?.catchUp().catch(() => undefined)
    const all = [...sources, ...(inviteLinks?.sources() ?? [])]
    const heard = await mailbox.fetch(lighthouses(), all, takeLetter, lookAt)
    // Old secrets with no replacement under way yet, now that any proposal waiting for this
    // device has been taken.
    await replaceOldSecrets()
    // What waits to be mailed to friends who are away: written before a close, or held back.
    for (const view of friendList()) void letters?.resume(view.id).catch(() => undefined)
    // A farewell every device of theirs has a receipt for was heard: nothing more to say.
    // One that only expired wasn't, and goes on being said in person.
    for (const id of heard)
      if (farewells().some((record) => record.id === id && record.mailed === true))
        await farewellHeard(id)
  }

  const mailSchedule = createMailSchedule({
    clock,
    wake: deps.wake,
    enabled: mailbox !== undefined,
    closed: () => closed,
    look: lookForMail,
    inviteWaiting: () => inviteLinks?.waiting() === true,
  })
  const { checkMail, lookSoon, gapLeft, lookedAt, lookState, stopWaking } = mailSchedule

  const [state, setState] = createStore<FriendStore>({
    friends: {},
  })
  const sessions = new Map<PeerId, PairSession>()
  const typingGeneration = new Map<PeerId, number>()
  const lastTypingSent = new Map<PeerId, number>()

  const friendList = (): readonly FriendView[] =>
    Object.values(state.friends).sort((a, b) => a.addedAt - b.addedAt)
  const friend = (id: PeerId): FriendView | undefined => state.friends[id]
  /** The mail secret for a friend: the old one while they may not have the new. */
  function friendMailSecret(id: PeerId): string | undefined {
    const view = friend(id)
    const kept = view === undefined ? undefined : secretState(view)
    return kept === undefined ? undefined : mailSecret(kept)
  }

  /**
   * Keeps records that couldn't be read exactly as stored under `key`, never written over. Done
   * before anything saves the records that did load, which would drop these from their own list.
   * A record already set aside by an earlier run isn't kept twice. Returns how many are set aside.
   */
  const setAside = async (key: string, unreadable: readonly unknown[]) => {
    const earlier = await store.get(key)
    const aside = Array.isArray(earlier) ? earlier : []
    const seen = new Set(aside.map((record) => JSON.stringify(record)))
    const added = unreadable.filter((record) => !seen.has(JSON.stringify(record)))
    if (added.length > 0) await store.set(key, [...aside, ...added] as Json)
    return aside.length + added.length
  }
  const storedBlocked = splitBlockedRecords(await store.get(KEYS.blocked))
  const blockedAside = await setAside(KEYS.unreadableBlocked, storedBlocked.unreadable)
  const storedFarewells = splitFarewells(await store.get(KEYS.farewells))
  const farewellsAside = await setAside(KEYS.unreadableFarewells, storedFarewells.unreadable)
  // A farewell stored before pair secrets was just an id.
  const {
    saveFriends,
    blocked,
    isBlocked,
    block,
    unblock,
    farewells,
    keepFarewell,
    dropFarewell,
    onlineCount,
    isFriend,
    rename,
    mute,
    muted,
  } = createFriends({
    store,
    clock,
    friends: friendList,
    friend,
    setState,
    initialBlocked: storedBlocked.readable,
    initialFarewells: storedFarewells.readable.map((entry) =>
      typeof entry === 'string' ? { id: entry } : entry,
    ),
  })
  const farewellSessions = new Map<PeerId, PairSession>()
  /**
   * Set once `close` runs. Declared before anything that reads it can run: a farewell still owed
   * from the last visit is said while the Messenger starts.
   */
  let closed = false
  /** Writes begun and not finished; see `inFlight`. */
  const writes = new Set<Promise<unknown>>()
  const keepUntilWritten = (write: Promise<unknown>) => {
    const settled = write.then(
      () => undefined,
      (error: unknown) => console.error(error),
    )
    writes.add(settled)
    void settled.then(() => writes.delete(settled))
  }
  // Leaving this Pigeon waits for its farewells to be said.
  let farewellsSaid: (() => void)[] = []
  /** Told each time a farewell is said, while leaving shows how many have heard. */
  let onFarewellSaid: (() => void) | undefined
  const saidFarewells = () => {
    onFarewellSaid?.()
    if (farewells().length > 0) return
    for (const resolve of farewellsSaid) resolve()
    farewellsSaid = []
  }

  // Where each friend is met: the old room from both ids until you've moved,
  // the secret's rooms once you have one. The old room's name is also the chat's id.
  const legacyRoom = (id: PeerId) => pairRoom(crypto, self, id)
  const places = new Map<PairSession, () => Promise<readonly PairRoomSpec[]>>()
  const syncing = new Map<PairSession, Promise<void>>()
  /** Joins the rooms `session` should be in now and leaves the rest, one change at a time. */
  function syncRooms(session: PairSession): Promise<void> {
    const place = places.get(session)
    if (place === undefined) return Promise.resolve()
    const next = (syncing.get(session) ?? Promise.resolve()).then(async () => {
      const wanted = await place()
      const have = session.rooms()
      // New rooms first, so a friend moving between them is never dropped.
      for (const spec of wanted)
        if (!have.includes(spec.name))
          session.addRoom(
            await transport.join(
              spec.name,
              spec.password === undefined ? {} : { password: spec.password },
            ),
          )
      const names = new Set<RoomName>(wanted.map((spec) => spec.name))
      for (const name of have) if (!names.has(name)) await session.removeRoom(name)
    })
    syncing.set(
      session,
      next.catch(() => undefined),
    )
    return next
  }
  const forget = (session: PairSession) => {
    places.delete(session)
    syncing.delete(session)
  }

  const handlers: {
    [T in PairEvent['type']]: (id: PeerId, event: Extract<PairEvent, { type: T }>) => void
  } = {
    online: (id, event) => {
      const current = state.friends[id]
      const changed = current?.handle !== event.handle
      setState('friends', id, {
        online: true,
        handle: event.handle,
        name: nameOf(event.handle, current?.petname),
        seesThisDevice: event.current || signer.id === self,
      })
      note(id, 'online')
      if (changed) void saveFriends()
      const view = friend(id)
      if (view !== undefined) events.onOnline?.(view)
    },
    keys: (id, event) => void heardKeys(id, event).catch(() => undefined),
    renamed: (id, event) => {
      const current = state.friends[id]
      if (current === undefined || current.handle === event.handle) return
      setState('friends', id, { handle: event.handle, name: nameOf(event.handle, current.petname) })
      void saveFriends()
    },
    // Their device said what it has, and the session answers with the rest: it has it all.
    has: (id, event) => letters?.synced(id, event.have),
    offline: (id) => {
      void Promise.resolve().then(() => letters?.left(id))
      setState('friends', id, { online: false, typing: false })
      note(id, 'offline')
    },
    presence: (id, event) => setState('friends', id, 'presence', event.presence),
    typing: (id, event) => {
      const generation = (typingGeneration.get(id) ?? 0) + 1
      typingGeneration.set(id, generation)
      setState('friends', id, 'typing', event.active)
      if (event.active)
        void clock.sleep(TYPING_EXPIRES_MS).then(() => {
          if (typingGeneration.get(id) === generation) setState('friends', id, 'typing', false)
        })
    },
    buzz: (id) => {
      note(id, 'buzz-in')
      const view = friend(id)
      if (view !== undefined) events.onBuzz?.(view)
    },
    unfriended: (id) => {
      setState('friends', id, { removedYouAt: clock.now(), online: false, typing: false })
      void saveFriends()
      const session = sessions.get(id)
      sessions.delete(id)
      void session?.close()
      const view = friend(id)
      if (view !== undefined) events.onUnfriended?.(view)
    },
    met: (id, event) => {
      const view = state.friends[id]
      const session = sessions.get(id)
      if (view === undefined || session === undefined || view.moved === true) return
      if (event.room !== view.log.id) {
        // They're in a room only the secret opens, so they hold it too.
        if (view.secret !== undefined) void moveTo(id, view.secret)
        return
      }
      // In the old room, the lower id gives the secret.
      if (self > id) return
      const secret = view.secret ?? newSecret()
      void (async () => {
        if (view.secret === undefined) {
          setState('friends', id, 'secret', secret)
          await saveFriends()
          await syncRooms(session)
        }
        await session.sendSecret(secret)
      })()
    },
    // The session hears these only in the old room. The secret counts only from the lower id,
    // the side that gives it, and only while you haven't moved: once you have, or once the
    // secret was sealed or is being replaced, a new one comes only by a signed replacement.
    // A secret held but never moved to (made when you paired, which the friend's Pigeon then
    // didn't keep) gives way to theirs, which is the one you both end up meeting under.
    secret: (id, event) => {
      const view = state.friends[id]
      const session = sessions.get(id)
      if (view === undefined || session === undefined || id > self) return
      if (view.moved === true || view.sealed === true || view.replacing !== undefined) return
      // Taken at once, so a second secret from another of their devices finds you moved, and
      // kept before it's confirmed: a friend told it arrived moves, so a Pigeon closed in between
      // must not wake up without it. A confirmation that never arrives is made up for in `met`:
      // the friend waits in the secret's rooms too, and moves on meeting you there.
      setState('friends', id, { secret: event.secret, moved: true })
      void (async () => {
        await saveFriends()
        await session.confirmSecret()
        await syncRooms(session)
      })()
    },
    // Only the lower id gives the secret, so only it hears that it arrived.
    'secret-ok': (id) => {
      const view = state.friends[id]
      if (view?.secret !== undefined && view.moved !== true && self < id)
        void moveTo(id, view.secret)
    },
    seen: (id, event) => void heardIn(id, event.room, event.device).catch(() => undefined),
    log: (id, event) => {
      const before = state.friends[id]?.log.entries ?? []
      const seen = new Set(before.map(entryKey))
      // Theirs, from whichever of their devices: anything not by one of yours.
      const arrived = event.log.entries.filter(
        (entry) => !devices.isMine(entry.author) && !seen.has(entryKey(entry)),
      )
      batch(() => {
        setState('friends', id, 'log', event.log)
        if (arrived.length > 0)
          setState(
            'friends',
            id,
            produce((view) => {
              view.unread += arrived.length
              view.typing = false
            }),
          )
      })
      keepUntilWritten(store.set(KEYS.log(id), event.log))
      const view = friend(id)
      if (view !== undefined) for (const entry of arrived) events.onMessage?.(view, entry)
    },
  }

  /** Both of you hold `secret`: meet only in its rooms from now on. */
  async function moveTo(id: PeerId, secret: string) {
    const view = state.friends[id]
    if (view === undefined) return
    if (view.secret !== secret || view.moved !== true) {
      setState('friends', id, { secret, moved: true })
      await saveFriends()
    }
    const session = sessions.get(id)
    if (session !== undefined) await syncRooms(session)
  }

  // Secrets from before this Pigeon sealed every secret it handed over are replaced: a new one
  // goes sealed to the devices that hold the old, as `mail:rekey`, and both sides move to its
  // rooms. The decisions are in rekeys.ts. One at a time, so two letters about the same secret
  // never both read it before either writes it. Nothing in here waits on a send: a letter is
  // taken while the mailbox is still fetching, and a send waits for the fetch.
  let rekeying: Promise<unknown> = Promise.resolve()
  function oneRekey<T>(run: () => Promise<T>): Promise<T> {
    const next = rekeying.then(run, run)
    rekeying = next.catch(() => undefined)
    return next
  }

  /** A send in the background, as all rekey mail is. */
  function mailRekey(to: Recipient | undefined, body: Json) {
    if (mailbox === undefined || to === undefined) return
    void mailbox.send('rekey', to, body).catch(() => undefined)
  }

  /** A proposing device still on its side's list, as this device knows the lists. */
  const countsFor = (id: PeerId) => (device: PeerId) =>
    device === signer.id || devices.classify(id, device) !== undefined
  const countsForSelf = (device: PeerId) => device === signer.id || devices.isOwnOther(device)

  /** The other side's devices on their list now: the friend's, or your own other devices. */
  const theirDevices = (id: PeerId): readonly PeerId[] =>
    id === self
      ? devices
          .devices()
          .filter((device) => !device.here)
          .map((device) => device.id)
      : [...deviceState(devices.friendLog(id)).active.keys()]

  /**
   * Device logs that came with a proposal, merged first, so a proposal from a device its side has
   * since removed is seen not to count, whichever letter came first.
   */
  async function takeRekeyLogs(logs: readonly DeviceLog[] | undefined) {
    for (const log of logs ?? []) {
      if (closed) return
      if (log.identity === self) await takeOwnLog(log)
      else if (friend(log.identity) !== undefined) {
        // Merged with the one kept, never in its place: a friend whose chat hasn't started yet
        // has none loaded.
        await devices.loadFriend(log.identity)
        if (await devices.takeFriend(log.identity, log))
          setState('friends', log.identity, 'devices', devices.friendDeviceCount(log.identity))
      }
    }
  }

  async function keepFriendSecret(id: PeerId, next: SecretState) {
    if (state.friends[id] === undefined) return
    setState('friends', id, {
      secret: next.secret,
      moved: true,
      sealed: next.sealed,
      replacing: next.replacing,
      prior: next.replacing === undefined ? undefined : next.prior,
      renew: next.renew === true ? true : undefined,
      begun: next.begun,
    })
    await saveFriends()
    const session = sessions.get(id)
    if (session !== undefined) await syncRooms(session)
  }

  /**
   * The tags a winner goes under: the old secret's, the round before's, where a device still in
   * that round looks, and `more` (the replacement this one beat, where a device that settled on
   * it looks, or the secret of a device that's behind).
   */
  function winnerTags(kept: SecretState, more: readonly (string | undefined)[]): string[] {
    const all = [kept.replacing?.old, kept.prior?.old, ...more]
    return [...new Set(all.filter((secret): secret is string => secret !== undefined))]
  }

  /**
   * Sends the winning proposal for a friend's secret, with the round before's winner when a
   * removal began it, to the friend's devices under `winnerTags`, and to your own other devices;
   * or only to `side`.
   */
  async function tellFriendWinner(
    id: PeerId,
    side?: 'friend' | 'own',
    more: readonly (string | undefined)[] = [],
  ) {
    const view = friend(id)
    const kept = view === undefined ? undefined : secretState(view)
    const rekey = kept === undefined ? undefined : await winner(crypto, kept)
    if (kept?.replacing === undefined || rekey === undefined) return
    const prior = await priorWinner(crypto, kept)
    const logs = [devices.own(), devices.friendLog(id)]
    if (side !== 'own')
      for (const under of winnerTags(kept, more))
        mailRekey(await recipient(id, under), rekeyBody(rekey, { logs, prior }))
    if (side !== 'friend')
      mailRekey(await selfRecipient(), rekeyBody(rekey, { friend: id, logs, prior }))
  }

  /**
   * Sends the winning proposal for the self secret, with the round before's winner when a
   * removal began it, to your other devices under `winnerTags`.
   */
  async function tellSelfWinner(more: readonly (string | undefined)[] = []) {
    const kept = devices.selfSecretState()
    const rekey = kept === undefined ? undefined : await winner(crypto, kept)
    if (kept?.replacing === undefined || rekey === undefined) return
    const prior = await priorWinner(crypto, kept)
    for (const under of winnerTags(kept, more))
      mailRekey(
        await selfRecipient(undefined, under),
        rekeyBody(rekey, { logs: [devices.own()], prior }),
      )
  }

  /**
   * A proposal for a friend's secret, from them or, as a copy, from your own other device, with
   * `prior`, the winner of the round it began from, when it came with one.
   */
  function takeFriendRekey(id: PeerId, rekey: Rekey, sender: Sender, prior?: Rekey) {
    return oneRekey(async () => {
      const view = friend(id)
      const kept = view === undefined ? undefined : secretState(view)
      if (kept === undefined || view?.removedYouAt !== undefined) return
      const step = await consider(crypto, kept, rekey, sender, clock.now(), countsFor(id), prior)
      if (step.next !== undefined) await keepFriendSecret(id, step.next)
      if (step.changed) await tellFriendWinner(id, undefined, [heldBefore(kept), kept.secret])
      else if (step.answer)
        await tellFriendWinner(id, sender.other ? 'friend' : 'own', step.under ?? [])
    })
  }

  /** A proposal for the self secret, from another of your devices. */
  function takeSelfRekey(rekey: Rekey, device: PeerId, prior?: Rekey) {
    return oneRekey(async () => {
      const kept = devices.selfSecretState()
      if (kept === undefined || devices.status() !== 'active') return
      const sender = { other: true, device }
      const step = await consider(crypto, kept, rekey, sender, clock.now(), countsForSelf, prior)
      if (step.next !== undefined) {
        await devices.setSelfSecretState(step.next)
        // A self secret from before may have been seen while a device was linked; one replaced
        // after a removal was sealed, and the list already says who's yours.
        if (step.changed && kept.sealed !== true) await askToCheckDevices()
        if (selfSession !== undefined) await syncRooms(selfSession)
      }
      if (step.changed) await tellSelfWinner([heldBefore(kept), kept.secret])
      else if (step.answer) await tellSelfWinner(step.under ?? [])
    })
  }

  /** A `mail:rekey` letter: counted once it's been looked at, whatever it said. */
  async function takeRekey(letter: Letter): Promise<boolean> {
    const read = readRekey(letter.body)
    // Nothing that could ever be taken: dropped, so it isn't fetched again. A proposal counts
    // only with its maker's signature, whoever passes it on, so no device can name another as
    // its maker.
    if (read === undefined || !(await verifyRekey(crypto, read.rekey))) return true
    await takeRekeyLogs(read.logs)
    if (closed) return false
    if (letter.sender === self) {
      if (!devices.isOwnOther(letter.from)) return false
      if (read.friend === undefined) await takeSelfRekey(read.rekey, letter.from, read.prior)
      else if (friend(read.friend) !== undefined)
        await takeFriendRekey(
          read.friend,
          read.rekey,
          { other: false, device: letter.from },
          read.prior,
        )
      return true
    }
    if (read.friend !== undefined || friend(letter.sender) === undefined) return true
    if (devices.classify(letter.sender, letter.from) !== 'friend') return false
    await takeFriendRekey(
      letter.sender,
      read.rekey,
      { other: true, device: letter.from },
      read.prior,
    )
    return true
  }

  /** The rooms a secret is met in around `now`, the days either side included. */
  async function roomsAround(secret: string, kind: 'pair' | 'self'): Promise<Set<RoomName>> {
    const now = clock.now()
    const days = [now - DAY_MS, now, now + DAY_MS]
    if (kind === 'self') {
      const specs = await Promise.all(days.map((at) => selfRoomsAt(crypto, secret, at)))
      return new Set(specs.flat().map((spec) => spec.name))
    }
    return new Set(await Promise.all(days.map((at) => pairRoomOn(crypto, secret, utcDay(at)))))
  }

  /** Sends of a winner again under way, by `${whose} ${device} ${winner's signature}`. */
  const resending = new Set<string>()
  const resendKey = (whose: PeerId, kept: SecretState, device: PeerId) =>
    `${whose} ${device} ${kept.replacing?.sig ?? ''}`

  /** Whether `device`, met in the old rooms, is still to be sent `whose` winner again. */
  const needsResending = (whose: PeerId, kept: SecretState, device: PeerId) =>
    kept.replacing !== undefined &&
    kept.replacing.heardAt === undefined &&
    kept.replacing.resent?.includes(device) !== true &&
    !resending.has(resendKey(whose, kept, device))

  /** A friend's pair secret as rekeys.ts sees it, as it is now. */
  const secretStateOf = (id: PeerId) => {
    const view = friend(id)
    return view === undefined ? undefined : secretState(view)
  }

  /**
   * Sends the winner, with the round before's, to `device` alone, `whose` friend's or one of your
   * own, under the tags it may be on, in the background: nothing waits on a send while a letter is
   * taken. The device is marked as sent to only once a Lighthouse took it, so a send that failed
   * is tried again the next time it's met.
   */
  function resendWinner(whose: PeerId, kept: SecretState, device: PeerId) {
    const key = resendKey(whose, kept, device)
    if (mailbox === undefined || resending.has(key)) return
    resending.add(key)
    const box = mailbox
    void (async () => {
      const rekey = await winner(crypto, kept)
      if (rekey === undefined) return
      const prior = await priorWinner(crypto, kept)
      let stored = false
      for (const under of winnerTags(kept, [])) {
        const to =
          whose === self
            ? await selfRecipient([device], under)
            : await recipient(whose, under).then((all) =>
                all === undefined
                  ? undefined
                  : { ...all, keys: all.keys.filter((one) => one.device === device) },
              )
        if (to === undefined || to.keys.length === 0) continue
        const logs = whose === self ? [devices.own()] : [devices.own(), devices.friendLog(whose)]
        if (await box.send('rekey', to, rekeyBody(rekey, { logs, prior }))) stored = true
      }
      if (!stored) return
      await oneRekey(async () => {
        const now = whose === self ? devices.selfSecretState() : secretStateOf(whose)
        const round = now?.replacing
        if (now === undefined || round === undefined || round.sig !== kept.replacing?.sig) return
        const resent = [...(round.resent ?? []), device]
        const next = { ...now, replacing: { ...round, resent } }
        if (whose === self) await devices.setSelfSecretState(next)
        else await keepFriendSecret(whose, next)
      })
    })()
      .catch(() => undefined)
      .finally(() => resending.delete(key))
  }

  /**
   * A friend's `device` said hello in `room`: if it's the new secret's, that device holds it; if
   * it's the old one's, while nobody on their side has been seen with the new, the winner may
   * never have reached it, and is sent again, once. A Pigeon that took `mail:rekey` before it
   * knew new rounds reads one, takes nothing and gives a receipt, so the letter is never put
   * again; once it updates, meeting it in the old rooms is the sign to send it again.
   */
  function heardIn(id: PeerId, room: RoomName, device: PeerId) {
    return oneRekey(async () => {
      const view = friend(id)
      const kept = view === undefined ? undefined : secretState(view)
      if (kept?.replacing === undefined || devices.classify(id, device) !== 'friend') return
      if (!(await roomsAround(kept.secret, 'pair')).has(room)) {
        if (!needsResending(id, kept, device)) return
        if (!(await roomsAround(kept.replacing.old, 'pair')).has(room)) return
        resendWinner(id, kept, device)
        return
      }
      const next = heardFrom(kept, device, clock.now())
      if (next !== undefined) await keepFriendSecret(id, next)
    })
  }

  /**
   * Another of your devices said hello in `room`: if it's the new self secret's, it holds it; if
   * it's the old one's, while none has been seen with the new, the winner is sent again, once.
   */
  function heardSelfIn(room: RoomName, device: PeerId) {
    return oneRekey(async () => {
      const kept = devices.selfSecretState()
      if (kept?.replacing === undefined || !devices.isOwnOther(device)) return
      if (!(await roomsAround(kept.secret, 'self')).has(room)) {
        if (!needsResending(self, kept, device)) return
        if (!(await roomsAround(kept.replacing.old, 'self')).has(room)) return
        resendWinner(self, kept, device)
        return
      }
      const next = heardFrom(kept, device, clock.now())
      if (next === undefined) return
      await devices.setSelfSecretState(next)
      if (selfSession !== undefined) await syncRooms(selfSession)
    })
  }

  /** Lets go of old secrets once every device on the other side is seen with the new one. */
  function settleSecrets() {
    return oneRekey(async () => {
      for (const view of friendList()) {
        const kept = secretState(view)
        if (kept?.replacing === undefined) continue
        // Their list as kept, never the empty one of a friend whose log isn't loaded yet.
        await devices.loadFriend(view.id)
        const next = settle(kept, theirDevices(view.id))
        if (next !== undefined) await keepFriendSecret(view.id, next)
      }
      const own = devices.selfSecretState()
      const next = own === undefined ? undefined : settle(own, theirDevices(self))
      if (next !== undefined) await devices.setSelfSecretState(next)
    })
  }

  /**
   * Proposes a new secret for each kept from before with no replacement under way, or whose
   * winner came from a device since removed, and begins a new round for each marked after a
   * removal here, when there's someone to seal it to; otherwise it's tried again at the next
   * check.
   */
  function replaceOldSecrets() {
    return oneRekey(async () => {
      if (mailbox === undefined || closed || devices.status() !== 'active') return
      for (const view of friendList()) {
        const kept = secretState(view)
        if (kept === undefined || view.moved !== true || view.removedYouAt !== undefined) continue
        if (kept.renew === true) {
          // Sealed to their devices still on their list, under the tags of the secret they're
          // on, which the removed device may know but can't open what's sealed there.
          if ((await recipient(view.id, mailSecret(kept))) === undefined) continue
          const { next } = await begin(crypto, signer, kept, newSecret(), clock.now())
          await keepFriendSecret(view.id, next)
          await tellFriendWinner(view.id, undefined, [kept.secret])
          continue
        }
        const gone = proposerGone(kept, countsFor(view.id))
        if (!needsReplacing(kept) && !gone) continue
        // Sealed to their devices and left under the old secret's tags, which is all a Pigeon
        // that hasn't moved yet looks under.
        const old = kept.replacing?.old ?? kept.secret
        if ((await recipient(view.id, old)) === undefined) continue
        const { next } = await propose(crypto, signer, kept, newSecret(), clock.now())
        await keepFriendSecret(view.id, next)
        await tellFriendWinner(view.id, undefined, [heldBefore(kept)])
      }
      await replaceSelfSecret()
    })
  }

  async function replaceSelfSecret() {
    const kept = devices.selfSecretState()
    if (kept === undefined) return
    if (kept.renew === true) {
      // No other device of yours left: a new one kept here is enough.
      if (theirDevices(self).length === 0) {
        await devices.setSelfSecretState({ secret: newSecret(), sealed: true })
        if (selfSession !== undefined) await syncRooms(selfSession)
        return
      }
      if ((await selfRecipient(undefined, mailSecret(kept))) === undefined) return
      const { next } = await begin(crypto, signer, kept, newSecret(), clock.now())
      await devices.setSelfSecretState(next)
      if (selfSession !== undefined) await syncRooms(selfSession)
      await tellSelfWinner([kept.secret])
      return
    }
    const gone = proposerGone(kept, countsForSelf)
    if (!needsReplacing(kept) && !gone) return
    // Never handed to another device: nobody else can know it.
    if (everDevices(devices.own()).size <= 1) {
      await devices.setSelfSecretState({ secret: kept.secret, sealed: true })
      return
    }
    // No other device of yours to tell: a new one kept here is enough.
    if (theirDevices(self).length === 0) {
      await devices.setSelfSecretState({ secret: newSecret(), sealed: true })
      await askToCheckDevices()
      if (selfSession !== undefined) await syncRooms(selfSession)
      return
    }
    const old = kept.replacing?.old ?? kept.secret
    if ((await selfRecipient(undefined, old)) === undefined) return
    const { next } = await propose(crypto, signer, kept, newSecret(), clock.now())
    await devices.setSelfSecretState(next)
    await askToCheckDevices()
    if (selfSession !== undefined) await syncRooms(selfSession)
    await tellSelfWinner([heldBefore(kept)])
  }

  /**
   * A device that held the self secret and every pair secret was taken off your list here: each
   * is replaced at the next mail check, which starts now, by a new one sealed to the devices
   * still on the lists, so the removed device can't follow anyone to the new rooms or tags.
   */
  async function renewSecrets() {
    await oneRekey(async () => {
      for (const view of friendList())
        if (view.secret !== undefined && state.friends[view.id] !== undefined)
          setState('friends', view.id, 'renew', true)
      await saveFriends()
      const kept = devices.selfSecretState()
      if (kept !== undefined) await devices.setSelfSecretState({ ...kept, renew: true })
    })
    void checkMail().catch(() => undefined)
  }

  /**
   * The self secret was replaced because it may have been seen while a device was linked: My
   * Devices asks you to check every device on your list is yours, until you say so.
   */
  async function askToCheckDevices() {
    if (checkDevices()) return
    setCheckDevices(true)
    await store.set(KEYS.checkDevices, true)
  }

  let nextNote = 0
  function note(id: PeerId, kind: Note['kind']) {
    const view = state.friends[id]
    if (view === undefined) return
    nextNote += 1
    setState('friends', id, 'notes', [
      ...view.notes,
      { id: nextNote, kind, after: view.log.entries.length, at: clock.now() },
    ])
  }

  /** Session options about devices: who's who, and device logs both ways. */
  const deviceOptions = (id: PeerId) => ({
    ...twinOptions,
    accepts: (device: PeerId) => devices.classify(id, device),
    theirLog: () => devices.friendLog(id),
    authors: () => devices.authors(id),
    deviceLog: devices.own,
    onDeviceLog: async (log: DeviceLog) => {
      if (log.identity === self) await takeOwnLog(log)
      else if (log.identity === id && (await devices.takeFriend(id, log)))
        setState('friends', id, 'devices', devices.friendDeviceCount(id))
    },
  })

  async function startSession(id: PeerId) {
    if (sessions.has(id) || profile().handle === '') return
    const view = friend(id)
    if (view === undefined || view.removedYouAt !== undefined) return
    await devices.loadFriend(id)
    if (sessions.has(id)) return
    setState('friends', id, 'devices', devices.friendDeviceCount(id))
    const session = startPairSession({
      ...deviceOptions(id),
      ...mailOptions,
      crypto,
      signer,
      friend: id,
      chat: view.log.id,
      rooms: [],
      handle: () => profile().handle,
      presence: () => ({ status: profile().status, message: profile().message }),
      log: view.log,
      now: clock.now,
      random: deps.random,
      onEvent: (event) =>
        (handlers[event.type] as (id: PeerId, event: PairEvent) => void)(id, event),
    })
    sessions.set(id, session)
    places.set(session, async () => {
      const current = state.friends[id]
      const legacy = view.log.id as `pair:${string}`
      const place: PairPlace = { legacy, secret: current?.secret, moved: current?.moved }
      const now = clock.now()
      const kept = current === undefined ? undefined : secretState(current)
      // While a secret from before is replaced, its rooms too, until the friend is seen with
      // the new one.
      const old = kept === undefined ? [] : roomSecrets(kept).slice(1)
      const rooms = await pairRoomsAt(crypto, place, now)
      const more = await Promise.all(
        old.map((secret) => pairRoomsAt(crypto, { legacy, secret, moved: true }, now)),
      )
      return [...rooms, ...more.flat()]
    })
    await syncRooms(session)
  }

  /**
   * The log you keep for a friend, loaded from storage if their session never started (one who
   * removed you, say): only a friend's own earlier log can vouch for their recovery.
   */
  async function knownLog(id: PeerId): Promise<DeviceLog | undefined> {
    if (friend(id) === undefined) return undefined
    await devices.loadFriend(id)
    return devices.friendLog(id)
  }

  /**
   * After pairing: a new friend's session starts; one you already had, paired again as after
   * their recovery, moves to the new secret's rooms and takes their new devices.
   */
  async function meet(id: PeerId) {
    const session = sessions.get(id)
    if (session === undefined) {
      await startSession(id)
      return
    }
    setState('friends', id, 'devices', devices.friendDeviceCount(id))
    session.recheck()
    await syncRooms(session)
  }

  async function addFriend(record: FriendRecord, log?: ChatLog) {
    letters?.remember(record.id)
    const existing = friend(record.id)
    if (existing !== undefined) {
      // Paired again, perhaps after they'd removed you: friends once more.
      setState('friends', record.id, {
        handle: cleanHandle(record.handle),
        name: nameOf(record.handle, existing.petname),
        removedYouAt: undefined,
        ...(record.secret === undefined
          ? {}
          : {
              secret: record.secret,
              moved: record.moved === true,
              sealed: record.sealed,
              replacing: record.replacing,
              prior: record.prior,
              renew: record.renew,
              begun: record.begun,
            }),
      })
      return existing
    }
    const room = await pairRoom(crypto, self, record.id)
    setState('friends', record.id, {
      ...record,
      handle: cleanHandle(record.handle),
      devices: 1,
      seesThisDevice: true,
      name: nameOf(record.handle, record.petname),
      fingerprint: await fingerprint(crypto, record.id),
      online: false,
      presence: { status: 'online', message: '' },
      typing: false,
      log: log ?? emptyLog(room),
      unread: 0,
      notes: [],
    })
    return state.friends[record.id] as FriendView
  }

  // Invites: at most one live code at a time, kept across reloads until it's used or expires.
  // Whoever proves they hold it waits in `codeAsks` until you add or decline them.
  const [invite, setInvite] = createSignal<HostedInvite | undefined>(undefined)
  const [codeAsks, setCodeAsks] = createSignal<readonly CodeAsk[]>([])
  const [wrongTries, setWrongTries] = createSignal(0)
  /** The last code was stopped after too many wrong tries; cleared when a new one is made. */
  const [inviteStopped, setInviteStopped] = createSignal(false)
  const codeRequests = new Map<string, CodeRequest>()
  let stopHosting: (() => Promise<void>) | undefined

  function clearAsks() {
    codeRequests.clear()
    setCodeAsks([])
    setWrongTries(0)
  }

  /** Names each hosting, so one that was stopped never changes what a later one shows. */
  let hosting = 0

  async function stopInvite() {
    hosting += 1
    await stopHosting?.()
    stopHosting = undefined
    setInvite(undefined)
    clearAsks()
    await store.delete(KEYS.invite)
  }

  async function host(hosted: HostedInvite) {
    await stopHosting?.()
    stopHosting = undefined
    clearAsks()
    setWrongTries(hosted.wrongTries ?? 0)
    hosting += 1
    const run = hosting
    const seal = deps.seal
    if (
      profile().handle === '' ||
      hosted.expiresAt <= clock.now() ||
      seal === undefined ||
      (hosted.wrongTries ?? 0) >= MAX_WRONG_TRIES
    ) {
      if ((hosted.wrongTries ?? 0) >= MAX_WRONG_TRIES) setInviteStopped(true)
      await stopInvite()
      return
    }
    setInvite(hosted)
    const current = () => hosting === run && invite() !== undefined
    const stopThis = await hostInvite({
      crypto,
      seal: seal.crypto,
      pake: deps.pake,
      signer,
      transport,
      handle: profile().handle,
      now: clock.now,
      sleep: clock.sleep,
      code: hosted.code,
      newSecret,
      speaker: devices.speaker,
      knownLog,
      onRequest: (request) => {
        if (!current()) return
        codeRequests.set(request.key, request)
        const ask: CodeAsk = {
          key: request.key,
          id: request.friend.id,
          handle: request.friend.handle,
          fingerprint: request.fingerprint,
        }
        setCodeAsks((asks) => [...asks.filter((other) => other.key !== request.key), ask])
        events.onCodeAsk?.(ask)
      },
      onRequestGone: (key) => {
        if (!current()) return
        codeRequests.delete(key)
        setCodeAsks((asks) => asks.filter((ask) => ask.key !== key))
      },
      wrongTries: hosted.wrongTries ?? 0,
      onWrongTry: (count) => {
        const shown = invite()
        if (!current() || shown === undefined) return
        setWrongTries(count)
        const kept = { ...shown, wrongTries: count }
        setInvite(kept)
        void store.set(KEYS.invite, kept)
      },
      onTooManyTries: () => {
        if (!current()) return
        setInviteStopped(true)
        // The host leaves the room itself, once its last pake-wrong has gone.
        hosting += 1
        stopHosting = undefined
        setInvite(undefined)
        clearAsks()
        void store.delete(KEYS.invite)
      },
      onPaired: (paired, secret) => void welcome(paired, secret),
      refuse: isBlocked,
    })
    // Stopped or replaced while it was being joined: this one isn't wanted any more.
    if (hosting !== run) {
      await stopThis()
      return
    }
    stopHosting = stopThis
    void clock.sleep(hosted.expiresAt - clock.now()).then(() => {
      if (current()) void stopInvite()
    })
  }

  /** Adds someone who asked through your code. False if the code was used meanwhile. */
  async function approveAsk(key: string): Promise<boolean> {
    const request = codeRequests.get(key)
    if (request === undefined) return false
    return request.approve()
  }

  async function declineAsk(key: string): Promise<void> {
    const request = codeRequests.get(key)
    codeRequests.delete(key)
    setCodeAsks((asks) => asks.filter((ask) => ask.key !== key))
    await request?.decline()
  }

  async function welcome(paired: NewFriend, secret: string) {
    hosting += 1
    stopHosting = undefined
    setInvite(undefined)
    clearAsks()
    await store.delete(KEYS.invite)
    // Straight to the secret's rooms, never the old one: offers there can be read by anyone who
    // knows both ids.
    const view = await addFriend({
      id: paired.id,
      handle: paired.handle,
      addedAt: clock.now(),
      secret,
      moved: true,
      sealed: true,
    })
    if (paired.devices !== undefined) await devices.takeFriend(paired.id, paired.devices)
    await saveFriends()
    await meet(paired.id)
    events.onPaired?.(view)
  }

  async function newInvite(): Promise<HostedInvite | undefined> {
    if (profile().handle === '' || devices.status() !== 'active' || deps.seal === undefined)
      return undefined
    setInviteStopped(false)
    const hosted = {
      code: newCode(deps.random(CODE_RANDOM_BYTES)),
      expiresAt: clock.now() + INVITE_LIFETIME_MS,
    }
    await store.set(KEYS.invite, hosted)
    await host(hosted)
    return invite()
  }

  // Load what's stored, then connect.
  const { readable, unreadable } = splitFriendRecords(await store.get(KEYS.friends))
  // Counts include what earlier runs set aside, so every start says so again.
  const friendsAside = await setAside(KEYS.unreadableFriends, unreadable)
  if (friendsAside > 0) events.onFriendsSetAside?.(friendsAside)
  if (blockedAside > 0) events.onBlockedSetAside?.(blockedAside)
  if (farewellsAside > 0) events.onFarewellsSetAside?.(farewellsAside)
  for (const record of readable) {
    const room = await pairRoom(crypto, self, record.id)
    const log = await store.get(KEYS.log(record.id))
    await addFriend(record, isChatLog(log) && log.id === room ? log : emptyLog(room))
  }

  /** Sealing keys of your devices on your list, this one's included. */
  async function ownKeys() {
    const book = await mailBook(self)
    return [
      ...(ownSealing === undefined ? [] : [ownSealing]),
      ...Object.values(book.keys).filter((key) => devices.isOwnOther(key.device)),
    ]
  }

  /** A friend through an invite link, either way round: saved with all a link says of them. */
  async function befriendByLink(found: LinkFriend) {
    const view = await addFriend({
      id: found.id,
      handle: found.handle,
      addedAt: clock.now(),
      secret: found.secret,
      moved: true,
      sealed: true,
    })
    await devices.loadFriend(found.id)
    // A request is kept until you press Add, perhaps from before low-S signatures: read as a
    // kept log is. One that just arrived was checked as it came, so this changes nothing there.
    await devices.takeFriend(found.id, lowSDeviceLog(found.deviceLog))
    for (const key of found.keys)
      await heardKeys(found.id, { type: 'keys', device: key.device, sealing: key })
    if (found.lighthouses.length > 0)
      await heardKeys(found.id, { type: 'keys', device: found.id, lighthouses: found.lighthouses })
    await saveFriends()
    await meet(found.id)
    events.onPaired?.(view)
  }

  if (mailbox !== undefined)
    letters = createLetters({
      store,
      mailbox,
      device: signer.id,
      isMine: devices.isMine,
      random: deps.random,
      now: clock.now,
      sleep: clock.sleep,
      stopped: () => closed,
      chat: (id) => friend(id)?.log,
      connected: (id) => sessions.get(id)?.online() === true,
      // Nobody to write to once they've removed you.
      recipient: async (id) =>
        friend(id)?.removedYouAt === undefined ? recipient(id, friendMailSecret(id)) : undefined,
      ownDevices: () => selfRecipient(),
      takeEntries: async (id, entries) => {
        const session = sessions.get(id)
        if (session === undefined) return false
        await session.takeEntries(entries)
        return true
      },
    })
  for (const view of friendList()) void letters?.load(view.id).catch(() => undefined)

  if (mailbox !== undefined && deps.seal !== undefined && makeClient !== undefined)
    inviteLinks = await loadInviteLinks({
      crypto,
      seal: deps.seal.crypto,
      signer,
      self,
      store,
      now: clock.now,
      random: deps.random,
      mailbox,
      client: (address) => lighthouseClient(address) as LighthouseClient,
      official: deps.lighthouses ?? [],
      lighthouses,
      inviteBase: deps.inviteBase,
      name: () => profile().handle,
      deviceLog: devices.own,
      active: () => devices.status() === 'active',
      ownKeys,
      knownLog,
      isFriend: (id) => friend(id) !== undefined,
      isBlocked,
      newSecret,
      befriend: befriendByLink,
      friendRecipient: (id) => recipient(id, friendMailSecret(id)),
      changed: () => tellOwnDevices(),
      friendLogHeard: async (id, log) => {
        if (friend(id) === undefined) return
        await devices.loadFriend(id)
        if (!(await devices.takeFriend(id, log))) return
        setState('friends', id, 'devices', devices.friendDeviceCount(id))
        sessions.get(id)?.recheck()
      },
      stopped: () => closed,
    })
  // Once on every device, whatever its own key: a card also carries your device log, which a
  // P-256 first device may have signed high-S. Closed cards go again too, so an old open card
  // can't win over a refused closed one. Kept unset, and so tried at the next start, until every
  // open link holds a card again.
  if (inviteLinks !== undefined && (await store.get(KEYS.cardsPutLowS)) !== true) {
    const links = inviteLinks
    void links
      .refresh({ closedToo: true })
      .then(async () => {
        const at = clock.now()
        const open = links.links().filter((link) => link.open && link.expires > at)
        if (devices.status() !== 'active' || closed) return
        if (open.some((link) => Object.keys(link.cards).length === 0)) return
        await store.set(KEYS.cardsPutLowS, true)
      })
      .catch(() => undefined)
  }
  /** A removed friend heard: in person, or by receipt for the farewell left in their mailbox. */
  async function farewellHeard(id: PeerId) {
    // Closed meanwhile, perhaps to be forgotten: the store may be another's now.
    if (closed) return
    await dropFarewell(id)
    // Heard in person: the mailbox stops putting it again.
    await mailbox?.forget(id)
    const session = farewellSessions.get(id)
    farewellSessions.delete(id)
    if (session !== undefined) {
      forget(session)
      await session.close()
    }
    saidFarewells()
  }

  // Telling a removed friend: a session of its own that says unfriend once they're there.
  async function sayFarewell(record: FarewellRecord) {
    const { id } = record
    if (closed || farewellSessions.has(id)) return
    const legacy = await legacyRoom(id)
    await devices.loadFriend(id)
    const session: PairSession = startPairSession({
      ...deviceOptions(id),
      ...mailOptions,
      crypto,
      signer,
      friend: id,
      chat: legacy,
      rooms: [],
      handle: () => profile().handle,
      presence: () => ({ status: profile().status, message: profile().message }),
      log: emptyLog(legacy),
      now: clock.now,
      random: deps.random,
      onEvent: (event) => {
        if (event.type !== 'online') return
        void session.unfriend().then(() => farewellHeard(id))
      },
    })
    farewellSessions.set(id, session)
    places.set(session, async () => {
      const now = clock.now()
      const rooms = await pairRoomsAt(
        crypto,
        { legacy, secret: record.secret, moved: record.moved },
        now,
      )
      const old =
        record.old === undefined
          ? []
          : await pairRoomsAt(crypto, { legacy, secret: record.old, moved: true }, now)
      return [...rooms, ...old]
    })
    await syncRooms(session)
  }

  async function removeFriend(id: PeerId, options: { block: boolean }) {
    const view = friend(id)
    if (closed || view === undefined) return
    const session = sessions.get(id)
    sessions.delete(id)
    if (session !== undefined) forget(session)
    await session?.close()
    batch(() => {
      setState(
        'friends',
        produce((friends) => delete friends[id]),
      )
    })
    await saveFriends()
    await store.delete(KEYS.log(id))
    await letters?.forget(id)
    // Who they are to mail, before their devices are forgotten: the farewell is sealed to them.
    const kept = secretState(view)
    const mailTo =
      view.removedYouAt === undefined && kept !== undefined
        ? await recipient(id, mailSecret(kept))
        : undefined
    await devices.forgetFriend(id)
    if (options.block && !isBlocked(id)) {
      await block(id, view.handle)
    }
    // They removed you first: there's nobody to tell.
    if (view.removedYouAt === undefined) {
      // Kept before anything is sent, so a tab that closes now still owes the farewell.
      const mailed = mailbox !== undefined && mailTo !== undefined
      const old = kept?.replacing?.heardAt === undefined ? kept?.replacing?.old : undefined
      const record: FarewellRecord = {
        id,
        ...(view.secret === undefined ? {} : { secret: view.secret }),
        ...(view.moved === true ? { moved: true } : {}),
        ...(old === undefined ? {} : { old }),
        ...(mailed ? { mailed: true } : {}),
      }
      await keepFarewell(record)
      if (mailed) void mailbox.send('farewell', mailTo, {}).catch(() => undefined)
      await sayFarewell(record)
    }
  }

  // Your devices. They meet in a self room named from the self secret, where
  // device logs travel, so an approval or a removal on one reaches the rest.
  let selfSession: PairSession | undefined
  const selfChat = `self:${self}`
  async function startSelfSession() {
    if (selfSession !== undefined || devices.selfSecretState() === undefined) return
    const session = startPairSession({
      crypto,
      signer,
      friend: self,
      chat: selfChat,
      rooms: [],
      handle: () => profile().handle || 'Me',
      presence: () => ({ status: profile().status, message: profile().message }),
      log: emptyLog(selfChat),
      now: clock.now,
      random: deps.random,
      ...twinOptions,
      ...mailOptions,
      // Your own other devices: their sealing keys and Lighthouses, kept under your own id.
      // One heard for the first time (a device just linked, say) is passed on by mail, so a
      // device that's away can write to it.
      onEvent: (event) => {
        if (event.type === 'seen') void heardSelfIn(event.room, event.device).catch(() => undefined)
        if (event.type === 'keys')
          void heardKeys(self, event)
            .then((added) => (added ? tellOwnDevices() : undefined))
            .catch(() => undefined)
      },
      accepts: (device) => (devices.isOwnOther(device) ? 'friend' : undefined),
      authors: () => new Set(),
      deviceLog: devices.own,
      onDeviceLog: async (log) => {
        if (log.identity === self) await takeOwnLog(log)
      },
      profile: profileChange,
      onProfile: (change) => void takeProfile(change),
    })
    selfSession = session
    // While a self secret from before is replaced, its rooms too, until another of your devices
    // is seen with the new one.
    places.set(session, async () => {
      const kept = devices.selfSecretState()
      if (kept === undefined) return []
      const now = clock.now()
      const rooms = await Promise.all(
        roomSecrets(kept).map((secret) => selfRoomsAt(crypto, secret, now)),
      )
      return rooms.flat()
    })
    await syncRooms(session)
  }

  /** Keeps a new profile and tells friends; `changedAt` when the name or message changed. */
  async function saveProfile(next: Profile, changedAt?: number) {
    const first = profile().handle === '' && next.handle !== ''
    const renamed = profile().handle !== next.handle
    // Before any await, so an older profile arriving meanwhile is already too old.
    if (changedAt !== undefined) profileChangedAt = changedAt
    setProfileSignal(next)
    await store.set(KEYS.profile, profile())
    if (changedAt !== undefined) await store.set(KEYS.profileChangedAt, changedAt)
    if (first) await connect()
    else for (const session of sessions.values()) session.announce()
    // Each open link's card shows the name you go by now.
    if (renamed && !first) void inviteLinks?.refresh().catch(() => undefined)
    // The code's host answers with the name it was started with.
    const current = invite()
    if (renamed && !first && current !== undefined) await host(current)
  }

  /** Your name from another of your devices: the newest change wins. */
  async function takeProfile(change: ProfileChange) {
    if (change.changedAt <= profileChangedAt || profile().handle === '') return
    // A time far ahead would outrank every later change, even after its device is removed.
    if (change.changedAt > clock.now() + PROFILE_CLOCK_SLACK_MS) return
    await saveProfile(
      { ...profile(), handle: change.handle, message: change.message },
      change.changedAt,
    )
  }

  /** Your device log arrived from another of your devices. */
  async function takeOwnLog(log: DeviceLog) {
    if (await devices.takeOwn(log)) await ownChanged()
  }

  let lastStatus = devices.status()
  /** Devices ever on your list and not on it now: removed, or left off by a recovery. */
  const removedNow = () => {
    const active = new Set(devices.devices().map((device) => device.id))
    return [...everDevices(devices.own())].filter((device) => !active.has(device))
  }
  const storedRemovals = await store.get(KEYS.removalsSeen)
  // On a first start with this, every removal so far counts as acted on.
  const firstSeen = new Set<PeerId>(
    Array.isArray(storedRemovals) && storedRemovals.every((id) => typeof id === 'string')
      ? (storedRemovals as PeerId[])
      : removedNow(),
  )
  if (!Array.isArray(storedRemovals)) await store.set(KEYS.removalsSeen, [...firstSeen])
  removalsSeen = firstSeen

  /**
   * Acts on any device taken off your list since the last time: on the device that writes your
   * list, every secret is marked to renew. The marks are kept before the removal is noted as
   * acted on, so a tab that closes between keeping the log and this does it when it next starts.
   * Invite links are left as they are: whoever opens one takes only its maker's cards and answers,
   * so a removed device can do nothing through another's links, and its own end within a week.
   */
  function actOnRemovals(): Promise<void> {
    // Nothing new: nothing to wait for.
    const seen = removalsSeen
    if (seen !== undefined && removedNow().every((device) => seen.has(device)))
      return Promise.resolve()
    // One at a time: a second run, from a log merged while the first waits, sees what it noted.
    const next = acting.then(actOnRemovalsNow, actOnRemovalsNow)
    acting = next.catch(() => undefined)
    return next
  }

  async function actOnRemovalsNow() {
    // Not yet read from storage: acted on once it is, at the end of starting.
    const seen = removalsSeen
    if (devices.status() !== 'active' || seen === undefined) return
    const removed = removedNow()
    if (removed.every((device) => seen.has(device))) return
    // Noted as acted on, here and in storage, only once the marks are kept: one that fails is
    // tried again at the next change or start.
    if (devices.isFirst()) await renewSecrets()
    await store.set(KEYS.removalsSeen, removed)
    removalsSeen = new Set(removed)
  }

  /** Tells everyone about a change to your device log, and acts on what it means here. */
  async function ownChanged() {
    // Each open link's card says your list as it is now.
    void inviteLinks?.refresh().catch(() => undefined)
    await actOnRemovals()
    for (const session of [...sessions.values(), ...farewellSessions.values()]) {
      session.recheck()
      session.shareDevices()
    }
    selfSession?.recheck()
    selfSession?.shareDevices()
    const status = devices.status()
    const was = lastStatus
    lastStatus = status
    // A removed device stops talking: nobody takes anything from it any more.
    if (status === 'removed' && was !== 'removed') {
      await disconnect()
      events.onDeviceRemoved?.()
    }
  }

  async function connect() {
    await startSelfSession()
    if (devices.status() === 'removed') return
    await Promise.all(friendList().map((view) => startSession(view.id)))
    if (profile().handle !== '') await Promise.all(farewells().map((record) => sayFarewell(record)))
    const stored = await store.get(KEYS.invite)
    if (isHostedInvite(stored)) await host(stored)
    void checkMail().catch(() => undefined)
  }
  await connect()
  if (unsharedLighthouses) tellOwnDevices()
  void inviteLinks?.resume().catch(() => undefined)
  // A removal kept in the log before a tab closed, but not acted on.
  await actOnRemovals()

  async function disconnect() {
    // A hosting still being joined sees this and stops itself.
    hosting += 1
    await stopHosting?.()
    stopHosting = undefined
    const all = [...sessions.values(), ...farewellSessions.values()]
    sessions.clear()
    farewellSessions.clear()
    for (const session of all) forget(session)
    await Promise.all(all.map((session) => session.close()))
  }

  // Linking a new device from this one: one code at a time, for 10 minutes.
  const [linking, setLinking] = createSignal<LinkingState | undefined>(undefined)
  let stopLinkHost: (() => Promise<void>) | undefined
  let linkRequest: LinkRequest | undefined

  /** Counts cancels, so a relay-only change can tell a link was closed while it ran. */
  let linkCancels = 0
  async function cancelLink() {
    linkCancels += 1
    await stopLinkHost?.()
    stopLinkHost = undefined
    linkRequest = undefined
    setLinking(undefined)
  }

  async function startLink(): Promise<LinkingState | undefined> {
    // Only the first device puts devices on the list, and not while a recovered
    // one waits for its whole list: a new device couldn't check it.
    const seal = deps.seal
    if (
      profile().handle === '' ||
      !devices.isFirst() ||
      isTailLog(devices.own()) ||
      seal === undefined
    )
      return undefined
    await cancelLink()
    const code = newCode(deps.random(CODE_RANDOM_BYTES))
    const expiresAt = clock.now() + LINK_LIFETIME_MS
    setLinking({
      code,
      link: `${deps.inviteBase}#${encodeDeviceLink(code, selfFingerprint)}`,
      expiresAt,
      wrongTries: 0,
      stopped: false,
    })
    const update = (change: (current: LinkingState) => LinkingState) => {
      const current = linking()
      if (current?.code === code) setLinking(change(current))
    }
    const stop = await hostLink({
      crypto,
      seal: seal.crypto,
      pake: deps.pake,
      signer,
      transport,
      code,
      handle: profile().handle,
      now: clock.now,
      sleep: clock.sleep,
      speaker: devices.speaker,
      onRequest: (request) => {
        if (linking()?.code !== code) return
        linkRequest = request
        update((current) => ({
          ...current,
          request: {
            device: request.device,
            fingerprint: request.fingerprint,
            name: deps.deviceName ?? 'Device',
          },
        }))
      },
      onRequestGone: () => {
        if (linking()?.code !== code) return
        linkRequest = undefined
        // Past its 10 minutes, the code ends with the request it was kept for.
        if (clock.now() >= expiresAt) {
          void cancelLink()
          return
        }
        update(({ request: _gone, ...current }) => current)
      },
      onWrongTry: (count) => update((current) => ({ ...current, wrongTries: count })),
      onTooManyTries: () => {
        update((current) => ({ ...current, stopped: true }))
        stopLinkHost = undefined
      },
    })
    // Closed, or another link started meanwhile: this one's room isn't kept.
    if (closed || linking()?.code !== code) {
      await stop()
      return undefined
    }
    stopLinkHost = stop
    void clock.sleep(LINK_LIFETIME_MS).then(() => {
      if (linking()?.code === code && linking()?.request === undefined) void cancelLink()
    })
    return linking()
  }

  const { bundle, exportData, importData } = createYourData({
    crypto,
    store,
    now: clock.now,
    self,
    devices,
    profile,
    settings,
    friends: friendList,
    blocked,
    isBlocked,
    disconnect,
  })

  /**
   * Not the device in your hand: its request is refused, and the code waits for yours, while it
   * lasts.
   */
  async function refuseLink() {
    const request = linkRequest
    const current = linking()
    if (request === undefined || current === undefined) return
    request.refuse()
    linkRequest = undefined
    if (clock.now() >= current.expiresAt) {
      await cancelLink()
      return
    }
    const { request: _refused, ...rest } = current
    setLinking(rest)
  }

  /** Puts the device that asked on your list under `name` and hands it everything. */
  async function confirmLink(name: string): Promise<'linked' | 'failed' | 'too-big'> {
    const request = linkRequest
    if (request === undefined) return 'failed'
    if (devices.selfSecret() === undefined) await devices.setSelfSecret(newSecret())
    // The first time, this device gets a name too, so My Devices can tell them apart.
    if (devices.own().entries.length === 0)
      await devices.change('name', signer.id, deps.deviceName ?? 'First device')
    // Everything has to fit one sealed letter, with room for the add about to be signed;
    // checked first, so a link that can't finish never puts a device on the list.
    if (canonicalBytes(bundle()).length > MAX_LINK_BUNDLE_BYTES) return 'too-big'
    // Gone already: nothing is signed for a device that can't be handed anything.
    if (!request.alive()) return 'failed'
    // Already on the list from a link that didn't finish: it's handed everything again.
    const listed = devices.isOwnOther(request.device)
    if (!listed && !(await devices.change('add', request.device, name.trim() || 'Device')))
      return 'failed'
    let sent: Awaited<ReturnType<LinkRequest['accept']>> | 'threw'
    try {
      sent = await request.accept(bundle())
    } catch {
      sent = 'threw'
    }
    // Left on the list rather than removed, since a removal is final and the same browser could
    // never be linked again; linking it again hands it everything, and My Devices can remove it.
    if (sent !== 'sent') return 'failed'
    linkRequest = undefined
    stopLinkHost = undefined
    setLinking(undefined)
    await startSelfSession()
    await ownChanged()
    tellOwnDevices()
    return 'linked'
  }

  /** Checks and keeps a bundle from the device that linked this one. False if it doesn't hold. */
  async function takeBundle(value: Json, expected: PeerId): Promise<boolean> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const fields = value as Record<string, unknown>
    const sent = fields['deviceLog']
    const identity = fields['self']
    // The identity whose fingerprint was checked, and nobody else's.
    if (identity !== expected || !isDeviceLog(sent) || sent.identity !== identity) return false
    // The bundle is what your other device keeps, so its logs are read as kept logs are: any
    // spelling from before low-S signatures made low-S.
    const log = lowSDeviceLog(sent)
    if (!(await verifyDeviceLog(crypto, log))) return false
    const state = deviceState(log)
    if (!state.active.has(signer.id)) return false
    const secret = fields['selfSecret']
    const friends = fields['friends']
    const blockedList = fields['blocked']
    const profileValue = fields['profile']
    const friendDevices = fields['friendDevices']
    if (!isPairSecret(secret) || !isFriendRecords(friends) || !isBlockedRecords(blockedList))
      return false
    if (!isProfile(profileValue)) return false
    const logs =
      typeof friendDevices === 'object' && friendDevices !== null
        ? Object.entries(friendDevices)
        : []
    await store.set(KEYS.profile, profileValue)
    await store.set(KEYS.friends, friends)
    await store.set(KEYS.blocked, blockedList)
    // The profile is the other device's now; this one's old change time no longer applies.
    await store.delete(KEYS.profileChangedAt)
    // Nothing of a Pigeon left behind is said as this one, and none of its mail is looked for.
    for (const key of ['mail-outbox', 'mail-fetched', 'mail-seen']) await store.delete(key)
    await store.set(KEYS.farewells, [])
    for (const [id, value] of logs) {
      const friendLog = isDeviceLog(value) ? lowSDeviceLog(value) : undefined
      if (
        friendLog !== undefined &&
        friendLog.identity === id &&
        (await verifyDeviceLog(crypto, friendLog))
      )
        await store.set(DEVICE_KEYS.friendDevices(id), friendLog)
    }
    await store.set(DEVICE_KEYS.deviceLog, log)
    // Handed over sealed to this device, after a live code it proved: as safe as the other
    // device's own, which that device replaces if it's from before. A replacement under way
    // there carries on here.
    const replacing = fields['selfReplacing']
    const prior = fields['selfPrior']
    // A bundle from a Pigeon that didn't say is taken as sealed, as before.
    await store.set(DEVICE_KEYS.selfSecretState, {
      secret,
      ...(fields['selfSealed'] === false && !isReplacing(replacing) ? {} : { sealed: true }),
      ...(isReplacing(replacing) ? { replacing } : {}),
      ...(isReplacing(replacing) && isReplacing(prior) ? { prior } : {}),
    })
    await store.set(DEVICE_KEYS.selfSecret, secret)
    // Last: with `self` set, this browser is that identity from its next start.
    await store.set(DEVICE_KEYS.self, identity)
    return true
  }

  const { emptyHere, leavingTells, leave, recoverIdentity, joinIdentity } = createIdentityMoves({
    crypto,
    signer,
    store,
    clock,
    transport,
    pake: deps.pake,
    ...(deps.deviceName === undefined ? {} : { deviceName: deps.deviceName }),
    seal: deps.seal,
    ownSealing,
    self,
    selfFingerprint,
    devices,
    friends: friendList,
    farewells,
    farewellWatch: {
      hear: (onSaid) => {
        onFarewellSaid = onSaid
      },
      wait: (resolve) => {
        farewellsSaid.push(resolve)
      },
    },
    twin,
    closed: () => closed,
    linking,
    newSecret,
    removeFriend,
    close,
    takeBundle,
  })

  /** Relay-only changes, one at a time: two that overlapped could each host a room. */
  let relayChange: Promise<void> = Promise.resolve()
  function setRelayOnly(relayOnly: boolean): Promise<void> {
    const next = relayChange.then(() => applyRelayOnly(relayOnly))
    relayChange = next.catch(() => undefined)
    return next
  }
  async function applyRelayOnly(relayOnly: boolean) {
    if (closed || settings().relayOnly === relayOnly) return
    setSettings({ ...settings(), relayOnly })
    await store.set(KEYS.settings, settings())
    // A connection open to a Lighthouse relay-only now refuses closes, so it isn't kept up.
    for (const [key, address] of clientAddresses)
      if (!mayReach(address)) lighthouseClients.get(key)?.close()
    // Every room this Pigeon hosts is joined again under the new policy: friends', the code you
    // host, your own devices' room, and a device link you're showing, which gets a new code.
    // A link a device has already answered is left to finish: that device was reached the old
    // way already, and taking the room away would add it without handing it anything.
    const showingLink = linking() !== undefined && linking()?.request === undefined
    if (showingLink) await cancelLink()
    const cancels = linkCancels
    await disconnect()
    await stopSelfSession()
    if (closed) return
    await connect()
    // Not when the link was closed or another started meanwhile.
    if (showingLink && !closed && linkCancels === cancels) await startLink()
  }

  /** Stops everything: no rooms, no sessions, no link or invite hosting. */
  async function close() {
    closed = true
    stopWaking?.()
    // A relay-only change halfway through would host rooms again after they're stopped.
    await relayChange
    for (const client of lighthouseClients.values()) client.close()
    await cancelLink()
    await disconnect()
    await stopSelfSession()
  }

  async function stopSelfSession() {
    const leaving = selfSession
    selfSession = undefined
    if (leaving !== undefined) {
      forget(leaving)
      await leaving.close()
    }
  }

  mailSchedule.run()

  // Rooms are renamed each UTC day, with both joined around midnight.
  void (async () => {
    while (!closed) {
      await clock.sleep(untilPairDaysChange(clock.now()))
      if (closed) return
      await Promise.all(
        [...places.keys()].map((session) => syncRooms(session).catch(() => undefined)),
      )
    }
  })()

  return {
    /** Your identity, the same on all your devices: what friends and birds know you by. */
    self,
    /** This device's own key. */
    device: signer.id,
    /** Whether a chat entry is yours, from any of your devices. */
    isMine: devices.isMine,
    deviceStatus: devices.status,
    /** This device's key was heard from another run: a copied profile. */
    twin,
    devices: devices.devices,
    /**
     * The secret your devices meet with was replaced, since it may have been seen while a device
     * was linked: My Devices asks you to check every device on the list is yours.
     */
    checkDevices,
    /** You've checked: My Devices stops asking. */
    async devicesChecked() {
      setCheckDevices(false)
      await store.delete(KEYS.checkDevices)
    },
    /** A first device with nobody on it: it can be linked to another identity. */
    canJoin: emptyHere,
    /** Recovered, and waiting for an old friend to hand back the whole list. */
    waitingForList: () => isTailLog(devices.own()),
    linking,
    startLink,
    confirmLink,
    refuseLink,
    cancelLink,
    joinIdentity,
    leavingTells,
    leave,
    exportData,
    importData,
    /** This is the first device, the only one that links and removes devices. */
    isFirstDevice: devices.isFirst,
    /** Your recovery key's public half, while you have one. */
    recoveryKey: devices.recoveryKey,
    /** The epoch a recover with your current key would start. */
    nextEpoch: () => devices.epoch() + 1,
    /** Commits your list to a new recovery key, on the first device while it has none. */
    async commitRecoveryKey(key: PeerId): Promise<boolean> {
      if (!(await devices.commitRecoveryKey(key))) return false
      await ownChanged()
      tellOwnDevices()
      return true
    },
    /**
     * Uses your recovery key on this device, which is already you: it writes your list from now
     * on, the others stay only if `keepOthers`, and `next` is the key from now on.
     */
    async recoverHere(key: Signer, keepOthers: boolean, next: PeerId): Promise<boolean> {
      const here = devices.devices().find((device) => device.here)
      const keep = devices
        .devices()
        .filter((device) => device.here || keepOthers)
        .map((device) => ({ device: device.id, name: device.name }))
      if (here === undefined) return false
      const before = devices.devices().map((device) => device.id)
      if (!(await devices.recoverHere(key, keep, next))) return false
      await ownChanged()
      // Devices the recovery left off are told, so they stop talking.
      tellOwnDevices(before)
      return true
    },
    recoverIdentity,
    /** True the first time it's asked: whether to remind you to make a recovery key. */
    async remindRecoveryOnce(): Promise<boolean> {
      if ((await store.get(KEYS.recoveryReminded)) === true) return false
      await store.set(KEYS.recoveryReminded, true)
      return true
    },
    /** Takes a device off your list, from the first device. */
    async removeDevice(id: PeerId) {
      if (!(await devices.change('remove', id))) return
      await ownChanged()
      // The removed device is told too, so it stops talking even if it's never in the self room.
      tellOwnDevices([id])
    },
    async renameDevice(id: PeerId, name: string) {
      if (name.trim() === '' || !(await devices.change('name', id, name))) return
      await ownChanged()
      tellOwnDevices()
    },
    selfFingerprint,
    /**
     * Where one of the chat's messages is: sealing, left at Lighthouses, received, or come by
     * letter. Received only on their word (a sync of theirs that holds it, or a receipt), so
     * nothing for one that went straight to them that they haven't said they hold. Call
     * `loadLetters` when the chat opens.
     */
    messageRoute: (id: PeerId, entry: LogEntry) => letters?.route(id, entry),
    loadLetters: (id: PeerId) => letters?.load(id) ?? Promise.resolve(),
    /** Invite links this device made, with who asked through each. */
    inviteLinks: () => inviteLinks?.links() ?? [],
    /** Invite links your other devices made. */
    inviteLinksElsewhere: () => inviteLinks?.elsewhere() ?? [],
    /** Requests you sent through someone's link, waiting for their answer. */
    sentAsks: () => inviteLinks?.asks() ?? [],
    /** Makes an invite link; undefined when this Pigeon can't reach Lighthouses. */
    makeInviteLink: (options: { lifetime: number; uses: number }) =>
      inviteLinks?.make(options) ??
      Promise.resolve({ ok: false as const, error: 'not-stored' as const }),
    cancelInviteLink: (secret: string) => inviteLinks?.cancel(secret) ?? Promise.resolve(),
    approveRequest: (secret: string, identity: PeerId) =>
      inviteLinks?.approve(secret, identity) ?? Promise.resolve(false),
    declineRequest: (secret: string, identity: PeerId) =>
      inviteLinks?.decline(secret, identity) ?? Promise.resolve(),
    /** Looks up someone's invite link at the Lighthouses. */
    openInviteLink: (text: string): Promise<OpenedLink> =>
      inviteLinks?.open(text) ??
      Promise.resolve({ ok: false as const, error: 'not-found' as const }),
    /** Asks to be friends through a link opened with `openInviteLink`. */
    askThroughLink: (opened: Extract<OpenedLink, { ok: true }>) =>
      inviteLinks?.ask(opened) ?? Promise.resolve('not-sent' as const),
    forgetAsk: (secret: string) => inviteLinks?.forgetAsk(secret) ?? Promise.resolve(),
    /** Where friends leave mail for this Pigeon. */
    lighthouses,
    /** Changes where mail is left for you, and says so to friends and your other devices. */
    async setLighthouses(next: readonly LighthouseAddress[]) {
      // Later than any change this device has seen, even with a clock that's behind.
      await saveLighthouses(next, Math.max(clock.now(), lighthousesChangedAt + 1))
      tellOwnDevices()
    },
    /** What `id`'s devices (your own, under your own id) said about their mail. */
    mailBook,
    /** Looks for mail now, rather than at the next few-minute check. */
    checkMail,
    /**
     * What Check Now shows: when Pigeon last finished looking for mail (undefined before the
     * first look) and whether a look is under way or waiting for its turn.
     */
    mailLook: () => ({ at: lookedAt(), state: lookState() }),
    /**
     * Check Now: looks for mail as soon as the scheduler allows, through the same path as a tab
     * shown or a message sent, so two looks never run at once and one never starts within
     * MAIL_MIN_GAP_MS of the last. Says how long it waits for that gap (0 when it starts at
     * once); a look already under way is followed by this one.
     */
    checkNow(): number {
      const wait = gapLeft()
      lookSoon(0)
      return wait
    },
    /**
     * Try Again: puts at once what you wrote to `id` that no Lighthouse took yet, and says each
     * message's way as it is. True when nothing is left unsent.
     */
    tryAgain: (id: PeerId) => letters?.tryAgain(id) ?? Promise.resolve(false),
    /**
     * Whether a Lighthouse answers, and what it says it runs: its own claim, which nothing in
     * Pigeon relies on.
     */
    async checkLighthouse(
      address: LighthouseAddress,
    ): Promise<Result<LighthouseSoftware, ClientError | 'no-client'>> {
      // Only Network asks, for one on your list or one you're adding: you chose it, so it's
      // reached at any address, private and local ones included, relay-only or not.
      if (lighthouseClient(address) === undefined) return err('no-client')
      const client = chosenClients.get(`${address.id} ${address.url} ${address.pass ?? ''}`)
      if (client === undefined) return err('no-client')
      return client.hello()
    },
    profile,
    async setProfile(next: Profile) {
      const handle = next.handle.trim().slice(0, MAX_HANDLE_LENGTH)
      const message = next.message.slice(0, MAX_PERSONAL_MESSAGE_LENGTH)
      const named = handle !== profile().handle || message !== profile().message
      // Later than any change this device has seen, even with a clock that's behind.
      const at = named ? Math.max(clock.now(), profileChangedAt + 1) : undefined
      await saveProfile({ ...next, handle, message }, at)
      if (named) {
        selfSession?.announce()
        tellOwnDevices()
      }
    },
    friends: friendList,
    friend,
    onlineCount,
    /** How many signaling relays are reachable now, where the transport can tell. */
    relays: () => transport.relays?.(),
    invite,
    inviteLink: () => {
      const current = invite()
      return current === undefined
        ? undefined
        : inviteLink(deps.inviteBase, current.code, selfFingerprint)
    },
    inviteCode: () => {
      const current = invite()
      return current === undefined ? undefined : formatCode(current.code)
    },
    newInvite,
    /** People who proved they hold your code, waiting for you to add or decline them. */
    codeAsks,
    approveAsk,
    declineAsk,
    /** Wrong confirmations your current code has had. */
    wrongTries,
    /** Your last code was stopped after too many wrong tries. */
    inviteStopped,
    /**
     * Answers someone's invite and waits to hear who they are. Nothing is agreed until the
     * returned offer is confirmed, which adds the friend on both sides.
     */
    async open(
      target: Invite,
      until: Promise<void>,
      onStep?: (step: OpenStep) => void,
    ): Promise<OpenedInvite> {
      if (isOwnCode(invite()?.code, target) || target.fingerprint === selfFingerprint)
        return { ok: false, error: 'own' }
      if (deps.seal === undefined || ownSealing === undefined)
        return { ok: false, error: 'stopped' }
      const result = await openInvite({
        crypto,
        seal: deps.seal.crypto,
        sealer: deps.seal.sealer,
        sealing: ownSealing,
        pake: deps.pake,
        signer,
        transport,
        handle: profile().handle,
        now: clock.now,
        invite: target,
        until,
        sleep: clock.sleep,
        speaker: devices.speaker,
        knownLog,
        ...(onStep === undefined ? {} : { onStep }),
      })
      if (!result.ok) return result
      const { offer } = result
      if (offer.friend.id === self) {
        await offer.cancel()
        return { ok: false, error: 'own' }
      }
      if (isBlocked(offer.friend.id)) {
        await offer.cancel()
        return { ok: false, error: 'blocked', handle: offer.friend.handle }
      }
      return {
        ok: true,
        offer: {
          ...offer,
          async confirm(confirmUntil: Promise<void>) {
            const accepted = await offer.confirm(confirmUntil)
            if (accepted === false || accepted === 'declined') return accepted
            // The inviter made the secret, so they hold it: meet only in its rooms.
            await addFriend({
              id: offer.friend.id,
              handle: offer.friend.handle,
              addedAt: clock.now(),
              secret: accepted.secret,
              moved: true,
              sealed: true,
            })
            if (offer.friend.devices !== undefined)
              await devices.takeFriend(offer.friend.id, offer.friend.devices)
            await saveFriends()
            await meet(offer.friend.id)
            return true
          },
        },
      }
    },
    async send(id: PeerId, text: string) {
      const trimmed = text.trim()
      if (trimmed === '' || devices.status() !== 'active') return
      lastTypingSent.delete(id)
      await sessions.get(id)?.send(trimmed)
      letters?.wrote(id)
      lookSoon(MAIL_AFTER_SEND_MS)
    },
    /** Call on every edit of the draft; it throttles what goes on the wire. */
    typing(id: PeerId, active: boolean) {
      const session = sessions.get(id)
      if (session === undefined) return
      const last = lastTypingSent.get(id)
      if (!active) {
        if (last !== undefined) session.typing(false)
        lastTypingSent.delete(id)
        return
      }
      if (last !== undefined && clock.now() - last < TYPING_REFRESH_MS) return
      lastTypingSent.set(id, clock.now())
      session.typing(true)
    },
    buzz(id: PeerId) {
      const session = sessions.get(id)
      if (session === undefined || !session.online()) return
      session.buzz()
      note(id, 'buzz-out')
    },
    fingerprintOf: (id: PeerId) => fingerprint(crypto, id),
    /** The traits of someone's pixel pigeon (docs/design.md, Avatars). */
    avatarOf: (id: PeerId) => avatarFor(crypto, id),
    markRead: (id: PeerId) => {
      if (state.friends[id]?.unread !== 0) setState('friends', id, 'unread', 0)
    },
    isFriend,
    rename,
    mute,
    muted,
    remove: removeFriend,
    blocked,
    unblock,
    settings,
    /** Turns relay-only connections on or off, and reconnects everything to match. */
    setRelayOnly,
    /**
     * Work in flight that a reload would cut short or repeat: a chat saved to storage a moment
     * ago and not yet written, and a letter being sealed and put. What else is going on survives
     * a reload as it does a closing tab (the outbox, mail already fetched, a removal still to be
     * acted on and a pair secret being replaced are kept as they go and picked up on the next
     * start), so it isn't counted.
     */
    inFlight: () => writes.size > 0 || (letters?.busy() ?? false),
    /** For a closing tab: friends see you go offline at once. */
    goodbye() {
      for (const session of sessions.values()) session.goodbye()
    },
    close,
  }
}
