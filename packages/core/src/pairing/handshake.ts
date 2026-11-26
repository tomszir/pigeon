// The part of invites and device links that proves both sides hold the same code, and that
// nobody sits between them. Side `a` opened the code, side `b` made it; every connection in the
// room gets a run of its own:
//
//   a -> b  pake-start   which secret (`code` or `link`), a's SPAKE2 message
//   b -> a  pake-reply   b's SPAKE2 message
//   a -> b  pake-prove   a's confirmation MAC (a wrong one is a wrong try, and b says pake-wrong)
//   b -> a  *-offer      b's confirmation MAC, with who b is (pairing.ts, link.ts)
//
// Both MACs are HMAC-SHA256 over one transcript, under keys HKDF makes from the SPAKE2 key, one
// per side. The transcript names the kind, the room, the secret used, both SPAKE2 messages, both
// device keys (each the signer of that side's envelopes) and both ends' DTLS fingerprints, from
// the connection itself. Someone in the middle shows each side a certificate of their own, so
// the two transcripts differ and neither MAC checks, even if they relay every message unchanged.
// Every later message has to come over the same connection from the same device.
//
// `a` proves first, so the side whose code waits for half an hour never hands anyone something
// to test a guess against: each guess at it is a wrong try it counts and shows.
import { base64Decode, base64Encode, hexEncode, utf8Encode } from '../encoding/bytes.ts'
import { canonicalBytes } from '../encoding/canonical.ts'
import type { Crypto } from '../identity/crypto.ts'
import type { PeerId } from '../identity/identity.ts'
import type { SealCrypto } from '../mail/seal-crypto.ts'
import type { Pake, PakeStart } from '../pake/pake.ts'
import {
  type ChannelBinding,
  type ConnectionId,
  isFingerprint,
  type Room,
} from '../transport/transport.ts'
import type { CodeKind, Invite } from './invite.ts'

export type Via = Invite['via']

/** Wrong confirmations a code takes before it's stopped. */
export const MAX_WRONG_TRIES = 5
/**
 * Runs the side that made a code keeps going in one room at once; more connections than this
 * are ignored until one ends. An unproven run lasts PROVE_TIMEOUT_MS, then counts as a wrong
 * try, so filling the slots costs the code's tries, which the inviter sees, rather than locking
 * it out unseen.
 */
const MAX_RUNS = 16
export const PROVE_TIMEOUT_MS = 30_000
/**
 * Runs the side that opened a code starts, at most MAX_OPENER_RUNS in all and
 * MAX_OPENER_ACTIVE at once, one per connection in the room. Whoever answers can test one guess
 * at the code per run against the confirmation it's sent, unseen by the inviter, so this is kept
 * to what a room of one inviter and a stranger or two needs. A run that stalls for
 * OPENER_TIMEOUT_MS gives its place to the next connection.
 */
const MAX_OPENER_RUNS = 8
const MAX_OPENER_ACTIVE = 4
export const OPENER_TIMEOUT_MS = 15_000

const context = (kind: CodeKind) => `pigeon/${kind}/v2`

/** What both MACs cover, in canonical JSON. */
interface Transcript {
  readonly v: string
  readonly room: string
  readonly via: Via
  readonly a: string
  readonly b: string
  readonly aDevice: PeerId
  readonly bDevice: PeerId
  readonly aDtls: string
  readonly bDtls: string
}

/** A run whose MACs are known: `session` names it, so a sealed answer counts only here. */
export interface Proven {
  readonly connection: ConnectionId
  /** The other side's device: every later message on this run must be signed by it. */
  readonly device: PeerId
  readonly via: Via
  /** SHA-256 of the transcript, hex. */
  readonly session: string
  /** The MAC this side sends (b's, in the offer), base64. */
  readonly mac: string
}

/** A binding the transcript can use: both ends known, one spelling each, and not the same. */
const usable = (binding: ChannelBinding | undefined): binding is ChannelBinding =>
  binding !== undefined &&
  isFingerprint(binding.local) &&
  isFingerprint(binding.remote) &&
  binding.local !== binding.remote

/** The SPAKE2 password: the kind of secret is part of it, so a code never stands for a link. */
const passwordBytes = (via: Via, secret: string) => utf8Encode(`${via}:${secret}`)

/**
 * Starts a run, wiping this side's copy of the password once the exchange has its own, and
 * undefined if it can't start.
 */
async function startRun(
  pake: Pake,
  role: 'a' | 'b',
  via: Via,
  secret: string,
  ids: readonly [Uint8Array, Uint8Array],
): Promise<PakeStart | undefined> {
  const password = passwordBytes(via, secret)
  try {
    return await pake.start(role, password, ids[0], ids[1])
  } catch {
    return undefined
  } finally {
    password.fill(0)
  }
}

const pakeIds = (kind: CodeKind, room: string) =>
  [utf8Encode(`${context(kind)}/a/${room}`), utf8Encode(`${context(kind)}/b/${room}`)] as const

/** Both sides' MACs and the session name, from the SPAKE2 key and the transcript. */
async function confirmations(
  crypto: Crypto,
  seal: SealCrypto,
  kind: CodeKind,
  key: Uint8Array,
  transcript: Transcript,
) {
  const bytes = canonicalBytes({ ...transcript })
  const keyA = await seal.hkdf(key, `${context(kind)}/confirm/a`, 32)
  const keyB = await seal.hkdf(key, `${context(kind)}/confirm/b`, 32)
  try {
    return {
      a: await crypto.hmacSha256(keyA, bytes),
      b: await crypto.hmacSha256(keyB, bytes),
      session: hexEncode(await crypto.sha256(bytes)),
    }
  } finally {
    // Nothing else is made from them: wiped now rather than when collected.
    for (const used of [key, keyA, keyB]) used.fill(0)
  }
}

/** True when `text` is the base64 of exactly `expected`, compared in constant time. */
function macMatches(expected: Uint8Array, text: unknown): boolean {
  if (typeof text !== 'string') return false
  const given = base64Decode(text)
  if (!given.ok || given.value.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= (expected[i] ?? 0) ^ (given.value[i] ?? 0)
  return diff === 0
}

interface Common {
  readonly crypto: Crypto
  readonly seal: SealCrypto
  readonly pake: Pake
  readonly kind: CodeKind
  readonly room: Room
  /** This device's key: the signer of its envelopes. */
  readonly device: PeerId
  readonly sleep: (ms: number) => Promise<void>
}

/**
 * A code's wrong tries, shared by both rooms it waits in. `onWrongTry` hears each with the count
 * so far, before anything else happens; once `count` reaches MAX_WRONG_TRIES no run goes on.
 */
export interface WrongTries {
  count: number
  readonly onWrongTry: (count: number) => void
}

export interface HostRuns {
  /** a's pake-start: answers pake-reply. */
  start(from: ConnectionId, sender: PeerId, body: { via: Via; pake: string }): Promise<void>
  /** a's pake-prove: the proven run when the MAC holds, for the offer; undefined otherwise. */
  prove(from: ConnectionId, sender: PeerId, body: { mac: string }): Promise<Proven | undefined>
  /** The proven run on `from`, when `sender` is its device. */
  proven(from: ConnectionId, sender: PeerId): Proven | undefined
  /**
   * A connection left. A run it hadn't proved counts as a wrong try, so leaving and coming
   * back can't hold a slot without paying for it.
   */
  drop(from: ConnectionId): void
  /** Ends a run without counting it, as when its request is declined: it can't ask again. */
  refuse(from: ConnectionId): void
  /** Forgets every run, as the code stops: nothing more counts. */
  clear(): void
}

/** Side b's runs for one live code in one room, which takes the secret `via` names alone. */
export function hostRuns(
  options: Common & {
    readonly via: Via
    readonly secret: string
    readonly tries: WrongTries
    readonly reply: (to: ConnectionId, pake: string) => Promise<void>
    readonly wrong: (to: ConnectionId) => Promise<void>
    /** False once the code is used up or stopped: nothing more starts or counts. */
    readonly open: () => boolean
  },
): HostRuns {
  const { crypto, seal, pake, kind, room, tries } = options
  const ids = pakeIds(kind, room.name)
  type Run =
    /** Taken at once, so a second pake-start on the connection never starts a second run. */
    | { readonly state: 'starting' }
    | { readonly state: 'replied'; readonly device: PeerId; readonly macs: Promise<Macs> }
    | { readonly state: 'proven'; readonly proven: Proven }
    | { readonly state: 'failed' }
  type Macs = { a: Uint8Array; b: Uint8Array; session: string } | undefined
  const runs = new Map<ConnectionId, Run>()
  const live = () => options.open() && tries.count < MAX_WRONG_TRIES

  /** A wrong try: counted and told at once, so tries that come together can't pass the limit. */
  const fail = (from: ConnectionId) => {
    runs.set(from, { state: 'failed' })
    tries.count += 1
    tries.onWrongTry(tries.count)
    void options.wrong(from).catch(() => undefined)
  }

  return {
    async start(from, sender, body) {
      if (!live() || body.via !== options.via || runs.has(from) || runs.size >= MAX_RUNS) return
      const message = base64Decode(body.pake)
      if (!message.ok) return
      const slot: Run = { state: 'starting' }
      runs.set(from, slot)
      const binding = await room.binding(from)
      const started = usable(binding)
        ? await startRun(pake, 'b', options.via, options.secret, ids)
        : undefined
      if (runs.get(from) !== slot || started === undefined || !usable(binding) || !live()) {
        started?.abandon()
        if (runs.get(from) === slot) runs.delete(from)
        return
      }
      const run = started
      const macs = (async (): Promise<Macs> => {
        const key = await run.finish(message.value).catch(() => undefined)
        if (key === undefined) return undefined
        const transcript: Transcript = {
          v: context(kind),
          room: room.name,
          via: options.via,
          a: base64Encode(message.value),
          b: base64Encode(run.message),
          aDevice: sender,
          bDevice: options.device,
          aDtls: binding.remote,
          bDtls: binding.local,
        }
        return confirmations(crypto, seal, kind, key, transcript)
      })()
      const replied: Run = { state: 'replied', device: sender, macs }
      runs.set(from, replied)
      // While the code is paused (an answer being sealed) the clock waits.
      const expire = (): void =>
        void options.sleep(PROVE_TIMEOUT_MS).then(() => {
          if (runs.get(from) !== replied || tries.count >= MAX_WRONG_TRIES) return
          if (options.open()) fail(from)
          else expire()
        })
      expire()
      await options.reply(from, base64Encode(run.message))
    },
    async prove(from, sender, body) {
      const run = runs.get(from)
      if (run?.state !== 'replied' || run.device !== sender || !live()) return undefined
      const macs = await run.macs
      // Checked again: other tries may have used up the code while this one was worked out.
      if (runs.get(from) !== run || !live()) return undefined
      if (macs === undefined || !macMatches(macs.a, body.mac)) {
        fail(from)
        return undefined
      }
      const proven: Proven = {
        connection: from,
        device: sender,
        via: options.via,
        session: macs.session,
        mac: base64Encode(macs.b),
      }
      runs.set(from, { state: 'proven', proven })
      return proven
    },
    proven(from, sender) {
      const run = runs.get(from)
      return run?.state === 'proven' && run.proven.device === sender ? run.proven : undefined
    },
    drop(from) {
      const run = runs.get(from)
      if (run?.state === 'replied' && live()) {
        tries.count += 1
        tries.onWrongTry(tries.count)
      }
      runs.delete(from)
    },
    refuse: (from) => void runs.set(from, { state: 'failed' }),
    clear: () => runs.clear(),
  }
}

export interface OpenerRuns {
  /** Starts a run with a connection that just joined, if there's room: sends pake-start. */
  begin(to: ConnectionId): Promise<void>
  /** b's pake-reply: sends pake-prove. */
  reply(from: ConnectionId, sender: PeerId, body: { pake: string }): Promise<void>
  /** b's offer: the proven run when its MAC holds, undefined otherwise. */
  offer(from: ConnectionId, sender: PeerId, body: { mac: string }): Promise<Proven | undefined>
  /** b said the confirmation was wrong: true if it was on a run of ours waiting for an offer. */
  wrong(from: ConnectionId, sender: PeerId): boolean
  /** The proven run on `from`, when `sender` is its device. */
  proven(from: ConnectionId, sender: PeerId): Proven | undefined
  /** Runs still under way, or connections still to try: none means nobody else can answer. */
  pending(): number
  /** Forgets a connection's run, as when it leaves. */
  drop(to: ConnectionId): void
  /** Ends every run still under way, as the opener gives up or goes on with one that held. */
  abandon(): void
}

/** Side a's runs for one invite or link it opened: one per connection in the room. */
export function openerRuns(
  options: Common & {
    readonly invite: Invite
    readonly startMessage: (to: ConnectionId, via: Via, pake: string) => Promise<void>
    readonly proveMessage: (to: ConnectionId, mac: string) => Promise<void>
  },
): OpenerRuns {
  const { crypto, seal, pake, kind, room, invite } = options
  const ids = pakeIds(kind, room.name)
  type Run =
    | { readonly state: 'starting' }
    | { readonly state: 'started'; readonly started: PakeStart; readonly binding: ChannelBinding }
    | {
        readonly state: 'proved'
        readonly device: PeerId
        readonly expected: Uint8Array
        readonly session: string
        readonly mac: string
      }
    | { readonly state: 'proven'; readonly proven: Proven }
    | { readonly state: 'failed' }
  const runs = new Map<ConnectionId, Run>()
  /** Connections that came while there was no room, tried as runs end. */
  const waiting = new Set<ConnectionId>()
  /** Runs ever started: each is one guess for whoever answers it. */
  let started = 0
  /** Set once the opener is done with the room: nothing more starts. */
  let closed = false
  const active = () =>
    [...runs.values()].filter(
      (run) => run.state === 'starting' || run.state === 'started' || run.state === 'proved',
    ).length

  /** Ends a run that won't go on, wiping its exchange if it never finished. */
  const end = (at: ConnectionId) => {
    const run = runs.get(at)
    if (run?.state === 'started') run.started.abandon()
    runs.set(at, { state: 'failed' })
    for (const next of waiting) {
      waiting.delete(next)
      void begin(next)
      break
    }
  }

  async function begin(to: ConnectionId): Promise<void> {
    if (closed || runs.has(to)) return
    if (started >= MAX_OPENER_RUNS) return
    if (active() >= MAX_OPENER_ACTIVE) {
      waiting.add(to)
      return
    }
    const slot: Run = { state: 'starting' }
    runs.set(to, slot)
    started += 1
    const binding = await room.binding(to)
    const pakeStart = usable(binding)
      ? await startRun(pake, 'a', invite.via, invite.secret, ids)
      : undefined
    if (runs.get(to) !== slot || closed) {
      pakeStart?.abandon()
      return
    }
    if (pakeStart === undefined || !usable(binding)) {
      // No channel to bind to yet: let a later join try again.
      runs.delete(to)
      started -= 1
      return
    }
    const run: Run = { state: 'started', started: pakeStart, binding }
    runs.set(to, run)
    void options.sleep(OPENER_TIMEOUT_MS).then(() => {
      const now = runs.get(to)
      if (now?.state === 'started' || now?.state === 'proved') end(to)
    })
    await options.startMessage(to, invite.via, base64Encode(pakeStart.message))
  }

  return {
    begin,
    async reply(from, sender, body) {
      const run = runs.get(from)
      if (run?.state !== 'started' || sender === options.device) return
      const message = base64Decode(body.pake)
      if (!message.ok) return
      const key = await run.started.finish(message.value).catch(() => undefined)
      if (runs.get(from) !== run) {
        key?.fill(0)
        return
      }
      if (key === undefined) {
        end(from)
        return
      }
      const transcript: Transcript = {
        v: context(kind),
        room: room.name,
        via: invite.via,
        a: base64Encode(run.started.message),
        b: base64Encode(message.value),
        aDevice: options.device,
        bDevice: sender,
        aDtls: run.binding.local,
        bDtls: run.binding.remote,
      }
      const macs = await confirmations(crypto, seal, kind, key, transcript)
      if (runs.get(from) !== run) return
      const mac = base64Encode(macs.a)
      runs.set(from, {
        state: 'proved',
        device: sender,
        expected: macs.b,
        session: macs.session,
        mac,
      })
      await options.proveMessage(from, mac)
    },
    async offer(from, sender, body) {
      const run = runs.get(from)
      if (run?.state !== 'proved' || run.device !== sender) return undefined
      if (!macMatches(run.expected, body.mac)) {
        end(from)
        return undefined
      }
      const proven: Proven = {
        connection: from,
        device: sender,
        via: invite.via,
        session: run.session,
        mac: run.mac,
      }
      runs.set(from, { state: 'proven', proven })
      return proven
    },
    wrong(from, sender) {
      const run = runs.get(from)
      if (run?.state !== 'proved' || run.device !== sender) return false
      end(from)
      return true
    },
    proven(from, sender) {
      const run = runs.get(from)
      return run?.state === 'proven' && run.proven.device === sender ? run.proven : undefined
    },
    pending: () => active() + (started < MAX_OPENER_RUNS ? waiting.size : 0),
    abandon() {
      closed = true
      waiting.clear()
      for (const [at, run] of runs) if (run.state === 'started' || run.state === 'proved') end(at)
    },
    drop(to) {
      waiting.delete(to)
      const run = runs.get(to)
      if (run !== undefined && run.state !== 'failed' && run.state !== 'proven') end(to)
      runs.delete(to)
    },
  }
}
