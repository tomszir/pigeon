// What a hostile removed device does in the your-data model: forge entries at an early or a
// current stamp, forge a pair-secret proposal of its own that claims a high round, sign a second
// entry under a number it used, send what it forged to your devices, and meet them in the self
// room. It reads every letter sealed to it the moment it's put (data-run.ts).
import { canon, copy } from './canon.ts'
import { meet, newLetter } from './data-mail.ts'
import { finish, type Step, spend } from './data-run.ts'
import { countsOn, winner } from './data-secrets.ts'
import {
  type DataConfig,
  type DataState,
  ENTRY_CAP,
  honest,
  LOG_CEIL,
  type LogEvent,
  propKey,
  REMOVED,
  STAMP_CAP,
  WRITER,
} from './data-state.ts'
import { tellFriends, winners } from './data-tell.ts'

/** How many of the configured forgeries X has made so far. */
function forgedSoFar(state: DataState): number {
  const x = state.devs[REMOVED]
  if (!x) return 0
  const entries = x.entries.filter((e) => e.by === REMOVED && e.sig.endsWith('a')).length
  const proposals = Object.values(x.props)
    .flat()
    .filter((p) => p.by === REMOVED).length
  return entries + proposals
}

const ALL: readonly LogEvent[] = ['rmX', 'rmF']

function forgeStep(cfg: DataConfig, state: DataState): Step[] {
  const forge = cfg.forges?.[forgedSoFar(state)]
  if (!forge) return []
  const next = copy(state)
  const dev = next.devs[REMOVED]
  if (!dev) return []
  if ('proposal' in forge) {
    const key = propKey(cfg.rules, 'F', 'F1')
    const held = winner(cfg.rules, dev.props[key] ?? [], countsOn(cfg.rules, next, REMOVED))
    if (!held) return []
    // It claims to have known every removal, the worst case for a rule that trusts the marker.
    const p = { id: 'F1x', inc: 'F1', replaces: held.id, at: 1, by: REMOVED, round: 50, knew: ALL }
    dev.props[key] = [...(dev.props[key] ?? []), p]
    next.secrets[p.id] = { by: REMOVED, knew: next.removalSt > 0 }
    return [['X forges a pair-secret proposal of its own for F, claiming round 50', next]]
  }
  if ('flood' in forge) {
    const from = dev.nextN
    dev.nextN = from + 2 * ENTRY_CAP
    for (let n = from; n < dev.nextN; n++)
      dev.entries = [...dev.entries, { by: REMOVED, n, st: n, op: { k: 'future' }, sig: `X${n}a` }]
    return [[`X signs entries ${from} to ${dev.nextN - 1}, of a kind no Pigeon reads`, next]]
  }
  if ('root' in forge) {
    // A second first secret for a friendship it has read the first of, stamped as early as can be.
    const inc = `${forge.root}1`
    if (!dev.learned.includes(`${inc}r0`)) return []
    // Stamped as early as it can be, or at the removal's own time once it has been removed.
    if (forge.at === 'removal' && next.removalAt === 0) return []
    const at = forge.at === 'removal' ? next.removalAt : 0
    const key = propKey(cfg.rules, forge.root, inc)
    const p = { id: `${inc}x0`, inc, replaces: null, at, by: REMOVED, round: 0, knew: ALL }
    dev.props[key] = [...(dev.props[key] ?? []), p]
    next.secrets[p.id] = { by: REMOVED, knew: next.removalSt > 0 }
    const when = forge.at === 'removal' ? 'at the removal\u2019s time' : 'as early as it can'
    return [[`X forges a second first secret for ${forge.root}, stamped ${when}`, next]]
  }
  const top =
    Math.max(
      ...Object.values(state.devs).flatMap((d) => [
        d?.clock ?? 0,
        ...(d?.entries ?? []).map((e) => e.st),
      ]),
    ) + 1
  // At the cap: once removed, one below the highest stamp an entry may carry.
  if (forge.stamp === 'cap' && next.removalSt === 0) return []
  // At the device log's ceiling, above the cap, while still on the list.
  if (forge.stamp === 'over' && next.removalSt !== 0) return []
  // Skipping a number leaves a gap no device can fill.
  const n = forge.skip ? dev.nextN + 1 : dev.nextN
  dev.nextN = n + 1
  // Ahead: a stamp far past every clock, which, while X is on the list, raises the threshold.
  const st =
    forge.stamp === 'early'
      ? 1
      : forge.stamp === 'ahead'
        ? top + 10
        : forge.stamp === 'cap'
          ? STAMP_CAP - 1
          : forge.stamp === 'over'
            ? LOG_CEIL
            : top
  const late = next.allKnew ? { late: true as const } : {}
  dev.entries = [...dev.entries, { by: REMOVED, n, st, op: forge.op, sig: `X${n}a`, ...late }]
  const when = {
    early: 'an early',
    ahead: 'a far-ahead',
    cap: 'the capped',
    over: 'the device log\u2019s highest',
    current: 'a current',
  }[forge.stamp]
  const gap = forge.skip ? ', skipping a number,' : ''
  return [[`X forges ${canon(forge.op)}${gap} at ${when} stamp`, next]]
}

export function hostileSteps(cfg: DataConfig, state: DataState): Step[] {
  const x = state.devs[REMOVED]
  if (!cfg.hostile || !x) return []
  const out: Step[] = forgeStep(cfg, state)
  const last = x.entries.filter((e) => e.by === REMOVED).at(-1)
  if ((state.left.fork ?? 0) > 0 && last && !x.entries.some((e) => e.sig === `X${last.n}b`)) {
    const next = copy(state)
    spend(next, 'fork')
    const dev = next.devs[REMOVED]
    const op = { k: 'pet', fr: 'F', v: 'py' } as const
    if (dev) dev.entries = [...dev.entries, { ...last, op, sig: `X${last.n}b` }]
    out.push(['X signs a second entry with the same number', next])
  }
  const own = x.entries.filter((e) => e.by === REMOVED)
  const forged = Object.fromEntries(
    Object.entries(x.props)
      .map(([k, ps]) => [k, ps.filter((p) => p.by === REMOVED)] as const)
      .filter(([, ps]) => ps.length > 0),
  )
  if (own.length > 0 || Object.keys(forged).length > 0)
    for (const r of honest(state, cfg).filter((d) => !cfg.xMails || cfg.xMails.includes(d))) {
      // A second entry under one number goes to the writer one way and to the others the other.
      const variant = r === WRITER ? 'a' : 'b'
      const picked = own.filter(
        (e) =>
          (e.sig.endsWith(variant) || !own.some((o) => o !== e && o.n === e.n)) &&
          (!cfg.xSplits || e.n <= ENTRY_CAP === (r === WRITER)),
      )
      const latest = Math.max(...picked.map((e) => e.n))
      const pick = cfg.xSendsLatest ? picked.filter((e) => e.n === latest) : picked
      const sent = canon([pick, forged])
      if (state.xSent[r] === sent) continue
      const next = copy(state)
      next.xSent[r] = sent
      const letter = newLetter(cfg, next, 'sync', REMOVED, [r], pick, forged, true)
      letter.log = letter.log.filter((e) => e !== 'rmX')
      out.push([`X sends what it forged to ${r}`, finish(cfg, next)])
    }
  // It holds the pair secrets, the tags and the friends' sealing keys, so it mails them too.
  if (Object.keys(forged).length > 0)
    for (const fr of ['F', 'G'] as const) {
      if (!state.friends[fr] || state.xSent[fr] === canon(forged)) continue
      const next = copy(state)
      next.xSent[fr] = canon(forged)
      const letter = newLetter(cfg, next, 'rekey-friend', REMOVED, [fr], [], forged, true)
      letter.log = []
      out.push([`X sends what it forged to ${fr}`, finish(cfg, next)])
    }
  for (const r of honest(state, cfg))
    if ((state.left.meet ?? 0) > 0) {
      const next = copy(state)
      spend(next, 'meet')
      const was = winners(cfg, next, r)
      meet(cfg, next, REMOVED, r)
      tellFriends(cfg, next, r, was)
      out.push([`X meets ${r} in the self room`, finish(cfg, next)])
    }
  return out
}
