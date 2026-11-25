// Your devices and your friends': which identity this device speaks for, its
// device log, and each friend's. Only your first device changes your log. The Messenger asks it who a device is and whose chat entries
// count, and hands it every device log that arrives. Logs are checked and merged here, so the
// rest of the Messenger only sees ones that verify.
import {
  appendDeviceEntry,
  type Crypto,
  type DeviceEntryKind,
  type DeviceInfo,
  type DeviceLog,
  deviceState,
  emptyDeviceLog,
  everDevices,
  FIRST_DEVICE_NAME,
  fingerprint,
  formatFingerprint,
  isDeviceLog,
  isTailLog,
  type KeptDevice,
  type LogEntry,
  mergeDeviceLogs,
  type PeerId,
  recoverDeviceLog,
  type Signer,
  setRecoveryKey,
  verifyDeviceLog,
  verifyOwnTail,
} from '@pigeon/core'
import { createSignal } from 'solid-js'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Store } from '../../../platform/storage/storage.ts'

export const DEVICE_KEYS = {
  /** The identity this device speaks for; absent on a first device, which is its own. */
  self: 'self',
  deviceLog: 'deviceLog',
  /** Where your devices meet, shared with each device when it's linked. */
  selfSecret: 'selfSecret',
  friendDevices: (id: PeerId) => `devices:${id}`,
} as const

/** This device, as far as its own identity goes. */
export type DeviceStatus = 'active' | 'removed'

export interface DeviceView extends DeviceInfo {
  readonly here: boolean
  /** The first device: the identity's own key, where this Pigeon began. */
  readonly first: boolean
  /** The device that writes your list: the first device, or the one a recovery made it. */
  readonly writer: boolean
  /** The device's own key, as "3f9a 21c0", to tell devices apart; "" until it's worked out. */
  readonly fingerprint: string
}

/** A device fingerprint is the first half of a friend's: enough to tell your few devices apart. */
export const DEVICE_FINGERPRINT_LENGTH = 8

export interface DevicesDeps {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly store: Store
  readonly clock: Clock
}

export async function loadDevices(deps: DevicesDeps) {
  const { crypto, signer, store, clock } = deps
  const storedSelf = await store.get(DEVICE_KEYS.self)
  const self: PeerId = typeof storedSelf === 'string' ? storedSelf : signer.id
  const storedLog = await store.get(DEVICE_KEYS.deviceLog)
  // A device brought back by its recovery key holds a tail until a friend sends the whole log;
  // it's checked from the key the tail names, which this device signed with.
  const holds = (log: DeviceLog) =>
    isTailLog(log) ? verifyOwnTail(crypto, log) : verifyDeviceLog(crypto, log)
  const own0 =
    isDeviceLog(storedLog) && storedLog.identity === self && (await holds(storedLog))
      ? storedLog
      : emptyDeviceLog(self)
  const [own, setOwnSignal] = createSignal<DeviceLog>(own0)
  const storedSecret = await store.get(DEVICE_KEYS.selfSecret)
  let selfSecret = typeof storedSecret === 'string' ? storedSecret : undefined

  const friendLogs = new Map<PeerId, DeviceLog>()
  const [friendLogsVersion, bump] = createSignal(0)

  // Fingerprints are hashed once per device, then shown from here.
  const prints = new Map<PeerId, string>()
  const [printsVersion, bumpPrints] = createSignal(0)
  const printOf = (id: PeerId) => {
    printsVersion()
    const known = prints.get(id)
    if (known !== undefined) return known
    prints.set(id, '')
    void fingerprint(crypto, id).then((print) => {
      prints.set(id, formatFingerprint(print.slice(0, DEVICE_FINGERPRINT_LENGTH)))
      bumpPrints((n) => n + 1)
    })
    return ''
  }

  const ownState = () => deviceState(own())
  const status = (): DeviceStatus => (ownState().active.has(signer.id) ? 'active' : 'removed')

  async function setOwn(next: DeviceLog) {
    setOwnSignal(next)
    await store.set(DEVICE_KEYS.deviceLog, next)
  }

  const friendLog = (id: PeerId) => {
    friendLogsVersion()
    return friendLogs.get(id) ?? emptyDeviceLog(id)
  }

  return {
    self,
    device: signer.id,
    own,
    status,
    /**
     * This device writes your list, the only one that links and removes devices: the first
     * device, or the one your recovery key made the writer.
     */
    isFirst: () => ownState().writer === signer.id,
    /** The recovery key that can start the next epoch, if you've made one. */
    recoveryKey: () => ownState().recoveryKey,
    /** The epoch your list is in: 0 until a recovery. */
    epoch: () => ownState().epoch,
    /** Commits your list to a recovery key's public half. Only the first device, once. */
    async commitRecoveryKey(key: PeerId): Promise<boolean> {
      const committed = await setRecoveryKey(own(), signer, key, clock.now())
      if (committed === undefined) return false
      // A Pigeon from before recovery keys takes a log only when it has more entries, and then
      // keeps it whole: renaming this device to its own name gives it one, so friends who haven't
      // updated still keep the commitment for when they do.
      const name = ownState().active.get(signer.id)?.name ?? FIRST_DEVICE_NAME
      const named = await appendDeviceEntry(
        crypto,
        committed,
        signer,
        { kind: 'name', device: signer.id, name },
        clock.now(),
      )
      await setOwn(named.ok ? named.log : committed)
      return true
    },
    /**
     * Signs a recover with the recovery key onto this device, which already speaks for you,
     * keeping `keep`. False when the key isn't your current one.
     */
    async recoverHere(key: Signer, keep: readonly KeptDevice[], next: PeerId): Promise<boolean> {
      const state = ownState()
      if (isTailLog(own()) || state.recoveryKey !== key.id) return false
      const log = await recoverDeviceLog(
        self,
        own(),
        key,
        { epoch: state.epoch + 1, writer: signer.id, keep, next },
        clock.now(),
      )
      if (log === undefined) return false
      await setOwn(log)
      return true
    },
    selfSecret: () => selfSecret,
    async setSelfSecret(secret: string) {
      selfSecret = secret
      await store.set(DEVICE_KEYS.selfSecret, secret)
    },
    /** Who this device speaks for, for invites and links, when it isn't the first device. */
    speaker: () => (self === signer.id ? undefined : { identity: self, devices: own() }),
    /** Your devices other than this one, active ones only. */
    isOwnOther: (device: PeerId) => device !== signer.id && ownState().active.has(device),
    /** Every device ever yours: whose chat entries are yours, removed devices' too. */
    isMine: (author: PeerId) => author === signer.id || everDevices(own()).has(author),
    devices(): readonly DeviceView[] {
      return [...ownState().active.values()].map((info) => ({
        ...info,
        here: info.id === signer.id,
        first: info.id === self,
        writer: info.id === ownState().writer,
        fingerprint: printOf(info.id),
      }))
    },
    /** Signs a change to your device log. Only the first device can; false otherwise. */
    async change(kind: DeviceEntryKind, device: PeerId, name?: string): Promise<boolean> {
      const result = await appendDeviceEntry(
        crypto,
        own(),
        signer,
        { kind, device, ...(name === undefined ? {} : { name }) },
        clock.now(),
      )
      if (!result.ok) return false
      await setOwn(result.log)
      return true
    },
    /** Takes in your device log from another of your devices. True when it changed. */
    async takeOwn(log: DeviceLog): Promise<boolean> {
      const before = own()
      const merged = await mergeDeviceLogs(crypto, before, log)
      if (merged === before) return false
      await setOwn(merged)
      return true
    },
    /** Loads a friend's stored device log. */
    async loadFriend(id: PeerId) {
      if (friendLogs.has(id)) return
      const stored = await store.get(DEVICE_KEYS.friendDevices(id))
      if (isDeviceLog(stored) && stored.identity === id && (await verifyDeviceLog(crypto, stored)))
        friendLogs.set(id, stored)
      bump((n) => n + 1)
    },
    /** Takes in a friend's device log. True when it changed. */
    async takeFriend(id: PeerId, log: DeviceLog): Promise<boolean> {
      const before = friendLog(id)
      const merged = await mergeDeviceLogs(crypto, before, log)
      if (merged === before) return false
      friendLogs.set(id, merged)
      bump((n) => n + 1)
      await store.set(DEVICE_KEYS.friendDevices(id), merged)
      return true
    },
    friendLog,
    /** How many devices a friend has on their list now. */
    friendDeviceCount: (id: PeerId) => deviceState(friendLog(id)).active.size,
    /** The friend's device, one of your own others, or nobody. */
    classify(friend: PeerId, device: PeerId): 'friend' | 'self' | undefined {
      if (deviceState(friendLog(friend)).active.has(device)) return 'friend'
      if (device !== signer.id && ownState().active.has(device)) return 'self'
      return undefined
    },
    /**
     * Whose chat entries count with this friend: both sides' active devices, and a removed
     * device's from before it was removed, so history caught up later has no gaps.
     */
    authors(friend: PeerId): (entry: LogEntry) => boolean {
      const theirs = deviceState(friendLog(friend))
      const mine = ownState()
      return (entry) => {
        const { author } = entry
        if (author === signer.id || theirs.active.has(author) || mine.active.has(author))
          return true
        // A message's time is its writer's word, so a removed device can backdate.
        const removed = theirs.removedAt.get(author) ?? mine.removedAt.get(author)
        return removed !== undefined && entry.at <= removed
      }
    },
    forgetFriend(id: PeerId) {
      friendLogs.delete(id)
      bump((n) => n + 1)
      return store.delete(DEVICE_KEYS.friendDevices(id))
    },
  }
}

export type Devices = Awaited<ReturnType<typeof loadDevices>>
