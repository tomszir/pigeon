// A Lighthouse's side of waiting for mail, as a reference: a pure function from a state and one
// event (a connection opening or closing, a frame, a keepalive, time passing, the Worker's object
// sleeping or waking) to the next state and what the Lighthouse sends. The Node and the Worker
// Lighthouse are the same function with a different `variant`: Node answers a lease at its end
// and closes an idle connection on its timer; the Worker has no timers, and notices both when
// something next wakes it, and loses what it keeps in memory whenever it sleeps.
//
// Every rule is a switch in `Rules`, all on in `RULES`; a planted defect turns one off. Nothing
// here is taken from the implementation, which is checked against this by `conformance.ts`.

export type Variant = 'node' | 'worker'

/** The limits a wait is held to, besides the read and connection limits it shares. */
export interface WaitLimits {
  /** Tags one wait may name (128). */
  readonly maxTags: number
  /** The longest lease, in seconds (600). */
  readonly maxSeconds: number
  /** Tags in all live waits from one address range (an IPv4 address or IPv6 /64). */
  readonly tagsPerRange: number
  /** The same, from one IPv6 /48. */
  readonly tagsPer48: number
  /** Tags in all live waits together. */
  readonly maxWaitedTags: number
  /** Reads (lists, gets, drops, waits) one range may make in a minute. */
  readonly readsPerMinute: number
  /** Seconds a connection may send nothing, neither a frame nor a keepalive, before it's idle. */
  readonly idleSeconds: number
  readonly maxConnections: number
  readonly connectionsPerRange: number
  /** Blobs in one `listed` page. */
  readonly pageSize: number
}

/** Each rule the design keeps; a planted defect turns one off. */
export interface Rules {
  /** A new `wait` ends the one standing, answering it `lease`. */
  readonly endsStandingWait: boolean
  /** A wait whose tags already hold a blob past its cursor is answered `mail` at once. */
  readonly answersAtOnce: boolean
  /** A put never wakes the connection that made it. */
  readonly skipsOwnPut: boolean
  /** A put never wakes a wait whose lease has passed. */
  readonly checksLease: boolean
  /** The Worker answers every lease that has passed first thing whenever it's woken. */
  readonly sweepsFirst: boolean
  /** A wait counts as a read. */
  readonly countsWaitAsRead: boolean
  /** The Worker rebuilds its index of waits from the sockets' attachments when it wakes. */
  readonly rebuildsIndex: boolean
  /** ...and wakes the waits a put stored before a reset lost its memory, from `wokeThrough`. */
  readonly rechecksAfterReset: boolean
  /** A wait whose connection has gone quiet past the idle time counts toward no limit. */
  readonly skipsDeadWaits: boolean
  /** A keepalive counts as hearing from a connection, so a waiting one isn't idle. */
  readonly pingsKeepAlive: boolean
  /** A put's reply goes before any wait it wakes is answered. */
  readonly replyBeforeWakes: boolean
  /** A put's reply and the store never depend on waits. */
  readonly putIgnoresWaits: boolean
  /** `waited` says only `mail` or `lease`. */
  readonly bareAnswer: boolean
  /** A new connection that finds no room closes the longest-standing waiter after idle ones. */
  readonly evictsWaiters: boolean
  /** A range's waits are counted by their tags, so many small Pigeons behind one address fit. */
  readonly countsTagsPerRange: boolean
}

export const RULES: Rules = {
  endsStandingWait: true,
  answersAtOnce: true,
  skipsOwnPut: true,
  checksLease: true,
  sweepsFirst: true,
  countsWaitAsRead: true,
  rebuildsIndex: true,
  rechecksAfterReset: true,
  skipsDeadWaits: true,
  pingsKeepAlive: true,
  replyBeforeWakes: true,
  putIgnoresWaits: true,
  bareAnswer: true,
  evictsWaiters: true,
  countsTagsPerRange: true,
}

/**
 * Waits one range may have standing when they're counted by connection, as the first design
 * did (16 there), scaled to the model: only used with `countsTagsPerRange` off.
 */
export const WAITS_PER_RANGE_BY_COUNT = 2

export interface Blob {
  readonly seq: number
  readonly id: string
  readonly tag: string
  readonly expires: number
  /** The connection that put it. Only the reference keeps this; a store never does. */
  readonly by: string
}

export interface Wait {
  readonly req: number
  readonly tags: readonly string[]
  readonly cursor: number
  /** When its lease ends. */
  readonly until: number
  readonly since: number
  /**
   * The order waits began in, for choosing whom to close when there's no room: the longest
   * standing, which is the first to begin, even of two that began in the same moment.
   */
  readonly order: number
}

export interface Conn {
  readonly range: string
  /** Its IPv6 /48, or null for IPv4. */
  readonly wide: string | null
  readonly open: boolean
  /** When it last sent a frame, or opened. */
  readonly seen: number
  /** When it last sent a keepalive. */
  readonly pinged: number
  readonly wait: Wait | null
  /**
   * Its `hello` was answered. A connection says hello first, which counts as a read, so a range
   * past its reads opens connections that can do nothing but hear `hello-first`.
   */
  readonly greeted: boolean
}

export interface LighthouseState {
  readonly variant: Variant
  readonly now: number
  readonly seq: number
  readonly blobs: readonly Blob[]
  readonly conns: Readonly<Record<string, Conn>>
  /** Reads per range in the current minute. */
  readonly reads: Readonly<Record<string, number>>
  readonly minute: number
  /** Whether the index of waits is in memory: always on Node; lost when the Worker sleeps. */
  readonly awake: boolean
  /** The connections in the in-memory index of waits. */
  readonly indexed: readonly string[]
  /** The highest seq whose wakes have all been sent: the Worker keeps it in its storage. */
  readonly wokeThrough: number
  /** Waits begun so far, for each wait's `order`. */
  readonly begun: number
}

export type Request =
  | {
      readonly type: 'wait'
      readonly tags: readonly string[]
      readonly cursor: number
      readonly seconds: number
    }
  | { readonly type: 'put'; readonly tag: string; readonly id: string; readonly expires: number }
  | { readonly type: 'list'; readonly tags: readonly string[]; readonly cursor: number }
  | { readonly type: 'drop'; readonly id: string }

export type Event =
  | {
      readonly kind: 'connect'
      readonly conn: string
      readonly range: string
      readonly wide?: string
    }
  | {
      readonly kind: 'frame'
      readonly conn: string
      readonly req: number
      readonly request: Request
      /** The Worker loses its memory after this put's reply, before the waits it wakes hear. */
      readonly crash?: boolean
    }
  | { readonly kind: 'ping'; readonly conn: string }
  | { readonly kind: 'close'; readonly conn: string }
  | { readonly kind: 'tick'; readonly seconds: number }
  | { readonly kind: 'hibernate' }
  | { readonly kind: 'alarm' }

export type Why = 'mail' | 'lease'

export type Body =
  | { readonly type: 'waited'; readonly why: Why; readonly tag?: string }
  | { readonly type: 'stored' }
  | {
      readonly type: 'listed'
      readonly items: readonly { readonly id: string; readonly tag: string }[]
      readonly cursor: number
      readonly more: boolean
    }
  | { readonly type: 'dropped' }
  | { readonly type: 'error'; readonly error: 'malformed' | 'limit' | 'unknown' | 'hello-first' }

export type Output =
  | { readonly kind: 'reply'; readonly conn: string; readonly req: number; readonly body: Body }
  | { readonly kind: 'close'; readonly conn: string; readonly why: 'idle' | 'room' }
  | { readonly kind: 'refuse'; readonly conn: string }
  | { readonly kind: 'pong'; readonly conn: string }

export interface Stepped {
  readonly state: LighthouseState
  readonly out: readonly Output[]
}

export const emptyLighthouse = (variant: Variant): LighthouseState => ({
  variant,
  now: 0,
  seq: 0,
  blobs: [],
  conns: {},
  reads: {},
  minute: 0,
  awake: true,
  indexed: [],
  wokeThrough: 0,
  begun: 0,
})

/** When a connection was last heard from: its last frame, or its last keepalive. */
export const lastHeard = (conn: Conn, rules: Rules = RULES): number =>
  rules.pingsKeepAlive ? Math.max(conn.seen, conn.pinged) : conn.seen

/** Whether a connection has gone quiet for the idle time: closed when next noticed. */
export const isIdle = (
  conn: Conn,
  now: number,
  limits: WaitLimits,
  rules: Rules = RULES,
): boolean => now - lastHeard(conn, rules) >= limits.idleSeconds

/** The live blobs a `list` of `tags` from `cursor` would name, oldest first. */
export const blobsPast = (
  state: LighthouseState,
  tags: readonly string[],
  cursor: number,
): readonly Blob[] =>
  state.blobs
    .filter((blob) => blob.expires > state.now && blob.seq > cursor && tags.includes(blob.tag))
    .sort((a, b) => a.seq - b.seq)

/** Whether a wait is well formed: 1 to maxTags distinct tags, a lease of 1 to maxSeconds. */
export const waitShapeOk = (request: Request, limits: WaitLimits): boolean =>
  request.type === 'wait' &&
  request.tags.length >= 1 &&
  request.tags.length <= limits.maxTags &&
  new Set(request.tags).size === request.tags.length &&
  Number.isSafeInteger(request.cursor) &&
  request.cursor >= 0 &&
  Number.isSafeInteger(request.seconds) &&
  request.seconds >= 1 &&
  request.seconds <= limits.maxSeconds

type Draft = {
  -readonly [K in keyof LighthouseState]: LighthouseState[K] extends readonly (infer T)[]
    ? T[]
    : LighthouseState[K] extends Readonly<Record<string, infer V>>
      ? Record<string, V>
      : LighthouseState[K]
}

const clone = (state: LighthouseState): Draft => JSON.parse(JSON.stringify(state)) as Draft

/** The next state and what's sent, for one event. */
export function step(
  before: LighthouseState,
  event: Event,
  limits: WaitLimits,
  rules: Rules = RULES,
): Stepped {
  const s = clone(before)
  const out: Output[] = []
  const worker = s.variant === 'worker'
  const conns = (): [string, Conn][] =>
    Object.entries(s.conns)
      .filter(([, conn]) => conn.open)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const setConn = (id: string, change: Partial<Conn>) => {
    const conn = s.conns[id]
    if (conn !== undefined) s.conns[id] = { ...conn, ...change }
  }
  const unindex = (id: string) => {
    s.indexed = s.indexed.filter((other) => other !== id)
  }
  const answer = (id: string, why: Why, tag?: string) => {
    const wait = s.conns[id]?.wait
    if (wait === null || wait === undefined) return
    const body: Body =
      rules.bareAnswer || tag === undefined ? { type: 'waited', why } : { type: 'waited', why, tag }
    out.push({ kind: 'reply', conn: id, req: wait.req, body })
    setConn(id, { wait: null })
    unindex(id)
  }
  const close = (id: string, why: 'idle' | 'room') => {
    setConn(id, { open: false, wait: null })
    unindex(id)
    out.push({ kind: 'close', conn: id, why })
  }
  const idle = (conn: Conn) => isIdle(conn, s.now, limits, rules)

  /** Answers `mail` to every indexed wait `blob` is news to, as a put does. */
  const wake = (blob: Blob, afterReset: boolean) => {
    for (const id of [...s.indexed].sort()) {
      const conn = s.conns[id]
      const wait = conn?.wait
      if (conn === undefined || !conn.open || wait === null || wait === undefined) continue
      if (!wait.tags.includes(blob.tag) || blob.seq <= wait.cursor) continue
      // The store doesn't say who put a blob, so after a reset even the putter's own is news.
      if (rules.skipsOwnPut && !afterReset && id === blob.by) continue
      if (rules.checksLease && !afterReset && wait.until <= s.now) continue
      if (rules.skipsDeadWaits && idle(conn)) {
        close(id, 'idle')
        continue
      }
      answer(id, 'mail', blob.tag)
    }
  }

  /**
   * What happens first whenever something reaches the Lighthouse: a Worker woken from sleep
   * rebuilds its index from the attachments and wakes what a put before a reset left unsent;
   * then every lease that has passed is answered.
   */
  const arrive = () => {
    if (worker && !s.awake) {
      s.awake = true
      s.indexed = rules.rebuildsIndex
        ? conns()
            .filter(([, conn]) => conn.wait !== null)
            .map(([id]) => id)
        : []
      if (rules.rechecksAfterReset)
        for (const blob of s.blobs
          .filter((b) => b.seq > s.wokeThrough)
          .sort((a, b) => a.seq - b.seq))
          wake(blob, true)
      s.wokeThrough = s.seq
    }
    if (!worker || rules.sweepsFirst) sweep()
  }
  const sweep = () => {
    for (const id of [...s.indexed].sort()) {
      const wait = s.conns[id]?.wait
      if (wait !== null && wait !== undefined && wait.until <= s.now) answer(id, 'lease')
    }
  }
  const allowRead = (range: string): boolean => {
    const made = s.reads[range] ?? 0
    if (made >= limits.readsPerMinute) return false
    s.reads[range] = made + 1
    return true
  }
  /** Tags in live waits, other than `except`'s, from everyone, from `range` and from `wide`. */
  const waited = (except: string, range: string, wide: string | null) => {
    let total = 0
    let fromRange = 0
    let fromWide = 0
    let waitsFromRange = 0
    for (const [id, conn] of conns()) {
      if (id === except || conn.wait === null) continue
      total += conn.wait.tags.length
      if (conn.range === range) {
        fromRange += conn.wait.tags.length
        waitsFromRange += 1
      }
      if (wide !== null && conn.wide === wide) fromWide += conn.wait.tags.length
    }
    return { total, fromRange, fromWide, waitsFromRange }
  }
  const room = (range: string) => {
    const open = conns()
    return (
      open.length < limits.maxConnections &&
      open.filter(([, conn]) => conn.range === range).length < limits.connectionsPerRange
    )
  }

  switch (event.kind) {
    case 'connect': {
      arrive()
      if (s.conns[event.conn] !== undefined) break
      const wide = event.wide ?? null
      if (!room(event.range)) for (const [id, conn] of conns()) if (idle(conn)) close(id, 'idle')
      if (!room(event.range) && rules.evictsWaiters) {
        // Among those counted against every limit that's full, so closing one makes room: anyone
        // when only the total is full, the newcomer's own range when that is.
        const rangeFull =
          conns().filter(([, conn]) => conn.range === event.range).length >=
          limits.connectionsPerRange
        const longest = conns()
          .filter(([, conn]) => conn.wait !== null && (!rangeFull || conn.range === event.range))
          .sort(([, x], [, y]) => (x.wait?.order ?? 0) - (y.wait?.order ?? 0))[0]
        if (longest !== undefined) close(longest[0], 'room')
      }
      if (!room(event.range)) {
        out.push({ kind: 'refuse', conn: event.conn })
        break
      }
      s.conns[event.conn] = {
        range: event.range,
        wide,
        open: true,
        seen: s.now,
        pinged: s.now,
        wait: null,
        greeted: allowRead(event.range),
      }
      break
    }
    case 'frame': {
      const conn = s.conns[event.conn]
      if (conn === undefined || !conn.open) break
      arrive()
      setConn(event.conn, { seen: s.now })
      const { request, req } = event
      const reply = (body: Body) => out.push({ kind: 'reply', conn: event.conn, req, body })
      const shapeless = request.type === 'wait' && !waitShapeOk(request, limits)
      if (!conn.greeted && !shapeless) {
        reply({ type: 'error', error: 'hello-first' })
        break
      }
      if (request.type === 'wait') {
        if (!waitShapeOk(request, limits)) {
          reply({ type: 'error', error: 'malformed' })
          break
        }
        const standing = s.conns[event.conn]?.wait
        if (standing !== null && standing !== undefined && rules.endsStandingWait)
          answer(event.conn, 'lease')
        if (rules.countsWaitAsRead && !allowRead(conn.range)) {
          reply({ type: 'error', error: 'limit' })
          break
        }
        const adding = request.tags.length
        const over = () => {
          const count = waited(event.conn, conn.range, conn.wide)
          const overRange = rules.countsTagsPerRange
            ? count.fromRange + adding > limits.tagsPerRange
            : count.waitsFromRange + 1 > WAITS_PER_RANGE_BY_COUNT
          return (
            overRange ||
            (conn.wide !== null && count.fromWide + adding > limits.tagsPer48) ||
            count.total + adding > limits.maxWaitedTags
          )
        }
        // Only when it doesn't fit are waits gone quiet past the idle time looked for: they count
        // for nothing, and are closed, not just left out, so they can't come back with a
        // keepalive and push the count past a limit after another has taken their room.
        if (over() && rules.skipsDeadWaits)
          for (const [id, other] of conns())
            if (id !== event.conn && other.wait !== null && idle(other)) close(id, 'idle')
        if (over()) {
          reply({ type: 'error', error: 'limit' })
          break
        }
        if (rules.answersAtOnce && blobsPast(s, request.tags, request.cursor).length > 0) {
          reply({ type: 'waited', why: 'mail' })
          break
        }
        setConn(event.conn, {
          wait: {
            req,
            tags: [...request.tags].sort(),
            cursor: request.cursor,
            until: s.now + request.seconds,
            since: s.now,
            order: s.begun,
          },
        })
        s.begun += 1
        if (!s.indexed.includes(event.conn)) s.indexed = [...s.indexed, event.conn].sort()
        break
      }
      if (request.type === 'put') {
        if (!rules.putIgnoresWaits && waited('', '', null).total >= limits.maxWaitedTags) {
          reply({ type: 'error', error: 'limit' })
          break
        }
        const held = s.blobs.find((blob) => blob.id === request.id && blob.expires > s.now)
        if (held !== undefined) {
          reply({ type: 'stored' })
          break
        }
        s.seq += 1
        const blob: Blob = {
          seq: s.seq,
          id: request.id,
          tag: request.tag,
          expires: request.expires,
          by: event.conn,
        }
        s.blobs = [...s.blobs.filter((other) => other.id !== request.id), blob]
        const replyAt = out.length
        reply({ type: 'stored' })
        // Reset before its wakes went: see the end of the frame.
        if (worker && event.crash === true) break
        wake(blob, false)
        s.wokeThrough = s.seq
        if (!rules.replyBeforeWakes) {
          const [stored] = out.splice(replyAt, 1)
          if (stored !== undefined) out.push(stored)
        }
        break
      }
      if (!allowRead(conn.range)) {
        reply({ type: 'error', error: 'limit' })
        break
      }
      if (request.type === 'list') {
        const found = blobsPast(s, request.tags, request.cursor)
        const page = found.slice(0, limits.pageSize)
        reply({
          type: 'listed',
          items: page.map((blob) => ({ id: blob.id, tag: blob.tag })),
          cursor: page.at(-1)?.seq ?? request.cursor,
          more: found.length > limits.pageSize,
        })
        break
      }
      const held = s.blobs.find((blob) => blob.id === request.id && blob.expires > s.now)
      if (held === undefined) reply({ type: 'error', error: 'unknown' })
      else {
        s.blobs = s.blobs.filter((blob) => blob.id !== request.id)
        reply({ type: 'dropped' })
      }
      break
    }
    case 'ping': {
      // Answered without waking the Worker (the runtime's auto-response) and counted against
      // nothing on either: it only says the connection is still there.
      const conn = s.conns[event.conn]
      if (conn === undefined || !conn.open) break
      setConn(event.conn, { pinged: s.now })
      out.push({ kind: 'pong', conn: event.conn })
      break
    }
    case 'close': {
      const conn = s.conns[event.conn]
      if (conn === undefined || !conn.open) break
      arrive()
      setConn(event.conn, { open: false, wait: null })
      unindex(event.conn)
      break
    }
    case 'tick': {
      s.now += event.seconds
      const minute = Math.floor(s.now / 60)
      if (minute !== s.minute) {
        s.minute = minute
        s.reads = {}
      }
      if (!worker) {
        sweep()
        for (const [id, conn] of conns()) if (idle(conn)) close(id, 'idle')
      }
      break
    }
    case 'hibernate': {
      // The Worker's memory goes, its counts of reads with it: they're kept nowhere else.
      if (worker) {
        s.awake = false
        s.indexed = []
        s.reads = {}
      }
      break
    }
    case 'alarm': {
      if (!worker) break
      arrive()
      for (const [id, conn] of conns()) if (idle(conn)) close(id, 'idle')
      break
    }
  }
  // A reset after a frame's reply, whatever the frame was: the Worker loses its memory (the index,
  // its counts of reads) and whatever a put still had to send.
  if (
    worker &&
    event.kind === 'frame' &&
    event.crash === true &&
    s.conns[event.conn] !== undefined
  ) {
    s.awake = false
    s.indexed = []
    s.reads = {}
  }
  return { state: s as LighthouseState, out }
}
