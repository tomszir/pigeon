// A world for the model-based test of the shared log (shared-log.model.test.ts): your devices,
// each running the real shared log, device log and sync rules, the letters between them, and a
// removed device that does whatever it likes. Its steps are the steps of the your-data model in
// verification/models/device-sync/ (data-steps.ts and data-hostile.ts), as far as they concern
// your data, and its checks are that model's invariants, read off the real devices' state.
//
// Only tests import this.
import {
  appendDeviceEntry,
  type DeviceLog,
  deviceState,
  emptyDeviceLog,
  everDevices,
  mergeDeviceLogs,
  removalsOf,
} from '../../devices/device-log.ts'
import { base32Encode } from '../../encoding/bytes.ts'
import { canonicalJson, type Json } from '../../encoding/canonical.ts'
import type { Crypto, Signer } from '../../identity/crypto.ts'
import type { PeerId } from '../../identity/identity.ts'
import { fakeCrypto, fakeSigner } from '../../testing/testing.ts'
import { appendShared, settleOps } from '../changes.ts'
import { INCARNATION_BYTES, type SharedEntry, type SharedOp } from '../entry.ts'
import { heardFrom, newPeer, type PeerSync, planLetter } from '../exchange.ts'
import { type FoldContext, foldShared, type SharedView } from '../fold.ts'
import {
  behindShared,
  emptySharedLog,
  missingShared,
  type SharedLog,
  summarizeShared,
  takeSharedEntries,
} from '../log.ts'
import { readSyncBody, syncBody, syncCounts } from '../sync.ts'

/** Your devices: A writes the device log, X may be removed, C may be linked. */
export type Dev = 'A' | 'B' | 'C' | 'X'
export type Friend = 'F' | 'G'
export const WRITER: Dev = 'A'
export const REMOVED: Dev = 'X'

export const crypto: Crypto = fakeCrypto
export const signers: Readonly<Record<Dev | Friend | 'Z', Signer>> = {
  A: fakeSigner('model:A'),
  B: fakeSigner('model:B'),
  C: fakeSigner('model:C'),
  X: fakeSigner('model:X'),
  F: fakeSigner('model:F'),
  G: fakeSigner('model:G'),
  Z: fakeSigner('model:Z'),
}
export const idOf = (who: Dev | Friend | 'Z'): PeerId => signers[who].id
export const devOf = (id: PeerId): Dev | undefined =>
  (['A', 'B', 'C', 'X'] as const).find((d) => idOf(d) === id)
export const friendOf = (id: PeerId): Friend | undefined =>
  (['F', 'G'] as const).find((f) => idOf(f) === id)
export const IDENTITY: PeerId = idOf(WRITER)

/** A month, in the clock's units: how far a clock gone wrong runs ahead. */
export const MONTH = 1_000_000
const START = 1_000

export type Budget =
  | 'add'
  | 'unfriend'
  | 'pet'
  | 'mute'
  | 'block'
  | 'unblock'
  | 'relay'
  | 'remove'
  | 'link'
  | 'meet'
  | 'lose'
  | 'fork'
  | 'future'
  | 'skew'
  | 'stranger'
  | 'gap'
  | 'proto'
  | 'burst'

export type Forge =
  | { readonly op: 'unfriendF'; readonly stamp: 'current' }
  | { readonly op: 'renameF'; readonly stamp: 'early' | 'cap' | 'over' }

export interface Scenario {
  readonly name: string
  readonly devices: readonly Dev[]
  readonly hostile: boolean
  readonly budgets: Partial<Record<Budget, number>>
  readonly who?: Partial<Record<Budget, readonly Dev[]>>
  readonly adds?: readonly Friend[]
  readonly targets?: readonly Friend[]
  readonly forges?: readonly Forge[]
}

export interface Device {
  clock: number
  log: DeviceLog
  shared: SharedLog
  /** What it keeps about each other device, to decide what to mail it, as the Messenger does. */
  peers: Partial<Record<Dev, PeerSync>>
  /** Its device log as its last letter carried it: a change goes out as `mail:self` news does. */
  logSent?: string
  dirty: boolean
}

export interface Letter {
  id: number
  from: Dev
  to: Dev[]
  pending: Dev[]
  lost: Dev[]
  put: boolean
  body: Json
  /** Ghost: the device log it was last sealed with. */
  sealedWith: DeviceLog
}

/** A change a device on the list made, as the person meant it: what the W1 oracle reads. */
interface Action {
  readonly by: Dev
  readonly n: number
  readonly stamp: number
  readonly register: string
  readonly value: string
  readonly sig: string
}

export interface World {
  devs: Partial<Record<Dev, Device>>
  mail: Letter[]
  nextLetter: number
  left: Partial<Record<Budget, number>>
  /** Ghosts below: what really happened, which no device reads. */
  actions: Action[]
  tombs: string[]
  /** The threshold the writer set when it removed X, 0 while X is on the list. */
  removalFrom: number
  heldAtRemoval: string[]
  /** Every device still on the list knows of the removal. */
  allKnew: boolean
  /** Signatures of entries X made after every device on the list knew of its removal. */
  late: string[]
  /** The friendship each friend is in: the last pairing to reach them. */
  seen: Partial<Record<Friend, string>>
  incs: number
  forged: number
  xSent: Partial<Record<Dev, string>>
  unsettled?: true
}

export type Step = readonly [string, (w: World) => Promise<void>]

export const clone = (w: World): World => ({
  ...w,
  devs: Object.fromEntries(
    Object.entries(w.devs).map(([d, dev]) => [d, { ...dev, peers: { ...dev.peers } }]),
  ),
  mail: w.mail.map((l) => ({ ...l, to: [...l.to], pending: [...l.pending], lost: [...l.lost] })),
  left: { ...w.left },
  actions: [...w.actions],
  tombs: [...w.tombs],
  heldAtRemoval: [...w.heldAtRemoval],
  late: [...w.late],
  seen: { ...w.seen },
  xSent: { ...w.xSent },
})

export const incarnation = (k: number): string => {
  const bytes = new Uint8Array(INCARNATION_BYTES)
  bytes[0] = k
  bytes[1] = 0x5e
  return base32Encode(bytes)
}

export const context = (dev: Device): FoldContext => ({
  authors: everDevices(dev.log),
  removals: removalsOf(dev.log),
})

export const viewOn = (w: World, d: Dev): SharedView | undefined => {
  const dev = w.devs[d]
  return dev === undefined ? undefined : foldShared(dev.shared, context(dev))
}

export const knowsRemoval = (dev: Device): boolean => removalsOf(dev.log).has(idOf(REMOVED))

/** The devices on `d`'s own copy of the list. */
export function listOf(w: World, d: Dev): Dev[] {
  const dev = w.devs[d]
  if (dev === undefined) return []
  const ever = everDevices(dev.log)
  const removed = removalsOf(dev.log)
  return (Object.keys(w.devs) as Dev[])
    .filter((o) => ever.has(idOf(o)) && !removed.has(idOf(o)))
    .sort()
}

/** Devices that follow the design: on the writer's list, and not X when X is hostile. */
export function honest(w: World, s: Scenario): Dev[] {
  return listOf(w, WRITER).filter((d) => !(d === REMOVED && s.hostile))
}

export const registerOf = (op: SharedOp): string | undefined =>
  op.kind === 'pet' || op.kind === 'mute' || op.kind === 'block'
    ? `${op.kind}:${friendOf(op.friend)}`
    : op.kind === 'setting'
      ? 'relay'
      : undefined

export const shownValue = (op: SharedOp): string =>
  op.kind === 'pet'
    ? op.name
    : op.kind === 'mute'
      ? String(op.until)
      : op.kind === 'block'
        ? String(op.on)
        : op.kind === 'setting'
          ? String(op.value)
          : op.kind

/** A person's change on `d`, written as its next entry. */
export async function write(w: World, s: Scenario, d: Dev, op: SharedOp): Promise<SharedEntry> {
  const dev = w.devs[d]
  if (dev === undefined) throw new Error(`no device ${d}`)
  dev.clock += 1
  const next = await appendShared(dev.shared, signers[d], op, dev.clock, context(dev))
  if (next === undefined) throw new Error('log full')
  dev.shared = next.log
  dev.dirty = true
  const register = registerOf(op)
  if (register !== undefined && !(d === REMOVED && s.hostile))
    w.actions.push({
      by: d,
      n: next.entry.n,
      stamp: next.entry.stamp,
      register,
      value: shownValue(op),
      sig: next.entry.sig,
    })
  return next.entry
}

export async function initialWorld(s: Scenario): Promise<World> {
  let log = emptyDeviceLog(IDENTITY)
  for (const d of s.devices)
    if (d !== WRITER) {
      const added = await appendDeviceEntry(
        crypto,
        log,
        signers.A,
        { kind: 'add', device: idOf(d), name: d },
        START,
      )
      if (!added.ok) throw new Error('could not add')
      log = added.log
    }
  const first = await appendShared(
    emptySharedLog(IDENTITY),
    signers.A,
    { kind: 'add', friend: idOf('F'), inc: incarnation(1) },
    START,
    { authors: everDevices(log), removals: new Map() },
  )
  if (first === undefined) throw new Error('could not write')
  const devs: Partial<Record<Dev, Device>> = {}
  for (const d of s.devices)
    devs[d] = { clock: START, log, shared: first.log, peers: {}, dirty: false }
  return {
    devs,
    mail: [],
    nextLetter: 1,
    left: { ...s.budgets },
    actions: [],
    tombs: [],
    removalFrom: 0,
    heldAtRemoval: [],
    allKnew: false,
    late: [],
    seen: { F: incarnation(1) },
    incs: 1,
    forged: 0,
    xSent: {},
  }
}

export const spend = (w: World, b: Budget): boolean => {
  const left = w.left[b] ?? 0
  if (left <= 0) return false
  w.left[b] = left - 1
  return true
}

export const allowed = (s: Scenario, b: Budget, d: Dev): boolean =>
  s.who?.[b] === undefined || (s.who[b]?.includes(d) ?? false)

/**
 * A letter from `d` to its other devices: what the Messenger's own planner says is due, with its
 * page limits (exchange.ts). The device marks them sent to once the letter is queued, and a page
 * that didn't fit leaves it with more to send.
 */
async function send(w: World, d: Dev): Promise<void> {
  const dev = w.devs[d]
  if (dev === undefined || !dev.dirty) return
  dev.dirty = false
  const to = listOf(w, d).filter((o) => o !== d)
  if (to.length === 0) return
  const peers = new Map(to.map((r) => [idOf(r), dev.peers[r] ?? newPeer()]))
  const listed = new Set(deviceState(dev.log).active.keys())
  const letter = await planLetter(crypto, dev.shared, peers, listed)
  // A changed device log goes out even with no entries due, as the Messenger's self news does.
  const logKey = canonicalJson(dev.log as unknown as Json)
  if (letter === undefined && dev.logSent === logKey) return
  dev.logSent = logKey
  const summary = letter?.summary ?? (await summarizeShared(crypto, dev.shared))
  // Each letter carries only what earlier ones didn't, so none takes another's place.
  w.mail.push({
    id: w.nextLetter++,
    from: d,
    to,
    pending: [...to],
    lost: [],
    put: false,
    body: syncBody({ log: dev.log, summary, entries: letter?.entries ?? [] }),
    sealedWith: dev.log,
  })
  for (const r of to) {
    const peer = letter?.peers.get(idOf(r))
    if (peer !== undefined) dev.peers[r] = peer
  }
  if (letter?.more === true) dev.dirty = true
}

/** Puts again what was lost: sealed again to the list as it is now, with the log as it is now. */
function putAgain(w: World, l: Letter): void {
  const dev = w.devs[l.from]
  if (dev === undefined || l.lost.length === 0) return
  const to = listOf(w, l.from).filter((o) => o !== l.from)
  l.pending = [
    ...new Set([
      ...l.pending,
      ...l.lost.filter((p) => to.includes(p)),
      ...to.filter((p) => !l.to.includes(p)),
    ]),
  ].sort()
  l.to = to
  l.lost = []
  const body = l.body as Record<string, Json>
  l.body = { ...body, log: dev.log as unknown as Json }
  l.sealedWith = dev.log
}

/** Device `r` takes one letter, its device log already merged. */
async function take(w: World, r: Dev, l: Letter): Promise<void> {
  l.pending = l.pending.filter((p) => p !== r)
  const dev = w.devs[r]
  if (dev === undefined) return
  const body = readSyncBody(IDENTITY, l.body)
  if (body === undefined) return
  if (!syncCounts(dev.log, idOf(l.from), idOf(r))) return
  const taken = await takeSharedEntries(crypto, dev.shared, body.entries, everDevices(dev.log))
  dev.shared = taken.log
  if (taken.taken.length > 0) dev.dirty = true
  // A sender that holds more than it carried is answered; one that lacks something this device
  // holds is sent it at this device's next letter.
  const behind = await behindShared(crypto, dev.shared, body.summary)
  dev.peers[l.from] = heardFrom(dev.peers[l.from], body.summary, behind)
  if (behind || (await missingShared(crypto, dev.shared, body.summary)).length > 0) dev.dirty = true
}

async function mergeLog(dev: Device, theirs: unknown): Promise<void> {
  const body = readSyncBody(IDENTITY, theirs)
  if (body === undefined) return
  const before = canonicalJson(dev.log as unknown as Json)
  dev.log = await mergeDeviceLogs(crypto, dev.log, body.log)
  if (canonicalJson(dev.log as unknown as Json) !== before) dev.dirty = true
}

/**
 * Two live friendships with one friend: once a device sees the friend in one (here, the one the
 * friend is in), it ends the others.
 */
async function settleRepairs(w: World, s: Scenario, d: Dev): Promise<void> {
  const dev = w.devs[d]
  if (dev === undefined) return
  for (const fr of ['F', 'G'] as const) {
    const seen = w.seen[fr]
    if (seen === undefined) continue
    const ops = settleOps(dev.shared, context(dev), idOf(fr), seen)
    for (const op of ops) {
      if (op.kind === 'tomb') w.tombs = [...new Set([...w.tombs, op.inc])]
      await write(w, s, d, op)
    }
  }
}

/** One mail check by `r`: put, put again, merge every log, take, then send. */
export async function check(w: World, s: Scenario, r: Dev): Promise<void> {
  const dev = w.devs[r]
  if (dev === undefined) return
  for (const l of w.mail) if (l.from === r) l.put = true
  for (const l of w.mail) if (l.from === r && l.lost.length > 0) putAgain(w, l)
  const waiting = w.mail.filter((l) => l.put && l.pending.includes(r))
  for (const l of waiting) await mergeLog(dev, l.body)
  for (const l of waiting) await take(w, r, l)
  await settleRepairs(w, s, r)
  await send(w, r)
  for (const l of w.mail) if (l.from === r) l.put = true
  sweep(w)
}

export function sweep(w: World): void {
  w.mail = w.mail.filter((l) => l.pending.length > 0 || l.lost.length > 0 || !l.put)
}

/** Two devices in the self room: each merges the other's log, then swaps entries by summary. */
export async function meet(w: World, s: Scenario, a: Dev, b: Dev): Promise<void> {
  const da = w.devs[a]
  const db = w.devs[b]
  if (da === undefined || db === undefined) return
  const hostile = (d: Dev) => d === REMOVED && s.hostile
  const logA = da.log
  const logB = db.log
  if (!hostile(a)) da.log = await mergeDeviceLogs(crypto, da.log, logB)
  if (!hostile(b)) db.log = await mergeDeviceLogs(crypto, db.log, logA)
  const sums = {
    [a]: await summarizeShared(crypto, da.shared),
    [b]: await summarizeShared(crypto, db.shared),
  }
  const pass = async (from: Dev, to: Dev) => {
    const src = w.devs[from]
    const dst = w.devs[to]
    if (src === undefined || dst === undefined || hostile(to)) return
    if (!syncCounts(dst.log, idOf(from), idOf(to))) return
    if (!syncCounts(src.log, idOf(to), idOf(from)) && !hostile(from)) return
    const sent = await missingShared(crypto, src.shared, sums[to])
    const taken = await takeSharedEntries(crypto, dst.shared, sent, everDevices(dst.log))
    dst.shared = taken.log
    dst.peers[from] = heardFrom(dst.peers[from], sums[from] ?? {}, false)
    if (taken.taken.length > 0) dst.dirty = true
  }
  await pass(a, b)
  await pass(b, a)
}

export function finish(w: World, s: Scenario): void {
  sweep(w)
  w.allKnew =
    w.removalFrom > 0 &&
    honest(w, s).every((d) => {
      const dev = w.devs[d]
      return dev !== undefined && knowsRemoval(dev)
    })
}

/** More rounds than settling ever needs; reaching it means it never ends. */
export const SETTLE_ROUNDS = 40

const fingerprint = (w: World): string =>
  canonicalJson({
    devs: Object.entries(w.devs).map(([d, dev]) => [
      d,
      dev.shared.entries.map((e) => e.sig),
      canonicalJson(dev.log as unknown as Json),
      dev.dirty,
      Object.entries(dev.peers)
        .map(
          ([r, p]) =>
            `${r}:${p?.told}:${p?.carried.size}:${canonicalJson((p?.known ?? null) as Json)}`,
        )
        .sort(),
    ]),
    mail: w.mail.map((l) => [l.id, l.pending, l.lost, l.put]),
  } as unknown as Json)

/** Every device on the list checks mail, round after round, until nothing changes. */
export async function settle(w: World, s: Scenario): Promise<World> {
  const out = clone(w)
  for (let round = 0; ; round++) {
    if (round === SETTLE_ROUNDS) {
      out.unsettled = true
      break
    }
    const before = fingerprint(out)
    for (const d of honest(out, s)) await check(out, s, d)
    const alive = new Set<Dev>(honest(out, s))
    for (const l of out.mail) l.pending = l.pending.filter((p) => alive.has(p))
    finish(out, s)
    if (fingerprint(out) === before) break
  }
  return out
}
