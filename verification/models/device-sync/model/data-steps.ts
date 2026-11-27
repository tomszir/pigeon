// The steps of the your-data model: what people do on a device, what devices send and take, what
// the Lighthouses lose, and what a hostile removed device does. Each step returns a new state;
// none changes the one it was given.
import { canon, copy, uniq } from './canon.ts'
import { fieldOf, liveFriends, valueIn, viewOf } from './data-fold.ts'
import { deliver, meet, newLetter, sealTo, takeEntries } from './data-mail.ts'
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
  REMOVED,
  WRITER,
} from './data-state.ts'

export type Step = readonly [string, DataState]

function spend(state: DataState, budget: Budget): boolean {
  const left = state.left[budget] ?? 0
  if (left <= 0) return false
  state.left[budget] = left - 1
  return true
}

/**
 * Works out the ghosts that depend on the whole state, and has whoever takes mail at once take
 * it: a hostile removed device reads every letter sealed to it the moment it's put (the worst
 * case), and a friend's device takes its letters (when doesn't matter to anything checked here).
 */
export function finish(cfg: DataConfig, state: DataState): DataState {
  const readers = ['F', 'G', ...(cfg.hostile ? [REMOVED] : [])]
  state.mail.forEach((l, i) => {
    if (!l.put) return
    for (const r of l.pending) if (readers.includes(r)) deliver(cfg, state, i, r)
  })
  sweep(state)
  state.allKnew =
    state.removalSt > 0 &&
    honest(state, cfg).every((d) => {
      const dev = state.devs[d]
      return dev !== undefined && knowsRemoval(dev)
    })
  return state
}

/** A change a person makes on device `d`, as a new entry of its log. */
function write(cfg: DataConfig, state: DataState, d: Dev, op: Op): Entry {
  const dev = state.devs[d]
  if (!dev) throw new Error(`no device ${d}`)
  dev.clock += 1
  const n = dev.nextN++
  const e: Entry = { by: d, n, st: dev.clock, op, sig: `${d}${n}a` }
  dev.entries = takeEntries(cfg, dev.entries, [e]).entries
  dev.dirty = true
  const field = fieldOf(e)
  if (field !== undefined && !(d === REMOVED && cfg.hostile))
    state.actions.push({ by: d, n, st: e.st, field, value: valueIn(e) })
  return e
}

const friendsOf = (cfg: DataConfig, state: DataState, d: Dev) =>
  liveFriends(viewOf(state, cfg.rules, d))

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
  if (!live.includes('G') && !view.blocked.G)
    act('adds G', 'add', (s) => {
      const k = Object.keys(s.secrets).filter((id) => /^G\d+r0$/.test(id)).length + 1
      const inc = `G${k}`
      const secret = { id: `G${k}r0`, round: 0 }
      write(cfg, s, d, { k: 'add', fr: 'G', inc })
      const dev = s.devs[d]
      if (dev) {
        dev.secrets.G = secret
        dev.learned = uniq([...dev.learned, secret.id])
      }
      s.secrets[secret.id] = { by: d, knew: dev ? knowsRemoval(dev) : false }
      s.friends.G = { secret, learned: [secret.id] }
    })
  for (const fr of live.filter((f) => !cfg.targets || cfg.targets.includes(f))) {
    const incs = Object.entries(view.live).flatMap(([inc, f]) => (f === fr ? [inc] : []))
    act(`unfriends ${fr}`, 'unfriend', (s) => unfriend(cfg, s, d, fr, incs))
    const v = `p${d}`
    if (view.pet[fr] !== v) act(`names ${fr} ${v}`, 'pet', (s) => write(cfg, s, d, pet(fr, v)))
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
  return out
}

const pet = (fr: FriendId, v: string): Op => ({ k: 'pet', fr, v })

function unfriend(cfg: DataConfig, s: DataState, d: Dev, fr: FriendId, incs: string[]): void {
  s.tombs = uniq([...s.tombs, ...incs])
  const dev = s.devs[d]
  if (!cfg.rules.tombstones) {
    // Without tombstones the friendship is only dropped here.
    if (dev) dev.entries = dev.entries.filter((e) => !(e.op.k === 'add' && incs.includes(e.op.inc)))
    if (dev) dev.dirty = true
    return
  }
  for (const inc of incs) write(cfg, s, d, { k: 'tomb', fr, inc })
}

/** Sends this device's whole log and its pair secrets to its other devices. */
export function send(cfg: DataConfig, state: DataState, d: Dev): void {
  const dev = state.devs[d]
  if (!dev?.dirty) return
  const to = sealTo(cfg, state, d)
  dev.dirty = false
  if (to.length === 0) return
  // A newer letter takes the place of an older one still waiting on the same devices.
  for (const old of state.mail)
    if (old.from === d && old.kind === 'sync') {
      old.pending = old.pending.filter((p) => !to.includes(p as Dev))
      old.lost = old.lost.filter((p) => !to.includes(p as Dev))
    }
  newLetter(cfg, state, 'sync', d, to, dev.entries, dev.secrets, true)
  state.mail = state.mail.filter((l) => l.pending.length > 0 || l.lost.length > 0 || !l.put)
}

/** The writer replaces every pair secret after a removal, for each friend live there. */
export function rekey(cfg: DataConfig, state: DataState): void {
  const dev = state.devs[WRITER]
  if (!state.renew || !dev || !knowsRemoval(dev)) return
  state.renew = false
  for (const fr of friendsOf(cfg, state, WRITER)) {
    const old = dev.secrets[fr]
    if (!old) continue
    const secret = { id: old.id.replace(/r\d+$/, `r${old.round + 1}`), round: old.round + 1 }
    state.secrets[secret.id] = { by: WRITER, knew: true }
    dev.secrets[fr] = secret
    dev.learned = uniq([...dev.learned, secret.id])
    dev.dirty = true
    const put = false
    newLetter(cfg, state, 'rekey-friend', WRITER, [fr], [], { [fr]: secret }, put)
    newLetter(cfg, state, 'rekey', WRITER, sealTo(cfg, state, WRITER), [], { [fr]: secret }, put)
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
      writer.clock += 1
      writer.log = uniq([...writer.log, 'rmX'])
      writer.dirty = true
      next.removalSt = writer.clock
    }
    next.renew = true
    out.push([`${WRITER} removes ${REMOVED}`, finish(cfg, next)])
  }
  if (state.renew && knowsRemoval(dev)) {
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
        secrets: { ...writer.secrets },
        learned: Object.values(writer.secrets).flatMap((s) => (s ? [s.id] : [])),
      }
    }
    out.push([`${WRITER} links C`, finish(cfg, next)])
  }
  return out
}

/** Letters nobody has left to take, and none waiting to be put, are gone from the Lighthouse. */
export function sweep(state: DataState): void {
  state.mail = state.mail.filter((l) => l.pending.length > 0 || l.lost.length > 0 || !l.put)
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
export function check(cfg: DataConfig, state: DataState, r: string): void {
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
  for (const i of waiting) deliver(cfg, state, i, r)
  if (own) send(cfg, state, own)
  sweep(state)
}

function mailSteps(cfg: DataConfig, state: DataState): Step[] {
  const out: Step[] = []
  for (const r of honest(state, cfg))
    if (hasWork(state, r)) {
      const next = copy(state)
      check(cfg, next, r)
      out.push([`${r} checks mail`, finish(cfg, next)])
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

/** Puts again what was lost: sealed again to the list as it is now, or the same letter. */
export function putAgain(cfg: DataConfig, state: DataState, i: number): void {
  const letter = state.mail[i]
  const dev = letter ? state.devs[letter.from] : undefined
  if (!letter || !dev || letter.lost.length === 0) return
  if (cfg.rules.resealOnReput && letter.kind !== 'rekey-friend') {
    const to = sealTo(cfg, state, letter.from)
    letter.pending = uniq([...letter.lost.filter((p) => to.includes(p as Dev)), ...letter.pending])
    letter.pending = uniq([...letter.pending, ...to.filter((p) => !letter.to.includes(p))])
    letter.to = to
    letter.log = cfg.rules.logFirst ? [...dev.log] : []
  } else letter.pending = uniq([...letter.pending, ...letter.lost])
  letter.lost = []
  letter.knew = knowsRemoval(dev)
  letter.sealedWith = [...dev.log]
}

function deviceSteps(cfg: DataConfig, state: DataState, d: Dev): Step[] {
  const out: Step[] = []
  if (
    (state.left.crash ?? 0) > 0 &&
    !cfg.rules.outbox &&
    state.mail.some((l) => l.from === d && !l.put)
  ) {
    const closed = copy(state)
    spend(closed, 'crash')
    closed.mail = closed.mail.filter((l) => l.from !== d || l.put)
    out.push([`${d}'s tab closes before it puts`, finish(cfg, closed)])
  }
  for (const other of onList(state))
    if (other > d && (state.left.meet ?? 0) > 0 && honest(state, cfg).includes(other)) {
      const next = copy(state)
      spend(next, 'meet')
      meet(cfg, next, d, other)
      out.push([`${d} and ${other} meet in the self room`, finish(cfg, next)])
    }
  return out
}

/** What a hostile removed device does: forge entries, fork one, send them, meet in the room. */
function hostileSteps(cfg: DataConfig, state: DataState): Step[] {
  const out: Step[] = []
  const x = state.devs[REMOVED]
  if (!cfg.hostile || !x) return out
  const top = Math.max(...Object.values(state.devs).map((d) => d?.clock ?? 0)) + 1
  const forged = x.entries.filter((e) => e.by === REMOVED && e.sig.endsWith('a')).length
  const forge = cfg.forges?.[forged]
  if (forge) {
    const next = copy(state)
    const dev = next.devs[REMOVED]
    if (dev) {
      const n = dev.nextN++
      const st = forge.stamp === 'early' ? 1 : top
      const late = next.allKnew ? { late: true as const } : {}
      dev.entries = [...dev.entries, { by: REMOVED, n, st, op: forge.op, sig: `X${n}a`, ...late }]
      out.push([
        `X forges ${canon(forge.op)} at ${forge.stamp === 'early' ? 'an early' : 'a current'} stamp`,
        next,
      ])
    }
  }
  const last = x.entries.filter((e) => e.by === REMOVED).at(-1)
  if ((state.left.fork ?? 0) > 0 && last && !x.entries.some((e) => e.sig === `X${last.n}b`)) {
    const next = copy(state)
    spend(next, 'fork')
    const dev = next.devs[REMOVED]
    if (dev) dev.entries = [...dev.entries, { ...last, op: pet('F', 'py'), sig: `X${last.n}b` }]
    out.push(['X signs a second entry with the same number', next])
  }
  const own = x.entries.filter((e) => e.by === REMOVED)
  if (own.length === 0) return out
  for (const r of honest(state, cfg)) {
    const variant = r === WRITER ? 'a' : 'b'
    const pick = own.filter(
      (e) => e.sig.endsWith(variant) || !own.some((o) => o !== e && o.n === e.n),
    )
    if (state.xSent[r] === canon(pick)) continue
    const next = copy(state)
    next.xSent[r] = canon(pick)
    const letter = newLetter(cfg, next, 'sync', REMOVED, [r], pick, {}, true)
    letter.log = letter.log.filter((e) => e !== 'rmX')
    out.push([`X sends its entries to ${r}`, finish(cfg, next)])
  }
  for (const r of honest(state, cfg))
    if ((state.left.meet ?? 0) > 0) {
      const next = copy(state)
      spend(next, 'meet')
      meet(cfg, next, REMOVED, r)
      out.push([`X meets ${r} in the self room`, finish(cfg, next)])
    }
  return out
}

export function steps(cfg: DataConfig, state: DataState): Step[] {
  const devices = honest(state, cfg)
  return [
    ...devices.flatMap((d) => personSteps(cfg, state, d)),
    ...writerSteps(cfg, state),
    ...devices.flatMap((d) => deviceSteps(cfg, state, d)),
    ...mailSteps(cfg, state),
    ...hostileSteps(cfg, state),
  ]
}
