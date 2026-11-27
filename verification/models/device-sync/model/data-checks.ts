// The invariants of the your-data model, each named as verification/specs/device-sync.md names it.
import { canon } from './canon.ts'
import { counts, fieldOf, valueIn, viewOf } from './data-fold.ts'
import { listFor } from './data-mail.ts'
import { friendSecret, secretOf } from './data-secrets.ts'
import {
  type DataConfig,
  type DataState,
  type Dev,
  type Entry,
  type FriendId,
  honest,
  knowsRemoval,
  REMOVED,
} from './data-state.ts'
import type { Invariant, StepInvariant } from './explore.ts'

type Check = Invariant<DataState>

const honestDevs = (cfg: DataConfig, s: DataState) => honest(s, cfg)

/** P1: every letter an honest device puts is sealed to exactly its list as it was then. */
const sealedToList = (cfg: DataConfig): Check => ({
  id: 'P1 sealed to the list',
  check: (s) => {
    for (const l of s.mail) {
      if (
        l.kind === 'rekey-friend' ||
        l.kind === 'friend-rekey' ||
        (l.from === REMOVED && cfg.hostile)
      )
        continue
      const want = listFor(s, l.sealedWith, l.from as Dev)
      if (canon(l.to) !== canon(want))
        return `#${l.id} from ${l.from} is sealed to ${l.to.join(',')}, its list is ${want.join(',')}`
    }
    return undefined
  },
})

/** P2: a removed device never reads a pair secret made by a device that knew of its removal. */
const noNewSecretToRemoved = (): Check => ({
  id: 'P2 no new secret to a removed device',
  check: (s) => {
    const x = s.devs[REMOVED]
    const leaked = x?.learned.filter((id) => s.secrets[id]?.knew && s.secrets[id]?.by !== REMOVED)
    return leaked?.length ? `${REMOVED} holds ${leaked.join(',')}` : undefined
  },
})

/** P4: whoever holds a secret made after a removal knows of that removal. */
const holdersKnowRemoval = (cfg: DataConfig): Check => ({
  id: 'P4 secret holders know the removal',
  check: (s) => {
    for (const d of honestDevs(cfg, s)) {
      const dev = s.devs[d]
      if (!dev || knowsRemoval(dev)) continue
      const held = Object.values(dev.props)
        .flat()
        .filter((p) => s.secrets[p.id]?.knew && p.by !== REMOVED)
      if (held.length) return `${d} holds ${held.map((p) => p.id).join(',')} without the removal`
    }
    return undefined
  },
})

/** R1: nothing a removed device made once everyone knew of its removal reaches an honest one. */
const nothingLate = (cfg: DataConfig): Check => ({
  id: 'R1 nothing from a removed device once all know',
  check: (s) => {
    for (const d of honestDevs(cfg, s)) {
      const late = s.devs[d]?.entries.find((e) => e.late)
      if (late) return `${d} holds ${late.sig}, made after every device knew of the removal`
    }
    return undefined
  },
})

/** R2: on a device that knows of the removal, nothing the removed device stamped since counts. */
const discounted = (cfg: DataConfig): Check => ({
  id: 'R2 removed device discounted from its removal',
  check: (s) => {
    for (const d of honestDevs(cfg, s)) {
      const dev = s.devs[d]
      if (!dev || !knowsRemoval(dev)) continue
      const kept = dev.entries.filter((e) => !(e.by === REMOVED && e.st >= s.removalSt))
      const as = viewOf(s, cfg.rules, d)
      const without = viewOf(
        { ...s, devs: { ...s.devs, [d]: { ...dev, entries: kept } } },
        cfg.rules,
        d,
      )
      if (canon(as) !== canon(without))
        return `${d} shows something ${REMOVED} stamped after its removal`
    }
    return undefined
  },
})

/**
 * T2: once a device holds a tombstone, that friendship stays ended there; the only exception is a
 * removed device's tombstone stamped at or after its removal, which stops counting by R2.
 */
const tombsHold = (cfg: DataConfig): StepInvariant<DataState> => ({
  id: 'T2 a tombstone held is never undone',
  check: (before, label, after) => {
    for (const d of honestDevs(cfg, after)) {
      const was = before.devs[d]
      if (!was) continue
      const ended = was.entries
        .filter(
          (e) =>
            e.op.k === 'tomb' &&
            !(e.by === REMOVED && after.removalSt > 0 && e.st >= after.removalSt),
        )
        .map((e) => (e.op.k === 'tomb' ? e.op.inc : ''))
      const live = Object.keys(viewOf(after, cfg.rules, d).live)
      const back = ended.find((inc) => live.includes(inc))
      if (back) return `${d} shows ${back} again after "${label}"`
    }
    return undefined
  },
})

/** C1: once mail settles, every device on the list shows the same. */
const converge = (cfg: DataConfig): Check => ({
  id: 'C1 devices on the list converge',
  check: (s) => {
    const views = honestDevs(cfg, s).map((d) => [d, canon(viewOf(s, cfg.rules, d))] as const)
    const [first, ...rest] = views
    const other = rest.find(([, v]) => v !== first?.[1])
    return other && first
      ? `${first[0]} shows ${first[1]}, ${other[0]} shows ${other[1]}`
      : undefined
  },
})

/**
 * T1: once mail settles, no friendship a device on the list ended is live anywhere, except one
 * whose only tombstones are the removed device's, stamped at or after its removal and never held
 * by the writer when it removed it (a removed device's last changes, which the spec accepts).
 */
const unfriendStays = (cfg: DataConfig): Check => ({
  id: 'T1 an ended friendship stays ended',
  check: (s) => {
    const tombsOf = (inc: string) =>
      honestDevs(cfg, s).flatMap((d) =>
        (s.devs[d]?.entries ?? []).filter((e) => e.op.k === 'tomb' && e.op.inc === inc),
      )
    const lapsed = (inc: string) =>
      s.removalSt > 0 &&
      tombsOf(inc).every(
        (e) => e.by === REMOVED && e.st >= s.removalSt && !s.heldAtRemoval.includes(e.sig),
      )
    for (const d of honestDevs(cfg, s)) {
      const live = Object.keys(viewOf(s, cfg.rules, d).live)
      const back = s.tombs.find((inc) => live.includes(inc) && !lapsed(inc))
      if (back) return `${d} shows ${back}, which was ended`
    }
    return undefined
  },
})

/**
 * The value a register should end on: the change with the highest stamp among those people made
 * on devices on the list, and the removed device's own entries that count (those stamped before
 * its removal, which is its own word) and reached a device on the list.
 */
export function oracle(cfg: DataConfig, s: DataState): Map<string, string> {
  type Candidate = { st: number; by: Dev; n: number; value: string }
  const candidates = new Map<string, Candidate[]>()
  const add = (field: string, c: Candidate) =>
    candidates.set(field, [...(candidates.get(field) ?? []), c])
  const before = (by: Dev, st: number) => s.removalSt === 0 || by !== REMOVED || st < s.removalSt
  // What a device on the list did counts; what the removed device did before its removal counts
  // whenever the writer held it then, however its stamp compares with the removal's.
  const held = (a: { by: Dev; n: number }) => s.heldAtRemoval.includes(`${a.by}${a.n}a`)
  for (const a of s.actions) if (before(a.by, a.st) || held(a)) add(a.field, a)
  if (cfg.hostile) {
    const seen = new Map<string, Entry>()
    for (const d of honestDevs(cfg, s))
      for (const e of s.devs[d]?.entries ?? [])
        if (e.by === REMOVED && before(e.by, e.st) && counts(s, cfg.rules, d, e)) seen.set(e.sig, e)
    for (const e of seen.values()) {
      const field = fieldOf(e)
      if (field) add(field, { st: e.st, by: e.by, n: e.n, value: valueIn(e) })
    }
  }
  const out = new Map<string, string>()
  for (const [field, list] of candidates) {
    const top = list.reduce((a, b) =>
      a.st !== b.st
        ? a.st > b.st
          ? a
          : b
        : a.by !== b.by
          ? a.by > b.by
            ? a
            : b
          : a.n > b.n
            ? a
            : b,
    )
    out.set(field, top.value)
  }
  return out
}

/** W1: once mail settles, each register holds its newest change, never an older one. */
const newestWins = (cfg: DataConfig): Check => ({
  id: 'W1 the newest change wins',
  check: (s) => {
    const want = oracle(cfg, s)
    for (const d of honestDevs(cfg, s)) {
      const view = viewOf(s, cfg.rules, d)
      const live = new Set(Object.values(view.live))
      for (const [field, value] of want) {
        const [kind, fr] = field.split(':') as [string, FriendId | undefined]
        const shown =
          kind === 'relay'
            ? String(view.relay)
            : kind === 'block' && fr
              ? String(view.blocked[fr] ?? false)
              : fr && live.has(fr)
                ? (view.pet[fr] ?? '')
                : undefined
        if (shown !== undefined && shown !== value)
          return `${d} shows ${field} = ${shown}, the newest change says ${value}`
      }
    }
    return undefined
  },
})

/** P3: once mail settles, every device on the list and the friend are on one pair secret. */
const sameSecret = (cfg: DataConfig): Check => ({
  id: 'P3 one pair secret per friend',
  check: (s) => {
    for (const d of honestDevs(cfg, s))
      for (const [inc, fr] of Object.entries(viewOf(s, cfg.rules, d).live)) {
        const mine = secretOf(cfg.rules, s, d, fr, inc)?.id
        const friend = s.friends[fr]
        const theirs = friend
          ? `${friendSecret(cfg.rules, s, friend)?.id} in ${friend.inc}`
          : 'none'
        if (`${mine} in ${inc}` !== theirs)
          return `${d} is on ${mine ?? 'nothing'} for ${fr} in ${inc}, ${fr} is on ${theirs}`
      }
    return undefined
  },
})

/** P6: a device that knows of a removal is never on a replacement the removed device proposed. */
const neverOnRemoved = (cfg: DataConfig): Check => ({
  id: 'P6 a removed device\u2019s proposal never wins once heard',
  check: (s) => {
    for (const d of honestDevs(cfg, s)) {
      const dev = s.devs[d]
      if (!dev || !knowsRemoval(dev)) continue
      for (const [inc, fr] of Object.entries(viewOf(s, cfg.rules, d).live)) {
        const mine = secretOf(cfg.rules, s, d, fr, inc)
        if (mine?.by === REMOVED && mine.replaces !== null)
          return `${d} is on ${mine.id}, by ${REMOVED}`
      }
    }
    return undefined
  },
})

/** P2b: once mail settles after a removal, no live friendship is on a secret the removed device read. */
const notOnRead = (cfg: DataConfig): Check => ({
  id: 'P2b no friendship on a secret a removed device read',
  check: (s) => {
    const read = s.devs[REMOVED]?.learned ?? []
    if (s.removalSt === 0) return undefined
    for (const d of honestDevs(cfg, s))
      for (const [inc, fr] of Object.entries(viewOf(s, cfg.rules, d).live)) {
        const mine = secretOf(cfg.rules, s, d, fr, inc)
        if (mine && read.includes(mine.id))
          return `${d} is on ${mine.id} for ${fr}, which ${REMOVED} read`
        const friend = s.friends[fr]
        const theirs = friend?.inc === inc ? friendSecret(cfg.rules, s, friend) : undefined
        if (theirs && read.includes(theirs.id))
          return `${fr} is on ${theirs.id}, which ${REMOVED} read`
      }
    return undefined
  },
})

/** P5: once mail settles, no friendship is on a secret a removed device proposed. */
const notOnRemoved = (cfg: DataConfig): Check => ({
  id: 'P5 no friendship on a removed device\u2019s secret',
  check: (s) => {
    if (s.removalSt === 0) return undefined
    for (const d of honestDevs(cfg, s))
      for (const [inc, fr] of Object.entries(viewOf(s, cfg.rules, d).live)) {
        const mine = secretOf(cfg.rules, s, d, fr, inc)
        if (mine?.by === REMOVED) return `${d} is on ${mine.id}, by ${REMOVED}`
      }
    const live = new Set(
      honestDevs(cfg, s).flatMap((d) => Object.keys(viewOf(s, cfg.rules, d).live)),
    )
    for (const [fr, friend] of Object.entries(s.friends)) {
      // A friendship your devices ended is the friend's to drop; only a live one is checked.
      if (!friend || !live.has(friend.inc)) continue
      const theirs = friendSecret(cfg.rules, s, friend)
      if (theirs?.by === REMOVED) return `${fr} is on ${theirs.id}, by ${REMOVED}`
    }
    return undefined
  },
})

export function dataChecks(cfg: DataConfig) {
  return {
    safety: [
      sealedToList(cfg),
      noNewSecretToRemoved(),
      holdersKnowRemoval(cfg),
      nothingLate(cfg),
      discounted(cfg),
      neverOnRemoved(cfg),
    ],
    stepChecks: [tombsHold(cfg)],
    settled: [
      converge(cfg),
      unfriendStays(cfg),
      newestWins(cfg),
      sameSecret(cfg),
      notOnRemoved(cfg),
      notOnRead(cfg),
    ],
  }
}

/** What a state shows happened, so a run that never got there can't pass. */
export function dataFlags(cfg: DataConfig, s: DataState): string[] {
  const flags: string[] = []
  if (s.removalSt > 0) flags.push('removed')
  if (s.allKnew) flags.push('every device knew of the removal')
  if (Object.values(s.secrets).some((x) => x.knew && x.by !== REMOVED && !x.root))
    flags.push('secret replaced after removal')
  if (Object.values(s.secrets).filter((x) => x.root === 'F').length > 1)
    flags.push('F paired again')
  if (
    s.devs[REMOVED]?.props &&
    Object.values(s.devs[REMOVED]?.props ?? {})
      .flat()
      .some((p) => p.by === REMOVED)
  )
    flags.push('X forged a proposal')
  if (s.tombs.length) flags.push('unfriended')
  if (s.left.link === 0) flags.push('C linked')
  if ((cfg.budgets.crash ?? 0) > (s.left.crash ?? 0)) flags.push('a tab closed')
  if (s.mail.some((l) => l.lost.length)) flags.push('letter lost')
  const sigs = honestDevs(cfg, s).flatMap((d) => (s.devs[d]?.entries ?? []).map((e) => e.sig))
  if (sigs.some((x) => x.endsWith('a') && sigs.includes(`${x.slice(0, -1)}b`)))
    flags.push('devices hold different entries under one number')
  for (const d of honestDevs(cfg, s)) {
    const view = viewOf(s, cfg.rules, d)
    if (Object.values(view.live).includes('G')) flags.push(`G live on ${d}`)
    if (view.pet.F || view.pet.G) flags.push('petname set')
    if (view.blocked.F || view.blocked.G) flags.push('blocked')
    if (view.relay) flags.push('relay on')
    const entries = s.devs[d]?.entries ?? []
    if (entries.some((e) => e.by === REMOVED && cfg.hostile)) flags.push('forged entry taken')
    if (entries.some((e) => e.op.k === 'future')) flags.push('unreadable entry held')
    if (Object.keys(view.live).includes('F2')) flags.push(`F2 live on ${d}`)
    const incsF = (s.devs[d]?.entries ?? []).filter(
      (e) => e.op.k === 'add' && e.op.fr === 'F',
    ).length
    if (incsF > 2) flags.push('F paired twice at once')
    const props = Object.values(s.devs[d]?.props ?? {}).flat()
    if (props.some((p) => p.by === REMOVED)) flags.push('forged proposal taken')
    if ((s.devs[d]?.clock ?? 0) > 9) flags.push('a clock ran ahead')
  }
  return [...new Set(flags)].sort()
}
