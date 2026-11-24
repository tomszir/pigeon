// The Messenger's state: who you are, your friends, your chats, and a pair session per friend.
// It reads and writes storage, runs core's protocol over the transport, and exposes Solid state
// the windows draw. Everything it touches comes in through platform interfaces. Friends meet in
// rooms named from their pair secret, renamed each UTC day; friends from before the secret move
// there the next time they meet (decision 0026).
import {
  avatarFor,
  type ChatLog,
  type Crypto,
  emptyLog,
  encodeInviteLink,
  encodePairSecret,
  fingerprint,
  formatInviteCode,
  hostInvite,
  INVITE_CODE_BYTES,
  INVITE_LIFETIME_MS,
  type Invite,
  inviteCode,
  isPeerId,
  type LogEntry,
  MAX_HANDLE_LENGTH,
  MAX_PERSONAL_MESSAGE_LENGTH,
  type NewFriend,
  type Offer,
  type OpenResult,
  type OpenStep,
  openInvite,
  PAIR_SECRET_BYTES,
  type PairEvent,
  type PairPlace,
  type PairSession,
  type PeerId,
  type Presence,
  pairRoom,
  pairRoomsAt,
  type RoomName,
  type Signer,
  type Status,
  startPairSession,
  type Transport,
  untilPairDaysChange,
} from '@pigeon/core'
import { batch, createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Store } from '../../../platform/storage/storage.ts'
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
  /** The pair secret your rooms are named from (decision 0026); none for friends not yet moved. */
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
  log: (id: PeerId) => `log:${id}`,
} as const

const DEFAULT_PROFILE: Profile = { handle: '', status: 'online', message: '' }

export const inviteLink = (base: string, code: string, fingerprint: string): string =>
  `${base}#${encodeInviteLink(code, fingerprint)}`

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

  const storedProfile = await store.get(KEYS.profile)
  const [profile, setProfileSignal] = createSignal<Profile>(
    isProfile(storedProfile) ? storedProfile : DEFAULT_PROFILE,
  )
  const selfFingerprint = await fingerprint(crypto, signer.id)

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
  // Before 0026 a farewell was just an id.
  let farewells: readonly FarewellRecord[] = isFarewells(storedFarewells)
    ? storedFarewells.map((entry) => (typeof entry === 'string' ? { id: entry } : entry))
    : []
  const farewellSessions = new Map<PeerId, PairSession>()

  // Where each friend is met (decision 0026): the old room from both ids until you've moved,
  // the secret's rooms once you have one. The old room's name is also the chat's id.
  const legacyRoom = (id: PeerId) => pairRoom(crypto, signer.id, id)
  const places = new Map<PairSession, () => Promise<PairPlace>>()
  const syncing = new Map<PairSession, Promise<void>>()
  /** Joins the rooms `session` should be in now and leaves the rest, one change at a time. */
  function syncRooms(session: PairSession): Promise<void> {
    const place = places.get(session)
    if (place === undefined) return Promise.resolve()
    const next = (syncing.get(session) ?? Promise.resolve()).then(async () => {
      const wanted = await pairRoomsAt(crypto, await place(), clock.now())
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
      })
      note(id, 'online')
      if (changed) void saveFriends()
      const view = friend(id)
      if (view !== undefined) events.onOnline?.(view)
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
      // In the old room, the lower id gives the secret (decision 0026).
      if (signer.id > id) return
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
      const arrived = event.log.entries.filter(
        (entry) => entry.author === id && !seen.has(entry.sig),
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

  async function startSession(id: PeerId) {
    if (sessions.has(id) || profile().handle === '') return
    const view = friend(id)
    if (view === undefined || view.removedYouAt !== undefined) return
    const session = startPairSession({
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
    places.set(session, async () => {
      const current = state.friends[id]
      return {
        legacy: view.log.id as `pair:${string}`,
        secret: current?.secret,
        moved: current?.moved,
      }
    })
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
    const room = await pairRoom(crypto, signer.id, record.id)
    setState('friends', record.id, {
      ...record,
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
    // knows both ids (decision 0026). An invitee whose tab predates 0026 ignored the secret and
    // will need to pair again.
    const view = await addFriend({ ...paired, addedAt: clock.now(), secret, moved: true })
    await saveFriends()
    await startSession(paired.id)
    events.onPaired?.(view)
  }

  async function newInvite(): Promise<HostedInvite | undefined> {
    if (profile().handle === '') return undefined
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
    const room = await pairRoom(crypto, signer.id, record.id)
    const log = await store.get(KEYS.log(record.id))
    await addFriend(record, isChatLog(log) && log.id === room ? log : emptyLog(room))
  }
  // Telling a removed friend: a session of its own that says unfriend once they're there.
  async function sayFarewell(record: FarewellRecord) {
    const { id } = record
    if (farewellSessions.has(id)) return
    const legacy = await legacyRoom(id)
    const session: PairSession = startPairSession({
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
          farewells = farewells.filter((other) => other.id !== id)
          await store.set(KEYS.farewells, farewells)
          farewellSessions.delete(id)
          forget(session)
          await session.close()
        })
      },
    })
    farewellSessions.set(id, session)
    places.set(session, async () => ({ legacy, secret: record.secret, moved: record.moved }))
    await syncRooms(session)
  }

  async function removeFriend(id: PeerId, options: { block: boolean }) {
    const view = friend(id)
    if (view === undefined) return
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

  async function connect() {
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

  // Rooms are renamed each UTC day, with both joined around midnight.
  let closed = false
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
    self: signer.id,
    selfFingerprint,
    profile,
    async setProfile(next: Profile) {
      const handle = next.handle.trim().slice(0, MAX_HANDLE_LENGTH)
      const message = next.message.slice(0, MAX_PERSONAL_MESSAGE_LENGTH)
      const first = profile().handle === '' && handle !== ''
      const renamed = profile().handle !== handle
      setProfileSignal({ ...next, handle, message })
      await store.set(KEYS.profile, profile())
      if (first) await connect()
      else for (const session of sessions.values()) session.announce()
      // The code's host answers with the name it was started with.
      const current = invite()
      if (renamed && !first && current !== undefined) await host(current)
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
        ...(onStep === undefined ? {} : { onStep }),
      })
      if (!result.ok) return result
      const { offer } = result
      if (offer.friend.id === signer.id) {
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
            // from before 0026 sends none, and you move later.
            await addFriend({
              ...offer.friend,
              addedAt: clock.now(),
              ...(accepted.secret === undefined ? {} : { secret: accepted.secret, moved: true }),
            })
            await saveFriends()
            await startSession(offer.friend.id)
            return true
          },
        },
      }
    },
    async send(id: PeerId, text: string) {
      const trimmed = text.trim()
      if (trimmed === '') return
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
    async close() {
      closed = true
      await disconnect()
    },
  }
}
