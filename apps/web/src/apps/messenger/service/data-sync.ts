// Your friends, petnames, mutes, blocks and the relay setting kept in step through your shared log:
// a change made here is written as entries, and what the log shows after entries arrive from your
// other devices is applied here.
//
// - Unfriending writes a tombstone for every friendship with that friend this device holds, so it
//   reaches every device of yours, and each deletes the chat. Nothing undoes a tombstone; only
//   pairing again makes a new friendship.
// - Blocking unfriends, then writes the block. Unblocking writes that it's off.
// - A petname, a mute and the setting take the newest change from any device.
// - A friendship begins with an `add` naming a new incarnation id. A friend from before your
//   devices shared a log has the id derived from theirs.
// - Two live friendships with one friend (two devices paired again at once): once this device
//   sees the friend in the one it holds, the others end.
//
// A friend another device added reaches this one as an entry; its pair secret isn't in the log,
// so it shows here only once this device holds that friend.
import {
  blockOps,
  type Crypto,
  incarnationBefore,
  MAX_HANDLE_LENGTH,
  newIncarnation,
  type PeerId,
  type SharedOp,
  type SharedView,
  settleOps,
  unfriendOps,
} from '@pigeon/core'
import { createSignal } from 'solid-js'
import type { SetStoreFunction } from 'solid-js/store'
import type { Store } from '../../../platform/storage/storage.ts'
import { type FriendStore, nameOf } from './friends.ts'
import type { Elsewhere, FriendView } from './messenger.ts'
import type { SharedLogKeeper } from './shared-log.ts'
import { type BlockedRecord, KEYS } from './stored.ts'

export interface DataSyncDeps {
  readonly crypto: Crypto
  readonly store: Store
  readonly random: (length: number) => Uint8Array
  readonly shared: SharedLogKeeper
  readonly friends: () => readonly FriendView[]
  readonly friend: (id: PeerId) => FriendView | undefined
  readonly setState: SetStoreFunction<FriendStore>
  readonly saveFriends: () => Promise<void>
  /** This device's own blocked list, and changing it here alone. */
  readonly blocked: () => readonly BlockedRecord[]
  readonly block: (id: PeerId, handle: string) => Promise<void>
  readonly unblock: (id: PeerId) => Promise<void>
  /** Renaming and muting here alone, as friends.ts does it. */
  readonly rename: (id: PeerId, petname: string) => Promise<void>
  readonly mute: (id: PeerId, until: number | undefined) => Promise<void>
  /**
   * Removes a friend here: with a farewell to them unless `quiet`, when another device of yours
   * ended the friendship and has said it.
   */
  readonly removeFriend: (id: PeerId, options: { block: boolean; quiet?: boolean }) => Promise<void>
  readonly relayOnly: () => boolean
  readonly setRelayOnly: (relayOnly: boolean) => Promise<void>
}

export async function createDataSync(deps: DataSyncDeps) {
  const { shared, store } = deps
  const storedKept = await store.get(KEYS.keptElsewhere)
  const [kept, setKept] = createSignal<readonly string[]>(
    Array.isArray(storedKept) ? storedKept.filter((inc) => typeof inc === 'string') : [],
  )
  const before = new Map<PeerId, string>()
  /** Friends being removed here, whose own tombstones mustn't remove them a second time. */
  const leaving = new Set<PeerId>()

  /** The incarnation a friend record is in. */
  async function incOf(record: FriendView): Promise<string> {
    if (record.inc !== undefined) return record.inc
    const known = before.get(record.id)
    if (known !== undefined) return known
    const derived = await incarnationBefore(deps.crypto, record.id)
    before.set(record.id, derived)
    return derived
  }

  /** The tombstones for `id`: every friendship held in the log, and the one this record is in. */
  async function endings(record: FriendView, block: boolean): Promise<SharedOp[]> {
    const log = shared.log()
    const context = shared.context()
    const ops = block
      ? blockOps(log, context, record.id, record.handle)
      : unfriendOps(log, context, record.id)
    const inc = await incOf(record)
    const held = ops.some((op) => op.kind === 'tomb' && op.inc === inc)
    return held ? [...ops] : [{ kind: 'tomb', friend: record.id, inc }, ...ops]
  }

  /** Applies what the log shows to this device's friends, blocks and setting. */
  async function apply(view: SharedView) {
    let changed = false
    for (const record of deps.friends()) {
      if (leaving.has(record.id)) continue
      const inc = await incOf(record)
      const blocked = view.blocked.has(record.id) && !view.friendships.has(inc)
      if (view.ended.has(inc) || blocked) {
        await deps.removeFriend(record.id, { block: false, quiet: true })
        continue
      }
      if (view.said.has(`pet:${record.id}`)) {
        const petname = view.petnames.get(record.id)
        if (petname !== record.petname) {
          deps.setState('friends', record.id, { petname, name: nameOf(record.handle, petname) })
          changed = true
        }
      }
      if (view.said.has(`mute:${record.id}`)) {
        const until = view.mutes.get(record.id)
        if (until !== record.mutedUntil) {
          deps.setState('friends', record.id, 'mutedUntil', until)
          changed = true
        }
      }
    }
    if (changed) await deps.saveFriends()
    const here = new Set(deps.blocked().map((record) => record.id))
    for (const [id, { name }] of view.blocked)
      if (!here.has(id)) await deps.block(id, name ?? deps.friend(id)?.handle ?? '')
    for (const id of here)
      if (view.said.has(`block:${id}`) && !view.blocked.has(id)) await deps.unblock(id)
    if (view.said.has('setting:relay') && view.relay !== deps.relayOnly())
      await deps.setRelayOnly(view.relay)
  }

  /**
   * The update: on its first start with your shared log, a device writes what it holds, at the
   * lowest stamps so any change made since on another device wins. An `add` for each friend
   * (marked as from before, with the id derived from theirs), petnames and mutes at stamp 1, a
   * block for each blocked person at stamp 2 so a blocked friend stays hidden, and Always Go
   * Through the Relay when it's on, since a device that had it off said nothing either way.
   */
  async function update(): Promise<boolean> {
    if ((await store.get(KEYS.sharedUpdated)) === true) return false
    const ops: SharedOp[] = []
    const stamps: number[] = []
    const at = (op: SharedOp, stamp: number) => {
      ops.push(op)
      stamps.push(stamp)
    }
    for (const record of deps.friends()) {
      if (record.inc !== undefined) continue
      const name = record.handle.slice(0, MAX_HANDLE_LENGTH)
      at({ kind: 'add', friend: record.id, inc: await incOf(record), name, before: true }, 1)
      if (record.petname !== undefined)
        at({ kind: 'pet', friend: record.id, name: record.petname.slice(0, MAX_HANDLE_LENGTH) }, 1)
      if (record.mutedUntil !== undefined)
        at({ kind: 'mute', friend: record.id, until: record.mutedUntil }, 1)
    }
    for (const { id, handle } of deps.blocked())
      at({ kind: 'block', friend: id, on: true, name: handle.slice(0, MAX_HANDLE_LENGTH) }, 2)
    if (deps.relayOnly()) at({ kind: 'setting', key: 'relay', value: true }, 1)
    await shared.write(ops, stamps)
    await store.set(KEYS.sharedUpdated, true)
    return true
  }

  return {
    apply,
    update,
    /**
     * Friends from before the update on another of your devices that this one never held: one
     * may have been added there, or removed here before your devices kept in step, which no
     * device can tell, so you choose.
     */
    elsewhere(): readonly Elsewhere[] {
      const held = new Set(deps.friends().map((record) => record.id))
      const keep = new Set(kept())
      return [...shared.view().friendships.values()]
        .filter((f) => f.before && !held.has(f.friend) && !keep.has(f.inc))
        .map((f) => ({ id: f.friend, inc: f.inc, name: f.name ?? '' }))
    },
    /** Keeps one on your other devices, or removes it there with a tombstone. */
    async settleElsewhere(inc: string, keep: boolean) {
      const friendship = shared.view().friendships.get(inc)
      if (friendship === undefined) return
      if (!keep) return shared.write([{ kind: 'tomb', friend: friendship.friend, inc }])
      setKept([...kept(), inc])
      await store.set(KEYS.keptElsewhere, kept())
    },
    /** A friendship that begins here: a new incarnation, written to the log. */
    newInc: () => newIncarnation(deps.random),
    /**
     * A friendship began here, in `inc`: written. Having paired is no proof the friend is still in
     * it (another device may pair with them after), so any other friendship ends only once this
     * device sees them in this one.
     */
    async began(id: PeerId, inc: string, name: string) {
      await shared.write([{ kind: 'add', friend: id, inc, name: name.slice(0, MAX_HANDLE_LENGTH) }])
    },
    /** This device saw the friend in the friendship it holds: any other with them ends. */
    async seen(id: PeerId) {
      const record = deps.friend(id)
      if (record === undefined) return
      const ops = settleOps(shared.log(), shared.context(), id, await incOf(record))
      if (ops.length > 0) await shared.write(ops)
    },
    async rename(id: PeerId, petname: string) {
      await deps.rename(id, petname)
      const view = deps.friend(id)
      if (view !== undefined)
        await shared.write([{ kind: 'pet', friend: id, name: view.petname ?? '' }])
    },
    async mute(id: PeerId, until: number | undefined) {
      if (deps.friend(id) === undefined) return
      await deps.mute(id, until)
      await shared.write([{ kind: 'mute', friend: id, until: until ?? null }])
    },
    async unblock(id: PeerId) {
      await deps.unblock(id)
      await shared.write([{ kind: 'block', friend: id, on: false }])
    },
    /** Unfriending, or blocking, on every device of yours: the tombstones, then the farewell. */
    async remove(id: PeerId, options: { block: boolean }) {
      const record = deps.friend(id)
      if (record === undefined) return
      leaving.add(id)
      try {
        await shared.write(await endings(record, options.block))
        await deps.removeFriend(id, options)
      } finally {
        leaving.delete(id)
      }
    },
    async setRelayOnly(relayOnly: boolean) {
      await shared.write([{ kind: 'setting', key: 'relay', value: relayOnly }])
      await deps.setRelayOnly(relayOnly)
    },
  }
}

export type DataSync = ReturnType<typeof createDataSync>
