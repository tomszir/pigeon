// One person on several devices (decision 0024). Each device has its own key; an identity is a
// device log saying which devices are its own. The first device's key starts it and stays the
// identity's PeerId, so a friend's view of you never changes; it is on the list without an entry.
//
// Only the first device writes the log: `add` puts a device on, `remove` takes one off for good,
// `name` names one as My Devices shows it. Entries are numbered and each names the signature of
// the one before, so the log is one chain with one writer and nothing to merge but a longer copy
// of the same chain. A stolen second device can't touch it; the first device removes it, and
// that's final. Letting other devices manage the list, and handing the first device's role to
// another, are for later decisions (docs/roadmap.md).
import { base32Decode, base32Encode } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'

export type DeviceEntryKind = 'add' | 'remove' | 'name'

export const MAX_DEVICE_NAME_LENGTH = 32
/** Plenty for a person, and keeps a log well inside one 64 KB envelope. */
export const MAX_DEVICE_ENTRIES = 100

export interface DeviceEntry {
  readonly seq: number
  /** The signature of the entry before, "" for the first. */
  readonly prev: string
  readonly kind: DeviceEntryKind
  readonly device: PeerId
  /** For `add` and `name`. */
  readonly name?: string
  readonly at: number
  /** The first device's signature. */
  readonly sig: string
}

export interface DeviceLog {
  /** The identity's PeerId: its first device's key, and the only one that signs the log. */
  readonly identity: PeerId
  readonly entries: readonly DeviceEntry[]
}

export interface DeviceInfo {
  readonly id: PeerId
  readonly name: string
  /** When it was added; undefined for the first device. */
  readonly addedAt?: number
}

export interface DeviceState {
  /** On the list and allowed to speak for the identity. */
  readonly active: ReadonlyMap<PeerId, DeviceInfo>
  readonly removed: ReadonlySet<PeerId>
  /** When each removed device was removed. */
  readonly removedAt: ReadonlyMap<PeerId, number>
}

export const FIRST_DEVICE_NAME = 'First device'

export const emptyDeviceLog = (identity: PeerId): DeviceLog => ({ identity, entries: [] })

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const KINDS: ReadonlySet<string> = new Set(['add', 'remove', 'name'])

const isName = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' && value.length <= MAX_DEVICE_NAME_LENGTH
const isCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value)
const isSig = (value: unknown) => typeof value === 'string' && value.length <= 256

function isEntry(value: unknown): value is DeviceEntry {
  if (!isObject(value)) return false
  const { seq, prev, kind, device, name, at, sig } = value
  return (
    isCount(seq) &&
    (seq as number) >= 1 &&
    isSig(prev) &&
    typeof kind === 'string' &&
    KINDS.has(kind) &&
    typeof device === 'string' &&
    isPeerId(device) &&
    (kind === 'remove' ? name === undefined : isName(name)) &&
    isCount(at) &&
    isSig(sig)
  )
}

/** The shape of a device log, as it arrives or is read back. Signatures are checked apart. */
export function isDeviceLog(value: unknown): value is DeviceLog {
  if (!isObject(value)) return false
  const { identity, entries } = value
  return (
    typeof identity === 'string' &&
    isPeerId(identity) &&
    Array.isArray(entries) &&
    entries.length <= MAX_DEVICE_ENTRIES &&
    entries.every(isEntry)
  )
}

type Unsigned = Omit<DeviceEntry, 'sig'>

const entryBytes = (identity: PeerId, entry: Unsigned) =>
  canonicalBytes({
    identity,
    seq: entry.seq,
    prev: entry.prev,
    kind: entry.kind,
    device: entry.device,
    ...(entry.name === undefined ? {} : { name: entry.name }),
    at: entry.at,
  } as Json)

interface Working {
  active: Map<PeerId, DeviceInfo>
  removed: Set<PeerId>
  removedAt: Map<PeerId, number>
}

const startState = (identity: PeerId): Working => ({
  active: new Map([[identity, { id: identity, name: FIRST_DEVICE_NAME }]]),
  removed: new Set(),
  removedAt: new Map(),
})

/** Applies one entry, or says why it can't. Signatures aren't checked here. */
function apply(state: Working, identity: PeerId, entry: Unsigned): string | undefined {
  switch (entry.kind) {
    case 'add':
      if (entry.device === identity || state.active.has(entry.device)) return 'already on the list'
      // A device removed is gone for good: its key can't come back.
      if (state.removed.has(entry.device)) return 'removed for good'
      state.active.set(entry.device, {
        id: entry.device,
        name: entry.name ?? 'Device',
        addedAt: entry.at,
      })
      return undefined
    case 'remove':
      // The first device stays: it's the only one that can change the list.
      if (entry.device === identity || !state.active.has(entry.device)) return 'not removable'
      state.active.delete(entry.device)
      state.removed.add(entry.device)
      state.removedAt.set(entry.device, entry.at)
      return undefined
    case 'name': {
      const info = state.active.get(entry.device)
      if (info === undefined) return 'not on the list'
      state.active.set(entry.device, { ...info, name: entry.name ?? info.name })
      return undefined
    }
  }
}

/** Who is on a log already checked by `verifyDeviceLog`. */
export function deviceState(log: DeviceLog): DeviceState {
  const state = startState(log.identity)
  for (const entry of log.entries) apply(state, log.identity, entry)
  return state
}

/** True when every entry is the first device's, chained and allowed by the ones before it. */
export async function verifyDeviceLog(crypto: Crypto, log: DeviceLog): Promise<boolean> {
  if (!isDeviceLog(log)) return false
  const state = startState(log.identity)
  let prev = ''
  for (const [index, entry] of log.entries.entries()) {
    if (entry.seq !== index + 1 || entry.prev !== prev) return false
    const signature = base32Decode(entry.sig)
    if (!signature.ok) return false
    if (!(await crypto.verify(log.identity, signature.value, entryBytes(log.identity, entry))))
      return false
    if (apply(state, log.identity, entry) !== undefined) return false
    prev = entry.sig
  }
  return true
}

export type AppendError = 'not-allowed' | 'not-first-device' | 'full'

/** Signs and appends an entry. Only the first device can. */
export async function appendDeviceEntry(
  _crypto: Crypto,
  log: DeviceLog,
  signer: Signer,
  change: { readonly kind: DeviceEntryKind; readonly device: PeerId; readonly name?: string },
  at: number,
): Promise<{ ok: true; log: DeviceLog } | { ok: false; error: AppendError }> {
  if (signer.id !== log.identity) return { ok: false, error: 'not-first-device' }
  if (log.entries.length >= MAX_DEVICE_ENTRIES) return { ok: false, error: 'full' }
  const unsigned: Unsigned = {
    seq: log.entries.length + 1,
    prev: log.entries.at(-1)?.sig ?? '',
    kind: change.kind,
    device: change.device,
    ...(change.name === undefined
      ? {}
      : { name: change.name.trim().slice(0, MAX_DEVICE_NAME_LENGTH) }),
    at,
  }
  const state = startState(log.identity)
  for (const entry of log.entries) apply(state, log.identity, entry)
  if (apply(state, log.identity, unsigned) !== undefined) return { ok: false, error: 'not-allowed' }
  const sig = base32Encode(await signer.sign(entryBytes(log.identity, unsigned)))
  return {
    ok: true,
    log: { identity: log.identity, entries: [...log.entries, { ...unsigned, sig }] },
  }
}

/**
 * Ours (already trusted) or theirs, whichever is further along the same chain. With one writer
 * there's nothing else to settle: a copy that disagrees with ours on an entry they both have
 * could only come from the first device's key signing twice, and ours is kept.
 */
export async function mergeDeviceLogs(
  crypto: Crypto,
  ours: DeviceLog,
  theirs: DeviceLog,
): Promise<DeviceLog> {
  if (theirs.identity !== ours.identity || theirs.entries.length <= ours.entries.length) return ours
  const agrees = ours.entries.every((entry, index) => entry.sig === theirs.entries[index]?.sig)
  if (!agrees || !(await verifyDeviceLog(crypto, theirs))) return ours
  return theirs
}

/** Every device that has ever been on the list, removed ones too: whose old messages are whose. */
export function everDevices(log: DeviceLog): ReadonlySet<PeerId> {
  const state = deviceState(log)
  return new Set([...state.active.keys(), ...state.removed])
}

/**
 * The identity a device speaks for: itself when it says nothing (a first device, or a Pigeon
 * from before devices), else `identity` when the log it sent verifies and has it on the list.
 * Undefined when the claim doesn't hold.
 */
export async function speakerIdentity(
  crypto: Crypto,
  device: PeerId,
  speaker: { readonly identity?: PeerId; readonly devices?: DeviceLog },
): Promise<PeerId | undefined> {
  if (speaker.identity === undefined) return device
  const log = speaker.devices
  if (log === undefined || log.identity !== speaker.identity) return undefined
  if (!(await verifyDeviceLog(crypto, log))) return undefined
  return deviceState(log).active.has(device) ? speaker.identity : undefined
}
