// When the Messenger looks for mail: one look at a time, never within MAIL_MIN_GAP_MS of the last
// that something other than a timer asked for, a timer every few minutes and a quicker one while an
// invite link of yours waits. What a look does is passed in as `look`.
import { type Accessor, createSignal } from 'solid-js'
import type { Clock } from '../../../platform/clock/clock.ts'
import type { Wake } from '../../../platform/wake/wake.ts'

/** How often a running Messenger looks for mail. */
export const MAIL_EVERY_MS = 10 * 60 * 1000
/** How often mail is looked for while a link of yours is open, or a request you sent waits. */
export const INVITE_MAIL_EVERY_MS = 30 * 1000
/**
 * The least time between two looks that something other than a timer asked for (a tab shown,
 * a window focused, the network back, a message sent), so a burst of them is one look.
 */
export const MAIL_MIN_GAP_MS = 5 * 1000
/**
 * How long after you send something mail is looked for: long enough for a letter that has to
 * go through a Lighthouse to be put there, so the look can hear its receipt or a reply.
 */
export const MAIL_AFTER_SEND_MS = 10 * 1000

export interface MailScheduleDeps {
  readonly clock: Clock
  /** When the person may have come back or the network returned: mail is looked for then. */
  readonly wake?: Wake | undefined
  /** Whether this Pigeon can use Lighthouses at all; without, nothing is ever looked for. */
  readonly enabled: boolean
  readonly closed: () => boolean
  /** One look: fetches, puts again what waits, and acts on what came. */
  readonly look: () => Promise<void>
  /** A link of yours is open, or a request you sent waits for its answer. */
  readonly inviteWaiting: () => boolean
}

export interface MailSchedule {
  /** Looks for mail now, or after the one under way. */
  readonly checkMail: () => Promise<void>
  /** Looks soon, in `after` ms at the earliest and never within MAIL_MIN_GAP_MS of the last. */
  readonly lookSoon: (after: number) => void
  /** How long a look asked for now would wait: what's left of the gap since the last one. */
  readonly gapLeft: () => number
  /** When the last look finished. */
  readonly lookedAt: Accessor<number | undefined>
  /** Whether a look is under way, or asked for and waiting its turn. */
  readonly lookState: Accessor<'idle' | 'waiting' | 'checking'>
  /** Stops listening for the person coming back, if anything was. */
  readonly stopWaking: (() => void) | undefined
  /** Starts the timers; they run until the Messenger is closed. */
  readonly run: () => void
}

export function createMailSchedule(deps: MailScheduleDeps): MailSchedule {
  const { clock, closed } = deps
  let checking: Promise<void> | undefined
  let lastLookAt = Number.NEGATIVE_INFINITY
  // What the Messenger says about its looking: when the last one finished, and whether one is
  // under way or asked for and waiting its turn.
  const [lookedAt, setLookedAt] = createSignal<number | undefined>(undefined)
  const [lookState, setLookState] = createSignal<'idle' | 'waiting' | 'checking'>('idle')
  function checkMail(): Promise<void> {
    if (!deps.enabled || closed()) return Promise.resolve()
    if (checking === undefined) lastLookAt = clock.now()
    checking ??= deps.look().finally(() => {
      checking = undefined
      setLookedAt(clock.now())
      setLookState(looking ? 'waiting' : 'idle')
    })
    setLookState('checking')
    return checking
  }

  /**
   * Looks for mail soon, in `after` ms at the earliest and never within MAIL_MIN_GAP_MS of the
   * last look. Asked again while one waits, it is that one: a tab shown, a window focused and a
   * network back in the same moment are one look. A look in progress isn't joined, since what it
   * has fetched may already be past what the person came back for; this one waits and goes after.
   */
  let looking = false
  /** How long a look asked for now would wait: what's left of the gap since the last one. */
  const gapLeft = () => Math.max(0, lastLookAt + MAIL_MIN_GAP_MS - clock.now())
  function lookSoon(after: number) {
    if (!deps.enabled || closed() || looking) return
    looking = true
    if (checking === undefined) setLookState('waiting')
    void (async () => {
      const wait = Math.max(after, gapLeft())
      if (wait > 0) await clock.sleep(wait)
      await checking?.catch(() => undefined)
      looking = false
      await checkMail().catch(() => undefined)
    })()
  }
  const stopWaking = deps.wake?.on(() => lookSoon(0))

  function run(): void {
    // Mail is looked for every few minutes while the Messenger runs, as well as on start.
    void (async () => {
      while (!closed()) {
        await clock.sleep(MAIL_EVERY_MS)
        if (closed()) return
        await checkMail().catch(() => undefined)
      }
    })()
    // More often while a link of yours is open or a request you sent waits, so two people online
    // together pair within a minute.
    void (async () => {
      while (!closed()) {
        await clock.sleep(INVITE_MAIL_EVERY_MS)
        if (closed()) return
        if (deps.inviteWaiting()) await checkMail().catch(() => undefined)
      }
    })()
  }

  return { checkMail, lookSoon, gapLeft, lookedAt, lookState, stopWaking, run }
}
