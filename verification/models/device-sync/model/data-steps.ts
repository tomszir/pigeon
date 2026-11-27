// The steps of the your-data model: what people do on a device, what devices send and take, what
// the writer does on a removal, and what the Lighthouses lose. Each step returns a new state;
// none changes the one it was given. What a hostile removed device does is in data-hostile.ts.
import { copy, uniq } from './canon.ts'
import { counts, fieldOf, liveFriends, valueIn, viewOf } from './data-fold.ts'
import { hostileSteps } from './data-hostile.ts'
import { deliver, meet, newLetter, sealTo, takeEntries, toSend } from './data-mail.ts'
import { finish, type Step, spend, sweep } from './data-run.ts'
import { countsOn, dropEnded, friendSecret, knew, winner } from './data-secrets.ts'
import {
  type Budget,
  type DataConfig,
  type DataState,
  type Dev,
  type Entry,
  type FriendId,
  honest,
  knowsRemoval,
  newDevice,
  type Op,
  onList,
  type Proposal,
  propKey,
  REMOVED,
  WRITER,
} from './data-state.ts'
import { tellFriends, winners } from './data-tell.ts'

/** What an entry is about: a friend, or a setting. Stamps follow per subject. */
const subjectOf = (op: Op): string => ('fr' in op ? `f:${op.fr}` : op.k)

/**
 * A change a person makes on device `d`, as a new entry of its log. Its stamp is later than the
 * device's own clock and than any entry it holds about the same subject, so a change made after
 * seeing another beats it, while a stamp far ahead elsewhere never pushes this device's clock.
 */
export function write(cfg: DataConfig, state: DataState, d: Dev, op: Op): Entry {
  const dev = state.devs[d]
  if (!dev) throw new Error(`no device ${d}`)
  dev.clock += 1
  const seen = dev.entries.filter((e) => subjectOf(e.op) === subjectOf(op)).map((e) => e.st)
  const st = Math.max(dev.clock, ...seen.map((x) => x + 1))
  const n = dev.nextN++
  const e: Entry = { by: d, n, st, op, sig: `${d}${n}a` }
  dev.entries = takeEntries(cfg, dev.entries, [e]).entries
  dev.dirty = true
  const field = fieldOf(e)
  if (field !== undefined && !(d === REMOVED && cfg.hostile))
    state.actions.push({ by: d, n, st: e.st, field, value: valueIn(e) })
  return e
}

/** Every friendship with `fr` that device `d` holds and hasn't ended, shown or not. */
function heldIncs(cfg: DataConfig, state: DataState, d: Dev, fr: FriendId): string[] {
  const entries = (state.devs[d]?.entries ?? []).filter((e) => counts(state, cfg.rules, d, e))
  const ended = new Set(entries.flatMap((e) => (e.op.k === 'tomb' ? [e.op.inc] : [])))
  return uniq(
    entries.flatMap((e) =>
      e.op.k === 'add' && e.op.fr === fr && !ended.has(e.op.inc) ? [e.op.inc] : [],
    ),
  )
}

/** Pairing with `fr` on device `d`: a new friendship, on a new first secret. */
function pair(cfg: DataConfig, s: DataState, d: Dev, fr: FriendId): void {
  const k = Object.values(s.secrets).filter((x) => x.root === fr).length + 1
  const inc = `${fr}${k}`
  const dev = s.devs[d]
  if (!dev) return
  const root: Proposal = { id: `${inc}r0`, inc, replaces: null, at: dev.clock + 1, by: d, round: 0 }
  write(cfg, s, d, { k: 'add', fr, inc })
  const key = propKey(cfg.rules, fr, inc)
  dev.props[key] = [...(dev.props[key] ?? []), root]
  dev.learned = uniq([...dev.learned, root.id])
  s.secrets[root.id] = { by: d, knew: knew(s, d), root: fr }
  s.friends[fr] = { inc, props: [root], learned: [root.id], knowsR: knowsRemoval(dev) }
}

function unfriend(cfg: DataConfig, s: DataState, d: Dev, fr: FriendId, incs: string[]): void {
  s.tombs = uniq([...s.tombs, ...incs])
  const dev = s.devs[d]
  if (!dev) return
  if (!cfg.rules.tombstones) {
    // Without tombstones the friendship is only dropped here.
    dev.entries = dev.entries.filter((e) => !(e.op.k === 'add' && incs.includes(e.op.inc)))
    dev.dirty = true
    return
  }
  for (const inc of incs) write(cfg, s, d, { k: 'tomb', fr, inc })
  dropEnded(cfg.rules, s, d)
}

function personSteps(cfg: DataConfig, state: DataState, d: Dev): Step[] {
  const out: Step[] = []
  const view = viewOf(state, cfg.rules, d)
  const live = liveFriends(view)
  const act = (label: string, budget: Budget, change: (s: DataState) => void) => {
    if ((state.left[budget] ?? 0) <= 0) return
    if (cfg.who?.[budget] && !cfg.who[budget]?.includes(d)) return
    const next = copy(state)
    spend(next, budget)
    change(next)
    out.push([`${d} ${label}`, finish(cfg, next)])
  }
  for (const fr of cfg.adds ?? ['G'])
    if (!live.includes(fr) && !view.blocked[fr])
      act(`pairs with ${fr}`, 'add', (s) => pair(cfg, s, d, fr))
  for (const fr of live.filter((f) => !cfg.targets || cfg.targets.includes(f))) {
    const incs = heldIncs(cfg, state, d, fr)
    act(`unfriends ${fr}`, 'unfriend', (s) => unfriend(cfg, s, d, fr, incs))
    const v = `p${d}`
    if (view.pet[fr] !== v)
      act(`names ${fr} ${v}`, 'pet', (s) => write(cfg, s, d, { k: 'pet', fr, v }))
    if (!view.blocked[fr])
      act(`blocks ${fr}`, 'block', (s) => {
        unfriend(cfg, s, d, fr, incs)
        write(cfg, s, d, { k: 'block', fr, v: true })
      })
  }
  for (const fr of ['F', 'G'] as const)
    if (view.blocked[fr])
      act(`unblocks ${fr}`, 'unblock', (s) => write(cfg, s, d, { k: 'block', fr, v: false }))
  act(`relay ${!view.relay}`, 'relay', (s) => write(cfg, s, d, { k: 'relay', v: !view.relay }))
  act('writes an entry only a newer Pigeon reads', 'future', (s) =>
    write(cfg, s, d, { k: 'future' }),
  )
  act('has its clock run a month ahead', 'skew', (s) => {
    const dev = s.devs[d]
    if (dev) dev.clock += 10
  })
  return out
}

const entryId = (e: Entry): string => `${e.by}:${e.n}:${e.sig}`

/**
 * Sends this device's other devices what any of them isn't known to hold, by the summary each
 * last sent, and its pair-secret proposals. The letter waits in the outbox until it's put.
 */
export function send(cfg: DataConfig, state: DataState, d: Dev): void {
  const dev = state.devs[d]
  if (!dev?.dirty) return
  const to = sealTo(cfg, state, d)
  dev.dirty = false
  if (to.length === 0) return
  const wanted = new Set(to.flatMap((r) => toSend(cfg, dev.entries, dev.known[r]).map(entryId)))
  const pick = dev.entries.filter((e) => wanted.has(entryId(e)))
  // A newer letter takes the place of an older one still waiting on the same devices.
  for (const old of state.mail)
    if (old.from === d && old.kind === 'sync') {
      old.pending = old.pending.filter((p) => !to.includes(p as Dev))
      old.lost = old.lost.filter((p) => !to.includes(p as Dev))
    }
  state.mail = state.mail.filter(
    (l) => l.from !== d || l.kind !== 'sync' || l.pending.length > 0 || l.lost.length > 0,
  )
  newLetter(cfg, state, 'sync', d, to, pick, dev.props, false)
}

/**
 * The friendships the writer must renew after a removal. Under the design: every one live on it
 * whose secret it didn't itself propose after the removal, whenever it finds one, so a friendship
 * paired or replaced in the window before every device heard (whose secret the removed device may
 * have read) is renewed too, and a rival that beat its proposal is renewed from. Off: those live
 * when it removed, once.
 */
export function toRenew(cfg: DataConfig, state: DataState): [string, FriendId][] {
  const dev = state.devs[WRITER]
  if (!dev || !knowsRemoval(dev)) return []
  if (!cfg.rules.renewWindow && !state.renew) return []
  return Object.entries(viewOf(state, cfg.rules, WRITER).live).filter(([inc, fr]) => {
    if (!cfg.rules.renewWindow) return true
    const held = winner(
      cfg.rules,
      dev.props[propKey(cfg.rules, fr, inc)] ?? [],
      countsOn(cfg.rules, state, WRITER),
    )
    return held !== undefined && !(held.by === WRITER && held.at > state.removalSt)
  })
}

/** The writer replaces the pair secret of each friendship it must renew. */
export function rekey(cfg: DataConfig, state: DataState): void {
  const dev = state.devs[WRITER]
  const renew = toRenew(cfg, state)
  state.renew = false
  if (!dev) return
  for (const [inc, fr] of renew) {
    const key = propKey(cfg.rules, fr, inc)
    const props = dev.props[key] ?? []
    const held = winner(cfg.rules, props, countsOn(cfg.rules, state, WRITER))
    if (!held) continue
    dev.clock = Math.max(dev.clock, state.removalSt) + 1
    let id = `${inc}r${held.round + 1}`
    while (state.secrets[id]) id = `${id}'`
    const p: Proposal = {
      id,
      inc,
      replaces: held.id,
      at: dev.clock,
      by: WRITER,
      round: held.round + 1,
    }
    dev.props[key] = [...props, p]
    dev.learned = uniq([...dev.learned, p.id])
    dev.dirty = true
    state.secrets[p.id] = { by: WRITER, knew: true }
    const chain = { [key]: dev.props[key] ?? [] }
    newLetter(cfg, state, 'rekey-friend', WRITER, [fr], [], chain, false)
    newLetter(cfg, state, 'rekey', WRITER, sealTo(cfg, state, WRITER), [], chain, false)
  }
}

function writerSteps(cfg: DataConfig, state: DataState): Step[] {
  const out: Step[] = []
  const dev = state.devs[WRITER]
  if (!dev) return out
  if ((state.left.remove ?? 0) > 0 && !knowsRemoval(dev)) {
    const next = copy(state)
    spend(next, 'remove')
    const writer = next.devs[WRITER]
    if (writer) {
      // The removal is stamped later than everything the writer holds from X, so what X had
      // already delivered keeps counting however fast its clock ran.
      const held = writer.entries.filter((e) => e.by === REMOVED)
      writer.clock += 1
      if (cfg.rules.removalAfterHeld)
        writer.clock = Math.max(writer.clock, ...held.map((e) => e.st + 1))
      writer.log = uniq([...writer.log, 'rmX'])
      writer.dirty = true
      next.removalSt = writer.clock
      next.heldAtRemoval = held.map((e) => e.sig)
    }
    next.renew = true
    out.push([`${WRITER} removes ${REMOVED}`, finish(cfg, next)])
  }
  if (toRenew(cfg, state).length > 0) {
    const next = copy(state)
    rekey(cfg, next)
    out.push([`${WRITER} replaces the pair secrets`, finish(cfg, next)])
  }
  if ((state.left.link ?? 0) > 0 && !state.devs.C) {
    const next = copy(state)
    spend(next, 'link')
    const writer = next.devs[WRITER]
    if (writer) {
      writer.log = uniq([...writer.log, 'addC'])
      writer.dirty = true
      next.devs.C = {
        ...newDevice(),
        clock: writer.clock,
        log: [...writer.log],
        entries: [...writer.entries],
        props: copy(writer.props),
        learned: Object.values(writer.props).flatMap((ps) => ps.map((p) => p.id)),
      }
    }
    out.push([`${WRITER} links C`, finish(cfg, next)])
  }
  return out
}

/** Whether a mail check by `r` would do anything. */
function hasWork(state: DataState, r: string): boolean {
  const dev = state.devs[r as Dev]
  return (
    (dev?.dirty ?? false) ||
    state.mail.some(
      (l) => (l.from === r && (!l.put || l.lost.length > 0)) || (l.put && l.pending.includes(r)),
    )
  )
}

/**
 * One mail check by `r`, as a Pigeon makes it: it puts what waits in its outbox and puts again
 * what was lost, opens every letter waiting for it before acting on any (so device logs are
 * merged first), and then sends its other devices what they may lack.
 */
export function check(cfg: DataConfig, state: DataState, r: string, closes = false): void {
  const own = r === 'F' || r === 'G' || (r === REMOVED && cfg.hostile) ? undefined : (r as Dev)
  if (own) {
    for (const l of state.mail) if (l.from === own) l.put = true
    state.mail.forEach((l, i) => {
      if (l.from === own && l.lost.length) putAgain(cfg, state, i)
    })
  }
  const waiting = state.mail.flatMap((l, i) => (l.put && l.pending.includes(r) ? [i] : []))
  const logs = waiting.flatMap((i) => state.mail[i]?.log ?? [])
  const dev = own ? state.devs[own] : undefined
  if (dev && logs.length) {
    const before = dev.log.length
    dev.log = uniq([...dev.log, ...logs])
    if (dev.log.length !== before) dev.dirty = true
  }
  const before = own ? winners(cfg, state, own) : {}
  for (const i of waiting) deliver(cfg, state, i, r)
  if (own) settleRepairs(cfg, state, own)
  if (own) tellFriends(cfg, state, own, before)
  if (own) send(cfg, state, own)
  // What the check sent is put before it ends, unless the tab closes first.
  if (own && !closes) for (const l of state.mail) if (l.from === own) l.put = true
  if (own && closes && !cfg.rules.outbox)
    state.mail = state.mail.filter((l) => l.from !== own || l.put)
  sweep(state)
}

/**
 * Two live friendships with one friend (paired again on two devices at once): the friend keeps
 * the pairing that reached it last. Once a device sees the friend in one (a bound hello in its
 * rooms, or a letter under its tags), it ends the other with a tombstone, so every device ends on
 * the friendship the friend is in. Until then the chat says it's still connecting.
 */
function settleRepairs(cfg: DataConfig, state: DataState, d: Dev): void {
  if (!cfg.rules.settleRepairs) return
  for (const fr of ['F', 'G'] as const) {
    const incs = heldIncs(cfg, state, d, fr)
    const seen = state.friends[fr]?.inc
    if (incs.length < 2 || !seen || !incs.includes(seen)) continue
    const others = incs.filter((inc) => inc !== seen)
    state.tombs = uniq([...state.tombs, ...others])
    for (const inc of others) write(cfg, state, d, { k: 'tomb', fr, inc })
  }
}

/** Puts again what was lost: sealed again to the list as it is now, or the same letter. */
export function putAgain(cfg: DataConfig, state: DataState, i: number): void {
  const letter = state.mail[i]
  const from = letter?.from as Dev
  const dev = letter ? state.devs[from] : undefined
  if (!letter || !dev || letter.lost.length === 0) return
  if (cfg.rules.resealOnReput && letter.kind !== 'rekey-friend') {
    const to = sealTo(cfg, state, from)
    letter.pending = uniq([...letter.lost.filter((p) => to.includes(p as Dev)), ...letter.pending])
    letter.pending = uniq([...letter.pending, ...to.filter((p) => !letter.to.includes(p))])
    letter.to = to
    letter.log = cfg.rules.logFirst ? [...dev.log] : []
  } else letter.pending = uniq([...letter.pending, ...letter.lost])
  letter.lost = []
  letter.knew = knowsRemoval(dev)
  letter.sealedWith = [...dev.log]
}

function mailSteps(cfg: DataConfig, state: DataState): Step[] {
  const out: Step[] = []
  for (const r of honest(state, cfg))
    if (hasWork(state, r)) {
      const next = copy(state)
      check(cfg, next, r)
      out.push([`${r} checks mail`, finish(cfg, next)])
      if ((state.left.crash ?? 0) > 0) {
        const closed = copy(state)
        spend(closed, 'crash')
        check(cfg, closed, r, true)
        out.push([`${r} checks mail, and its tab closes before it puts`, finish(cfg, closed)])
      }
    }
  if ((state.left.lose ?? 0) <= 0) return out
  state.mail.forEach((letter, i) => {
    if (!letter.put) return
    for (const r of letter.pending) {
      const lost = copy(state)
      spend(lost, 'lose')
      const l = lost.mail[i]
      if (l) {
        l.pending = l.pending.filter((p) => p !== r)
        l.lost = uniq([...l.lost, r])
      }
      out.push([`#${letter.id} is lost for ${r}`, finish(cfg, lost)])
    }
  })
  return out
}

/**
 * A tab closed before it puts a replacement (which waits for a check to be put): under the
 * design the outbox keeps it, to be put at the next start, so only the budget changes; under the
 * planted defect the letters are gone.
 */
function deviceSteps(cfg: DataConfig, state: DataState, d: Dev): Step[] {
  const out: Step[] = []
  if ((state.left.crash ?? 0) > 0 && state.mail.some((l) => l.from === d && !l.put)) {
    const closed = copy(state)
    spend(closed, 'crash')
    if (!cfg.rules.outbox) closed.mail = closed.mail.filter((l) => l.from !== d || l.put)
    out.push([`${d}'s tab closes before it puts`, finish(cfg, closed)])
  }
  for (const other of onList(state))
    if (other > d && (state.left.meet ?? 0) > 0 && honest(state, cfg).includes(other)) {
      const next = copy(state)
      spend(next, 'meet')
      const was = { [d]: winners(cfg, next, d), [other]: winners(cfg, next, other) }
      meet(cfg, next, d, other)
      for (const x of [d, other]) tellFriends(cfg, next, x, was[x] ?? {})
      out.push([`${d} and ${other} meet in the self room`, finish(cfg, next)])
    }
  return out
}

/**
 * F proposes a replacement of its own, as a friend that removed one of its devices would: sealed
 * to your devices on its copy of your list, which still names X until it hears of the removal.
 */
function friendSteps(cfg: DataConfig, state: DataState): Step[] {
  const friend = state.friends.F
  if ((state.left.friendRound ?? 0) <= 0 || !friend) return []
  const held = friendSecret(cfg.rules, state, friend)
  if (!held) return []
  const next = copy(state)
  spend(next, 'friendRound')
  const f = next.friends.F
  if (!f) return []
  const at = Math.max(...Object.values(next.devs).map((d) => d?.clock ?? 0)) + 1
  const p: Proposal = {
    id: `${f.inc}f${held.round + 1}`,
    inc: f.inc,
    replaces: held.id,
    at,
    by: 'F',
    round: held.round + 1,
  }
  f.props = [...f.props, p]
  f.learned = uniq([...f.learned, p.id])
  next.secrets[p.id] = { by: 'F', knew: f.knowsR }
  const to = (Object.keys(next.devs) as Dev[]).filter((d) => d !== REMOVED || !f.knowsR)
  const key = propKey(cfg.rules, 'F', f.inc)
  next.mail.push({
    id: next.nextLetter++,
    kind: 'friend-rekey',
    from: 'F',
    to,
    pending: to,
    lost: [],
    put: true,
    knew: f.knowsR,
    sealedWith: [],
    log: f.knowsR ? ['rmX'] : [],
    entries: [],
    props: { [key]: f.props },
    summary: {},
  })
  return [['F proposes a replacement of its own', finish(cfg, next)]]
}

export function steps(cfg: DataConfig, state: DataState): Step[] {
  const devices = honest(state, cfg)
  return [
    ...devices.flatMap((d) => personSteps(cfg, state, d)),
    ...writerSteps(cfg, state),
    ...devices.flatMap((d) => deviceSteps(cfg, state, d)),
    ...mailSteps(cfg, state),
    ...hostileSteps(cfg, state),
    ...friendSteps(cfg, state),
  ]
}
