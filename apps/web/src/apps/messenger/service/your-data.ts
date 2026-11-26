// Your data in and out: the bundle a new device is given (what makes it you), the export file
// people keep, and merging such a file back in. An export holds no keys; an import is a file handed
// over by someone, so it is read with the same checks stored data gets and only what Pigeon
// knows is kept.
import {
  type Crypto,
  emptyLog,
  isDeviceLog,
  type Json,
  lowSDeviceLog,
  lowSEntry,
  mergeEntries,
  type PeerId,
  pairRoom,
} from '@pigeon/core'
import { unwrap } from 'solid-js/store'
import type { Store } from '../../../platform/storage/storage.ts'
import type { Devices } from './devices.ts'
import type { FriendView, ImportResult } from './messenger.ts'
import {
  type BlockedRecord,
  importedBlocked,
  importedFriends,
  importedProfile,
  importedSettings,
  isChatLog,
  KEYS,
  type MessengerSettings,
  type Profile,
  plainRound,
  secretFlags,
  splitFriendRecords,
} from './stored.ts'

/** What an export file says it is. */
export const EXPORT_KIND = 'pigeon-export'

export interface YourDataDeps {
  readonly crypto: Crypto
  readonly store: Store
  readonly now: () => number
  /** Your identity. */
  readonly self: PeerId
  /** Your device log and secret, and what is known of friends' devices. */
  readonly devices: Pick<
    Devices,
    'own' | 'selfSecret' | 'selfSecretState' | 'friendLog' | 'loadFriend' | 'takeFriend' | 'authors'
  >
  readonly profile: () => Profile
  readonly settings: () => MessengerSettings
  readonly friends: () => readonly FriendView[]
  readonly blocked: () => readonly BlockedRecord[]
  readonly isBlocked: (id: PeerId) => boolean
  /** Stops every session and room, so nothing writes over an import being merged. */
  readonly disconnect: () => Promise<void>
}

export interface YourData {
  /** What a new device needs to be you: who you are, your devices, friends and settings. */
  readonly bundle: () => Json
  readonly exportData: () => Json
  readonly importData: (value: unknown) => Promise<ImportResult>
}

export function createYourData(deps: YourDataDeps): YourData {
  const { crypto, store, now, self, devices, profile, settings, blocked, isBlocked, disconnect } =
    deps
  const friendList = deps.friends

  /** The self secret's replacement under way and the round before, for a bundle: plain copies. */
  const selfReplacingField = () => {
    const kept = devices.selfSecretState()
    const replacing = kept?.replacing
    if (replacing === undefined) return {}
    return {
      selfReplacing: plainRound(replacing),
      ...(kept?.prior === undefined ? {} : { selfPrior: plainRound(kept.prior) }),
    }
  }

  /** What a new device needs to be you: who you are, your devices, friends and settings. */
  const bundle = (): Json =>
    ({
      self,
      deviceLog: devices.own(),
      selfSecret: devices.selfSecret() ?? '',
      // Whether it's from before, so the new device replaces it too if this one can't yet.
      selfSealed: devices.selfSecretState()?.sealed === true,
      // A replacement of the self secret still under way goes along, so the new device still
      // hears the old secret's mail and settles with the rest.
      ...selfReplacingField(),
      profile: profile(),
      friends: friendList().map(
        ({
          id,
          handle,
          addedAt,
          petname,
          mutedUntil,
          secret,
          moved,
          sealed,
          replacing,
          prior,
          renew,
          begun,
        }) => ({
          id,
          handle,
          addedAt,
          ...(petname === undefined ? {} : { petname }),
          ...(mutedUntil === undefined ? {} : { mutedUntil }),
          ...(secret === undefined ? {} : { secret }),
          ...(moved === true ? { moved } : {}),
          ...secretFlags({ sealed, replacing, prior, renew, begun }),
        }),
      ),
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
    const {
      deviceLog: _log,
      selfSecret: _secret,
      selfReplacing: _replacing,
      selfPrior: _prior,
      selfSealed: _sealed,
      ...data
    } = bundle() as Record<string, unknown>
    return {
      kind: EXPORT_KIND,
      v: 1,
      at: now(),
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
    const records = importedFriends(fields['friends'])
    const blockedList = importedBlocked(fields['blocked'])
    const profileValue = importedProfile(fields['profile'])
    const settingsValue = importedSettings(fields['settings'])
    const logs = fields['logs']
    const friendDevices = fields['friendDevices']
    if (records === undefined || blockedList === undefined) return 'unreadable'
    if (typeof logs !== 'object' || logs === null || Array.isArray(logs)) return 'unreadable'
    // Nothing more changes here before the restart, so a session can't write over the merge.
    await disconnect()
    const deviceLogs =
      typeof friendDevices === 'object' && friendDevices !== null
        ? Object.entries(friendDevices)
        : []
    const ids = new Set(records.map((record) => record.id))
    // Friends' devices first, so entries from all of them count.
    // An export is your own data, so what it keeps is read as kept data is: any signature
    // spelled high-S before Pigeon took only low-S comes in low-S.
    for (const [id, log] of deviceLogs)
      if (ids.has(id) && isDeviceLog(log) && log.identity === id) {
        await devices.loadFriend(id)
        await devices.takeFriend(id, lowSDeviceLog(log))
      }
    const have = new Map(friendList().map((view) => [view.id, view]))
    // A pair secret from a file may be known to whoever else had the file, or to a device it
    // came from that has since been removed, as after a recovery: each is replaced.
    const added = records
      .filter((record) => !have.has(record.id) && !isBlocked(record.id))
      .map((record) => (record.secret === undefined ? record : { ...record, renew: true }))
    for (const record of records) {
      if (isBlocked(record.id)) continue
      const room = await pairRoom(crypto, self, record.id)
      const stored = await store.get(KEYS.log(record.id))
      // The chat as the Messenger shows it lives in a reactive store: unwrapped, so it can be kept.
      const shown = have.get(record.id)?.log
      const current =
        (shown === undefined ? undefined : unwrap(shown)) ??
        (isChatLog(stored) && stored.id === room ? stored : emptyLog(room))
      const incoming = (logs as Record<string, unknown>)[record.id]
      if (!isChatLog(incoming) || incoming.id !== room) {
        if (!have.has(record.id)) await store.set(KEYS.log(record.id), current)
        continue
      }
      await store.set(
        KEYS.log(record.id),
        await mergeEntries(
          crypto,
          current,
          incoming.entries.map(lowSEntry),
          devices.authors(record.id),
        ),
      )
    }
    // Records that couldn't be read were set aside when this started; only the readable ones are
    // kept here.
    const kept = splitFriendRecords(await store.get(KEYS.friends)).readable
    await store.set(KEYS.friends, [...kept, ...added])
    const blockedHere = new Set(blocked().map((record) => record.id))
    await store.set(KEYS.blocked, [
      ...blocked(),
      ...blockedList.filter((record) => !blockedHere.has(record.id) && !have.has(record.id)),
    ])
    if (profile().handle === '' && profileValue !== undefined) {
      await store.set(KEYS.profile, profileValue)
      if (settingsValue !== undefined) await store.set(KEYS.settings, settingsValue)
    }
    return 'imported'
  }

  return { bundle, exportData, importData }
}
