// One person on several devices. Each device has its own key; an identity is a
// device log saying which devices are its own. The first device's key starts it and stays the
// identity's PeerId, so a friend's view of you never changes; it is on the list without an entry.
//
// One device writes the log at a time: `add` puts a device on, `remove` takes one off for good,
// `name` names one as My Devices shows it. Entries are numbered and each names the signature of
// the one before, so each epoch's log is one chain with one writer. The first device writes
// epoch 0.
//
// A recovery key outranks every device. The first device commits to
// one in `recovery`; a `recover` signed by the current key starts a new epoch, naming the device
// that writes it, the devices it keeps, and the next key. Every other device is removed. Epochs
// sit beside epoch 0's entries, in `epochs`, so a Pigeon from before them still reads epoch 0 and
// ignores the rest.
//
// Each epoch stands on its own: its recover's signature and its own chain decide whether it
// holds, and who is on the list comes from the latest epoch alone. An older epoch's entries only
// say who was once yours and until when, so a stolen device writing more of them, after it was
// recovered away, can neither change the list nor break a log that holds. A later epoch beats an
// earlier one, and two recovers for the same epoch settle on the lower signature.
//
// A device brought back by its recovery key knows only its own epoch: its log is a tail, with
// `from` set, `by` the key it trusts its first recover to, and nothing before. Only a Pigeon that
// already has your earlier epochs takes a tail, and the tail's owner takes a whole log only if it
// runs through the key in `by`.
import { base32DecodeExact, base32Encode } from '../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../encoding/canonical.ts'
import type { Crypto, Signer } from '../identity/crypto.ts'
import { isPeerId, type PeerId } from '../identity/identity.ts'

export type DeviceEntryKind = 'add' | 'remove' | 'name'

export const MAX_DEVICE_NAME_LENGTH = 32
/**
 * Entries a log holds across all its epochs, so it stays well inside one 64 KB envelope. When
 * there are more, the oldest epochs' last entries go first: the current epoch is never cut.
 */
export const MAX_DEVICE_ENTRIES = 100
/** Recoveries a log holds: each is a lost set of devices, so a handful is a lifetime. */
export const MAX_EPOCHS = 8
/** Devices a `recover` keeps on the list. */
export const MAX_KEPT_DEVICES = 8

export interface DeviceEntry {
  readonly seq: number
  /** The signature of the entry before, "" for the first in its epoch. */
  readonly prev: string
  readonly kind: DeviceEntryKind
  readonly device: PeerId
  /** For `add` and `name`. */
  readonly name?: string
  readonly at: number
  /** The writer's signature: the first device's in epoch 0, the epoch's writer's after. */
  readonly sig: string
}

/** The recovery key's public half, signed by the first device. */
export interface RecoveryKey {
  readonly key: PeerId
  readonly at: number
  readonly sig: string
}

export interface KeptDevice {
  readonly device: PeerId
  readonly name: string
}

/** Starts an epoch: signed by the recovery key current at the epoch before. */
export interface RecoverEntry {
  readonly epoch: number
  /** The device that writes this epoch's entries. It is kept too. */
  readonly writer: PeerId
  /** The devices on the list from now on, the writer among them, with their names. */
  readonly keep: readonly KeptDevice[]
  /** The recovery key from now on. */
  readonly next: PeerId
  readonly at: number
  readonly sig: string
}

export interface Epoch {
  readonly recover: RecoverEntry
  readonly entries: readonly DeviceEntry[]
}

export interface DeviceLog {
  /** The identity's PeerId: its first device's key, now and after any recovery. */
  readonly identity: PeerId
  /** Epoch 0's entries, signed by the first device. Empty in a tail. */
  readonly entries: readonly DeviceEntry[]
  readonly recovery?: RecoveryKey
  /** Epochs 1, 2, ... in order; in a tail, from `from` on. */
  readonly epochs?: readonly Epoch[]
  /** Set in a tail: the epoch `epochs` starts at, with nothing before it. */
  readonly from?: number
  /** Set in a tail: the recovery key its first recover was signed with. */
  readonly by?: PeerId
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
  /** Every device once on the list and not on it now. */
  readonly removed: ReadonlySet<PeerId>
  /** When each removed device was removed. */
  readonly removedAt: ReadonlyMap<PeerId, number>
  /** The device that writes the log now. */
  readonly writer: PeerId
  /** The current epoch: 0 until a recovery. */
  readonly epoch: number
  /** The recovery key that can start the next epoch, if there is one. */
  readonly recoveryKey: PeerId | undefined
}

export const FIRST_DEVICE_NAME = 'First device'

export const emptyDeviceLog = (identity: PeerId): DeviceLog => ({ identity, entries: [] })

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const KINDS: ReadonlySet<string> = new Set(['add', 'remove', 'name'])

const isName = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' && value.length <= MAX_DEVICE_NAME_LENGTH
const isCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value)
/** Lowercase base32 only, the one way Pigeon writes a signature (empty for a chain's first link). */
const isSig = (value: unknown) =>
  typeof value === 'string' && value.length <= 256 && /^[a-z2-7]*$/.test(value)
const isId = (value: unknown) => typeof value === 'string' && isPeerId(value)

function isEntry(value: unknown): value is DeviceEntry {
  if (!isObject(value)) return false
  const { seq, prev, kind, device, name, at, sig } = value
  return (
    isCount(seq) &&
    (seq as number) >= 1 &&
    isSig(prev) &&
    typeof kind === 'string' &&
    KINDS.has(kind) &&
    isId(device) &&
    (kind === 'remove' ? name === undefined : isName(name)) &&
    isCount(at) &&
    isSig(sig)
  )
}

const isRecoveryKey = (value: unknown): value is RecoveryKey =>
  isObject(value) && isId(value['key']) && isCount(value['at']) && isSig(value['sig'])

const isKept = (value: unknown): value is KeptDevice =>
  isObject(value) && isId(value['device']) && isName(value['name'])

function isRecover(value: unknown): value is RecoverEntry {
  if (!isObject(value)) return false
  const { epoch, writer, keep, next, at, sig } = value
  return (
    isCount(epoch) &&
    (epoch as number) >= 1 &&
    isId(writer) &&
    Array.isArray(keep) &&
    keep.length <= MAX_KEPT_DEVICES &&
    keep.every(isKept) &&
    isId(next) &&
    isCount(at) &&
    isSig(sig)
  )
}

const isEpoch = (value: unknown): value is Epoch =>
  isObject(value) &&
  isRecover(value['recover']) &&
  Array.isArray(value['entries']) &&
  value['entries'].every(isEntry)

const epochsOf = (log: DeviceLog): readonly Epoch[] => log.epochs ?? []
const isTail = (log: DeviceLog) => log.from !== undefined
/** The epoch number of `log.epochs[0]`. */
const firstEpoch = (log: DeviceLog) => log.from ?? 1
const totalEntries = (log: DeviceLog) =>
  epochsOf(log).reduce((sum, epoch) => sum + epoch.entries.length, log.entries.length)

/** The shape of a device log, as it arrives or is read back. Signatures are checked apart. */
export function isDeviceLog(value: unknown): value is DeviceLog {
  if (!isObject(value)) return false
  const { identity, entries, recovery, epochs, from, by } = value
  if (
    !(
      isId(identity) &&
      Array.isArray(entries) &&
      entries.every(isEntry) &&
      (recovery === undefined || isRecoveryKey(recovery)) &&
      (epochs === undefined ||
        (Array.isArray(epochs) && epochs.length <= MAX_EPOCHS && epochs.every(isEpoch))) &&
      (from === undefined || (isCount(from) && (from as number) >= 1)) &&
      (by === undefined || isId(by)) &&
      (from === undefined) === (by === undefined)
    )
  )
    return false
  return totalEntries(value as unknown as DeviceLog) <= MAX_DEVICE_ENTRIES
}

/** `log` with these epochs, leaving the field out when there are none, as a log before them. */
function withEpochs(log: DeviceLog, epochs: readonly Epoch[]): DeviceLog {
  const { epochs: _old, ...rest } = log
  return epochs.length === 0 ? rest : { ...rest, epochs }
}

type Unsigned = Omit<DeviceEntry, 'sig'>

// Epoch 0's bytes are as they were before recovery keys, so older entries still verify.
const entryBytes = (identity: PeerId, epoch: number, entry: Unsigned) =>
  canonicalBytes({
    identity,
    ...(epoch === 0 ? {} : { epoch }),
    seq: entry.seq,
    prev: entry.prev,
    kind: entry.kind,
    device: entry.device,
    ...(entry.name === undefined ? {} : { name: entry.name }),
    at: entry.at,
  } as Json)

const recoveryBytes = (identity: PeerId, key: PeerId, at: number) =>
  canonicalBytes({ identity, type: 'recovery-key', key, at })

const recoverBytes = (identity: PeerId, recover: Omit<RecoverEntry, 'sig'>) =>
  canonicalBytes({
    identity,
    type: 'recover',
    epoch: recover.epoch,
    writer: recover.writer,
    keep: recover.keep.map(({ device, name }) => ({ device, name })),
    next: recover.next,
    at: recover.at,
  } as unknown as Json)

/** One epoch's list as its chain is read: what an entry is checked against. */
interface EpochState {
  active: Map<PeerId, DeviceInfo>
  /** Removed in this epoch: gone for good until a recovery says otherwise. */
  removed: Set<PeerId>
  removedAt: Map<PeerId, number>
  writer: PeerId
}

const firstEpochState = (identity: PeerId): EpochState => ({
  active: new Map([[identity, { id: identity, name: FIRST_DEVICE_NAME }]]),
  removed: new Set(),
  removedAt: new Map(),
  writer: identity,
})

/** An epoch's list as its recover sets it: the kept devices, and nobody removed yet. */
const recoveredState = (recover: Omit<RecoverEntry, 'sig'>): EpochState => ({
  active: new Map(recover.keep.map(({ device, name }) => [device, { id: device, name }])),
  removed: new Set(),
  removedAt: new Map(),
  writer: recover.writer,
})

/** A recover's own shape: the writer kept, and nobody kept twice. */
function recoverHolds(recover: Omit<RecoverEntry, 'sig'>): boolean {
  const kept = new Set(recover.keep.map((device) => device.device))
  return kept.size === recover.keep.length && kept.has(recover.writer)
}

/** Applies one entry, or says why it can't. Signatures aren't checked here. */
function apply(state: EpochState, entry: Unsigned): string | undefined {
  switch (entry.kind) {
    case 'add':
      if (state.active.has(entry.device)) return 'already on the list'
      // A device removed in this epoch is gone for good: its key can't come back.
      if (state.removed.has(entry.device)) return 'removed for good'
      state.active.set(entry.device, {
        id: entry.device,
        name: entry.name ?? 'Device',
        addedAt: entry.at,
      })
      return undefined
    case 'remove':
      // The writer stays: it's the only one that can change the list.
      if (entry.device === state.writer || !state.active.has(entry.device)) return 'not removable'
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

function readChain(state: EpochState, entries: readonly DeviceEntry[]): EpochState {
  for (const entry of entries) apply(state, entry)
  return state
}

/**
 * Who's on the list (the latest epoch's), and who was once and when they stopped: removed in
 * their epoch, or dropped by the recover after it, whichever came first.
 */
function stateOf(log: DeviceLog): DeviceState {
  const epochs = epochsOf(log)
  const reads: { readonly state: EpochState; readonly endedAt: number | undefined }[] = []
  if (!isTail(log))
    reads.push({
      state: readChain(firstEpochState(log.identity), log.entries),
      endedAt: epochs[0]?.recover.at,
    })
  for (const [index, epoch] of epochs.entries())
    reads.push({
      state: readChain(recoveredState(epoch.recover), epoch.entries),
      endedAt: epochs[index + 1]?.recover.at,
    })
  const current = reads.at(-1)?.state
  const active = current?.active ?? new Map<PeerId, DeviceInfo>()
  const removedAt = new Map<PeerId, number>()
  for (const { state, endedAt } of reads) {
    const ended = (id: PeerId, at: number | undefined) => {
      if (active.has(id) || at === undefined) return
      removedAt.set(id, Math.max(removedAt.get(id) ?? Number.NEGATIVE_INFINITY, at))
    }
    for (const [id, at] of state.removedAt) ended(id, at)
    for (const [id] of state.active) ended(id, endedAt)
  }
  const last = epochs.at(-1)?.recover
  return {
    active,
    removed: new Set(removedAt.keys()),
    removedAt,
    writer: current?.writer ?? '',
    epoch: last?.epoch ?? 0,
    recoveryKey: last === undefined ? (isTail(log) ? undefined : log.recovery?.key) : last.next,
  }
}

/** Who is on a log already checked by `verifyDeviceLog` (or a tail its owner made). */
export function deviceState(log: DeviceLog): DeviceState {
  return stateOf(log)
}

async function checkSig(crypto: Crypto, signer: PeerId, sig: string, bytes: Uint8Array) {
  const signature = base32DecodeExact(sig)
  return signature.ok && (await crypto.verify(signer, signature.value, bytes))
}

/** One epoch's chain: numbered, linked, signed by its writer and allowed step by step. */
async function checkChain(
  crypto: Crypto,
  identity: PeerId,
  epoch: number,
  state: EpochState,
  entries: readonly DeviceEntry[],
): Promise<boolean> {
  let prev = ''
  for (const [index, entry] of entries.entries()) {
    if (entry.seq !== index + 1 || entry.prev !== prev) return false
    if (!(await checkSig(crypto, state.writer, entry.sig, entryBytes(identity, epoch, entry))))
      return false
    if (apply(state, entry) !== undefined) return false
    prev = entry.sig
  }
  return true
}

/** Epochs from `firstNumber` on, the first signed by `firstKey`, each by the `next` before it. */
async function checkEpochs(
  crypto: Crypto,
  identity: PeerId,
  epochs: readonly Epoch[],
  firstNumber: number,
  firstKey: PeerId | undefined,
): Promise<boolean> {
  let key = firstKey
  for (const [index, { recover, entries }] of epochs.entries()) {
    if (recover.epoch !== firstNumber + index || key === undefined) return false
    if (!recoverHolds(recover)) return false
    if (!(await checkSig(crypto, key, recover.sig, recoverBytes(identity, recover)))) return false
    if (!(await checkChain(crypto, identity, recover.epoch, recoveredState(recover), entries)))
      return false
    key = recover.next
  }
  return true
}

/** True for a whole log whose every signature and step holds. A tail is never true here. */
export async function verifyDeviceLog(crypto: Crypto, log: DeviceLog): Promise<boolean> {
  if (!isDeviceLog(log) || isTail(log)) return false
  const { identity, recovery } = log
  if (!(await checkChain(crypto, identity, 0, firstEpochState(identity), log.entries))) return false
  if (
    recovery !== undefined &&
    !(await checkSig(
      crypto,
      identity,
      recovery.sig,
      recoveryBytes(identity, recovery.key, recovery.at),
    ))
  )
    return false
  return checkEpochs(crypto, identity, epochsOf(log), 1, recovery?.key)
}

/** True for a tail whose recovers run from the key in its `by`: the check its own device makes. */
export async function verifyOwnTail(crypto: Crypto, log: DeviceLog): Promise<boolean> {
  if (!isDeviceLog(log) || !isTail(log) || log.entries.length > 0) return false
  if (log.recovery !== undefined) return false
  return checkEpochs(crypto, log.identity, epochsOf(log), firstEpoch(log), log.by)
}

/** The recovery key that signs the recover of `epoch`, in a whole log; undefined if none. */
function keyFor(log: DeviceLog, epoch: number): PeerId | undefined {
  if (epoch === 1) return log.recovery?.key
  return epochsOf(log)[epoch - 2]?.recover.next
}

/**
 * Cuts a log to `MAX_DEVICE_ENTRIES` in all: the oldest epochs' last entries go first, so the
 * current epoch, the only one that sets the list, is never cut. What goes is only history.
 */
function trim(log: DeviceLog): DeviceLog {
  let over = totalEntries(log) - MAX_DEVICE_ENTRIES
  if (over <= 0) return log
  const cut = (entries: readonly DeviceEntry[]) => {
    const drop = Math.min(over, entries.length)
    over -= drop
    return entries.slice(0, entries.length - drop)
  }
  const epochs = epochsOf(log)
  if (epochs.length === 0) return log
  const entries = isTail(log) ? log.entries : cut(log.entries)
  const older = epochs.slice(0, -1).map((epoch) => ({ ...epoch, entries: cut(epoch.entries) }))
  return withEpochs({ ...log, entries }, [...older, ...epochs.slice(-1)])
}

export type AppendError = 'not-allowed' | 'not-writer' | 'full'

/** Signs and appends an entry to the current epoch. Only the device that writes the log can. */
export async function appendDeviceEntry(
  _crypto: Crypto,
  log: DeviceLog,
  signer: Signer,
  change: { readonly kind: DeviceEntryKind; readonly device: PeerId; readonly name?: string },
  at: number,
): Promise<{ ok: true; log: DeviceLog } | { ok: false; error: AppendError }> {
  const epochs = epochsOf(log)
  const last = epochs.at(-1)
  const current = last?.entries ?? log.entries
  const state = readChain(
    last === undefined ? firstEpochState(log.identity) : recoveredState(last.recover),
    current,
  )
  if (signer.id !== state.writer) return { ok: false, error: 'not-writer' }
  if (current.length >= MAX_DEVICE_ENTRIES) return { ok: false, error: 'full' }
  const unsigned: Unsigned = {
    seq: current.length + 1,
    prev: current.at(-1)?.sig ?? '',
    kind: change.kind,
    device: change.device,
    ...(change.name === undefined
      ? {}
      : { name: change.name.trim().slice(0, MAX_DEVICE_NAME_LENGTH) }),
    at,
  }
  if (apply(state, unsigned) !== undefined) return { ok: false, error: 'not-allowed' }
  const epoch = last?.recover.epoch ?? 0
  const sig = base32Encode(await signer.sign(entryBytes(log.identity, epoch, unsigned)))
  const entry = { ...unsigned, sig }
  if (last === undefined) return { ok: true, log: { ...log, entries: [...log.entries, entry] } }
  const grown = { ...last, entries: [...last.entries, entry] }
  return { ok: true, log: trim(withEpochs(log, [...epochs.slice(0, -1), grown])) }
}

/**
 * Commits to a recovery key, from the first device, while there's none and no recovery yet.
 * After that only a `recover` signed by the current key names the next.
 */
export async function setRecoveryKey(
  log: DeviceLog,
  signer: Signer,
  key: PeerId,
  at: number,
): Promise<DeviceLog | undefined> {
  if (signer.id !== log.identity || isTail(log)) return undefined
  if (log.recovery !== undefined || epochsOf(log).length > 0) return undefined
  const sig = base32Encode(await signer.sign(recoveryBytes(log.identity, key, at)))
  return { ...log, recovery: { key, at, sig } }
}

/**
 * Signs a `recover` with the current recovery key, starting `epoch`. Given your whole log, it
 * is appended to it, as when you hand the writer's role to a device you hold; without one, the
 * result is a tail that a friend completes.
 */
export async function recoverDeviceLog(
  identity: PeerId,
  known: DeviceLog | undefined,
  key: Signer,
  change: {
    readonly epoch: number
    readonly writer: PeerId
    readonly keep: readonly KeptDevice[]
    readonly next: PeerId
  },
  at: number,
): Promise<DeviceLog | undefined> {
  const keep = change.keep.map(({ device, name }) => ({
    device,
    name: name.trim().slice(0, MAX_DEVICE_NAME_LENGTH) || 'Device',
  }))
  const unsigned = { ...change, keep, at }
  if (!recoverHolds(unsigned) || keep.length > MAX_KEPT_DEVICES) return undefined
  const sig = base32Encode(await key.sign(recoverBytes(identity, unsigned)))
  const epoch: Epoch = { recover: { ...unsigned, sig }, entries: [] }
  if (known === undefined || isTail(known))
    return { identity, entries: [], from: change.epoch, by: key.id, epochs: [epoch] }
  const state = stateOf(known)
  if (state.recoveryKey !== key.id || state.epoch + 1 !== change.epoch) return undefined
  if (epochsOf(known).length >= MAX_EPOCHS) return undefined
  return withEpochs(known, [...epochsOf(known), epoch])
}

/** The longer of two copies of one chain, or undefined when they disagree. */
function longerChain(
  ours: readonly DeviceEntry[],
  theirs: readonly DeviceEntry[],
): readonly DeviceEntry[] | undefined {
  const [short, long] = ours.length >= theirs.length ? [theirs, ours] : [ours, theirs]
  return short.every((entry, index) => entry.sig === long[index]?.sig) ? long : undefined
}

/**
 * Lines two runs of epochs up from the same number; ours is the one already trusted. At the first
 * recover they disagree on, what we already know wins if we have a later epoch on top of it: a
 * key that was used and replaced can't start that epoch again. Only at our latest
 * epoch, where both recovers come from the key still current, does the lower signature win, with
 * everything after it. With no disagreement the one with more epochs wins, and each epoch both
 * share keeps the longer copy of its chain.
 */
function settleEpochs(ours: readonly Epoch[], theirs: readonly Epoch[]): readonly Epoch[] {
  const out: Epoch[] = []
  for (let index = 0; index < Math.max(ours.length, theirs.length); index += 1) {
    const a = ours[index]
    const b = theirs[index]
    if (a === undefined) return [...out, ...theirs.slice(index)]
    if (b === undefined) return [...out, ...ours.slice(index)]
    if (a.recover.sig !== b.recover.sig) {
      const replaced = index < ours.length - 1
      return [...out, ...(replaced || a.recover.sig < b.recover.sig ? ours : theirs).slice(index)]
    }
    out.push({ recover: a.recover, entries: longerChain(a.entries, b.entries) ?? a.entries })
  }
  return out
}

function sameLog(a: DeviceLog, b: DeviceLog): boolean {
  const left = canonicalBytes(a as unknown as Json)
  const right = canonicalBytes(b as unknown as Json)
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

/**
 * Ours (already trusted) merged with theirs; anything that doesn't hold keeps ours.
 *
 * Two whole logs: each epoch keeps the longer copy of its chain, the epochs settle as
 * `settleEpochs` says, and the recovery key we committed to first stays ours. A tail joins a whole
 * log it follows on from, checked against the key that log names. Our own tail takes a whole log
 * only if that log's key for our first epoch is the one we recovered with. The result is cut to
 * size and checked whole before it's kept.
 */
export async function mergeDeviceLogs(
  crypto: Crypto,
  ours: DeviceLog,
  theirs: DeviceLog,
): Promise<DeviceLog> {
  if (!isDeviceLog(theirs) || theirs.identity !== ours.identity) return ours
  let candidate: DeviceLog
  if (!isTail(ours) && !isTail(theirs)) {
    const recovery = ours.recovery ?? theirs.recovery
    candidate = withEpochs(
      {
        identity: ours.identity,
        entries: longerChain(ours.entries, theirs.entries) ?? ours.entries,
        ...(recovery === undefined ? {} : { recovery }),
      },
      settleEpochs(epochsOf(ours), epochsOf(theirs)),
    )
  } else if (!isTail(ours)) {
    // Theirs is a tail: it has to follow on from an epoch we know.
    const at = firstEpoch(theirs) - 1
    const known = epochsOf(ours)
    if (at > known.length) return ours
    candidate = withEpochs(ours, [
      ...known.slice(0, at),
      ...settleEpochs(known.slice(at), epochsOf(theirs)),
    ])
  } else if (!isTail(theirs)) {
    // Ours is our own tail: a whole log has to run through the key we recovered with.
    const at = firstEpoch(ours) - 1
    if (keyFor(theirs, at + 1) !== ours.by) return ours
    const known = epochsOf(theirs)
    if (known.length < at) return ours
    candidate = withEpochs(theirs, [
      ...known.slice(0, at),
      ...settleEpochs(epochsOf(ours), known.slice(at)),
    ])
  } else {
    // Two tails: only one from our own key, starting where ours does, can add to ours.
    if (firstEpoch(ours) !== firstEpoch(theirs) || ours.by !== theirs.by) return ours
    candidate = withEpochs(ours, settleEpochs(epochsOf(ours), epochsOf(theirs)))
    candidate = trim(candidate)
    if (sameLog(candidate, ours)) return ours
    return (await verifyOwnTail(crypto, candidate)) ? candidate : ours
  }
  candidate = trim(candidate)
  if (sameLog(candidate, ours)) return ours
  if (sameLog(candidate, theirs)) candidate = theirs
  return (await verifyDeviceLog(crypto, candidate)) ? candidate : ours
}

/** Every device that has ever been on the list, removed ones too: whose old messages are whose. */
export function everDevices(log: DeviceLog): ReadonlySet<PeerId> {
  const state = stateOf(log)
  return new Set([...state.active.keys(), ...state.removed])
}

/** Whether a log is a tail, known from its first recover on only. */
export const isTailLog = isTail

/**
 * The identity a device speaks for, or undefined when its claim doesn't hold. `known` is the log
 * you already keep for the identity it names (or for the device itself, when it names none).
 *
 * A device that names no identity speaks for itself, as a first device or a Pigeon from before
 * devices does, unless the log you keep says a recovery took it off its own list. A device that
 * names one has to be on the list you get by merging what it sent into what you keep, so an old
 * copy can't undo a recovery you've seen, and a tail is taken only on top of earlier epochs.
 */
export async function speakerIdentity(
  crypto: Crypto,
  device: PeerId,
  speaker: { readonly identity?: PeerId; readonly devices?: DeviceLog },
  known?: DeviceLog,
): Promise<PeerId | undefined> {
  if (speaker.identity === undefined) {
    if (known === undefined || known.identity !== device) return device
    return stateOf(known).active.has(device) ? device : undefined
  }
  const log = speaker.devices
  if (log === undefined || log.identity !== speaker.identity) return undefined
  const kept = known !== undefined && known.identity === log.identity ? known : undefined
  let merged: DeviceLog
  if (kept !== undefined) merged = await mergeDeviceLogs(crypto, kept, log)
  else if (!isTail(log) && (await verifyDeviceLog(crypto, log))) merged = log
  else return undefined
  return stateOf(merged).active.has(device) ? speaker.identity : undefined
}
