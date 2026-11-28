// The invariants of the model-based test, as verification/specs/device-sync.md names them, read
// off the real devices' state: R1, R2 and R4 after every step, T2 across each step, and, once mail
// settles, S0, C1, T1, W1 and T4. And the flags that say what a world reached.
//
// Only tests import this.
import { everDevices } from '../../devices/device-log.ts'
import { canonicalJson } from '../../encoding/canonical.ts'
import { readOp, type SharedEntry, STAMP_CAP } from '../entry.ts'
import { counting, foldShared, later, type SharedView } from '../fold.ts'
import {
  context,
  type Dev,
  devOf,
  type Friend,
  friendOf,
  honest,
  IDENTITY,
  idOf,
  knowsRemoval,
  MONTH,
  REMOVED,
  registerOf,
  type Scenario,
  shownValue,
  viewOn,
  type World,
} from './model-world.ts'

const canonView = (view: SharedView | undefined): string =>
  view === undefined
    ? 'none'
    : canonicalJson({
        friendships: [...view.friendships.keys()].sort(),
        shown: [...view.shown].map(([f, s]) => `${f}:${s.inc}`).sort(),
        petnames: [...view.petnames].map(([f, n]) => `${f}:${n}`).sort(),
        mutes: [...view.mutes].map(([f, u]) => `${f}:${u}`).sort(),
        blocked: [...view.blocked.keys()].sort(),
        relay: view.relay,
      })

/** A violated invariant: its id, as the spec names it, and what was seen. */
export interface Violation {
  readonly id: string
  readonly message: string
}

/** The invariants checked after every step. */
export function safety(w: World, s: Scenario): Violation[] {
  const out: Violation[] = []
  const x = idOf(REMOVED)
  for (const d of honest(w, s)) {
    const dev = w.devs[d]
    if (dev === undefined) continue
    const late = dev.shared.entries.find((e) => w.late.includes(e.sig))
    if (late !== undefined)
      out.push({ id: 'R1', message: `${d} holds an entry X made after every device knew` })
    const stranger = dev.shared.entries.find((e) => e.device === idOf('Z'))
    if (stranger !== undefined)
      out.push({ id: 'R4', message: `${d} holds an entry from a key never on the device log` })
    // W2: a change is stamped at the cap only after an entry about the same thing that still
    // counts there; one that doesn't count (a removed device's, discounted) never pushes it there.
    const counted = counting(dev.shared, context(dev))
    for (const a of w.actions) {
      if (a.by !== d || a.stamp < STAMP_CAP - 1) continue
      const followed = counted.some(
        ({ entry, op }) =>
          entry.device !== idOf(d) && registerOf(op) === a.register && entry.stamp >= a.stamp - 1,
      )
      if (!followed)
        out.push({
          id: 'W2',
          message: `${d} stamped ${a.register} at the cap, past nothing that counts`,
        })
    }
    if (knowsRemoval(dev) && w.removalFrom > 0) {
      const kept = dev.shared.entries.filter((e) => !(e.device === x && e.stamp >= w.removalFrom))
      const as = canonView(viewOn(w, d))
      const without = canonView(foldShared({ identity: IDENTITY, entries: kept }, context(dev)))
      if (as !== without)
        out.push({ id: 'R2', message: `${d} shows something X stamped after its removal` })
    }
  }
  return out
}

/** T2, checked across each step: a tombstone held is never undone. */
export function tombsHold(before: World, label: string, after: World, s: Scenario): Violation[] {
  const out: Violation[] = []
  for (const d of honest(after, s)) {
    const was = before.devs[d]
    if (was === undefined) continue
    const ended = was.shared.entries.flatMap((e) => {
      const op = readOp(e)
      if (op?.kind !== 'tomb') return []
      const lapses =
        e.device === idOf(REMOVED) && after.removalFrom > 0 && e.stamp >= after.removalFrom
      return lapses || !everDevices(was.log).has(e.device) ? [] : [op.inc]
    })
    const live = [...(viewOn(after, d)?.friendships.keys() ?? [])]
    const back = ended.find((inc) => live.includes(inc))
    if (back !== undefined)
      out.push({ id: 'T2', message: `${d} shows ${back} again after "${label}"` })
  }
  return out
}

/**
 * The value a register should end on: the change with the highest stamp among those people made
 * on devices on the list, and the removed device's own entries that count and reached a device
 * on the list. What the removed device did before its removal counts when the writer held it
 * then, however its stamp compares with the removal's.
 */
function oracle(w: World, s: Scenario): Map<string, string> {
  type Candidate = { stamp: number; by: string; n: number; value: string }
  const candidates = new Map<string, Candidate[]>()
  const add = (register: string, c: Candidate) =>
    candidates.set(register, [...(candidates.get(register) ?? []), c])
  const counted = (by: Dev, stamp: number) =>
    w.removalFrom === 0 || by !== REMOVED || stamp < w.removalFrom
  for (const a of w.actions) {
    const held = w.heldAtRemoval.includes(a.sig)
    if (counted(a.by, a.stamp) || held)
      add(a.register, { stamp: a.stamp, by: idOf(a.by), n: a.n, value: a.value })
  }
  if (s.hostile) {
    const seen = new Map<string, SharedEntry>()
    for (const d of honest(w, s)) {
      const dev = w.devs[d]
      if (dev === undefined) continue
      for (const e of dev.shared.entries)
        if (e.device === idOf(REMOVED) && e.stamp <= STAMP_CAP && counted(REMOVED, e.stamp))
          seen.set(e.sig, e)
    }
    for (const e of seen.values()) {
      const op = readOp(e)
      const register = op === undefined ? undefined : registerOf(op)
      if (op !== undefined && register !== undefined)
        add(register, { stamp: e.stamp, by: e.device, n: e.n, value: shownValue(op) })
    }
  }
  const out = new Map<string, string>()
  for (const [register, list] of candidates) {
    const top = list.reduce((a, b) =>
      later(
        { stamp: a.stamp, device: a.by, n: a.n } as SharedEntry,
        { stamp: b.stamp, device: b.by, n: b.n } as SharedEntry,
      )
        ? a
        : b,
    )
    out.set(register, top.value)
  }
  return out
}

/** The invariants checked once mail settles. */
export function settled(w: World, s: Scenario): Violation[] {
  const out: Violation[] = []
  if (w.unsettled) out.push({ id: 'S0', message: 'settling ran out of rounds' })
  const devices = honest(w, s)
  const views = devices.map((d) => [d, canonView(viewOn(w, d))] as const)
  const [first, ...rest] = views
  const other = rest.find(([, v]) => v !== first?.[1])
  if (other !== undefined && first !== undefined)
    out.push({ id: 'C1', message: `${first[0]} shows ${first[1]}, ${other[0]} shows ${other[1]}` })
  // T1: no friendship a device on the list ended is live, but one whose only tombstones are the
  // removed device's, stamped at or after its removal and never held by the writer then.
  const tombsOf = (inc: string) =>
    devices.flatMap((d) =>
      (w.devs[d]?.shared.entries ?? []).filter((e) => {
        const op = readOp(e)
        return op?.kind === 'tomb' && op.inc === inc
      }),
    )
  const lapsed = (inc: string) =>
    w.removalFrom > 0 &&
    tombsOf(inc).every(
      (e) =>
        e.device === idOf(REMOVED) && e.stamp >= w.removalFrom && !w.heldAtRemoval.includes(e.sig),
    )
  for (const d of devices) {
    const live = [...(viewOn(w, d)?.friendships.keys() ?? [])]
    const back = w.tombs.find((inc) => live.includes(inc) && !lapsed(inc))
    if (back !== undefined) out.push({ id: 'T1', message: `${d} shows ${back}, which was ended` })
  }
  // W1: each register holds its newest change.
  const want = oracle(w, s)
  for (const d of devices) {
    const view = viewOn(w, d)
    if (view === undefined) continue
    const live = new Set([...view.friendships.values()].map((f) => friendOf(f.friend)))
    for (const [register, value] of want) {
      const [kind, fr] = register.split(':') as [string, Friend | undefined]
      const id = fr === undefined ? undefined : idOf(fr)
      const shown =
        kind === 'relay'
          ? String(view.relay)
          : kind === 'block' && id !== undefined
            ? String(view.blocked.has(id))
            : fr !== undefined && id !== undefined && live.has(fr)
              ? kind === 'pet'
                ? (view.petnames.get(id) ?? '')
                : String(view.mutes.get(id) ?? null)
              : undefined
      if (shown !== undefined && shown !== value)
        out.push({
          id: 'W1',
          message: `${d} shows ${register} = ${shown}, the newest change says ${value}`,
        })
    }
  }
  // T4: once a device has seen the friend in one of two live friendships, every device shows
  // the friendship the friend is in.
  for (const d of devices) {
    const view = viewOn(w, d)
    if (view === undefined) continue
    for (const fr of ['F', 'G'] as const) {
      const seen = w.seen[fr]
      const shown = view.shown.get(idOf(fr))
      if (seen === undefined || shown === undefined) continue
      const live = [...view.friendships.values()].filter((f) => f.friend === idOf(fr))
      if (live.some((f) => f.inc === seen) && shown.inc !== seen)
        out.push({
          id: 'T4',
          message: `${d} shows ${shown.inc} for ${fr}, the friend is in ${seen}`,
        })
    }
  }
  return out
}

/** What a world shows happened, so a run that never got there can't pass. */
export function flags(w: World, s: Scenario): string[] {
  const out = new Set<string>()
  if (w.removalFrom > 0) out.add('removed')
  if (w.allKnew) out.add('every device knew of the removal')
  if (w.tombs.length > 0) out.add('unfriended')
  if (w.devs.C !== undefined && !s.devices.includes('C')) out.add('C linked')
  if (w.mail.some((l) => l.lost.length > 0)) out.add('letter lost')
  for (const d of honest(w, s)) {
    const dev = w.devs[d]
    const view = viewOn(w, d)
    if (dev === undefined || view === undefined) continue
    if ([...view.friendships.values()].some((f) => f.friend === idOf('G')))
      out.add(`G live on ${d}`)
    if (view.petnames.size > 0) out.add('petname set')
    if (dev.shared.entries.length > 200) out.add('more entries than one letter holds')
    if (view.mutes.size > 0) out.add('muted')
    if (view.blocked.size > 0) out.add('blocked')
    if (view.relay) out.add('relay on')
    if (dev.clock > MONTH) out.add('a clock ran ahead')
    if (s.hostile && dev.shared.entries.some((e) => e.device === idOf(REMOVED)))
      out.add('forged entry taken')
    if (dev.shared.entries.some((e) => readOp(e) === undefined)) out.add('unreadable entry held')
    const adds = dev.shared.entries.filter((e) => {
      const op = readOp(e)
      return op?.kind === 'add' && op.friend === idOf('F')
    })
    if (adds.length > 2) out.add('F paired twice at once')
  }
  for (const d of honest(w, s)) {
    const entries = w.devs[d]?.shared.entries ?? []
    if (
      entries.some((e) => e.n > 1 && !entries.some((o) => o.device === e.device && o.n === e.n - 1))
    )
      out.add('an entry past a gap held')
  }
  for (const d of honest(w, s))
    if ((w.devs[d]?.shared.entries ?? []).some((e) => e.stamp > STAMP_CAP))
      out.add('an entry above the cap held')
  for (const d of honest(w, s))
    if ((w.devs[d]?.shared.entries ?? []).some((e) => e.kind === 'constructor'))
      out.add('an entry of a kind named like an object property held')
  const sigs = new Map<string, Set<string>>()
  for (const d of honest(w, s))
    for (const e of w.devs[d]?.shared.entries ?? []) {
      const key = `${e.device}/${e.n}`
      sigs.set(key, new Set([...(sigs.get(key) ?? []), e.sig]))
    }
  if ([...sigs.values()].some((set) => set.size > 1))
    out.add('devices hold different entries under one number')
  return [...out].sort()
}

/** A seeded pseudo-random number generator (mulberry32), so a failing walk can be run again. */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const describeEntry = (e: SharedEntry): string =>
  `${devOf(e.device) ?? '?'}${e.n}@${e.stamp}:${e.kind}`
