// The Messenger's state: who you are, your friends, your chats, and a pair session per friend.
// It reads and writes storage, runs core's protocol over the transport, and exposes Solid state
// the windows draw. Everything it touches comes in through platform interfaces. Friends meet in
// rooms named from their pair secret, renamed each UTC day; friends from before the secret move
// there the next time they meet.
import {
  avatarFor,
  type ChatLog,
  type Crypto,
  canonicalBytes,
  type DeviceLog,
  deviceState,
  emptyLog,
  encodeDeviceLink,
  encodeInstance,
  encodeInviteLink,
  encodePairSecret,
  fingerprint,
  formatInviteCode,
  hostInvite,
  hostLink,
  INSTANCE_BYTES,
  INVITE_CODE_BYTES,
  INVITE_LIFETIME_MS,
  type Invite,
  inviteCode,
  isDeviceLog,
  isPairSecret,
  isPeerId,
  isTailLog,
  type Json,
  type LinkRequest,
  type LogEntry,
  MAX_HANDLE_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_PERSONAL_MESSAGE_LENGTH,
  mergeEntries,
  type NewFriend,
  type Offer,
  type OpenResult,
  type OpenStep,
  openInvite,
  openLink,
  PAIR_SECRET_BYTES,
  type PairEvent,
  type PairPlace,
  type PairRoomSpec,
  type PairSession,
  type PeerId,
  type Presence,
  type ProfileChange,
  pairRoom,
  pairRoomsAt,
  type RoomName,
  recoverDeviceLog,
  type Signer,
  type Status,
  selfRoomsAt,
  startPairSession,
  type Transport,
  untilPairDaysChange,
  verifyDeviceLog,
} from '@pigeon/core'
import { batch, createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Store } from '../../../platform/storage/storage.ts'
import { DEVICE_KEYS, type DeviceView, loadDevices } from './devices.ts'
import {
  isBlockedRecords,
  isChatLog,
  isFarewells,
  isFriendRecords,
  isHostedInvite,
  isMessengerSettings,
  isProfile,
} from './stored.ts'

/** How long a "typing" lasts without a refresh, and how often the sender refreshes it. */
export const TYPING_EXPIRES_MS = 6000
export const TYPING_REFRESH_MS = 3000

export interface Profile {
  readonly handle: string
  readonly status: Status
  readonly message: string
}

export interface FriendRecord {
  readonly id: PeerId
  /** The name they chose, as last seen in their signed hello. */
  readonly handle: string
  readonly addedAt: number
  /** What you call them, shown instead of their handle. */
  readonly petname?: string | undefined
  /** No balloons and no shaking from them until then (`Infinity` stored as -1: until unmuted). */
  readonly mutedUntil?: number | undefined
  /** They removed you: the chat stays, read-only, until you remove them too. */
  readonly removedYouAt?: number | undefined
  /** The pair secret your rooms are named from; none for friends not yet moved. */
  readonly secret?: string | undefined
  /** Both of you hold the secret, so the old room named from your ids is no longer used. */
  readonly moved?: boolean | undefined
}

/** A friend you removed who hasn't been told yet, and where to find them. */
export interface FarewellRecord {
  readonly id: PeerId
  readonly secret?: string | undefined
  readonly moved?: boolean | undefined
}

export interface MessengerSettings {
  /** Connect to friends through the TURN relay only, so they never learn your IP address. */
  readonly relayOnly: boolean
}

/** Someone you've blocked: their invite requests and answers are refused. */
export interface BlockedRecord {
  readonly id: PeerId
  readonly handle: string
  readonly at: number
}

/** Stored for "until I unmute". */
export const MUTED_FOREVER = -1

export interface FriendView extends FriendRecord {
  /** How many devices they have on their list. */
  readonly devices: number
  /**
   * Their Pigeon accepts messages from this device. False when this isn't your first device and
   * theirs is from before device logs: they hear your first device only, until they update.
   */
  readonly seesThisDevice: boolean
  /** The petname if you gave one, else their handle: what every screen shows. */
  readonly name: string
  readonly fingerprint: string
  readonly online: boolean
  readonly presence: Presence
  readonly typing: boolean
  readonly log: ChatLog
  /** Messages from them that arrived since you last looked. */
  readonly unread: number
  /** Buzzes, comings and goings this visit, not kept: each sits after `after` chat entries. */
  readonly notes: readonly Note[]
}

export interface Note {
  readonly id: number
  readonly kind: 'buzz-in' | 'buzz-out' | 'online' | 'offline'
  readonly after: number
  readonly at: number
}

export interface MessengerEvents {
  readonly onPaired?: (friend: FriendView) => void
  /** Another of your devices took this one off your list. */
  readonly onDeviceRemoved?: () => void
  /** This device's key is open somewhere else too: a copied profile. Once a run. */
  readonly onTwin?: () => void
  readonly onMessage?: (friend: FriendView, entry: LogEntry) => void
  readonly onBuzz?: (friend: FriendView) => void
  readonly onOnline?: (friend: FriendView) => void
  readonly onUnfriended?: (friend: FriendView) => void
}

export interface MessengerDeps {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly store: Store
  readonly transport: Transport
  readonly clock: Clock
  readonly random: (length: number) => Uint8Array
  /** The page address invite links start with: "https://pigeon.tomszir.com/". */
  readonly inviteBase: string
  /** What to call this device in My Devices when it's linked: "Firefox on Linux". */
  readonly deviceName?: string
  readonly events?: MessengerEvents
}

export type Messenger = Awaited<ReturnType<typeof createMessenger>>

const KEYS = {
  profile: 'profile',
  friends: 'friends',
  invite: 'invite',
  blocked: 'blocked',
  /** Friends you removed who haven't been told yet. */
  farewells: 'farewells',
  settings: 'messengerSettings',
  /** When your name or personal message last changed, so the newest wins on your devices. */
  profileChangedAt: 'profileChangedAt',
  /** Set once the balloon reminding you to make a recovery key has been shown. */
  recoveryReminded: 'recoveryReminded',
  log: (id: PeerId) => `log:${id}`,
} as const

const DEFAULT_PROFILE: Profile = { handle: '', status: 'online', message: '' }

export const inviteLink = (base: string, code: string, fingerprint: string): string =>
  `${base}#${encodeInviteLink(code, fingerprint)}`

/** What an export file says it is. */
export const EXPORT_KIND = 'pigeon-export'

export type ImportResult = 'imported' | 'not-yours' | 'unreadable'

/** Recovering onto this Pigeon: done, or why not. */
export type RecoverResult = 'recovered' | 'own' | 'linked' | 'has-friends' | 'waiting' | 'refused'

/** Linking a device from this one: the code it shows, and who asked, once someone has. */
export interface LinkingState {
  readonly code: string
  readonly link: string
  readonly expiresAt: number
  readonly request?: { readonly device: PeerId; readonly check: string; readonly name: string }
}

/** Linking this device to another's identity: who answered, and the check to compare. */
export interface DeviceOffer {
  readonly handle: string
  readonly check: string
  /** Resolves true once confirmed on the other device and this one has taken it all in. */
  confirmed(until: Promise<void>): Promise<boolean>
  cancel(): Promise<void>
}

/** How far leaving a Pigeon has got: removing friends here, then telling them. */
export interface LeaveProgress {
  readonly step: 'removing' | 'telling'
  /** Friends removed, or friends who have heard, so far. */
  readonly done: number
  readonly total: number
}

export type JoinedIdentity =
  | { readonly ok: true; readonly offer: DeviceOffer }
  | {
      readonly ok: false
      readonly error: 'stopped' | 'impostor' | 'has-friends' | 'has-devices' | 'waiting' | 'own'
    }

/** How far ahead of this device's clock another of yours may stamp a name. */
export const PROFILE_CLOCK_SLACK_MS = 24 * 60 * 60 * 1000

/** How long a link code is shown before it lapses. */
export const LINK_LIFETIME_MS = 10 * 60 * 1000

/** The invite this tab is hosting. */
export interface HostedInvite {
  readonly code: string
  readonly expiresAt: number
}

/** An invite's answer as the Messenger hands it on: confirming adds the friend here too. */
export interface FriendOffer extends Omit<Offer, 'confirm'> {
  /** Agrees to be friends; true once you are, false if `until` gives up first. */
  confirm(until: Promise<void>): Promise<boolean>
}

export type OpenedInvite =
  | { readonly ok: true; readonly offer: FriendOffer }
  | Extract<OpenResult, { ok: false }>
  | { readonly ok: false; readonly error: 'own' }
  /** The inviter is someone you blocked. */
  | { readonly ok: false; readonly error: 'blocked'; readonly handle: string }

export async function createMessenger(deps: MessengerDeps) {
  const { crypto, signer, store, clock } = deps
  const events = deps.events ?? {}
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

  const storedProfile = await store.get(KEYS.profile)
  const [profile, setProfileSignal] = createSignal<Profile>(
    isProfile(storedProfile) ? storedProfile : DEFAULT_PROFILE,
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

  // The store's own copy is mutable so Solid's path setters type-check; callers see FriendView.
  type Mutable<T> = { -readonly [K in keyof T]: T[K] }
  const [state, setState] = createStore<{ friends: Record<PeerId, Mutable<FriendView>> }>({
    friends: {},
  })
  const sessions = new Map<PeerId, PairSession>()
  const typingGeneration = new Map<PeerId, number>()
  const lastTypingSent = new Map<PeerId, number>()

  const friendList = (): readonly FriendView[] =>
    Object.values(state.friends).sort((a, b) => a.addedAt - b.addedAt)
  const friend = (id: PeerId): FriendView | undefined => state.friends[id]

  const saveFriends = () =>
    store.set(
      KEYS.friends,
      friendList().map(
        ({
          id,
          handle,
          addedAt,
          petname,
          mutedUntil,
          removedYouAt,
          secret,
          moved,
        }): FriendRecord => ({
          id,
          handle,
          addedAt,
          ...(petname === undefined ? {} : { petname }),
          ...(mutedUntil === undefined ? {} : { mutedUntil }),
          ...(removedYouAt === undefined ? {} : { removedYouAt }),
          ...(secret === undefined ? {} : { secret }),
          ...(moved === true ? { moved } : {}),
        }),
      ),
    )
  const nameOf = (handle: string, petname: string | undefined) => petname ?? handle

  const storedBlocked = await store.get(KEYS.blocked)
  const [blocked, setBlocked] = createSignal<readonly BlockedRecord[]>(
    isBlockedRecords(storedBlocked) ? storedBlocked : [],
  )
  const isBlocked = (id: PeerId) => blocked().some((record) => record.id === id)
  const storedFarewells = await store.get(KEYS.farewells)
  // A farewell stored before pair secrets was just an id.
  let farewells: readonly FarewellRecord[] = isFarewells(storedFarewells)
    ? storedFarewells.map((entry) => (typeof entry === 'string' ? { id: entry } : entry))
    : []
  const farewellSessions = new Map<PeerId, PairSession>()
  /**
   * Set once `close` runs. Declared before anything that reads it can run: a farewell still owed
   * from the last visit is said while the Messenger starts.
   */
  let closed = false
  // Leaving this Pigeon waits for its farewells to be said.
  let farewellsSaid: (() => void)[] = []
  /** Told each time a farewell is said, while leaving shows how many have heard. */
  let onFarewellSaid: (() => void) | undefined
  const saidFarewells = () => {
    onFarewellSaid?.()
    if (farewells.length > 0) return
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
    renamed: (id, event) => {
      const current = state.friends[id]
      if (current === undefined || current.handle === event.handle) return
      setState('friends', id, { handle: event.handle, name: nameOf(event.handle, current.petname) })
      void saveFriends()
    },
    offline: (id) => {
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
    secret: (id, event) => {
      const session = sessions.get(id)
      if (session === undefined) return
      void (async () => {
        await session.confirmSecret()
        await moveTo(id, event.secret)
      })()
    },
    'secret-ok': (id) => {
      const secret = state.friends[id]?.secret
      if (secret !== undefined) void moveTo(id, secret)
    },
    log: (id, event) => {
      const before = state.friends[id]?.log.entries ?? []
      const seen = new Set(before.map((entry) => entry.sig))
      // Theirs, from whichever of their devices: anything not by one of yours.
      const arrived = event.log.entries.filter(
        (entry) => !devices.isMine(entry.author) && !seen.has(entry.sig),
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
      void store.set(KEYS.log(id), event.log)
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
      crypto,
      signer,
      friend: id,
      chat: view.log.id,
      rooms: [],
      handle: () => profile().handle,
      presence: () => ({ status: profile().status, message: profile().message }),
      log: view.log,
      now: clock.now,
      onEvent: (event) =>
        (handlers[event.type] as (id: PeerId, event: PairEvent) => void)(id, event),
    })
    sessions.set(id, session)
    places.set(session, () => {
      const current = state.friends[id]
      const place: PairPlace = {
        legacy: view.log.id as `pair:${string}`,
        secret: current?.secret,
        moved: current?.moved,
      }
      return pairRoomsAt(crypto, place, clock.now())
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
    const existing = friend(record.id)
    if (existing !== undefined) {
      // Paired again, perhaps after they'd removed you: friends once more.
      setState('friends', record.id, {
        handle: record.handle,
        name: nameOf(record.handle, existing.petname),
        removedYouAt: undefined,
        ...(record.secret === undefined
          ? {}
          : { secret: record.secret, moved: record.moved === true }),
      })
      return existing
    }
    const room = await pairRoom(crypto, self, record.id)
    setState('friends', record.id, {
      ...record,
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
  const [invite, setInvite] = createSignal<HostedInvite | undefined>(undefined)
  let stopHosting: (() => Promise<void>) | undefined

  async function stopInvite() {
    await stopHosting?.()
    stopHosting = undefined
    setInvite(undefined)
    await store.delete(KEYS.invite)
  }

  async function host(hosted: HostedInvite) {
    await stopHosting?.()
    stopHosting = undefined
    if (profile().handle === '' || hosted.expiresAt <= clock.now()) {
      await stopInvite()
      return
    }
    setInvite(hosted)
    stopHosting = await hostInvite({
      crypto,
      signer,
      transport,
      handle: profile().handle,
      now: clock.now,
      sleep: clock.sleep,
      code: hosted.code,
      newSecret,
      speaker: devices.speaker,
      knownLog,
      onPaired: (paired, secret) => void welcome(paired, secret),
      refuse: isBlocked,
    })
    void clock.sleep(hosted.expiresAt - clock.now()).then(() => {
      if (invite()?.code === hosted.code) void stopInvite()
    })
  }

  async function welcome(paired: NewFriend, secret: string) {
    stopHosting = undefined
    setInvite(undefined)
    await store.delete(KEYS.invite)
    // Straight to the secret's rooms, never the old one: offers there can be read by anyone who
    // knows both ids. An invitee on a Pigeon from before pair secrets ignores the secret and
    // will need to pair again.
    const view = await addFriend({
      id: paired.id,
      handle: paired.handle,
      addedAt: clock.now(),
      secret,
      moved: true,
    })
    if (paired.devices !== undefined) await devices.takeFriend(paired.id, paired.devices)
    await saveFriends()
    await meet(paired.id)
    events.onPaired?.(view)
  }

  async function newInvite(): Promise<HostedInvite | undefined> {
    if (profile().handle === '' || devices.status() !== 'active') return undefined
    const hosted = {
      code: inviteCode(deps.random(INVITE_CODE_BYTES)),
      expiresAt: clock.now() + INVITE_LIFETIME_MS,
    }
    await store.set(KEYS.invite, hosted)
    await host(hosted)
    return invite()
  }

  // Load what's stored, then connect.
  const records = await store.get(KEYS.friends)
  for (const record of isFriendRecords(records) ? records : []) {
    const room = await pairRoom(crypto, self, record.id)
    const log = await store.get(KEYS.log(record.id))
    await addFriend(record, isChatLog(log) && log.id === room ? log : emptyLog(room))
  }
  // Telling a removed friend: a session of its own that says unfriend once they're there.
  async function sayFarewell(record: FarewellRecord) {
    const { id } = record
    if (closed || farewellSessions.has(id)) return
    const legacy = await legacyRoom(id)
    await devices.loadFriend(id)
    const session: PairSession = startPairSession({
      ...deviceOptions(id),
      crypto,
      signer,
      friend: id,
      chat: legacy,
      rooms: [],
      handle: () => profile().handle,
      presence: () => ({ status: profile().status, message: profile().message }),
      log: emptyLog(legacy),
      now: clock.now,
      onEvent: (event) => {
        if (event.type !== 'online') return
        void session.unfriend().then(async () => {
          // Closed meanwhile, perhaps to be forgotten: the store may be another's now.
          if (closed) return
          farewells = farewells.filter((other) => other.id !== id)
          await store.set(KEYS.farewells, farewells)
          farewellSessions.delete(id)
          forget(session)
          await session.close()
          saidFarewells()
        })
      },
    })
    farewellSessions.set(id, session)
    places.set(session, () =>
      pairRoomsAt(crypto, { legacy, secret: record.secret, moved: record.moved }, clock.now()),
    )
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
    await devices.forgetFriend(id)
    if (options.block && !isBlocked(id)) {
      setBlocked([...blocked(), { id, handle: view.handle, at: clock.now() }])
      await store.set(KEYS.blocked, blocked())
    }
    // They removed you first: there's nobody to tell.
    if (view.removedYouAt === undefined) {
      const record: FarewellRecord = {
        id,
        ...(view.secret === undefined ? {} : { secret: view.secret }),
        ...(view.moved === true ? { moved: true } : {}),
      }
      farewells = [...farewells.filter((other) => other.id !== id), record]
      await store.set(KEYS.farewells, farewells)
      await sayFarewell(record)
    }
  }

  // Your devices. They meet in a self room named from the self secret, where
  // device logs travel, so an approval or a removal on one reaches the rest.
  let selfSession: PairSession | undefined
  const selfChat = `self:${self}`
  async function startSelfSession() {
    const secret = devices.selfSecret()
    if (selfSession !== undefined || secret === undefined) return
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
      ...twinOptions,
      onEvent: () => undefined,
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
    places.set(session, () => selfRoomsAt(crypto, secret, clock.now()))
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
  /** Tells everyone about a change to your device log, and acts on what it means here. */
  async function ownChanged() {
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
    if (profile().handle !== '') await Promise.all(farewells.map((record) => sayFarewell(record)))
    const stored = await store.get(KEYS.invite)
    if (isHostedInvite(stored)) await host(stored)
  }
  await connect()

  async function disconnect() {
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

  async function cancelLink() {
    await stopLinkHost?.()
    stopLinkHost = undefined
    linkRequest = undefined
    setLinking(undefined)
  }

  async function startLink(): Promise<LinkingState | undefined> {
    // Only the first device puts devices on the list, and not while a recovered
    // one waits for its whole list: a new device couldn't check it.
    if (profile().handle === '' || !devices.isFirst() || isTailLog(devices.own())) return undefined
    await cancelLink()
    const code = inviteCode(deps.random(INVITE_CODE_BYTES))
    const expiresAt = clock.now() + LINK_LIFETIME_MS
    setLinking({
      code,
      link: `${deps.inviteBase}#${encodeDeviceLink(code, selfFingerprint)}`,
      expiresAt,
    })
    stopLinkHost = await hostLink({
      crypto,
      signer,
      transport,
      code,
      handle: profile().handle,
      now: clock.now,
      sleep: clock.sleep,
      speaker: devices.speaker,
      onRequest: (request) => {
        const current = linking()
        if (current?.code !== code) return
        linkRequest = request
        setLinking({
          ...current,
          request: {
            device: request.device,
            check: request.check,
            name: deps.deviceName ?? 'Device',
          },
        })
      },
    })
    void clock.sleep(LINK_LIFETIME_MS).then(() => {
      if (linking()?.code === code && linking()?.request === undefined) void cancelLink()
    })
    return linking()
  }

  /** What a new device needs to be you: who you are, your devices, friends and settings. */
  const bundle = (): Json =>
    ({
      self,
      deviceLog: devices.own(),
      selfSecret: devices.selfSecret() ?? '',
      profile: profile(),
      friends: friendList().map(({ id, handle, addedAt, petname, mutedUntil, secret, moved }) => ({
        id,
        handle,
        addedAt,
        ...(petname === undefined ? {} : { petname }),
        ...(mutedUntil === undefined ? {} : { mutedUntil }),
        ...(secret === undefined ? {} : { secret }),
        ...(moved === true ? { moved } : {}),
      })),
      blocked: blocked(),
      friendDevices: Object.fromEntries(
        friendList()
          .map((view) => [view.id, devices.friendLog(view.id)] as const)
          .filter(([, log]) => log.entries.length > 0),
      ),
    }) as unknown as Json

  /**
   * Your data for a file: friends with their pair secrets, petnames, blocks, chats,
   * friends' device logs, your profile and settings. No keys: a device's never leave it.
   */
  const exportData = (): Json => {
    const { deviceLog: _log, selfSecret: _secret, ...data } = bundle() as Record<string, unknown>
    return {
      kind: EXPORT_KIND,
      v: 1,
      at: clock.now(),
      ...data,
      logs: Object.fromEntries(friendList().map((view) => [view.id, view.log])),
      settings: settings(),
    } as unknown as Json
  }

  /**
   * Merges an export into this device, then the Messenger has to start again. Only a device of
   * the same identity takes one. Chats merge entry by entry, as a catch-up would; friends and
   * blocks this device lacks are added, and where both have one, this device's copy stays. The
   * profile and settings come along only when this device has no name yet.
   */
  async function importData(value: unknown): Promise<ImportResult> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'unreadable'
    const fields = value as Record<string, unknown>
    if (fields['kind'] !== EXPORT_KIND || fields['v'] !== 1) return 'unreadable'
    if (fields['self'] !== self) return 'not-yours'
    const records = fields['friends']
    const blockedList = fields['blocked']
    const profileValue = fields['profile']
    const settingsValue = fields['settings']
    const logs = fields['logs']
    const friendDevices = fields['friendDevices']
    if (!isFriendRecords(records) || !isBlockedRecords(blockedList)) return 'unreadable'
    if (typeof logs !== 'object' || logs === null || Array.isArray(logs)) return 'unreadable'
    // Nothing more changes here before the restart, so a session can't write over the merge.
    await disconnect()
    const deviceLogs =
      typeof friendDevices === 'object' && friendDevices !== null
        ? Object.entries(friendDevices)
        : []
    const ids = new Set(records.map((record) => record.id))
    // Friends' devices first, so entries from all of them count.
    for (const [id, log] of deviceLogs)
      if (ids.has(id) && isDeviceLog(log) && log.identity === id) {
        await devices.loadFriend(id)
        await devices.takeFriend(id, log)
      }
    const have = new Map(friendList().map((view) => [view.id, view]))
    const added = records.filter((record) => !have.has(record.id) && !isBlocked(record.id))
    for (const record of records) {
      if (isBlocked(record.id)) continue
      const room = await pairRoom(crypto, self, record.id)
      const stored = await store.get(KEYS.log(record.id))
      const current =
        have.get(record.id)?.log ??
        (isChatLog(stored) && stored.id === room ? stored : emptyLog(room))
      const incoming = (logs as Record<string, unknown>)[record.id]
      if (!isChatLog(incoming) || incoming.id !== room) {
        if (!have.has(record.id)) await store.set(KEYS.log(record.id), current)
        continue
      }
      await store.set(
        KEYS.log(record.id),
        await mergeEntries(crypto, current, incoming.entries, devices.authors(record.id)),
      )
    }
    const kept = await store.get(KEYS.friends)
    await store.set(KEYS.friends, [...(isFriendRecords(kept) ? kept : []), ...added])
    const blockedHere = new Set(blocked().map((record) => record.id))
    await store.set(KEYS.blocked, [
      ...blocked(),
      ...blockedList.filter((record) => !blockedHere.has(record.id) && !have.has(record.id)),
    ])
    if (profile().handle === '' && isProfile(profileValue)) {
      await store.set(KEYS.profile, profileValue)
      if (isMessengerSettings(settingsValue)) await store.set(KEYS.settings, settingsValue)
    }
    return 'imported'
  }

  /** Puts the device that asked on your list under `name` and hands it everything. */
  async function confirmLink(name: string): Promise<'linked' | 'failed' | 'too-big'> {
    const request = linkRequest
    if (request === undefined) return 'failed'
    if (devices.selfSecret() === undefined) await devices.setSelfSecret(newSecret())
    // The first time, this device gets a name too, so My Devices can tell them apart.
    if (devices.own().entries.length === 0)
      await devices.change('name', signer.id, deps.deviceName ?? 'First device')
    // Everything has to fit one envelope, with room for the add about to be signed; checked
    // first, so a link that can't finish never puts a device on the list.
    if (canonicalBytes(bundle()).length > MAX_MESSAGE_BYTES - 8 * 1024) return 'too-big'
    if (!(await devices.change('add', request.device, name.trim() || 'Device'))) return 'failed'
    try {
      await request.accept(bundle())
    } catch {
      return 'failed'
    }
    linkRequest = undefined
    stopLinkHost = undefined
    setLinking(undefined)
    await startSelfSession()
    await ownChanged()
    return 'linked'
  }

  /** Checks and keeps a bundle from the device that linked this one. False if it doesn't hold. */
  async function takeBundle(value: Json, expected: PeerId): Promise<boolean> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const fields = value as Record<string, unknown>
    const log = fields['deviceLog']
    const identity = fields['self']
    // The identity whose fingerprint was checked, and nobody else's.
    if (identity !== expected || !isDeviceLog(log) || log.identity !== identity) return false
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
    // Nothing of a Pigeon left behind is said as this one.
    await store.set(KEYS.farewells, [])
    for (const [id, friendLog] of logs)
      if (
        isDeviceLog(friendLog) &&
        friendLog.identity === id &&
        (await verifyDeviceLog(crypto, friendLog))
      )
        await store.set(DEVICE_KEYS.friendDevices(id), friendLog)
    await store.set(DEVICE_KEYS.deviceLog, log)
    await store.set(DEVICE_KEYS.selfSecret, secret)
    // Last: with `self` set, this browser is that identity from its next start.
    await store.set(DEVICE_KEYS.self, identity)
    return true
  }

  /**
   * A Pigeon with nobody on it: no friends, and no devices of its own beyond naming itself (as
   * committing a recovery key does). It can be linked to another identity, or recovered onto. A
   * recovered device waiting for its list isn't: wiping it would lose the recovery.
   */
  function emptyHere(): boolean {
    if (friendList().length > 0) return false
    const log = devices.own()
    if (self !== signer.id || (log.epochs?.length ?? 0) > 0) return false
    return log.entries.every((entry) => entry.kind === 'name' && entry.device === signer.id)
  }

  /**
   * Whether leaving tells this Pigeon's friends: only when this is its only
   * device and no copy of it has been heard. A copy that never met its twin can't know.
   */
  const leavingTells = () => !twin() && devices.devices().every((device) => device.here)

  /**
   * Before this Pigeon is forgotten to link it to another: when `leavingTells`,
   * each friend is removed and told, as removing them one by one does, and this waits until
   * every one has heard or `until` resolves. Otherwise the Pigeon lives on elsewhere, so nobody
   * is told. `onProgress` hears how far it has got. Returns how many friends haven't heard yet.
   */
  async function leave(
    until: Promise<void>,
    onProgress?: (progress: LeaveProgress) => void,
  ): Promise<number> {
    if (!leavingTells()) return 0
    const leaving = friendList().map((view) => view.id)
    const total = leaving.length
    const told = () => total - farewells.filter((record) => leaving.includes(record.id)).length
    for (const [index, id] of leaving.entries()) {
      // Closed meanwhile, as when Pigeon moves to another tab: that tab keeps everyone.
      if (closed) return farewells.length
      onProgress?.({ step: 'removing', done: index, total })
      await removeFriend(id, { block: false })
    }
    onProgress?.({ step: 'telling', done: told(), total })
    onFarewellSaid = () => onProgress?.({ step: 'telling', done: told(), total })
    try {
      if (farewells.length > 0)
        await Promise.race([until, new Promise<void>((resolve) => farewellsSaid.push(resolve))])
    } finally {
      onFarewellSaid = undefined
    }
    return farewells.length
  }

  /** Stops everything: no rooms, no sessions, no link or invite hosting. */
  async function close() {
    closed = true
    await cancelLink()
    await disconnect()
    const leaving = selfSession
    selfSession = undefined
    if (leaving !== undefined) {
      forget(leaving)
      await leaving.close()
    }
  }

  /**
   * Brings an identity back onto this empty Pigeon with its recovery key: this
   * device writes its list from now on, every other device is removed, and `next` is the key
   * from now on. Then the Messenger has to start again as that identity, with no friends: they
   * come back by pairing again, or from an export.
   */
  async function recoverIdentity(
    identity: PeerId,
    epoch: number,
    key: Signer,
    next: PeerId,
  ): Promise<RecoverResult> {
    const own = devices.own()
    if (isTailLog(own)) {
      // Waiting for the whole list, the tail is the only copy of this recovery: only the same
      // code again may sign over it, never a later key or another identity.
      if (identity !== self || epoch !== own.from || friendList().length > 0) return 'waiting'
    } else {
      if (identity === self) return 'own'
      if (!emptyHere()) return friendList().length > 0 ? 'has-friends' : 'linked'
    }
    const log = await recoverDeviceLog(
      identity,
      undefined,
      key,
      {
        epoch,
        writer: signer.id,
        keep: [{ device: signer.id, name: deps.deviceName ?? 'Recovered device' }],
        next,
      },
      clock.now(),
    )
    if (log === undefined) return 'refused'
    await close()
    await store.set(DEVICE_KEYS.deviceLog, log)
    await store.set(DEVICE_KEYS.selfSecret, newSecret())
    // Last: with `self` set, this browser is that identity from its next start.
    await store.set(DEVICE_KEYS.self, identity)
    return 'recovered'
  }

  /**
   * Links this device to the identity whose device showed `target`. Only a device with no
   * friends of its own can be linked, since it takes on the other's. Once confirmed, the
   * Messenger has to be started again to be that identity.
   */
  async function joinIdentity(target: Invite, until: Promise<void>): Promise<JoinedIdentity> {
    // This Pigeon's own code or link is never a reason to leave it.
    if (target.code === linking()?.code || target.fingerprint === selfFingerprint)
      return { ok: false, error: 'own' }
    // Waiting for its list, this is the only copy of a recovery: never offered to leave.
    if (isTailLog(devices.own())) return { ok: false, error: 'waiting' }
    if (!emptyHere())
      return { ok: false, error: friendList().length > 0 ? 'has-friends' : 'has-devices' }
    if (target.code === linking()?.code) return { ok: false, error: 'own' }
    const result = await openLink({
      crypto,
      signer,
      transport,
      now: clock.now,
      code: target.code,
      fingerprint: target.fingerprint,
      until,
    })
    if (!result.ok) return result
    const { offer } = result
    if (offer.identity === self) {
      await offer.cancel()
      return { ok: false, error: 'own' }
    }
    return {
      ok: true,
      offer: {
        handle: offer.handle,
        check: offer.check,
        cancel: offer.cancel,
        async confirmed(confirmUntil) {
          const sent = await offer.accepted(confirmUntil)
          if (sent === false) return false
          return takeBundle(sent, offer.identity)
        },
      },
    }
  }

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
    /** A first device with nobody on it: it can be linked to another identity. */
    canJoin: emptyHere,
    /** Recovered, and waiting for an old friend to hand back the whole list. */
    waitingForList: () => isTailLog(devices.own()),
    linking,
    startLink,
    confirmLink,
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
      if (!(await devices.recoverHere(key, keep, next))) return false
      await ownChanged()
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
      if (await devices.change('remove', id)) await ownChanged()
    },
    async renameDevice(id: PeerId, name: string) {
      if (name.trim() !== '' && (await devices.change('name', id, name))) await ownChanged()
    },
    selfFingerprint,
    profile,
    async setProfile(next: Profile) {
      const handle = next.handle.trim().slice(0, MAX_HANDLE_LENGTH)
      const message = next.message.slice(0, MAX_PERSONAL_MESSAGE_LENGTH)
      const named = handle !== profile().handle || message !== profile().message
      // Later than any change this device has seen, even with a clock that's behind.
      const at = named ? Math.max(clock.now(), profileChangedAt + 1) : undefined
      await saveProfile({ ...next, handle, message }, at)
      if (named) selfSession?.announce()
    },
    friends: friendList,
    friend,
    onlineCount: () => friendList().filter((view) => view.online).length,
    invite,
    inviteLink: () => {
      const current = invite()
      return current === undefined
        ? undefined
        : inviteLink(deps.inviteBase, current.code, selfFingerprint)
    },
    inviteCode: () => {
      const current = invite()
      return current === undefined ? undefined : formatInviteCode(current.code)
    },
    newInvite,
    /**
     * Answers someone's invite and waits to hear who they are. Nothing is agreed until the
     * returned offer is confirmed, which adds the friend on both sides.
     */
    async open(
      target: Invite,
      until: Promise<void>,
      onStep?: (step: OpenStep) => void,
    ): Promise<OpenedInvite> {
      if (target.code === invite()?.code || target.fingerprint === selfFingerprint)
        return { ok: false, error: 'own' }
      const result = await openInvite({
        crypto,
        signer,
        transport,
        handle: profile().handle,
        now: clock.now,
        invite: target,
        until,
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
            if (accepted === false) return false
            // The inviter made the secret, so they hold it: meet only in its rooms. An inviter
            // from before pair secrets sends none, and you move later.
            await addFriend({
              id: offer.friend.id,
              handle: offer.friend.handle,
              addedAt: clock.now(),
              ...(accepted.secret === undefined ? {} : { secret: accepted.secret, moved: true }),
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
    isFriend: (id: string) => isPeerId(id) && friend(id) !== undefined,
    /** Calls a friend something of your own; an empty name goes back to theirs. */
    async rename(id: PeerId, petname: string) {
      const view = friend(id)
      if (view === undefined) return
      const trimmed = petname.trim().slice(0, MAX_HANDLE_LENGTH)
      const next = trimmed === '' || trimmed === view.handle ? undefined : trimmed
      setState('friends', id, { petname: next, name: nameOf(view.handle, next) })
      await saveFriends()
    },
    /** Quiets a friend until `until` (a time, or MUTED_FOREVER); undefined unmutes. */
    async mute(id: PeerId, until: number | undefined) {
      if (friend(id) === undefined) return
      setState('friends', id, 'mutedUntil', until)
      await saveFriends()
    },
    muted(id: PeerId): boolean {
      const until = friend(id)?.mutedUntil
      return until !== undefined && (until === MUTED_FOREVER || until > clock.now())
    },
    remove: removeFriend,
    blocked,
    async unblock(id: PeerId) {
      setBlocked(blocked().filter((record) => record.id !== id))
      await store.set(KEYS.blocked, blocked())
    },
    settings,
    /** Turns relay-only connections on or off, and reconnects everything to match. */
    async setRelayOnly(relayOnly: boolean) {
      if (settings().relayOnly === relayOnly) return
      setSettings({ ...settings(), relayOnly })
      await store.set(KEYS.settings, settings())
      await disconnect()
      await connect()
    },
    /** For a closing tab: friends see you go offline at once. */
    goodbye() {
      for (const session of sessions.values()) session.goodbye()
    },
    close,
  }
}
