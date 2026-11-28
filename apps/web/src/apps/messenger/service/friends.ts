// The friends you have as records: saving them, what each is called, muting, the people you've
// blocked and the farewells still owed to friends you removed. The Solid store the friends are
// read from stays with the Messenger and comes in through `friend`, `friends` and `setState`;
// sessions, rooms and secrets stay there too.
import { cleanHandle, isPeerId, MAX_HANDLE_LENGTH, type PeerId } from '@pigeon/core'
import { type Accessor, createSignal } from 'solid-js'
import type { SetStoreFunction } from 'solid-js/store'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Store } from '../../../platform/storage/storage.ts'
import type { FriendView } from './messenger.ts'
import {
  type BlockedRecord,
  type FarewellRecord,
  type FriendRecord,
  KEYS,
  secretFlags,
} from './stored.ts'

/** Stored for "until I unmute". */
export const MUTED_FOREVER = -1

/** The store's own copy is mutable so Solid's path setters type-check; callers see FriendView. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
export interface FriendStore {
  friends: Record<PeerId, Mutable<FriendView>>
}

// Names saved before they were checked, petnames included, are shown cleaned, so none can break
// a line or turn text around; one with nothing left shows as "Friend".
export const nameOf = (handle: string, petname: string | undefined): string =>
  cleanHandle(petname ?? '') || cleanHandle(handle) || 'Friend'

export interface FriendsDeps {
  readonly store: Store
  readonly clock: Clock
  /** Every friend, oldest first. */
  readonly friends: () => readonly FriendView[]
  readonly friend: (id: PeerId) => FriendView | undefined
  /** The friends' reactive store's setter. */
  readonly setState: SetStoreFunction<FriendStore>
  /** The blocked people that were read from storage. */
  readonly initialBlocked: readonly BlockedRecord[]
  /** The farewells that were read from storage. */
  readonly initialFarewells: readonly FarewellRecord[]
}

export interface Friends {
  /** Writes every friend's record. */
  readonly saveFriends: () => Promise<void>
  readonly blocked: Accessor<readonly BlockedRecord[]>
  readonly isBlocked: (id: PeerId) => boolean
  /** Adds someone to the people you've blocked, as they are now called. */
  readonly block: (id: PeerId, handle: string) => Promise<void>
  readonly unblock: (id: PeerId) => Promise<void>
  /** Friends you removed who haven't been told yet. */
  readonly farewells: () => readonly FarewellRecord[]
  /** Owes `record`'s friend a farewell, in place of any earlier one. */
  readonly keepFarewell: (record: FarewellRecord) => Promise<void>
  /** A farewell was heard: nothing more is owed to `id`. */
  readonly dropFarewell: (id: PeerId) => Promise<void>
  readonly onlineCount: () => number
  readonly isFriend: (id: string) => boolean
  readonly rename: (id: PeerId, petname: string) => Promise<void>
  readonly mute: (id: PeerId, until: number | undefined) => Promise<void>
  readonly muted: (id: PeerId) => boolean
}

export function createFriends(deps: FriendsDeps): Friends {
  const { store, clock, friend, setState } = deps
  const friendList = deps.friends

  const saveFriends = () =>
    store.set(
      KEYS.friends,
      friendList().map(
        ({
          id,
          handle,
          addedAt,
          inc,
          petname,
          mutedUntil,
          removedYouAt,
          secret,
          moved,
          sealed,
          replacing,
          prior,
          renew,
          begun,
        }): FriendRecord => ({
          id,
          handle,
          addedAt,
          ...(inc === undefined ? {} : { inc }),
          ...(petname === undefined ? {} : { petname }),
          ...(mutedUntil === undefined ? {} : { mutedUntil }),
          ...(removedYouAt === undefined ? {} : { removedYouAt }),
          ...(secret === undefined ? {} : { secret }),
          ...(moved === true ? { moved } : {}),
          ...secretFlags({ sealed, replacing, prior, renew, begun }),
        }),
      ),
    )
  const [blocked, setBlocked] = createSignal<readonly BlockedRecord[]>(deps.initialBlocked)
  const isBlocked = (id: PeerId) => blocked().some((record) => record.id === id)
  let farewells: readonly FarewellRecord[] = deps.initialFarewells

  return {
    saveFriends,
    blocked,
    isBlocked,
    async block(id: PeerId, handle: string) {
      setBlocked([...blocked(), { id, handle, at: clock.now() }])
      await store.set(KEYS.blocked, blocked())
    },
    async unblock(id: PeerId) {
      setBlocked(blocked().filter((record) => record.id !== id))
      await store.set(KEYS.blocked, blocked())
    },
    farewells: () => farewells,
    async keepFarewell(record: FarewellRecord) {
      farewells = [...farewells.filter((other) => other.id !== record.id), record]
      await store.set(KEYS.farewells, farewells)
    },
    async dropFarewell(id: PeerId) {
      farewells = farewells.filter((other) => other.id !== id)
      await store.set(KEYS.farewells, farewells)
    },
    onlineCount: () => friendList().filter((view) => view.online).length,
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
  }
}
