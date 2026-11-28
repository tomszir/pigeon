// Your friends, petnames, mutes, blocks and the relay setting kept in step through your shared log:
// a change made here is written as entries, and what the log shows after entries arrive from your
// other devices is applied here.
//
// - Unfriending writes a tombstone for every friendship with that friend this device holds, so it
//   reaches every device of yours, and each deletes the chat. Nothing undoes a tombstone; only
//   pairing again makes a new friendship.
// - Blocking unfriends, then writes the block. Unblocking writes that it's off.
// - A petname, a mute and the setting take the newest change from any device.
// - A friendship begins with an `add` naming a new incarnation id.
// - Two live friendships with one friend (two devices paired again at once): once this device
//   sees the friend in the one it holds, the others end.
//
// A friend another device added reaches this one as an entry; its pair secret isn't in the log,
// so it shows here only once this device holds that friend.
import {
  blockOps,
  MAX_HANDLE_LENGTH,
  newIncarnation,
  type PeerId,
  type SharedOp,
  type SharedView,
  settleOps,
  unfriendOps,
} from '@pigeon/core'
import type { SetStoreFunction } from 'solid-js/store'
import { type FriendStore, nameOf } from './friends.ts'
import type { FriendView } from './messenger.ts'
import type { SharedLogKeeper } from './shared-log.ts'
import type { BlockedRecord } from './stored.ts'

export interface DataSyncDeps {
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

export function createDataSync(deps: DataSyncDeps) {
  const { shared } = deps
  /** Friends being removed here, whose own tombstones mustn't remove them a second time. */
  const leaving = new Set<PeerId>()

  /** The tombstones for `id`: every friendship held in the log, and the one this record is in. */
  async function endings(record: FriendView, block: boolean): Promise<SharedOp[]> {
    const log = shared.log()
    const context = shared.context()
    const ops = block
      ? blockOps(log, context, record.id, record.handle)
      : unfriendOps(log, context, record.id)
    const { inc } = record
    const held = inc === undefined || ops.some((op) => op.kind === 'tomb' && op.inc === inc)
    return held ? [...ops] : [{ kind: 'tomb', friend: record.id, inc }, ...ops]
  }

  /** Applies what the log shows to this device's friends, blocks and setting. */
  async function apply(view: SharedView) {
    let changed = false
    for (const record of deps.friends()) {
      if (leaving.has(record.id)) continue
      const { inc } = record
      const live = inc !== undefined && view.friendships.has(inc)
      const blocked = view.blocked.has(record.id) && !live
      if ((inc !== undefined && view.ended.has(inc)) || blocked) {
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

  return {
    apply,
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
      const inc = deps.friend(id)?.inc
      if (inc === undefined) return
      const ops = settleOps(shared.log(), shared.context(), id, inc)
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
