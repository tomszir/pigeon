// Moving between identities: leaving this Pigeon, recovering an identity onto it with its
// recovery key, and linking it to another device's identity. Each is allowed only on a Pigeon
// with nobody on it (`emptyHere`), except leaving, which tells friends first when this is the
// only device. What these need from the Messenger is passed in.
import {
  type Crypto,
  type Invite,
  isOwnCode,
  isTailLog,
  type Json,
  openLink,
  type Pake,
  type PeerId,
  recoverDeviceLog,
  type SealCrypto,
  type Sealer,
  type SealingKey,
  type Signer,
  type Transport,
} from '@pigeon/core'
import type { Accessor } from 'solid-js'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Store } from '../../../platform/storage/storage.ts'
import { DEVICE_KEYS, type Devices } from './devices.ts'
import type {
  FriendView,
  JoinedIdentity,
  LeaveProgress,
  LinkingState,
  RecoverResult,
} from './messenger.ts'
import type { FarewellRecord } from './stored.ts'

/** How leaving hears that farewells are said: it waits for the last, and reports each. */
export interface FarewellWatch {
  /** Calls `onSaid` each time a farewell is said, until called with undefined. */
  readonly hear: (onSaid: (() => void) | undefined) => void
  /** Calls `resolve` once every farewell has been said. */
  readonly wait: (resolve: () => void) => void
}

export interface IdentityMovesDeps {
  readonly crypto: Crypto
  readonly signer: Signer
  readonly store: Store
  readonly clock: Clock
  readonly transport: Transport
  readonly pake: Pake
  /** What to call this device when it's recovered: "Firefox on Linux". */
  readonly deviceName?: string
  /** This device's sealing key and the sealing it does; without them nothing is linked. */
  readonly seal?: { readonly crypto: SealCrypto; readonly sealer: Sealer } | undefined
  readonly ownSealing: SealingKey | undefined
  /** Your identity. */
  readonly self: PeerId
  readonly selfFingerprint: string
  readonly devices: Pick<Devices, 'own' | 'devices'>
  readonly friends: () => readonly FriendView[]
  /** Friends removed here who haven't been told yet. */
  readonly farewells: () => readonly FarewellRecord[]
  readonly farewellWatch: FarewellWatch
  /** This device's key was heard from another run: a copied profile. */
  readonly twin: () => boolean
  readonly closed: () => boolean
  /** The device link this Pigeon is showing, if any. */
  readonly linking: Accessor<LinkingState | undefined>
  readonly newSecret: () => string
  readonly removeFriend: (id: PeerId, options: { block: boolean }) => Promise<void>
  /** Stops the Messenger: no rooms, no sessions, no link or invite hosting. */
  readonly close: () => Promise<void>
  /** Checks and keeps a bundle from the device that linked this one. False if it doesn't hold. */
  readonly takeBundle: (value: Json, expected: PeerId) => Promise<boolean>
}

export interface IdentityMoves {
  /** A Pigeon with nobody on it: it can be linked to another identity, or recovered onto. */
  readonly emptyHere: () => boolean
  /** Whether leaving tells this Pigeon's friends. */
  readonly leavingTells: () => boolean
  readonly leave: (
    until: Promise<void>,
    onProgress?: (progress: LeaveProgress) => void,
  ) => Promise<number>
  readonly recoverIdentity: (
    identity: PeerId,
    epoch: number,
    key: Signer,
    next: PeerId,
  ) => Promise<RecoverResult>
  readonly joinIdentity: (target: Invite, until: Promise<void>) => Promise<JoinedIdentity>
}

export function createIdentityMoves(deps: IdentityMovesDeps): IdentityMoves {
  const {
    crypto,
    signer,
    store,
    clock,
    transport,
    self,
    selfFingerprint,
    devices,
    farewells,
    farewellWatch,
    twin,
    closed,
    linking,
    ownSealing,
    newSecret,
    removeFriend,
    close,
    takeBundle,
  } = deps
  const friendList = deps.friends

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
    const told = () => total - farewells().filter((record) => leaving.includes(record.id)).length
    for (const [index, id] of leaving.entries()) {
      // Closed meanwhile, as when Pigeon moves to another tab: that tab keeps everyone.
      if (closed()) return farewells().length
      onProgress?.({ step: 'removing', done: index, total })
      await removeFriend(id, { block: false })
    }
    onProgress?.({ step: 'telling', done: told(), total })
    farewellWatch.hear(() => onProgress?.({ step: 'telling', done: told(), total }))
    try {
      if (farewells().length > 0)
        await Promise.race([until, new Promise<void>((resolve) => farewellWatch.wait(resolve))])
    } finally {
      farewellWatch.hear(undefined)
    }
    return farewells().length
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
    const secret = newSecret()
    await store.set(DEVICE_KEYS.selfSecretState, { secret, sealed: true })
    await store.set(DEVICE_KEYS.selfSecret, secret)
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
    if (isOwnCode(linking()?.code, target) || target.fingerprint === selfFingerprint)
      return { ok: false, error: 'own' }
    // Waiting for its list, this is the only copy of a recovery: never offered to leave.
    if (isTailLog(devices.own())) return { ok: false, error: 'waiting' }
    if (!emptyHere())
      return { ok: false, error: friendList().length > 0 ? 'has-friends' : 'has-devices' }
    if (deps.seal === undefined || ownSealing === undefined) return { ok: false, error: 'stopped' }
    const result = await openLink({
      crypto,
      seal: deps.seal.crypto,
      sealer: deps.seal.sealer,
      sealing: ownSealing,
      pake: deps.pake,
      signer,
      transport,
      now: clock.now,
      invite: target,
      until,
      sleep: clock.sleep,
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
        fingerprint: offer.fingerprint,
        identityFingerprint: offer.identityFingerprint,
        checked: offer.checked,
        cancel: offer.cancel,
        async confirmed(confirmUntil) {
          const sent = await offer.accepted(confirmUntil)
          if (sent === false) return false
          return takeBundle(sent, offer.identity)
        },
      },
    }
  }

  return { emptyHere, leavingTells, leave, recoverIdentity, joinIdentity }
}
