// The Messenger's state: who you are, your friends, your chats, and a pair session per friend.
// It reads and writes storage, runs core's protocol over the transport, and exposes Solid state
// the windows draw. Everything it touches comes in through platform interfaces.
import {
  type ChatLog,
  type Crypto,
  emptyLog,
  encodeInviteLink,
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
  type OpenResult,
  openInvite,
  type PairEvent,
  type PairSession,
  type PeerId,
  type Presence,
  pairRoom,
  type Signer,
  type Status,
  startPairSession,
  type Transport,
} from '@pigeon/core'
import { batch, createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Store } from '../../../platform/storage/storage.ts'
import { isChatLog, isFriendRecords, isHostedInvite, isProfile } from './stored.ts'

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
}

export interface FriendView extends FriendRecord {
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

export type OpenedInvite = OpenResult | { readonly ok: false; readonly error: 'own' }

export async function createMessenger(deps: MessengerDeps) {
  const { crypto, signer, store, transport, clock } = deps
  const events = deps.events ?? {}

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
      friendList().map(({ id, handle, addedAt }) => ({ id, handle, addedAt })),
    )

  const handlers: {
    [T in PairEvent['type']]: (id: PeerId, event: Extract<PairEvent, { type: T }>) => void
  } = {
    online: (id, event) => {
      const changed = state.friends[id]?.handle !== event.handle
      setState('friends', id, { online: true, handle: event.handle })
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
    if (view === undefined) return
    const room = await transport.join(await pairRoom(crypto, signer.id, id))
    const session = startPairSession({
      crypto,
      signer,
      friend: id,
      room,
      handle: () => profile().handle,
      presence: () => ({ status: profile().status, message: profile().message }),
      log: view.log,
      now: clock.now,
      onEvent: (event) =>
        (handlers[event.type] as (id: PeerId, event: PairEvent) => void)(id, event),
    })
    sessions.set(id, session)
  }

  async function addFriend(record: FriendRecord, log?: ChatLog) {
    const existing = friend(record.id)
    if (existing !== undefined) {
      setState('friends', record.id, 'handle', record.handle)
      return existing
    }
    const room = await pairRoom(crypto, signer.id, record.id)
    setState('friends', record.id, {
      ...record,
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
      onPaired: (paired) => void welcome(paired),
    })
    void clock.sleep(hosted.expiresAt - clock.now()).then(() => {
      if (invite()?.code === hosted.code) void stopInvite()
    })
  }

  async function welcome(paired: NewFriend) {
    stopHosting = undefined
    setInvite(undefined)
    await store.delete(KEYS.invite)
    const view = await addFriend({ ...paired, addedAt: clock.now() })
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
  async function connect() {
    await Promise.all(friendList().map((view) => startSession(view.id)))
    const stored = await store.get(KEYS.invite)
    if (isHostedInvite(stored)) await host(stored)
  }
  await connect()

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
    async open(target: Invite, until: Promise<void>): Promise<OpenedInvite> {
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
      })
      if (!result.ok) return result
      const { offer } = result
      if (offer.friend.id === signer.id) {
        await offer.cancel()
        return { ok: false, error: 'own' }
      }
      return {
        ok: true,
        offer: {
          ...offer,
          async confirm(confirmUntil: Promise<void>) {
            const accepted = await offer.confirm(confirmUntil)
            if (accepted) {
              await addFriend({ ...offer.friend, addedAt: clock.now() })
              await saveFriends()
              await startSession(offer.friend.id)
            }
            return accepted
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
    markRead: (id: PeerId) => {
      if (state.friends[id]?.unread !== 0) setState('friends', id, 'unread', 0)
    },
    isFriend: (id: string) => isPeerId(id) && friend(id) !== undefined,
    /** For a closing tab: friends see you go offline at once. */
    goodbye() {
      for (const session of sessions.values()) session.goodbye()
    },
    async close() {
      await stopHosting?.()
      await Promise.all([...sessions.values()].map((session) => session.close()))
      sessions.clear()
    },
  }
}
