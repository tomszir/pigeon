// Pigeons and a Lighthouse together: clients that look for mail, wait after each look, hear
// `waited`, look again on its cue, wait again when a lease ends, lose and reopen their
// connections, and turn waiting off; a
// sender that puts mail for them; and the Lighthouse, Node or Worker, from `lighthouse.ts`.
// Every event the clients cause goes through `step`, and through `checkEvent`, which records
// what it finds in the state for the explorer to report.
import { checkEvent, emptyGhost, type Ghost } from './checks.ts'
import {
  type Event,
  emptyLighthouse,
  type LighthouseState,
  type Output,
  RULES,
  type Rules,
  step,
  type Variant,
  type WaitLimits,
} from './lighthouse.ts'

/** The client's rules; a planted defect turns one off. */
export interface ClientRules {
  /** A look that couldn't read its Lighthouse to the end (a refusal, a failed get) sends no wait. */
  readonly waitsOnlyAfterFullLook: boolean
  /** A wait sent again after its connection dropped names the tags it named, not today's. */
  readonly reusesLookTags: boolean
  /** Turning waiting off (or relay-only on) closes the connection, ending its wait. */
  readonly closesOnSwitch: boolean
  /** A client whose waiting connection was closed for room waits for its next look to reopen it. */
  readonly holdsOffAfterEviction: boolean
  /** `waited { mail }` only asks for a look; it never moves the cursor. */
  readonly cueOnly: boolean
  /** A wait whose lease ran its course is sent again, with the tags it named, until the next look. */
  readonly renewsAfterLease: boolean
  /** A renewal due is sent at once, in the same step as the lease's end. */
  readonly renewalSends: boolean
  /**
   * A wait still unanswered GRACE past its lease (a Worker with nothing to wake it doesn't answer
   * an ended lease) is taken as its lease ending, not as a drop.
   */
  readonly renewsAfterTimeout: boolean
}

export const CLIENT_RULES: ClientRules = {
  waitsOnlyAfterFullLook: true,
  reusesLookTags: true,
  closesOnSwitch: true,
  holdsOffAfterEviction: true,
  cueOnly: true,
  renewsAfterLease: true,
  renewalSends: true,
  renewsAfterTimeout: true,
}

/** How long past its lease a client gives up on a wait's answer, in the model's time. */
const GRACE = 1

export interface Client {
  readonly range: string
  readonly wide: string | null
  /** The connection it uses, as it knows it; null when it has none. */
  readonly conn: string | null
  readonly gen: number
  /** Waiting is on: "Hear about mail at once", and relay-only off. */
  readonly on: boolean
  readonly cursor: number
  readonly taken: readonly string[]
  /** The tags its last look listed. */
  readonly lookTags: readonly string[]
  readonly waitReq: number | null
  /** The last wait it sent: its tags and when its lease ends, for sending it again. */
  readonly waitTags: readonly string[]
  readonly waitUntil: number
  readonly req: number
  /** A `waited { mail }` came: a look is due. */
  readonly cue: boolean
  /** Its waiting connection was closed for room since its last look. */
  readonly evicted: boolean
  /** It has waited since its last look, which read its Lighthouse to the end, and wasn't refused. */
  readonly waiting: boolean
  /** Its wait's lease ran its course: it's sent again. */
  readonly renewDue: boolean
}

export interface Budget {
  readonly puts: number
  readonly own: number
  readonly ticks: number
  readonly looks: number
  readonly cues: number
  readonly drops: number
  readonly silences: number
  readonly days: number
  readonly sleeps: number
  readonly crashes: number
  readonly switches: number
  readonly faults: number
  readonly joins: number
  readonly reopens: number
}

export interface Sys {
  readonly lh: LighthouseState
  readonly ghost: Ghost
  readonly clients: Readonly<Record<string, Client>>
  /** Clients still to connect for the first time, by name (a scenario's latecomers). */
  readonly waitingToJoin: readonly string[]
  /** The sender's connection, or null. */
  readonly sender: string | null
  readonly senderGen: number
  /** What the sender put, as `id client`. */
  readonly sent: readonly string[]
  readonly day: number
  /** In the last two hours of the UTC day: tomorrow's tags are listed and waited on too. */
  readonly late: boolean
  /** The Lighthouse fails every get until it recovers. */
  readonly fault: boolean
  readonly budget: Budget
  readonly next: number
  /** Looks a cue caused since mail last came from anyone. */
  readonly cueRun: number
  /** Connections their clients stopped hearing from without the Lighthouse knowing. */
  readonly silent: readonly string[]
  /** A wait named a tag its client's last look didn't list; reopened while evicted. */
  readonly strayTag: string | null
  readonly reopenedEvicted: boolean
  /** A client gave up on a wait's answer past its lease. */
  readonly timedOut: boolean
  /** A client sent a wait again after its lease ended. */
  readonly renewed: boolean
  readonly broken: readonly (readonly [string, string])[]
}

export interface Setup {
  readonly name: string
  readonly variant: Variant
  readonly limits: WaitLimits
  /** The clients, by name, with their address range and IPv6 /48. */
  readonly clients: Readonly<Record<string, { readonly range: string; readonly wide?: string }>>
  /** Clients that join only when a step says so. */
  readonly latecomers?: readonly string[]
  readonly budget: Budget
  /** Whether the day starts in its last two hours. */
  readonly late?: boolean
}

/** A lease for the waits clients send: as long as a wait may have, in the model's time. */
const leaseFor = (limits: WaitLimits) => limits.maxSeconds

export function initial(setup: Setup): Sys {
  const clients: Record<string, Client> = {}
  for (const [name, at] of Object.entries(setup.clients))
    clients[name] = {
      range: at.range,
      wide: at.wide ?? null,
      conn: null,
      gen: 0,
      on: true,
      cursor: 0,
      taken: [],
      lookTags: [],
      waitReq: null,
      waitTags: [],
      waitUntil: 0,
      req: 1,
      cue: false,
      evicted: false,
      waiting: false,
      renewDue: false,
    }
  return {
    lh: emptyLighthouse(setup.variant),
    ghost: emptyGhost,
    clients,
    waitingToJoin: setup.latecomers ?? [],
    sender: null,
    senderGen: 0,
    sent: [],
    day: 1,
    late: setup.late ?? false,
    fault: false,
    budget: setup.budget,
    next: 1,
    cueRun: 0,
    silent: [],
    strayTag: null,
    reopenedEvicted: false,
    timedOut: false,
    renewed: false,
    broken: [],
  }
}

type MSys = { -readonly [K in keyof Sys]: Sys[K] }

const tag = (who: string, day: number) => `${who}:d${day}`

/** The tags a look lists: yesterday's and today's, and tomorrow's in the day's last two hours. */
const lookTagsFor = (who: string, day: number, late: boolean) => [
  tag(who, day - 1),
  tag(who, day),
  ...(late ? [tag(who, day + 1)] : []),
]

/** The tags a wait names: today's, and tomorrow's in the last two hours, all from the look. */
const waitTagsFor = (who: string, day: number, late: boolean) => [
  tag(who, day),
  ...(late ? [tag(who, day + 1)] : []),
]

/** Runs events through the Lighthouse, checking each, and hands clients what's said to them. */
function run(
  s: MSys,
  events: readonly Event[],
  setup: Setup,
  rules: Rules,
  client: ClientRules,
): Output[] {
  const all: Output[] = []
  for (const event of events) {
    const before = s.lh
    const { state, out } = step(before, event, setup.limits, rules)
    const checked = checkEvent(before, event, state, out, setup.limits, s.ghost)
    s.lh = state
    s.ghost = checked.ghost
    if (checked.broken.length > 0) s.broken = [...s.broken, ...checked.broken]
    for (const o of out) hear(s, o, client)
    all.push(...out)
  }
  return all
}

function owner(s: MSys, conn: string): string | undefined {
  return Object.entries(s.clients).find(([, c]) => c.conn === conn)?.[0]
}

function setClient(s: MSys, who: string, change: Partial<Client>) {
  const c = s.clients[who]
  if (c !== undefined) s.clients = { ...s.clients, [who]: { ...c, ...change } }
}

/** What a client does with what the Lighthouse says outside a request it's awaiting. */
function hear(s: MSys, o: Output, rules: ClientRules) {
  if (o.kind === 'reply' && o.body.type === 'waited') {
    const who = owner(s, o.conn)
    const c = who === undefined ? undefined : s.clients[who]
    if (who === undefined || c === undefined || o.req !== c.waitReq) return
    setClient(s, who, { waitReq: null })
    if (o.body.why === 'mail') {
      setClient(s, who, { cue: true })
      if (!rules.cueOnly) setClient(s, who, { cursor: s.lh.seq })
    } else if (rules.renewsAfterLease && s.lh.now >= c.waitUntil)
      setClient(s, who, { renewDue: true })
    return
  }
  if (o.kind === 'close' || o.kind === 'refuse') {
    if (s.sender === o.conn) s.sender = null
    const who = owner(s, o.conn)
    if (who === undefined) return
    setClient(s, who, {
      conn: null,
      waitReq: null,
      renewDue: false,
      ...(o.kind === 'close' && o.why === 'room' ? { evicted: true, waiting: false } : {}),
    })
  }
}

function connect(s: MSys, who: string, setup: Setup, rules: Rules, client: ClientRules): boolean {
  const c = s.clients[who]
  if (c === undefined) return false
  if (c.conn !== null) return true
  const conn = `${who}${c.gen + 1}`
  setClient(s, who, { conn, gen: c.gen + 1, req: 1 })
  const out = run(
    s,
    [{ kind: 'connect', conn, range: c.range, ...(c.wide === null ? {} : { wide: c.wide }) }],
    setup,
    rules,
    client,
  )
  return !out.some((o) => o.kind === 'refuse' && o.conn === conn)
}

/** Sends one request on the client's connection; the reply to it, if one came. */
function ask(
  s: MSys,
  who: string,
  request: Extract<Event, { kind: 'frame' }>['request'],
  setup: Setup,
  rules: Rules,
  client: ClientRules,
) {
  const c = s.clients[who]
  if (c === undefined || c.conn === null) return undefined
  const conn = c.conn
  const req = c.req
  setClient(s, who, { req: req + 1, ...(request.type === 'wait' ? { waitReq: req } : {}) })
  const out = run(s, [{ kind: 'frame', conn, req, request }], setup, rules, client)
  const reply = out.find((o) => o.kind === 'reply' && o.conn === conn && o.req === req)
  return reply?.kind === 'reply' ? reply.body : undefined
}

function sendWait(
  s: MSys,
  who: string,
  tags: readonly string[],
  seconds: number,
  setup: Setup,
  rules: Rules,
  client: ClientRules,
) {
  const c = s.clients[who]
  if (c === undefined) return
  if (tags.some((t) => !c.lookTags.includes(t)))
    s.strayTag = tags.find((t) => !c.lookTags.includes(t)) ?? null
  setClient(s, who, {
    waitTags: [...tags],
    waitUntil: s.lh.now + seconds,
    waiting: true,
    renewDue: false,
  })
  const body = ask(s, who, { type: 'wait', tags, cursor: c.cursor, seconds }, setup, rules, client)
  // A refusal, or `malformed` from a Lighthouse that doesn't wait, is all it hears.
  if (body !== undefined && body.type === 'error')
    setClient(s, who, { waitReq: null, waiting: false })
}

/**
 * What a client does once a step's events are through: a wait still unanswered GRACE past its
 * lease is given up, and a wait whose lease ran its course is sent again at once, the same tags
 * with a lease to the next look. Time has to pass for each, so it needs no budget of its own.
 */
function renew(s: MSys, setup: Setup, rules: Rules, client: ClientRules) {
  for (const [who, c] of Object.entries(s.clients))
    if (c.waitReq !== null && s.lh.now >= c.waitUntil + GRACE) {
      s.timedOut = true
      // Taken as a drop instead, it's reopened only once it's been seen closed, and its lease has
      // passed: nothing waits until the next look.
      setClient(s, who, { waitReq: null, renewDue: client.renewsAfterTimeout && c.on })
    }
  for (const who of Object.keys(s.clients)) {
    // Read again for each: a wait sent for one client can close another's connection for room.
    const c = s.clients[who]
    if (c === undefined || !c.renewDue) continue
    setClient(s, who, { renewDue: false })
    if (!c.on || c.conn === null || !client.renewalSends) continue
    const tags = client.reusesLookTags ? c.waitTags : waitTagsFor(who, s.day, s.late)
    s.renewed = true
    sendWait(s, who, tags, leaseFor(setup.limits), setup, rules, client)
  }
}

/** One look at the Lighthouse: lists from the cursor to the end, takes and drops what's new. */
function look(s: MSys, who: string, setup: Setup, rules: Rules, client: ClientRules) {
  setClient(s, who, { cue: false, evicted: false, waiting: false, renewDue: false })
  if (!connect(s, who, setup, rules, client)) return
  const tags = lookTagsFor(who, s.day, s.late)
  setClient(s, who, { lookTags: tags })
  let cursor = s.clients[who]?.cursor ?? 0
  let complete = true
  const got: string[] = []
  for (let pages = 0; pages < 8; pages++) {
    const body = ask(s, who, { type: 'list', tags, cursor }, setup, rules, client)
    if (body === undefined || body.type !== 'listed') {
      complete = false
      break
    }
    if (body.items.length > 0 && s.fault) {
      complete = false
      break
    }
    got.push(...body.items.map((item) => item.id))
    cursor = body.cursor
    if (!body.more) break
  }
  const taken = s.clients[who]?.taken ?? []
  // Only mail sealed to it is taken and dropped; its own copies, for its other devices, aren't.
  const fresh = got.filter((id) => !taken.includes(id) && id.startsWith('m'))
  setClient(s, who, { taken: [...taken, ...fresh].sort(), ...(complete ? { cursor } : {}) })
  for (const id of fresh) ask(s, who, { type: 'drop', id }, setup, rules, client)
  const c = s.clients[who]
  if (c === undefined || !c.on || c.conn === null) return
  if (complete || !client.waitsOnlyAfterFullLook)
    sendWait(s, who, waitTagsFor(who, s.day, s.late), leaseFor(setup.limits), setup, rules, client)
}

/** Every step enabled from `sys`, each with its label. */
export function steps(
  sys: Sys,
  setup: Setup,
  rules: Rules = RULES,
  client: ClientRules = CLIENT_RULES,
): (readonly [string, Sys])[] {
  const out: (readonly [string, Sys])[] = []
  const b = sys.budget
  const take = (
    label: string,
    spend: Partial<Record<keyof Budget, number>>,
    act: (s: MSys) => void,
  ) => {
    const s: MSys = { ...sys, broken: [] }
    const budget: Record<string, number> = { ...b }
    for (const [key, n] of Object.entries(spend)) budget[key] = (budget[key] ?? 0) - (n ?? 0)
    s.budget = budget as unknown as Budget
    act(s)
    renew(s, setup, rules, client)
    out.push([label, s])
  }
  const joined = (who: string) => !sys.waitingToJoin.includes(who)
  const names = Object.keys(sys.clients).filter(joined)

  for (const name of sys.waitingToJoin)
    if (b.joins > 0)
      take(`${name} joins and looks`, { joins: 1 }, (s) => {
        s.waitingToJoin = s.waitingToJoin.filter((other) => other !== name)
        look(s, name, setup, rules, client)
      })

  if (b.puts > 0)
    for (const who of names)
      for (const [when, day] of [
        ['today', sys.day],
        ...(sys.late ? [['tomorrow', sys.day + 1]] : []),
      ] as [string, number][])
        for (const crash of setup.variant === 'worker' && b.crashes > 0 ? [false, true] : [false])
          take(
            `S puts m${sys.next} under ${who}'s ${when} tag${crash ? ', and the Worker resets before its wakes' : ''}`,
            { puts: 1, ...(crash ? { crashes: 1 } : {}) },
            (s) => {
              const id = `m${s.next}`
              s.next += 1
              s.cueRun = 0
              if (s.sender === null) {
                const conn = `s${s.senderGen + 1}`
                s.senderGen += 1
                const outs = run(
                  s,
                  [{ kind: 'connect', conn, range: 'sender' }],
                  setup,
                  rules,
                  client,
                )
                if (outs.some((o) => o.kind === 'refuse')) return
                s.sender = conn
              }
              s.sent = [...s.sent, `${id} ${who}`]
              run(
                s,
                [
                  {
                    kind: 'frame',
                    conn: s.sender,
                    req: s.next,
                    request: { type: 'put', tag: tag(who, day), id, expires: 10_000 },
                    ...(crash ? { crash: true } : {}),
                  },
                ],
                setup,
                rules,
                client,
              )
            },
          )

  for (const who of names) {
    const c = sys.clients[who]
    if (c === undefined) continue
    if (b.looks > 0) take(`${who} looks`, { looks: 1 }, (s) => look(s, who, setup, rules, client))
    if (c.cue && b.cues > 0)
      take(`${who} looks on its cue`, { cues: 1 }, (s) => {
        s.cueRun += 1
        look(s, who, setup, rules, client)
      })
    if (b.own > 0 && c.conn !== null)
      take(`${who} puts a copy for its other devices`, { own: 1 }, (s) => {
        const id = `own${s.next}`
        s.next += 1
        s.cueRun = 0
        ask(
          s,
          who,
          { type: 'put', tag: tag(who, s.day), id, expires: 10_000 },
          setup,
          rules,
          client,
        )
      })
    if (b.drops > 0 && c.conn !== null)
      take(`${who}'s connection drops`, { drops: 1 }, (s) => {
        const conn = c.conn ?? ''
        setClient(s, who, { conn: null, waitReq: null })
        run(s, [{ kind: 'close', conn }], setup, rules, client)
      })
    if (b.silences > 0 && c.conn !== null && c.waitReq !== null)
      take(`${who}'s connection goes silent`, { silences: 1 }, (s) => {
        s.silent = [...s.silent, c.conn ?? '']
        setClient(s, who, { conn: null, waitReq: null })
      })
    // Reopened while Pigeon is on screen, to wait again, after a drop that wasn't a close for room.
    const reopenable = c.conn === null && c.on && c.waitTags.length > 0 && c.waitUntil > sys.lh.now
    if (reopenable && (!c.evicted || !client.holdsOffAfterEviction) && b.reopens > 0)
      take(`${who} reopens and waits again`, { reopens: 1 }, (s) => {
        if (c.evicted) s.reopenedEvicted = true
        if (!connect(s, who, setup, rules, client)) return
        const tags = client.reusesLookTags ? c.waitTags : waitTagsFor(who, s.day, s.late)
        sendWait(s, who, tags, c.waitUntil - s.lh.now, setup, rules, client)
      })
    if (c.on && b.switches > 0)
      take(`${who} turns waiting off`, { switches: 1 }, (s) => {
        setClient(s, who, { on: false, waiting: false, renewDue: false })
        if (client.closesOnSwitch && c.conn !== null) {
          setClient(s, who, { conn: null, waitReq: null })
          run(s, [{ kind: 'close', conn: c.conn }], setup, rules, client)
        }
      })
  }

  if (b.ticks > 0)
    take('time passes', { ticks: 1 }, (s) => {
      // A connection with a wait standing sends a keepalive, which the Lighthouse answers.
      const pings: Event[] = Object.values(s.clients)
        .filter((c) => c.conn !== null && c.waitReq !== null)
        .map((c) => ({ kind: 'ping', conn: c.conn ?? '' }))
      run(s, [...pings, { kind: 'tick', seconds: 1 }], setup, rules, client)
    })
  if (b.days > 0)
    take(
      sys.late ? 'the UTC day turns' : 'the last two hours of the UTC day begin',
      { days: 1 },
      (s) => {
        if (s.late) {
          s.day += 1
          s.late = false
        } else s.late = true
      },
    )
  if (b.faults > 0)
    take(
      sys.fault ? 'the Lighthouse gets blobs again' : 'the Lighthouse fails every get',
      { faults: 1 },
      (s) => {
        s.fault = !s.fault
      },
    )
  if (setup.variant === 'worker' && b.sleeps > 0) {
    take('the Worker sleeps', { sleeps: 1 }, (s) => {
      run(s, [{ kind: 'hibernate' }], setup, rules, client)
    })
    take('the hourly alarm', { sleeps: 1 }, (s) => {
      run(s, [{ kind: 'alarm' }], setup, rules, client)
    })
  }
  return out
}

/**
 * Mail settles: a minute passes, so reads are allowed again, the Lighthouse recovers, every
 * client that's joined looks until it takes nothing new.
 */
export function settle(
  sys: Sys,
  setup: Setup,
  rules: Rules = RULES,
  client: ClientRules = CLIENT_RULES,
): Sys {
  const s: MSys = { ...sys, broken: [], fault: false }
  const pings: Event[] = Object.values(s.clients)
    .filter((c) => c.conn !== null && c.waitReq !== null)
    .map((c) => ({ kind: 'ping', conn: c.conn ?? '' }))
  run(s, [...pings, { kind: 'tick', seconds: 60 }], setup, rules, client)
  for (let round = 0; round < 6; round++) {
    const before = JSON.stringify(Object.values(s.clients).map((c) => c.taken))
    for (const who of Object.keys(s.clients))
      if (!s.waitingToJoin.includes(who)) look(s, who, setup, rules, client)
    if (JSON.stringify(Object.values(s.clients).map((c) => c.taken)) === before) break
  }
  return s
}
