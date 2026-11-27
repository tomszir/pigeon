// The test an implementation of waiting must pass: seeded random traces of events, run through
// the reference in `lighthouse.ts` and through the implementation, which must send the same
// things to each connection, in the same order, for every event, and keep a put's reply before
// the wakes it causes. The traces are generated while the reference runs, so cursors name real
// places in the store and frames go to connections that are open.
//
// An implementation takes part through a `Subject`, which turns each event into its own: the
// model's tag and blob names into real ones, its seconds into a clock, its frames into requests on
// a socket. It hands back what it sent, in the model's terms. Nothing here imports Node or the
// implementation, so a package's tests can run it as they are.
import {
  type Body,
  type Event,
  emptyLighthouse,
  type LighthouseState,
  type Output,
  type Request,
  RULES,
  type Rules,
  step,
  type Variant,
  type WaitLimits,
} from './lighthouse.ts'

export interface Subject {
  /** Applies one event, and says what the Lighthouse sent because of it, in the order it went. */
  apply(event: Event): Promise<readonly Output[]>
}

export interface TraceOptions {
  readonly variant: Variant
  readonly limits: WaitLimits
  readonly seed: number
  /** Events after the connections first open. */
  readonly length: number
  /** The connections, by name, with their address range and IPv6 /48 if any. */
  readonly conns: Readonly<Record<string, { readonly range: string; readonly wide?: string }>>
  /** The tag names traces use. */
  readonly tags: readonly string[]
  /** Every open connection sends a keepalive before time passes, so none ever goes idle. */
  readonly keepAlive?: boolean
  /** On the Worker, whether puts may reset it before their wakes go (yes unless said). */
  readonly resets?: boolean
  /** On the Worker, whether it may sleep (yes unless said). */
  readonly sleeps?: boolean
}

/** The tag names a trace may use: a few, so waits and puts often meet. */
export const TRACE_TAGS: readonly string[] = ['t1', 't2', 't3', 't4']

/**
 * The limits an implementation is built with to run the traces: the protocol's own for a wait's
 * shape and a page, and the rest small enough that traces of a few dozen events reach them.
 */
export const TRACE_LIMITS: WaitLimits = {
  maxTags: 128,
  maxSeconds: 600,
  tagsPerRange: 3,
  tagsPer48: 4,
  maxWaitedTags: 5,
  readsPerMinute: 8,
  idleSeconds: 3,
  maxConnections: 4,
  connectionsPerRange: 3,
  pageSize: 256,
}

/**
 * The connections traces use: three behind one IPv4 address, two /64s in one IPv6 /48. An
 * implementation gives each range an address of its own kind.
 */
export const TRACE_CONNS: Readonly<
  Record<string, { readonly range: string; readonly wide?: string }>
> = {
  a: { range: 'v4' },
  b: { range: 'v4' },
  c: { range: 'v4' },
  d: { range: 'v6a', wide: 'v6' },
  e: { range: 'v6b', wide: 'v6' },
}

/** A small seeded generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Traced {
  readonly event: Event
  /** What the reference sent for it. */
  readonly out: readonly Output[]
}

/** A blob's expiry in traces: never reached. */
export const FAR = 1_000_000_000

/**
 * A random trace, made while the reference runs: connections open, then frames (waits of good
 * and bad shapes, puts new and again, lists, drops), keepalives, closes and reopenings, time, and
 * on the Worker its sleeps, alarms and resets mid-put.
 */
export function randomTrace(options: TraceOptions, rules: Rules = RULES): readonly Traced[] {
  const next = random(options.seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
  const { limits } = options
  let state: LighthouseState = emptyLighthouse(options.variant)
  const traced: Traced[] = []
  const reqs: Record<string, number> = {}
  const generation: Record<string, number> = {}
  const names = Object.keys(options.conns)
  const ids: string[] = []
  const run = (event: Event) => {
    const { state: after, out } = step(state, event, limits, rules)
    state = after
    traced.push({ event, out })
  }
  /** A connection's current socket: the name and how many times it has opened. */
  const socket = (name: string) => `${name}.${generation[name] ?? 0}`
  /** Sockets whose client went away without closing them: the Lighthouse still has them open. */
  const silent = new Set<string>()
  const open = (name: string) =>
    state.conns[socket(name)]?.open === true && !silent.has(socket(name))
  const connect = (name: string) => {
    generation[name] = (generation[name] ?? 0) + 1
    reqs[socket(name)] = 1
    const at = options.conns[name]
    run({
      kind: 'connect',
      conn: socket(name),
      range: at?.range ?? 'unknown',
      ...(at?.wide === undefined ? {} : { wide: at.wide }),
    })
  }
  const frame = (name: string, request: Request, crash = false) => {
    const conn = socket(name)
    const req = reqs[conn] ?? 1
    reqs[conn] = req + 1
    run({ kind: 'frame', conn, req, request, ...(crash ? { crash: true } : {}) })
  }
  const someTags = () => {
    const count = 1 + Math.floor(next() * Math.min(3, options.tags.length))
    return [...new Set(Array.from({ length: count }, () => pick(options.tags)))]
  }
  const cursor = () => (next() < 0.5 ? state.seq : Math.floor(next() * (state.seq + 1)))

  for (const name of names) connect(name)
  for (let i = 0; i < options.length; i++) {
    const name = pick(names)
    const roll = next()
    if (!open(name)) {
      if (roll < 0.5) connect(name)
      continue
    }
    if (roll < 0.22) {
      const shape = next()
      const tags =
        shape < 0.04
          ? []
          : shape < 0.08
            ? Array.from({ length: limits.maxTags + 1 }, (_, n) => `x${n}`)
            : someTags()
      // Leases from shorter than the idle time to well past it, as 600 seconds are past 120.
      const seconds =
        shape > 0.96 ? limits.maxSeconds + 1 : shape > 0.93 ? 0 : 1 + Math.floor(next() * 10)
      frame(name, { type: 'wait', tags, cursor: cursor(), seconds })
    } else if (roll < 0.42) {
      const again = ids.length > 0 && next() < 0.15
      const id = again ? pick(ids) : `m${ids.length + 1}`
      if (!again) ids.push(id)
      const crash = options.variant === 'worker' && options.resets !== false && next() < 0.08
      frame(name, { type: 'put', tag: pick(options.tags), id, expires: FAR }, crash)
    } else if (roll < 0.5) frame(name, { type: 'list', tags: someTags(), cursor: cursor() })
    else if (roll < 0.55 && ids.length > 0) frame(name, { type: 'drop', id: pick(ids) })
    else if (roll < 0.61) run({ kind: 'ping', conn: socket(name) })
    else if (roll < 0.63) {
      if (options.keepAlive !== true) silent.add(socket(name))
    } else if (roll < 0.67) run({ kind: 'close', conn: socket(name) })
    else if (roll < 0.9) {
      // Most of the time every connection with a wait keeps alive across the tick, as Pigeon does.
      if (options.keepAlive === true || next() < 0.85)
        for (const other of names)
          if (
            open(other) &&
            (options.keepAlive === true || state.conns[socket(other)]?.wait !== null)
          )
            run({ kind: 'ping', conn: socket(other) })
      // Shorter than the idle time, as a keepalive every 50 seconds is inside 120.
      run({ kind: 'tick', seconds: 1 + Math.floor(next() * 2) })
    } else if (options.variant === 'worker')
      run(next() < 0.6 && options.sleeps !== false ? { kind: 'hibernate' } : { kind: 'alarm' })
  }
  return traced
}

/** What one connection was sent, in order, with `pong`s left out: their timing isn't the rule. */
const toConn = (out: readonly Output[], conn: string): string[] =>
  out
    .filter((o) => o.conn === conn && o.kind !== 'pong')
    .map((o) => JSON.stringify(o.kind === 'reply' ? { req: o.req, body: sortBody(o.body) } : o))

const sortBody = (body: Body): Body =>
  body.type === 'listed' ? { ...body, items: [...body.items] } : body

const conns = (out: readonly Output[]) => [...new Set(out.map((o) => o.conn))].sort()

export interface Mismatch {
  readonly seed: number
  /** How many events in. */
  readonly at: number
  readonly event: Event
  readonly expected: readonly Output[]
  readonly got: readonly Output[]
  /** The trace up to and including the event that went wrong. */
  readonly trace: readonly Event[]
  readonly why: string
}

/** Runs one trace through `subject`; the first event where it sends something else, if any. */
export async function conformTrace(
  subject: Subject,
  traced: readonly Traced[],
  seed: number,
): Promise<Mismatch | undefined> {
  for (let at = 0; at < traced.length; at++) {
    const entry = traced[at]
    if (entry === undefined) continue
    const got = await subject.apply(entry.event)
    const fail = (why: string): Mismatch => ({
      seed,
      at,
      event: entry.event,
      expected: entry.out,
      got,
      trace: traced.slice(0, at + 1).map((t) => t.event),
      why,
    })
    for (const conn of new Set([...conns(entry.out), ...conns(got)])) {
      const want = toConn(entry.out, conn)
      const have = toConn(got, conn)
      if (want.join('\n') !== have.join('\n')) return fail(`${conn} was sent something else`)
    }
    const pongs = (out: readonly Output[]) => out.filter((o) => o.kind === 'pong').length
    if (pongs(entry.out) !== pongs(got))
      return fail('a keepalive went unanswered, or was answered twice')
    // A put's reply goes before the wakes it causes. The reference may send some before it: a
    // Worker catching up on what a reset left unsent. The subject may send no more than that.
    if (entry.event.kind === 'frame' && entry.event.request.type === 'put') {
      const { conn, req } = entry.event
      const wakesBefore = (out: readonly Output[]) => {
        const reply = out.findIndex((o) => o.kind === 'reply' && o.conn === conn && o.req === req)
        return out.filter(
          (o, i) =>
            i < reply && o.kind === 'reply' && o.body.type === 'waited' && o.body.why === 'mail',
        ).length
      }
      if (wakesBefore(got) > wakesBefore(entry.out))
        return fail("a wake went before the put's reply")
    }
  }
  return undefined
}

/** Runs `count` traces from `seed` on, each through a fresh subject; the first mismatch, if any. */
export async function conform(
  makeSubject: () => Promise<Subject>,
  options: Omit<TraceOptions, 'seed'> & { readonly seed?: number; readonly count: number },
): Promise<Mismatch | undefined> {
  const first = options.seed ?? 1
  for (let seed = first; seed < first + options.count; seed++) {
    const traced = randomTrace({ ...options, seed })
    const mismatch = await conformTrace(await makeSubject(), traced, seed)
    if (mismatch !== undefined) return mismatch
  }
  return undefined
}

/** The reference itself as a subject, with any rules turned off: how planted defects are run. */
export function referenceSubject(
  variant: Variant,
  limits: WaitLimits,
  rules: Rules = RULES,
): Subject {
  let state = emptyLighthouse(variant)
  return {
    async apply(event) {
      const { state: after, out } = step(state, event, limits, rules)
      state = after
      return out
    },
  }
}

/**
 * Node and the Worker on the same trace: every frame gets the same reply, every connection hears
 * of mail for the same waits, and the same connections are refused or closed for room. The Worker
 * may answer a lease later, or not at all if the connection closes first, since it notices only
 * when something wakes it; and idle connections close at different times, so a trace for this
 * keeps every connection heard from, and leaves out the Worker's resets and sleeps, which Node has
 * no counterpart for: after a reset the Worker can't tell a blob's putter from anyone else, and
 * after a sleep it has forgotten how much each range has read.
 */
export function parity(
  traceOptions: Omit<TraceOptions, 'variant'>,
  rules: Rules = RULES,
): string | undefined {
  const events = randomTrace(
    { ...traceOptions, variant: 'worker', keepAlive: true, resets: false, sleeps: false },
    rules,
  ).map((t) => t.event)
  let node = emptyLighthouse('node')
  let work = emptyLighthouse('worker')
  const heard = { node: new Map<string, string[]>(), worker: new Map<string, string[]>() }
  const note = (side: 'node' | 'worker', out: readonly Output[]) => {
    for (const o of out) {
      if (o.kind === 'pong') continue
      if (o.kind === 'close' && o.why === 'idle') continue
      const list = heard[side].get(o.conn) ?? []
      list.push(
        o.kind === 'reply' && o.body.type === 'waited'
          ? `${o.req} ${o.body.why}`
          : JSON.stringify(o),
      )
      heard[side].set(o.conn, list)
    }
  }
  for (const event of events) {
    const a = step(node, event, traceOptions.limits, rules)
    const b = step(work, event, traceOptions.limits, rules)
    node = a.state
    work = b.state
    note('node', a.out)
    note('worker', b.out)
  }
  for (const conn of new Set([...heard.node.keys(), ...heard.worker.keys()])) {
    const n = heard.node.get(conn) ?? []
    const w = heard.worker.get(conn) ?? []
    // The Worker's may stop short of Node's, by lease answers it never got to send.
    const extra = n.slice(w.length)
    const prefix = n.slice(0, w.length)
    if (prefix.join('\n') !== w.join('\n') || !extra.every((line) => line.endsWith(' lease')))
      return `seed ${traceOptions.seed}: ${conn} heard\n  on Node:   ${n.join(' | ')}\n  on Worker: ${w.join(' | ')}`
  }
  return undefined
}
