// The steps of the model-based test's world: those of the your-data model in
// verification/models/device-sync/ (data-steps.ts and data-hostile.ts), as far as they concern
// your data. What people do on a device, what the writer does on a removal or a link, mail checks
// and letters lost, devices meeting in the self room, and what a hostile removed device does.
//
// Only tests import this.
import { appendDeviceEntry } from '../../devices/device-log.ts'
import { base32Encode } from '../../encoding/bytes.ts'
import { canonicalBytes, type Json } from '../../encoding/canonical.ts'
import { blockOps, heldFriendships, removalAt, unfriendOps } from '../changes.ts'
import { SHARED_ENTRY_CONTEXT, type SharedEntry, STAMP_CAP } from '../entry.ts'
import { emptySharedLog, type SharedLog } from '../log.ts'
import { syncBody } from '../sync.ts'
import {
  allowed,
  type Budget,
  check,
  clone,
  context,
  crypto,
  type Dev,
  finish,
  friendOf,
  honest,
  IDENTITY,
  idOf,
  incarnation,
  knowsRemoval,
  MONTH,
  meet,
  REMOVED,
  type Scenario,
  type Step,
  signers,
  spend,
  viewOn,
  type World,
  WRITER,
  write,
} from './model-world.ts'

const step = (label: string, run: (w: World) => Promise<void>): Step => [label, run]

function personSteps(w: World, s: Scenario, d: Dev): Step[] {
  const out: Step[] = []
  const dev = w.devs[d]
  const view = viewOn(w, d)
  if (dev === undefined || view === undefined) return out
  const live = [...new Set([...view.friendships.values()].map((f) => friendOf(f.friend)))]
  const act = (label: string, b: Budget, change: (w: World) => Promise<void>) => {
    if ((w.left[b] ?? 0) <= 0 || !allowed(s, b, d)) return
    out.push(
      step(`${d} ${label}`, async (next) => {
        spend(next, b)
        await change(next)
      }),
    )
  }
  for (const fr of s.adds ?? ['G'])
    if (!live.includes(fr) && !view.blocked.has(idOf(fr)))
      act(`pairs with ${fr}`, 'add', async (next) => {
        const inc = incarnation(++next.incs)
        await write(next, s, d, { kind: 'add', friend: idOf(fr), inc })
        next.seen[fr] = inc
      })
  for (const fr of live) {
    if (fr === undefined || (s.targets !== undefined && !s.targets.includes(fr))) continue
    act(`unfriends ${fr}`, 'unfriend', async (next) => {
      const nd = next.devs[d]
      if (nd === undefined) return
      // The friendships the person ends, whatever the entries written say.
      const ended = heldFriendships(nd.shared, context(nd), idOf(fr))
      next.tombs = [...new Set([...next.tombs, ...ended])]
      for (const op of unfriendOps(nd.shared, context(nd), idOf(fr))) await write(next, s, d, op)
    })
    const name = `p${d}`
    if (view.petnames.get(idOf(fr)) !== name)
      act(`names ${fr} ${name}`, 'pet', (next) =>
        write(next, s, d, { kind: 'pet', friend: idOf(fr), name }).then(() => undefined),
      )
    const until = view.mutes.has(idOf(fr)) ? null : -1
    act(`${until === null ? 'unmutes' : 'mutes'} ${fr}`, 'mute', (next) =>
      write(next, s, d, { kind: 'mute', friend: idOf(fr), until }).then(() => undefined),
    )
    if (!view.blocked.has(idOf(fr)))
      act(`blocks ${fr}`, 'block', async (next) => {
        const nd = next.devs[d]
        if (nd === undefined) return
        const ended = heldFriendships(nd.shared, context(nd), idOf(fr))
        next.tombs = [...new Set([...next.tombs, ...ended])]
        for (const op of blockOps(nd.shared, context(nd), idOf(fr), fr)) await write(next, s, d, op)
      })
  }
  for (const fr of ['F', 'G'] as const)
    if (view.blocked.has(idOf(fr)))
      act(`unblocks ${fr}`, 'unblock', (next) =>
        write(next, s, d, { kind: 'block', friend: idOf(fr), on: false }).then(() => undefined),
      )
  act(`relay ${!view.relay}`, 'relay', (next) =>
    write(next, s, d, { kind: 'setting', key: 'relay', value: !view.relay }).then(() => undefined),
  )
  act('writes an entry only a newer Pigeon reads', 'future', async (next) => {
    const nd = next.devs[d]
    if (nd === undefined) return
    nd.clock += 1
    nd.shared = await signRaw(nd.shared, d, { kind: 'future', note: 'newer' }, nd.clock)
    nd.dirty = true
  })
  act('renames F 120 times in a row, more than one letter holds', 'burst', async (next) => {
    for (let i = 0; i < 120; i++)
      await write(next, s, d, { kind: 'pet', friend: idOf('F'), name: `b${d}${i}` })
  })
  act('has its clock run a month ahead', 'skew', async (next) => {
    const nd = next.devs[d]
    if (nd !== undefined) nd.clock += MONTH
  })
  return out
}

/** Signs an entry as `d`, whatever it says, outside the rules (newer kinds, forgeries). */
async function signRaw(
  log: SharedLog,
  d: Dev | 'Z',
  fields: Readonly<Record<string, Json>>,
  stamp: number,
  n?: number,
): Promise<SharedLog> {
  const mine = log.entries.filter((e) => e.device === idOf(d))
  const unsigned = {
    v: SHARED_ENTRY_CONTEXT,
    identity: IDENTITY,
    device: idOf(d),
    n: n ?? (mine.at(-1)?.n ?? 0) + 1,
    stamp,
    ...fields,
  }
  const sig = base32Encode(await signers[d].sign(canonicalBytes(unsigned)))
  const entry = { ...unsigned, sig } as SharedEntry
  return { identity: IDENTITY, entries: [...log.entries, entry] }
}

function writerSteps(w: World): Step[] {
  const out: Step[] = []
  const dev = w.devs[WRITER]
  if (dev === undefined) return out
  if ((w.left.remove ?? 0) > 0 && !knowsRemoval(dev))
    out.push(
      step(`${WRITER} removes ${REMOVED}`, async (next) => {
        spend(next, 'remove')
        const writer = next.devs[WRITER]
        if (writer === undefined) return
        writer.clock += 1
        // The removal's own `at` is the threshold: later than everything the writer holds from X,
        // so what X had already delivered keeps counting however fast its clock ran. The writer's
        // own clock doesn't follow it.
        const at = removalAt(writer.shared, [idOf(REMOVED)], writer.clock)
        const removed = await appendDeviceEntry(
          crypto,
          writer.log,
          signers.A,
          { kind: 'remove', device: idOf(REMOVED) },
          at,
        )
        if (!removed.ok) throw new Error('could not remove')
        writer.log = removed.log
        next.removalFrom = at
        next.heldAtRemoval = writer.shared.entries
          .filter((e) => e.device === idOf(REMOVED))
          .map((e) => e.sig)
        writer.dirty = true
      }),
    )
  if ((w.left.link ?? 0) > 0 && w.devs.C === undefined)
    out.push(
      step(`${WRITER} links C`, async (next) => {
        spend(next, 'link')
        const writer = next.devs[WRITER]
        if (writer === undefined) return
        const added = await appendDeviceEntry(
          crypto,
          writer.log,
          signers.A,
          { kind: 'add', device: idOf('C'), name: 'C' },
          writer.clock,
        )
        if (!added.ok) throw new Error('could not link')
        writer.log = added.log
        writer.dirty = true
        next.devs.C = {
          clock: writer.clock,
          log: writer.log,
          shared: writer.shared,
          peers: {},
          dirty: false,
        }
      }),
    )
  return out
}

function hasWork(w: World, r: Dev): boolean {
  return (
    (w.devs[r]?.dirty ?? false) ||
    w.mail.some(
      (l) => (l.from === r && (!l.put || l.lost.length > 0)) || (l.put && l.pending.includes(r)),
    )
  )
}

function mailSteps(w: World, s: Scenario): Step[] {
  const out: Step[] = []
  for (const r of honest(w, s))
    if (hasWork(w, r)) out.push(step(`${r} checks mail`, (next) => check(next, s, r)))
  if ((w.left.lose ?? 0) <= 0) return out
  w.mail.forEach((l, i) => {
    if (!l.put) return
    for (const r of l.pending)
      out.push(
        step(`#${l.id} is lost for ${r}`, async (next) => {
          spend(next, 'lose')
          const nl = next.mail[i]
          if (nl === undefined) return
          nl.pending = nl.pending.filter((p) => p !== r)
          nl.lost = [...new Set([...nl.lost, r])]
        }),
      )
  })
  return out
}

function deviceSteps(w: World, s: Scenario, d: Dev): Step[] {
  const out: Step[] = []
  if ((w.left.meet ?? 0) <= 0) return out
  for (const other of honest(w, s))
    if (other > d)
      out.push(
        step(`${d} and ${other} meet in the self room`, async (next) => {
          spend(next, 'meet')
          await meet(next, s, d, other)
        }),
      )
  return out
}

/** What a hostile removed device does: forge, sign two entries under one number, send, meet. */
function hostileSteps(w: World, s: Scenario): Step[] {
  const x = w.devs[REMOVED]
  if (!s.hostile || x === undefined) return []
  const out: Step[] = []
  const forge = s.forges?.[w.forged]
  if (forge !== undefined)
    out.push(
      step(`X forges ${forge.op} at stamp ${forge.stamp}`, async (next) => {
        const nx = next.devs[REMOVED]
        if (nx === undefined) return
        next.forged += 1
        const top =
          Math.max(
            ...Object.values(next.devs).flatMap((d) => [
              d.clock,
              ...d.shared.entries.map((e) => e.stamp),
            ]),
          ) + 1
        const stamp =
          forge.stamp === 'early'
            ? 1
            : forge.stamp === 'cap'
              ? STAMP_CAP - 1
              : forge.stamp === 'over'
                ? STAMP_CAP + 1000
                : top
        const fields: Record<string, Json> =
          forge.op === 'unfriendF'
            ? { kind: 'tomb', friend: idOf('F'), inc: incarnation(1) }
            : { kind: 'pet', friend: idOf('F'), name: 'px' }
        nx.shared = await signRaw(nx.shared, REMOVED, fields, stamp)
        const made = nx.shared.entries.at(-1)
        if (made !== undefined && next.allKnew) next.late = [...next.late, made.sig]
      }),
    )
  const own = x.shared.entries.filter((e) => e.device === idOf(REMOVED))
  const last = own.at(-1)
  if (
    (w.left.fork ?? 0) > 0 &&
    last !== undefined &&
    !own.some((e) => e !== last && e.n === last.n)
  )
    out.push(
      step('X signs a second entry with the same number', async (next) => {
        spend(next, 'fork')
        const nx = next.devs[REMOVED]
        if (nx === undefined) return
        const fields = { kind: 'pet', friend: idOf('F'), name: 'py' }
        nx.shared = await signRaw(nx.shared, REMOVED, fields, last.stamp, last.n)
        const made = nx.shared.entries.at(-1)
        if (made !== undefined && next.allKnew) next.late = [...next.late, made.sig]
      }),
    )
  if ((w.left.proto ?? 0) > 0)
    out.push(
      step('X signs entries whose kinds are the names objects already have', async (next) => {
        spend(next, 'proto')
        const nx = next.devs[REMOVED]
        if (nx === undefined) return
        for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
          const top = Math.max(
            0,
            ...nx.shared.entries.filter((e) => e.device === idOf(REMOVED)).map((e) => e.n),
          )
          nx.shared = await signRaw(nx.shared, REMOVED, { kind, extra: 'x' }, 1, top + 1)
          const made = nx.shared.entries.at(-1)
          if (made !== undefined && next.allKnew) next.late = [...next.late, made.sig]
        }
      }),
    )
  if ((w.left.gap ?? 0) > 0)
    out.push(
      step(
        'X signs entries that skip numbers, of a kind only a newer Pigeon reads',
        async (next) => {
          spend(next, 'gap')
          const nx = next.devs[REMOVED]
          if (nx === undefined) return
          const top = Math.max(0, ...own.map((e) => e.n))
          for (const n of [top + 2, top + 4]) {
            nx.shared = await signRaw(
              nx.shared,
              REMOVED,
              { kind: 'future', note: `gap ${n}` },
              1,
              n,
            )
            const made = nx.shared.entries.at(-1)
            if (made !== undefined && next.allKnew) next.late = [...next.late, made.sig]
          }
        },
      ),
    )
  if ((w.left.stranger ?? 0) > 0)
    out.push(
      step('a key never on the device log signs a rename and sends it to A', async (next) => {
        spend(next, 'stranger')
        const nx = next.devs[REMOVED]
        if (nx === undefined) return
        const stranger = await signRaw(
          emptySharedLog(IDENTITY),
          'Z',
          { kind: 'pet', friend: idOf('F'), name: 'pz' },
          1,
        )
        nx.shared = { identity: IDENTITY, entries: [...nx.shared.entries, ...stranger.entries] }
      }),
    )
  const sent = x.shared.entries.filter((e) => e.device === idOf(REMOVED) || e.device === idOf('Z'))
  if (sent.length > 0)
    for (const r of honest(w, s)) {
      // A second entry under one number goes to the writer one way and to the others the other.
      const pick = sent.filter((e) => {
        const twins = sent.filter((o) => o.device === e.device && o.n === e.n)
        if (twins.length < 2) return true
        return (twins.indexOf(e) === 0) === (r === WRITER)
      })
      const key = pick.map((e) => e.sig).join(',')
      if (w.xSent[r] === key) continue
      out.push(
        step(`X sends what it forged to ${r}`, async (next) => {
          next.xSent[r] = key
          const nx = next.devs[REMOVED]
          if (nx === undefined) return
          next.mail.push({
            id: next.nextLetter++,
            from: REMOVED,
            to: [r],
            pending: [r],
            lost: [],
            put: true,
            body: syncBody({ log: nx.log, summary: {}, entries: pick }),
            sealedWith: nx.log,
          })
        }),
      )
    }
  if ((w.left.meet ?? 0) > 0)
    for (const r of honest(w, s))
      out.push(
        step(`X meets ${r} in the self room`, async (next) => {
          spend(next, 'meet')
          await meet(next, s, REMOVED, r)
        }),
      )
  return out
}

export function steps(w: World, s: Scenario): Step[] {
  const devices = honest(w, s)
  return [
    ...devices.flatMap((d) => personSteps(w, s, d)),
    ...writerSteps(w),
    ...devices.flatMap((d) => deviceSteps(w, s, d)),
    ...mailSteps(w, s),
    ...hostileSteps(w, s),
  ]
}

/** Runs one step on a copy of `w`, and works out the ghosts that depend on the whole world. */
export async function apply(w: World, s: Scenario, [, run]: Step): Promise<World> {
  const next = clone(w)
  await run(next)
  finish(next, s)
  return next
}
