// The Lighthouse's invariants, checked on every event from what went in and what came out. Each
// is worked out here from the state before the event and plain rules of its own, never from the
// switches in `Rules`, so a planted defect can't hide by changing the check along with the step.
import {
  blobsPast,
  type Conn,
  type Event,
  isIdle,
  type LighthouseState,
  type Output,
  RULES,
  type WaitLimits,
  waitShapeOk,
} from './lighthouse.ts'

/** What the checks carry from event to event, beside the Lighthouse's own state. */
export interface Ghost {
  /** Waits a put stored news for, which must still hear `mail`: `conn req`. */
  readonly owed: readonly string[]
  /** Reads per range this minute, counted here. */
  readonly reads: Readonly<Record<string, number>>
  readonly minute: number
  /** The store as puts and drops alone would leave it: `seq id`. */
  readonly shadow: readonly string[]
  readonly shadowSeq: number
}

export const emptyGhost: Ghost = { owed: [], reads: {}, minute: 0, shadow: [], shadowSeq: 0 }

export interface Checked {
  readonly ghost: Ghost
  /** Each broken invariant's id and what's wrong. */
  readonly broken: readonly (readonly [string, string])[]
}

/** Whether an event reaches the Lighthouse itself: on the Worker, a keepalive and time don't. */
export const reaches = (state: LighthouseState, event: Event): boolean =>
  state.variant === 'node' ||
  event.kind === 'connect' ||
  event.kind === 'frame' ||
  event.kind === 'close' ||
  event.kind === 'alarm'

const idle = (conn: Conn, now: number, limits: WaitLimits) => isIdle(conn, now, limits, RULES)

export function checkEvent(
  before: LighthouseState,
  event: Event,
  after: LighthouseState,
  out: readonly Output[],
  limits: WaitLimits,
  ghost: Ghost,
): Checked {
  const broken: [string, string][] = []
  const fail = (id: string, message: string) => broken.push([id, message])
  const now = before.now
  const waitedOut = out.flatMap((o) =>
    o.kind === 'reply' && o.body.type === 'waited' ? [{ ...o, why: o.body.why, body: o.body }] : [],
  )
  // A frame on a connection whose hello was refused only hears `hello-first`: nothing to check.
  const frame =
    event.kind === 'frame' && before.conns[event.conn]?.greeted !== false ? event : undefined
  const waitFrame = frame?.request.type === 'wait' ? frame : undefined
  const putFrame = frame?.request.type === 'put' ? frame : undefined
  const wellFormedWait =
    waitFrame !== undefined &&
    waitShapeOk(waitFrame.request, limits) &&
    before.conns[waitFrame.conn]?.open === true
  const replyTo = (conn: string, req: number) =>
    out.find((o) => o.kind === 'reply' && o.conn === conn && o.req === req)
  const closed = (conn: string) =>
    out.some((o) => o.kind === 'close' && o.conn === conn) ||
    (event.kind === 'close' && event.conn === conn)

  // W6: a waited answer says mail or lease, and nothing else.
  for (const answer of waitedOut)
    if (Object.keys(answer.body).sort().join() !== 'type,why')
      fail('W6 reveals nothing', `waited to ${answer.conn} says ${JSON.stringify(answer.body)}`)

  // W1 and L1: each waited answers the wait standing on its connection, or the wait in this very
  // frame, once; a well-formed new wait first ends the one standing, before anything else is
  // said to it; and no wait disappears from an open connection without an answer.
  const seen = new Set<string>()
  for (const answer of waitedOut) {
    const key = `${answer.conn} ${answer.req}`
    const standing = before.conns[answer.conn]?.wait?.req
    const fresh =
      waitFrame !== undefined && waitFrame.conn === answer.conn && waitFrame.req === answer.req
    if (seen.has(key) || (standing !== answer.req && !fresh))
      fail('W1 one reply', `waited to ${key}, which isn't a wait standing there, or twice`)
    seen.add(key)
  }
  for (const [id, conn] of Object.entries(before.conns)) {
    const wait = conn.wait
    if (wait === null || !conn.open) continue
    const kept = after.conns[id]?.wait?.req === wait.req && after.conns[id]?.open === true
    if (!kept && replyTo(id, wait.req) === undefined && !closed(id))
      fail('W1 one reply', `the wait ${id} ${wait.req} ended unanswered on an open connection`)
  }
  if (wellFormedWait && waitFrame !== undefined) {
    const standing = before.conns[waitFrame.conn]?.wait
    if (standing !== null && standing !== undefined) {
      const old = out.findIndex(
        (o) => o.kind === 'reply' && o.conn === waitFrame.conn && o.req === standing.req,
      )
      const fresh = out.findIndex(
        (o) => o.kind === 'reply' && o.conn === waitFrame.conn && o.req === waitFrame.req,
      )
      const oldBody = out[old]
      if (old < 0 || (fresh >= 0 && fresh < old))
        fail('L1 one wait', `a new wait on ${waitFrame.conn} didn't first end the one standing`)
      else if (
        oldBody?.kind === 'reply' &&
        oldBody.body.type === 'waited' &&
        oldBody.body.why !== 'lease'
      ) {
        // Ending it is `lease`, unless news for it was owed from before, or a Worker waking from
        // a reset found news for it first.
        const recheck = before.variant === 'worker' && !before.awake
        if (!recheck && !ghost.owed.includes(`${waitFrame.conn} ${standing.req}`))
          fail('L1 one wait', `the replaced wait on ${waitFrame.conn} heard ${oldBody.body.why}`)
      }
    }
  }

  // L2: a wait the wrong shape is malformed, and one the right shape never is.
  if (waitFrame !== undefined && before.conns[waitFrame.conn]?.open === true) {
    const reply = replyTo(waitFrame.conn, waitFrame.req)
    const malformed =
      reply?.kind === 'reply' && reply.body.type === 'error' && reply.body.error === 'malformed'
    if (waitShapeOk(waitFrame.request, limits) === malformed)
      fail(
        'L2 shape',
        `a wait of ${JSON.stringify(waitFrame.request)} answered ${JSON.stringify(reply)}`,
      )
  }

  // L3: lists, drops and waits are reads; past the range's reads this minute each is refused.
  let reads = ghost.reads
  let minute = ghost.minute
  if (event.kind === 'tick' && Math.floor((now + event.seconds) / 60) !== minute) {
    minute = Math.floor((now + event.seconds) / 60)
    reads = {}
  }
  // The Worker counts reads in memory, which it loses when it sleeps: it holds a range to its
  // reads since it last woke, never across a sleep.
  const forgets =
    event.kind === 'hibernate' ||
    (event.kind === 'frame' && event.crash === true && after.awake === false)
  if (forgets && before.variant === 'worker') reads = {}
  // A connection's hello, as it opens, is a read too.
  if (event.kind === 'connect' && before.conns[event.conn] === undefined) {
    const opened = after.conns[event.conn]
    if (opened !== undefined) {
      const made = reads[event.range] ?? 0
      if (made >= limits.readsPerMinute) {
        if (opened.greeted) fail('L3 read', `${event.conn}'s hello past its reads wasn't refused`)
      } else reads = { ...reads, [event.range]: made + 1 }
    }
  }
  if (
    frame !== undefined &&
    before.conns[frame.conn]?.open === true &&
    frame.request.type !== 'put'
  ) {
    const range = before.conns[frame.conn]?.range ?? ''
    const shaped = frame.request.type !== 'wait' || waitShapeOk(frame.request, limits)
    if (shaped) {
      const made = reads[range] ?? 0
      const reply = replyTo(frame.conn, frame.req)
      const refused =
        reply?.kind === 'reply' && reply.body.type === 'error' && reply.body.error === 'limit'
      if (made >= limits.readsPerMinute) {
        if (!refused)
          fail('L3 read', `${frame.conn}'s ${frame.request.type} past its reads wasn't refused`)
      } else reads = { ...reads, [range]: made + 1 }
    }
  }

  // L7: a wait is refused for its tags only when live waits that are heard from leave no room.
  if (wellFormedWait && waitFrame !== undefined) {
    const reply = replyTo(waitFrame.conn, waitFrame.req)
    const conn = before.conns[waitFrame.conn]
    const refused =
      reply?.kind === 'reply' && reply.body.type === 'error' && reply.body.error === 'limit'
    const range = conn?.range ?? ''
    const readsLeft = (ghost.reads[range] ?? 0) < limits.readsPerMinute || minute !== ghost.minute
    if (refused && readsLeft && conn !== undefined) {
      let total = 0
      let fromRange = 0
      let fromWide = 0
      for (const [id, other] of Object.entries(before.conns)) {
        if (id === waitFrame.conn || !other.open || other.wait === null || idle(other, now, limits))
          continue
        total += other.wait.tags.length
        if (other.range === conn.range) fromRange += other.wait.tags.length
        if (conn.wide !== null && other.wide === conn.wide) fromWide += other.wait.tags.length
      }
      const adding = waitFrame.request.type === 'wait' ? waitFrame.request.tags.length : 0
      if (
        fromRange + adding <= limits.tagsPerRange &&
        (conn.wide === null || fromWide + adding <= limits.tagsPer48) &&
        total + adding <= limits.maxWaitedTags
      )
        fail('L7 refusal justified', `${waitFrame.conn}'s wait was refused though its tags fit`)
    }
  }

  // L4: live waits that are heard from never hold more tags than the limits allow.
  {
    let total = 0
    const byRange: Record<string, number> = {}
    const byWide: Record<string, number> = {}
    for (const conn of Object.values(after.conns)) {
      if (!conn.open || conn.wait === null || idle(conn, after.now, limits)) continue
      total += conn.wait.tags.length
      byRange[conn.range] = (byRange[conn.range] ?? 0) + conn.wait.tags.length
      if (conn.wide !== null) byWide[conn.wide] = (byWide[conn.wide] ?? 0) + conn.wait.tags.length
      if (
        conn.wait.tags.length > limits.maxTags ||
        conn.wait.until - conn.wait.since > limits.maxSeconds
      )
        fail('L4 tag limits', 'a wait stands with more tags or a longer lease than a wait may have')
    }
    if (
      total > limits.maxWaitedTags ||
      Object.values(byRange).some((n) => n > limits.tagsPerRange) ||
      Object.values(byWide).some((n) => n > limits.tagsPer48)
    )
      fail('L4 tag limits', `live waits hold ${total} tags, ${JSON.stringify(byRange)} by range`)
  }

  // W4: a put's reply and the store are what puts and drops alone would give.
  let shadow = ghost.shadow
  let shadowSeq = ghost.shadowSeq
  if (frame !== undefined && before.conns[frame.conn]?.open === true) {
    const live = (entry: string) => {
      const id = entry.split(' ')[1]
      return (
        after.blobs.some((blob) => blob.id === id) ||
        before.blobs.some((b) => b.id === id && b.expires > now)
      )
    }
    if (putFrame !== undefined && putFrame.request.type === 'put') {
      const { id } = putFrame.request
      const held = before.blobs.some((blob) => blob.id === id && blob.expires > now)
      if (!held) {
        shadowSeq += 1
        shadow = [...shadow.filter((entry) => entry.split(' ')[1] !== id), `${shadowSeq} ${id}`]
      }
      const reply = replyTo(putFrame.conn, putFrame.req)
      if (reply?.kind !== 'reply' || reply.body.type !== 'stored')
        fail('W4 put alone', `${putFrame.conn}'s put answered ${JSON.stringify(reply)}`)
    }
    if (frame.request.type === 'drop') {
      const { id } = frame.request
      const reply = replyTo(frame.conn, frame.req)
      if (reply?.kind === 'reply' && reply.body.type === 'dropped')
        shadow = shadow.filter((entry) => entry.split(' ')[1] !== id)
    }
    shadow = shadow.filter(live)
    const store = after.blobs.map((blob) => `${blob.seq} ${blob.id}`).sort()
    if (store.join() !== [...shadow].sort().join())
      fail(
        'W4 put alone',
        `the store is ${store.join()}, puts alone give ${[...shadow].sort().join()}`,
      )
  }

  // W5: a wait, or anything but a put or a drop, leaves the store as it was.
  if (putFrame === undefined && frame?.request.type !== 'drop') {
    const a = before.blobs.map((blob) => `${blob.seq} ${blob.id}`).join()
    const b = after.blobs.map((blob) => `${blob.seq} ${blob.id}`).join()
    if (a !== b) fail('W5 wait moves nothing', `${event.kind} changed the store`)
  }

  // W3: a wait whose tags already hold a blob past its cursor hears `mail` at once.
  if (wellFormedWait && waitFrame !== undefined && waitFrame.request.type === 'wait') {
    const reply = replyTo(waitFrame.conn, waitFrame.req)
    const refused = reply?.kind === 'reply' && reply.body.type === 'error'
    const news = blobsPast(before, waitFrame.request.tags, waitFrame.request.cursor).length > 0
    if (
      news &&
      !refused &&
      !(reply?.kind === 'reply' && reply.body.type === 'waited' && reply.body.why === 'mail')
    )
      fail('W3 at once', `${waitFrame.conn}'s wait had mail waiting and wasn't answered at once`)
  }

  // W6, the other half: `mail` is said only when a list of the wait's tags from its cursor
  // would name a blob.
  for (const answer of waitedOut) {
    if (answer.why !== 'mail') continue
    const standing = before.conns[answer.conn]?.wait
    const request =
      waitFrame?.request.type === 'wait' && waitFrame.conn === answer.conn
        ? waitFrame.request
        : undefined
    const tags = standing?.req === answer.req ? standing.tags : (request?.tags ?? [])
    const cursor = standing?.req === answer.req ? standing.cursor : (request?.cursor ?? 0)
    if (blobsPast(after, tags, cursor).length === 0 && blobsPast(before, tags, cursor).length === 0)
      fail('W6 reveals nothing', `${answer.conn} heard mail that no list of its tags would show`)
  }

  // L5 and O1: a put's own wake goes to another connection whose lease hasn't passed, and only
  // after the put's reply. A Worker waking from a reset may also wake what an earlier put owed,
  // its putter included, since the store doesn't say who put a blob.
  const recheck = before.variant === 'worker' && !before.awake
  if (putFrame !== undefined) {
    const at = out.findIndex(
      (o) => o.kind === 'reply' && o.conn === putFrame.conn && o.req === putFrame.req,
    )
    out.forEach((o, i) => {
      if (o.kind !== 'reply' || o.body.type !== 'waited' || o.body.why !== 'mail') return
      const owedBefore = ghost.owed.includes(`${o.conn} ${o.req}`)
      if (owedBefore || recheck) return
      const wait = before.conns[o.conn]?.wait
      if (o.conn === putFrame.conn || wait === null || wait === undefined || wait.until <= now)
        fail('L5 no self or stale wake', `${putFrame.conn}'s put woke ${o.conn}`)
      if (i < at)
        fail('O1 reply first', `${o.conn} heard of ${putFrame.conn}'s put before its reply`)
    })
  }

  // W2: news a put stores for a standing wait reaches it, by the end of the event, or, when the
  // Worker reset in between, by the next event that reaches it.
  let owed = ghost.owed.filter((key) => {
    const [conn = '', req] = key.split(' ')
    const delivered = waitedOut.some(
      (o) => o.conn === conn && String(o.req) === req && o.why === 'mail',
    )
    return !delivered && !closed(conn) && after.conns[conn]?.open === true
  })
  if (reaches(before, event))
    for (const key of owed)
      if (ghost.owed.includes(key)) fail('W2 never lost', `the wake owed to ${key} never came`)
  if (putFrame !== undefined && putFrame.request.type === 'put' && after.seq > before.seq) {
    const tag = putFrame.request.tag
    for (const [id, conn] of Object.entries(before.conns)) {
      const wait = conn.wait
      if (id === putFrame.conn || !conn.open || wait === null) continue
      if (wait.until <= now || !wait.tags.includes(tag) || after.seq <= wait.cursor) continue
      if (idle(conn, now, limits)) continue
      const key = `${id} ${wait.req}`
      const delivered = waitedOut.some(
        (o) => o.conn === id && o.req === wait.req && o.why === 'mail',
      )
      if (delivered) continue
      if (putFrame.crash === true && before.variant === 'worker') owed = [...owed, key]
      else fail('W2 never lost', `${putFrame.conn}'s put never woke ${key}`)
    }
  }

  // K1: only a connection quiet for the idle time, keepalives counted, is closed as idle.
  for (const o of out) {
    if (o.kind !== 'close' || o.why !== 'idle') continue
    const conn = before.conns[o.conn]
    const at = event.kind === 'tick' ? now + event.seconds : now
    if (conn !== undefined && !idle(conn, at, limits))
      fail('K1 keepalive', `${o.conn} was closed as idle though it was heard from`)
  }

  // E1: a new connection closes a waiter only when there's no room and no idle connection, the
  // waiter that has stood longest among those the full limit counts; it's refused only when not
  // even that makes room.
  if (event.kind === 'connect' && before.conns[event.conn] === undefined) {
    const open = Object.entries(before.conns).filter(
      ([, conn]) => conn.open && !idle(conn, now, limits),
    )
    const totalFull = open.length >= limits.maxConnections
    const rangeFull =
      open.filter(([, c]) => c.range === event.range).length >= limits.connectionsPerRange
    // A wait answered first, its lease passed or news found for it after a reset, no longer stands.
    const answered = new Set(waitedOut.map((o) => o.conn))
    const candidates = open
      .filter(
        ([id, conn]) =>
          conn.wait !== null &&
          conn.wait.until > now &&
          !answered.has(id) &&
          (!rangeFull || conn.range === event.range),
      )
      .sort(([, x], [, y]) => (x.wait?.order ?? 0) - (y.wait?.order ?? 0))
    const evicted = out.filter((o) => o.kind === 'close' && o.why === 'room')
    const refused = out.some((o) => o.kind === 'refuse')
    if (
      evicted.length > 0 &&
      (!(totalFull || rangeFull) || evicted[0]?.conn !== candidates[0]?.[0])
    )
      fail('E1 eviction', `${event.conn} closed ${evicted[0]?.conn} without need or out of turn`)
    if (refused && (!(totalFull || rangeFull) || candidates.length > 0))
      fail('E1 eviction', `${event.conn} was refused though room could be made`)
  }

  return { ghost: { owed: [...new Set(owed)].sort(), reads, minute, shadow, shadowSeq }, broken }
}
