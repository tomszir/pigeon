// Property tests for the device log's merge rules. Each run writes a random history the way the
// owner's devices would: adds, removes and renames, a recovery key, recoveries, and signatures
// spelled high-S or low-S as Pigeons from before and after low-S spell them, over the bytes
// every Pigeon checks or the ones that say what an entry is. From it come the
// copies others hold or can make: older copies, tails, a signature's other spelling or capitals,
// a stolen writer adding to an epoch it was recovered out of, a recovery key used twice, and
// recovers forged with keys already used. They're merged in random orders, and every result is
// checked against what the log promises. The first device signs with P-256, the one kind of key
// with a second spelling; other devices and the recovery keys sign with the test fakes, so a
// run stays fast.
import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import { base32Decode, base32DecodeExact, base32Encode } from '../encoding/bytes.ts'
import type { Signer } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import { canonicalSignature } from '../identity/signature.ts'
import { flipS, p256Crypto, p256Signer } from '../testing/p256.ts'
import { fakeSigner, typedSigner } from '../testing/testing.ts'
import {
  appendDeviceEntry,
  type DeviceEntry,
  type DeviceEntryKind,
  type DeviceLog,
  deviceState,
  emptyDeviceLog,
  isTailLog,
  lowSDeviceLog,
  MAX_DEVICE_ENTRIES,
  MAX_EPOCHS,
  mergeDeviceLogs,
  type RecoverEntry,
  recoverDeviceLog,
  setRecoveryKey,
  verifyDeviceLog,
  verifyOwnTail,
} from './device-log.ts'

const crypto = p256Crypto()

/**
 * How a device signed: low-S over the bytes that say what an entry is; an updated Pigeon, low-S
 * over the bytes every Pigeon checks; one from before low-S over those bytes too, either way.
 */
type Spelling = 'typed' | 'updated' | 'old-low' | 'old-high'

type Op =
  | {
      readonly kind: 'add' | 'remove' | 'name'
      readonly device: number
      readonly spelling: Spelling
    }
  | { readonly kind: 'commit'; readonly spelling: Spelling }
  | { readonly kind: 'recover'; readonly writer: number; readonly keep: readonly number[] }
  /** The writer renames itself this many times, to fill the log to its limit. */
  | { readonly kind: 'bulk'; readonly count: number; readonly spelling: Spelling }

/** What an attacker does with the owner's history. */
interface Attack {
  /** Entries a stolen writer adds to an epoch it was recovered out of. */
  readonly stolen: readonly { readonly kind: DeviceEntryKind; readonly device: number }[]
  /** Where in each such epoch's chain the stolen writer starts. */
  readonly forkAt: readonly number[]
  /** Times for recovers forged with keys already used; each signs differently. */
  readonly forgedAt: readonly number[]
  /** A second recover of the latest epoch, signed by the owner's own key, at this time. */
  readonly twiceAt: number | undefined
  /** Copies re-spelled: which copy, which signature, and capitals or the other S. */
  readonly respell: readonly (readonly [number, number, boolean])[]
}

interface Cast {
  readonly owner: Signer
  /** The first device as a Pigeon from before low-S, when it signed high-S. */
  readonly ownerHigh: Signer
  /** Devices a log can name: the first device, then the others. */
  readonly devices: readonly Signer[]
  /** `keys[e]` signs epoch e's recover. */
  readonly keys: readonly Signer[]
  readonly attacker: Signer
  readonly attackerKeys: readonly Signer[]
}

function castOf(owner: Signer): Cast {
  return {
    owner,
    ownerHigh: { id: owner.id, sign: async (data) => flipS(await owner.sign(data)) },
    devices: [owner, ...['phone', 'tablet', 'desktop', 'watch'].map((name) => fakeSigner(name))],
    keys: Array.from({ length: MAX_EPOCHS + 2 }, (_, epoch) => fakeSigner(`recovery-${epoch}`)),
    attacker: fakeSigner('attacker'),
    attackerKeys: [0, 1, 2].map((index) => fakeSigner(`attacker-key-${index}`)),
  }
}

const pick = <T>(list: readonly T[], index: number): T => {
  const item = list[index % list.length]
  if (item === undefined) throw new Error('nothing to pick from')
  return item
}

const signerFor = (cast: Cast, id: PeerId, spelling: Spelling): Signer => {
  const signer =
    id === cast.owner.id
      ? spelling === 'old-high'
        ? cast.ownerHigh
        : cast.owner
      : cast.devices.find((device) => device.id === id)
  if (signer === undefined) throw new Error('no such device')
  return spelling === 'typed' ? typedSigner(signer) : signer
}

/** Whether a Pigeon signing this way reads its stored log low-S, as Pigeons since low-S do. */
const sinceLowS = (spelling: Spelling) => spelling === 'typed' || spelling === 'updated'

// What a log says, whatever spelling it says it in: every signature decoded, either case, and
// made low-S. Only the first device's key is P-256, so it's the one a twin spelling can come from.
let ownerId: PeerId = ''
function meaningOfSig(sig: string): string {
  const bytes = base32Decode(sig)
  return bytes.ok ? base32Encode(canonicalSignature(ownerId, bytes.value)) : `malformed:${sig}`
}
function meaning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(meaning)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      (key === 'sig' || key === 'prev') && typeof item === 'string'
        ? meaningOfSig(item)
        : meaning(item),
    ]),
  )
}
const same = (a: unknown, b: unknown) => JSON.stringify(meaning(a)) === JSON.stringify(meaning(b))

const firstEpoch = (log: DeviceLog) => log.from ?? 1
const epochOf = (log: DeviceLog, epoch: number) => log.epochs?.[epoch - firstEpoch(log)]
const recoverOf = (log: DeviceLog, epoch: number): RecoverEntry | undefined =>
  epochOf(log, epoch)?.recover
const chainOf = (log: DeviceLog, epoch: number): readonly DeviceEntry[] =>
  epoch === 0 ? log.entries : (epochOf(log, epoch)?.entries ?? [])
const writerOf = (log: DeviceLog, epoch: number) =>
  epoch === 0 ? log.identity : (recoverOf(log, epoch)?.writer ?? '')
const latest = (log: DeviceLog) => deviceState(log).epoch
const total = (log: DeviceLog) =>
  (log.epochs ?? []).reduce((sum, epoch) => sum + epoch.entries.length, log.entries.length)
const isPrefix = (short: readonly DeviceEntry[], long: readonly DeviceEntry[]) =>
  short.length <= long.length && short.every((entry, index) => same(entry, long[index]))

/** Who's on the list and what decides it: the latest epoch's recover and chain. */
function current(log: DeviceLog) {
  const state = deviceState(log)
  return JSON.stringify(
    meaning({
      active: [...state.active.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
      writer: state.writer,
      epoch: state.epoch,
      key: state.recoveryKey ?? null,
      recover: recoverOf(log, state.epoch) ?? null,
      chain: chainOf(log, state.epoch),
    }),
  )
}

/** A whole log cut back to `epoch` as its latest, with that epoch's chain cut to `length`. */
function cutTo(log: DeviceLog, epoch: number, length = Number.POSITIVE_INFINITY): DeviceLog {
  const { epochs: all = [], ...rest } = log
  if (epoch === 0) return lowSDeviceLog({ ...rest, entries: log.entries.slice(0, length) })
  const kept = all.slice(0, epoch)
  const last = kept.at(-1)
  if (last === undefined) throw new Error('no such epoch')
  const cut = { ...last, entries: last.entries.slice(0, length) }
  return lowSDeviceLog({ ...rest, epochs: [...kept.slice(0, -1), cut] })
}

/** `log` with one epoch's chain swapped for another. */
function withChain(log: DeviceLog, epoch: number, entries: readonly DeviceEntry[]): DeviceLog {
  if (epoch === 0) return { ...log, entries }
  const epochs = (log.epochs ?? []).map((item) =>
    item.recover.epoch === epoch ? { ...item, entries } : item,
  )
  return { ...log, epochs }
}

/** A whole log's epochs from `from` on, as the device recovered onto it holds them. */
function tailOf(log: DeviceLog, from: number): DeviceLog | undefined {
  const epochs = log.epochs ?? []
  const by = from === 1 ? log.recovery?.key : epochs[from - 2]?.recover.next
  if (by === undefined || from > epochs.length) return undefined
  return { identity: log.identity, entries: [], from, by, epochs: epochs.slice(from - 1) }
}

/** The same log with one signature in capitals, or in its other spelling. */
function respelled(log: DeviceLog, which: number, capitals: boolean): DeviceLog | undefined {
  const copy = JSON.parse(JSON.stringify(log)) as Record<string, unknown>
  const slots: { holder: Record<string, unknown>; field: string; value: string }[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) for (const item of value) visit(item)
    else if (typeof value === 'object' && value !== null) {
      const holder = value as Record<string, unknown>
      for (const [field, item] of Object.entries(holder)) {
        if ((field === 'sig' || (capitals && field === 'prev')) && typeof item === 'string') {
          // The other spelling is only made of one that decodes as written: lowercase.
          if (
            capitals ? item !== item.toUpperCase() : base32DecodeExact(item).ok && item.length > 60
          )
            slots.push({ holder, field, value: item })
        } else visit(item)
      }
    }
  }
  visit(copy)
  if (slots.length === 0) return undefined
  const slot = pick(slots, which)
  if (capitals) slot.holder[slot.field] = slot.value.toUpperCase()
  else {
    const bytes = base32DecodeExact(slot.value)
    if (!bytes.ok || bytes.value.length !== 64) return undefined
    slot.holder[slot.field] = base32Encode(flipS(bytes.value))
  }
  return copy as unknown as DeviceLog
}

async function append(
  cast: Cast,
  raw: DeviceLog,
  change: { kind: DeviceEntryKind; device: PeerId; name?: string },
  spelling: Spelling,
  at: number,
): Promise<DeviceLog | undefined> {
  const writer = deviceState(raw).writer
  const log = sinceLowS(spelling) ? lowSDeviceLog(raw) : raw
  const result = await appendDeviceEntry(crypto, log, signerFor(cast, writer, spelling), change, at)
  return result.ok ? result.log : undefined
}

async function step(cast: Cast, raw: DeviceLog, op: Op, at: number) {
  const state = deviceState(raw)
  switch (op.kind) {
    case 'commit': {
      const log = sinceLowS(op.spelling) ? lowSDeviceLog(raw) : raw
      const signer = op.spelling === 'old-high' ? cast.ownerHigh : cast.owner
      return setRecoveryKey(log, signer, pick(cast.keys, 1).id, at)
    }
    case 'recover': {
      const key = cast.keys.find((signer) => signer.id === state.recoveryKey)
      if (key === undefined) return undefined
      const epoch = state.epoch + 1
      const writer = pick(cast.devices, op.writer).id
      const ids = new Set([writer, ...op.keep.map((index) => pick(cast.devices, index).id)])
      const keep = [...ids].map((device, index) => ({ device, name: `Kept ${index}` }))
      const next = pick(cast.keys, epoch + 1).id
      return recoverDeviceLog(cast.owner.id, raw, key, { epoch, writer, keep, next }, at)
    }
    case 'bulk': {
      let log = raw
      for (let index = 0; index < op.count; index += 1) {
        const name = `Name ${at}.${index}`
        const grown = await append(
          cast,
          log,
          { kind: 'name', device: state.writer, name },
          op.spelling,
          at,
        )
        if (grown === undefined) break
        log = grown
      }
      return log
    }
    default: {
      const device = pick(cast.devices, op.device).id
      const name = op.kind === 'remove' ? {} : { name: `${op.kind} ${at}` }
      return append(cast, raw, { kind: op.kind, device, ...name }, op.spelling, at)
    }
  }
}

/**
 * A copy, and who could have made it. A re-spelled copy counts as its source's: a merge takes
 * what holds of a copy, so the parts a re-spelling leaves alone still count.
 */
interface Copy {
  readonly log: DeviceLog
  readonly by: 'owner' | 'stolen-writer' | 'key-used-twice' | 'forger'
  readonly respelled?: true
}

interface World {
  /** The owner's log after each change, as its devices store it and as they send it. */
  readonly stored: readonly DeviceLog[]
  readonly sent: readonly DeviceLog[]
  readonly final: DeviceLog
  /** Copies from the owner's writing, and re-spellings of them. */
  readonly honest: readonly Copy[]
  /** Copies from keys an attacker could hold: the first device and recovery keys used before. */
  readonly forged: readonly DeviceLog[]
  /** What a device or friend may already keep: whole logs, and recovered devices' own tails. */
  readonly kept: readonly DeviceLog[]
}

async function build(cast: Cast, ops: readonly Op[], attack: Attack): Promise<World> {
  const identity = cast.owner.id
  let raw = emptyDeviceLog(identity)
  const stored = [raw]
  for (const [index, op] of ops.entries()) {
    const next = await step(cast, raw, op, (index + 1) * 10)
    if (next === undefined) continue
    raw = next
    stored.push(raw)
  }
  const sent = stored.map(lowSDeviceLog)
  const final = lowSDeviceLog(raw)
  const last = latest(final)

  const tails = sent.flatMap((log) => [1, latest(log)].flatMap((from) => tailOf(log, from) ?? []))
  const honest: Copy[] = [
    ...[...sent, ...stored, ...tails, cutTo(final, 0)].map((log) => ({
      log,
      by: 'owner' as const,
    })),
  ]

  // A writer recovered out of its epoch still holds its key, and writes more of that epoch.
  for (let epoch = 0; epoch < last; epoch += 1) {
    const chain = chainOf(final, epoch)
    let stale = cutTo(final, epoch, pick(attack.forkAt, epoch) % (chain.length + 1))
    const writer = signerFor(cast, writerOf(final, epoch), 'updated')
    for (const [index, entry] of attack.stolen.entries()) {
      const device = pick([...cast.devices, cast.attacker], entry.device).id
      const name = entry.kind === 'remove' ? {} : { name: `Stolen ${index}` }
      const change = { kind: entry.kind, device, ...name }
      const result = await appendDeviceEntry(crypto, stale, writer, change, 1000 + index)
      if (result.ok) stale = result.log
    }
    honest.push({ log: stale, by: 'stolen-writer' })
    honest.push({ log: withChain(final, epoch, chainOf(stale, epoch)), by: 'stolen-writer' })
  }

  // The owner signs a second recover for the latest epoch with the same key, onto another device.
  if (attack.twiceAt !== undefined && last >= 1) {
    const writer = pick(cast.devices, 1 + attack.twiceAt).id
    const twice = await recoverDeviceLog(
      identity,
      cutTo(final, last - 1),
      pick(cast.keys, last),
      {
        epoch: last,
        writer,
        keep: [{ device: writer, name: 'Other' }],
        next: pick(cast.keys, last + 1).id,
      },
      attack.twiceAt,
    )
    if (twice !== undefined) {
      const grown = await appendDeviceEntry(
        crypto,
        twice,
        signerFor(cast, writer, 'updated'),
        { kind: 'name', device: writer, name: 'Renamed' },
        attack.twiceAt + 1,
      )
      for (const log of [twice, grown.ok ? grown.log : twice, tailOf(twice, last)])
        if (log !== undefined) honest.push({ log, by: 'key-used-twice' })
    }
  }

  for (const [copy, which, capitals] of attack.respell) {
    const source = pick(honest, copy)
    const log = respelled(source.log, which, capitals)
    if (log !== undefined) honest.push({ log, by: source.by, respelled: true })
  }

  // Whoever has a used recovery key forges a recover for its epoch, whole and as a tail, and
  // goes one epoch further with a key of their own.
  const forged: DeviceLog[] = []
  const mine = [{ device: cast.attacker.id, name: 'Mine' }]
  for (let epoch = 1; epoch <= last; epoch += 1) {
    for (const at of attack.forgedAt) {
      const change = { epoch, writer: cast.attacker.id, keep: mine }
      const next = pick(cast.attackerKeys, 0).id
      const key = pick(cast.keys, epoch)
      for (const known of [cutTo(final, epoch - 1), undefined]) {
        const log = await recoverDeviceLog(identity, known, key, { ...change, next }, at)
        if (log === undefined) continue
        forged.push(log)
        const further = await recoverDeviceLog(
          identity,
          log,
          pick(cast.attackerKeys, 0),
          { epoch: epoch + 1, writer: cast.attacker.id, keep: mine, next: cast.attacker.id },
          at + 1,
        )
        if (further !== undefined) forged.push(further)
      }
    }
  }
  // Whoever has the first device commits epoch 0 to a recovery key of their own.
  const { recovery: _, ...bare } = cutTo(final, 0)
  const committed = await setRecoveryKey(bare, cast.owner, pick(cast.attackerKeys, 2).id, 999)
  if (committed !== undefined) forged.push(committed)

  const kept = [
    emptyDeviceLog(identity),
    ...sent,
    ...stored,
    ...sent.flatMap((log) => tailOf(log, latest(log)) ?? []),
  ]
  return { stored, sent, final, honest, forged, kept }
}

const spelling = fc.constantFrom<Spelling>('typed', 'updated', 'old-low', 'old-high')
// Removals are what most rules guard, and each needs an add before it, so they come up often.
const change = fc.record({
  kind: fc.constantFrom<'add' | 'remove' | 'name'>('add', 'remove', 'add', 'remove', 'name'),
  device: fc.nat(4),
  spelling,
})
const commit = fc.record({ kind: fc.constant('commit' as const), spelling })
const recover = fc.record({
  kind: fc.constant('recover' as const),
  writer: fc.nat(4),
  keep: fc.array(fc.nat(4), { maxLength: 4 }),
})
const bulk = fc.record({
  kind: fc.constant('bulk' as const),
  count: fc.integer({ min: 10, max: 60 }),
  spelling,
})

/**
 * A history: a few changes, then mostly a recovery key (recoveries need one), then changes and
 * recoveries mixed, so most runs reach several epochs.
 */
const history = (later: fc.Arbitrary<Op>, maxLength: number): fc.Arbitrary<readonly Op[]> =>
  fc
    .tuple(
      fc.array(change, { maxLength: 3 }),
      fc.option(commit, { freq: 6, nil: undefined }),
      fc.array(later, { minLength: 2, maxLength }),
    )
    .map(([first, key, rest]) => [...first, ...(key === undefined ? [] : [key]), ...rest])

const shortOps = history(
  fc.oneof({ weight: 4, arbitrary: change }, { weight: 2, arbitrary: recover }, commit),
  12,
)
/** Long enough to reach the entry limit, which a merge cuts older epochs to. */
const longOps = history(
  fc.oneof(
    { weight: 2, arbitrary: change },
    { weight: 2, arbitrary: recover },
    { weight: 3, arbitrary: bulk },
  ),
  10,
)

const attack: fc.Arbitrary<Attack> = fc.record({
  stolen: fc.array(
    fc.record({
      kind: fc.constantFrom<DeviceEntryKind>('add', 'remove', 'name'),
      device: fc.nat(5),
    }),
    { maxLength: 3 },
  ),
  forkAt: fc.array(fc.nat(), { minLength: 1, maxLength: 4 }),
  forgedAt: fc.array(fc.nat(1_000_000), { minLength: 1, maxLength: 3 }),
  twiceAt: fc.option(fc.nat(1_000_000), { nil: undefined }),
  respell: fc.array(fc.tuple(fc.nat(), fc.nat(), fc.boolean()), { maxLength: 4 }),
})

/** Indices into the copies a world has: which to merge, in which order, from where. */
const plan = fc.record({
  base: fc.nat(),
  before: fc.array(fc.nat(), { maxLength: 4 }),
  copies: fc.array(fc.nat(), { minLength: 1, maxLength: 6 }),
  order: fc.array(fc.nat(), { maxLength: 6 }),
  withFinal: fc.boolean(),
})
type Plan = typeof plan extends fc.Arbitrary<infer T> ? T : never

const shuffled = <T>(list: readonly T[], order: readonly number[]): T[] => {
  const out = [...list]
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = (order[index % Math.max(order.length, 1)] ?? 0) % (index + 1)
    const swap = out[index] as T
    out[index] = out[other] as T
    out[other] = swap
  }
  return out
}

/** Merges the copies in turn, again and again, until a pass changes nothing, as peers resend. */
async function gossip(base: DeviceLog, copies: readonly DeviceLog[]): Promise<DeviceLog> {
  let log = base
  for (let pass = 0; pass <= copies.length + 1; pass += 1) {
    const before = log
    for (const copy of copies) log = await mergeDeviceLogs(crypto, log, copy)
    if (same(before, log)) return log
  }
  throw new Error('merging never settled')
}

/** Something already kept, grown by merging some copies into it, honest or not. */
async function keptAfter(world: World, choice: Plan): Promise<DeviceLog> {
  const all = [...world.honest.map((copy) => copy.log), ...world.forged]
  let log = pick(world.kept, choice.base)
  for (const index of choice.before) log = await mergeDeviceLogs(crypto, log, pick(all, index))
  return log
}

const forgedCopies = (world: World): Copy[] => world.forged.map((log) => ({ log, by: 'forger' }))

const incoming = (world: World, choice: Plan): Copy[] => {
  const all = [...world.honest, ...forgedCopies(world)]
  return choice.copies.map((index) => pick(all, index))
}

const removedIn = (chain: readonly DeviceEntry[]) =>
  chain.filter((entry) => entry.kind === 'remove').map((entry) => entry.device)

/** Long enough for a run's merges, which verify every signature they keep. */
const TIMEOUT = 120_000

const suites = [
  { name: 'a few changes and recoveries', ops: shortOps, runs: 100 },
  { name: 'a log at its entry limit', ops: longOps, runs: 40 },
] as const

for (const suite of suites) {
  describe(`device-log merges, for ${suite.name}`, { timeout: TIMEOUT }, () => {
    let cast: Cast
    beforeAll(async () => {
      const owner = await p256Signer('low')
      cast = castOf(owner)
      ownerId = owner.id
    })

    /**
     * Runs `check` on every merge of a picked copy into something kept, and of every forged one
     * too when `forged` says so.
     */
    const forEachMerge = (
      check: (
        ours: DeviceLog,
        theirs: DeviceLog,
        merged: DeviceLog,
        copy: Copy,
      ) => Promise<void> | void,
      { forged = false } = {},
    ) =>
      fc.assert(
        fc.asyncProperty(suite.ops, attack, plan, async (ops, hostile, choice) => {
          ownerId = cast.owner.id
          const world = await build(cast, ops, hostile)
          const ours = await keptAfter(world, choice)
          const copies = [...incoming(world, choice), ...(forged ? forgedCopies(world) : [])]
          for (const copy of copies)
            await check(ours, copy.log, await mergeDeviceLogs(crypto, ours, copy.log), copy)
        }),
        { numRuns: suite.runs },
      )

    it('verifies everything the owner writes, as it is sent', () =>
      fc.assert(
        fc.asyncProperty(suite.ops, attack, async (ops, hostile) => {
          ownerId = cast.owner.id
          const world = await build(cast, ops, hostile)
          for (const log of world.sent) expect(await verifyDeviceLog(crypto, log)).toBe(true)
          for (const log of world.kept)
            if (isTailLog(log)) expect(await verifyOwnTail(crypto, log)).toBe(true)
        }),
        { numRuns: suite.runs },
      ))

    it('settles on the same list in any order', () =>
      fc.assert(
        fc.asyncProperty(suite.ops, attack, plan, async (ops, hostile, choice) => {
          ownerId = cast.owner.id
          const world = await build(cast, ops, hostile)
          const picked = choice.copies.map((index) => pick(world.honest, index))
          // A stolen writer's entries are the latest word to anyone who hasn't seen the epoch
          // after: they stand beside the owner's only once that later epoch reaches everyone.
          const stolen = picked.some((copy) => copy.by === 'stolen-writer')
          const copies = [
            ...picked.map((copy) => copy.log),
            ...(choice.withFinal || stolen ? [world.final] : []),
          ]
          const base = pick(
            world.kept.filter((log) => !isTailLog(log)),
            choice.base,
          )
          const results = await Promise.all(
            [copies, shuffled(copies, choice.order), [...copies].reverse()].map((order) =>
              gossip(base, order),
            ),
          )
          for (const result of results)
            expect(current(result)).toBe(current(results[0] as DeviceLog))
          // With only the owner's own copies, every order ends on the very same log.
          if (picked.every((copy) => copy.by === 'owner'))
            for (const result of results) expect(same(result, results[0])).toBe(true)
          // And with the owner's latest among them, on the owner's own list.
          if (copies.includes(world.final) && !picked.some((copy) => copy.by === 'key-used-twice'))
            expect(current(results[0] as DeviceLog)).toBe(current(world.final))
        }),
        { numRuns: suite.runs },
      ))

    it('takes the owner’s latest log over any older copy of it', () =>
      fc.assert(
        fc.asyncProperty(suite.ops, attack, async (ops, hostile) => {
          ownerId = cast.owner.id
          const world = await build(cast, ops, hostile)
          for (const log of world.kept) {
            const merged = await mergeDeviceLogs(crypto, log, world.final)
            expect(current(merged)).toBe(current(world.final))
          }
        }),
        { numRuns: suite.runs },
      ))

    it('never brings back a device removed in the epoch it holds', () =>
      forEachMerge((ours, _theirs, merged) => {
        const epoch = latest(ours)
        if (latest(merged) !== epoch || !same(recoverOf(ours, epoch), recoverOf(merged, epoch)))
          return
        const active = deviceState(merged).active
        for (const device of removedIn(chainOf(ours, epoch))) expect(active.has(device)).toBe(false)
      }))

    it('keeps a used recovery key replaced', () =>
      forEachMerge(
        (ours, _theirs, merged) => {
          // Every recover with a later epoch on top of it stays as it is.
          for (let epoch = isTailLog(ours) ? firstEpoch(ours) : 1; epoch < latest(ours); epoch += 1)
            expect(same(recoverOf(merged, epoch), recoverOf(ours, epoch))).toBe(true)
          // And so does the key epoch 1 was committed to.
          if (ours.recovery !== undefined) expect(same(merged.recovery, ours.recovery)).toBe(true)
        },
        { forged: true },
      ))

    it('never shortens our own copy', () =>
      forEachMerge((ours, _theirs, merged) => {
        const top = latest(ours)
        expect(latest(merged)).toBeGreaterThanOrEqual(top)
        // A merge cuts the oldest epochs' last entries to stay at the limit, never the current one.
        const cut = total(merged) >= MAX_DEVICE_ENTRIES
        for (let epoch = isTailLog(ours) ? firstEpoch(ours) : 0; epoch <= top; epoch += 1) {
          // At our latest epoch the lower of two recovers by the current key wins.
          if (epoch > 0 && !same(recoverOf(merged, epoch), recoverOf(ours, epoch))) {
            expect(epoch).toBe(top)
            continue
          }
          const before = chainOf(ours, epoch)
          const after = chainOf(merged, epoch)
          // Cut or not, an older epoch's chain is still the same chain as ours.
          if (cut && epoch < latest(merged))
            expect(isPrefix(after, before) || isPrefix(before, after)).toBe(true)
          else expect(isPrefix(before, after)).toBe(true)
        }
      }))

    it('keeps a log that holds, with its writer on the list', () =>
      forEachMerge(async (_ours, _theirs, merged) => {
        const log = lowSDeviceLog(merged)
        const holds = isTailLog(log)
          ? await verifyOwnTail(crypto, log)
          : await verifyDeviceLog(crypto, log)
        expect(holds).toBe(true)
        const state = deviceState(merged)
        if (state.writer !== '') expect(state.active.has(state.writer)).toBe(true)
      }))

    it('changes nothing when the same copy, or the result, is merged again', () =>
      forEachMerge(async (_ours, theirs, merged) => {
        expect(same(await mergeDeviceLogs(crypto, merged, theirs), merged)).toBe(true)
        expect(await mergeDeviceLogs(crypto, merged, merged)).toBe(merged)
      }))

    it('refuses a signature in capitals, and gains nothing from its other spelling', () =>
      forEachMerge(async (ours, theirs, merged, copy) => {
        // Re-spelling a copy that is itself re-spelled can spell it back as it was.
        if (copy.respelled) return
        // Its low-S spelling is the one a copy from before low-S is taken in.
        const lowS = current(await mergeDeviceLogs(crypto, ours, lowSDeviceLog(theirs)))
        for (const which of [0, 1, 2, 7]) {
          const shouted = respelled(theirs, which, true)
          if (shouted !== undefined) expect(await mergeDeviceLogs(crypto, ours, shouted)).toBe(ours)
          const twin = respelled(theirs, which, false)
          if (twin === undefined) continue
          const result = current(await mergeDeviceLogs(crypto, ours, twin))
          expect([current(ours), current(merged), lowS]).toContain(result)
        }
      }))
  })
}
