// Hearing about mail at once: after a look that read one of this Pigeon's own Lighthouses to the
// end, a `wait` is left there for the tags a sender could be putting under now, and the Lighthouse
// answers it the moment one of them gets mail. The answer is only a cue to look, through the usual
// scheduler, a moment later; it never moves a cursor or takes anything. A connection closed while
// it waits is opened again while Pigeon is on screen, unless the Lighthouse closed it for room.
import {
  type LighthouseAddress,
  type LighthouseClient,
  MAX_WAIT_SECONDS,
  MAX_WAIT_TAGS,
  utcDate,
} from '@pigeon/core'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Looked } from './look.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** How long before a dropped wait is opened again, at first and at most. */
export const REOPEN_FIRST_MS = 5000
export const REOPEN_MOST_MS = 5 * 60 * 1000
/** A wait that stood this long went well: the next drop is reopened quickly again. */
const STOOD_MS = 60 * 1000
/** The most a look waits after a cue, so a network watcher can't as easily line up put and fetch. */
export const CUE_JITTER_MS = 2000
/**
 * How long the next cue waits after one brought a look that took nothing, at first, doubling to
 * the schedule's own ten minutes. Anyone holding a tag a Pigeon waits on (a friend, someone with
 * an invite link) could put junk under it every few seconds; without this each put would bring a
 * look at every Lighthouse on the list.
 */
export const EMPTY_CUE_HOLD_MS = 60 * 1000
export const EMPTY_CUE_HOLD_MOST_MS = 10 * 60 * 1000

/**
 * The tags a wait names after a look at `at`: of those the look listed, today's, yesterday's in
 * the first two hours of the UTC day and tomorrow's in the last two, your own and invites' first,
 * 128 at most. Always among what the look listed, since they're taken from it.
 */
export function waitTags(at: number, tags: Looked['tags']): string[] {
  const today = utcDate(at)
  const days = new Set([today])
  if (utcDate(at - 2 * HOUR) !== today) days.add(utcDate(at - DAY))
  if (utcDate(at + 2 * HOUR) !== today) days.add(utcDate(at + DAY))
  const kept = tags.filter((entry) => days.has(entry.date))
  return [...kept.filter((entry) => entry.first), ...kept.filter((entry) => !entry.first)]
    .map((entry) => entry.tag)
    .slice(0, MAX_WAIT_TAGS)
}

export interface MailWaitsDeps {
  readonly clock: Clock
  readonly random: (length: number) => Uint8Array
  readonly client: (address: LighthouseAddress) => LighthouseClient | undefined
  /** Waiting is on: "Hear about mail at once", and relay-only off. */
  readonly on: () => boolean
  /** Pigeon is on screen: a dropped wait is opened again only then. */
  readonly visible: () => boolean
  /** Asks for a look through the scheduler, which keeps looks apart. */
  readonly cue: () => void
  /** How long until the next scheduled look, in ms. */
  readonly nextLook: () => number
  readonly closed: () => boolean
}

export interface MailWaits {
  /** A look read `address`: a wait follows it there, if it read every list to the end. */
  looked(address: LighthouseAddress, looked: Looked): void
  /** Waiting turned off, or relay-only on: every connection with a wait standing is closed. */
  stop(): void
  /**
   * Your Lighthouses are now `list`: one that left it waits no more, and is never waited at again
   * (nor reopened) until a look reads it as one of yours.
   */
  retain(list: readonly LighthouseAddress[]): void
  /**
   * A look's `take`, noting whether it took anything that counted, which says how soon the next
   * cue may bring a look.
   */
  counting<A extends unknown[]>(
    take: (...args: A) => Promise<boolean>,
  ): (...args: A) => Promise<boolean>
  /** The look `counting` was used for has finished. */
  lookDone(): void
}

interface Waiting {
  readonly address: LighthouseAddress
  tags: readonly string[]
  cursor: number
  /** When its lease ends: at the next scheduled look. */
  until: number
  /** Bumped by each wait sent and by stopping, so an old one's answer is ignored. */
  gen: number
  standing: boolean
  since: number
  backoff: number
  /** Closed for room: not opened again until the next look. */
  heldOff: boolean
  /** It called a wait malformed: a Lighthouse from before waits, not asked again for an hour. */
  unsupportedUntil: number
}

const keyOf = (address: LighthouseAddress) => `${address.id} ${address.url} ${address.pass ?? ''}`

export function createMailWaits(deps: MailWaitsDeps): MailWaits {
  const { clock } = deps
  const waiting = new Map<string, Waiting>()
  /** Cues in a row whose looks took nothing; a look that takes something starts it again. */
  let emptyCues = 0
  /** A cue asked for a look that hasn't finished yet. */
  let cued = false
  /** The look under way took something that counted. */
  let took = false
  /** A fraction from 0 to 1, from the random source. */
  const fraction = () => (deps.random(1)[0] ?? 0) / 255
  /** One cue at a time: a second `mail` while one is held back is the same cue. */
  let holding = false

  /** Asks for a look, a moment from now, or later after cues whose looks took nothing. */
  async function cue() {
    if (holding) return
    holding = true
    const hold =
      emptyCues === 0
        ? 0
        : Math.min(EMPTY_CUE_HOLD_MS * 2 ** (emptyCues - 1), EMPTY_CUE_HOLD_MOST_MS)
    await clock.sleep(hold + Math.floor(fraction() * CUE_JITTER_MS))
    holding = false
    if (deps.closed() || !deps.on()) return
    cued = true
    deps.cue()
  }

  async function send(state: Waiting): Promise<void> {
    const client = deps.client(state.address)
    if (client === undefined || deps.closed() || !deps.on()) return
    const now = clock.now()
    state.gen += 1
    const gen = state.gen
    state.standing = true
    state.since = now
    const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Math.ceil((state.until - now) / 1000)))
    const answer = await client.request({
      type: 'wait',
      tags: state.tags,
      cursor: state.cursor,
      seconds,
    })
    // Replaced by a newer wait, or stopped: its answer is that one's business, or nobody's.
    if (gen !== state.gen) return
    state.standing = false
    if (answer.ok) {
      const reply = answer.value
      if (reply.type === 'waited') {
        state.backoff = 0
        if (reply.why === 'mail') await cue()
      } else if (reply.type === 'error' && reply.error === 'malformed')
        state.unsupportedUntil = clock.now() + HOUR
      // Refused for its limits: this Pigeon looks on its schedule.
      return
    }
    if (answer.error === 'room') {
      state.heldOff = true
      return
    }
    // Dropped: opened again while Pigeon is on screen, a little later each time.
    if (clock.now() - state.since >= STOOD_MS) state.backoff = 0
    state.backoff =
      state.backoff === 0 ? REOPEN_FIRST_MS : Math.min(state.backoff * 2, REOPEN_MOST_MS)
    // Half of it random, so connections a Lighthouse dropped all at once don't come back in step.
    await clock.sleep(Math.floor(state.backoff * (0.5 + fraction() / 2)))
    if (gen !== state.gen || state.heldOff || deps.closed() || !deps.on() || !deps.visible()) return
    if (state.until > clock.now()) await send(state)
  }

  return {
    looked(address, looked) {
      if (deps.closed() || !deps.on()) return
      const key = keyOf(address)
      const state: Waiting = waiting.get(key) ?? {
        address,
        tags: [],
        cursor: 0,
        until: 0,
        gen: 0,
        standing: false,
        since: 0,
        backoff: 0,
        heldOff: false,
        unsupportedUntil: 0,
      }
      waiting.set(key, state)
      // A look is when a connection closed for room may wait again.
      state.heldOff = false
      // Only after a look that read every list: otherwise mail past its cursor would answer it
      // at once, and the cue would bring another look that doesn't finish either.
      if (!looked.complete || state.unsupportedUntil > clock.now()) return
      const tags = waitTags(looked.at, looked.tags)
      if (tags.length === 0) return
      state.tags = tags
      state.cursor = looked.cursor
      state.until = clock.now() + Math.min(MAX_WAIT_SECONDS * 1000, Math.max(1000, deps.nextLook()))
      state.backoff = 0
      void send(state).catch(() => undefined)
    },
    counting(take) {
      return async (...args) => {
        const counted = await take(...args)
        if (counted) took = true
        return counted
      }
    },
    lookDone() {
      if (took) emptyCues = 0
      else if (cued) emptyCues += 1
      cued = false
      took = false
    },
    retain(list) {
      const kept = new Set(list.map(keyOf))
      for (const [key, state] of waiting) {
        if (kept.has(key)) continue
        waiting.delete(key)
        state.gen += 1
        if (state.standing) {
          state.standing = false
          deps.client(state.address)?.close()
        }
      }
    },
    stop() {
      for (const state of waiting.values()) {
        state.gen += 1
        if (!state.standing) continue
        state.standing = false
        // Closing the connection is the only way to end a wait: it's gone, unanswered.
        deps.client(state.address)?.close()
      }
    },
  }
}
