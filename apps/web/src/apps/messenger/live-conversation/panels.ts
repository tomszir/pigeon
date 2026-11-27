// What a friend's chat puts on the screen: the log as panels with the marks that say how each of
// your messages is getting there, a day line between days, and the messages that came by letter
// while you were away folded into one envelope.
import type { LogEntry, PeerId } from '@pigeon/core'
import type {
  MessageEntry,
  MessageMark,
  MessageNote,
  TranscriptEntry,
} from '../../../ui/transcript/entries.ts'
import type { MessageRoute } from '../service/letters.ts'
import type { FriendView, Note } from '../service/messenger.ts'
import { clockTime, dayLabel, dayName, fullTime, sameDay } from './clock-text.ts'

type NoteKind = Note['kind']
const NOTES: Record<
  NoteKind,
  { kind: 'buzz' | 'system'; text: (name: string, at: number) => string }
> = {
  'buzz-in': { kind: 'buzz', text: (name) => `${name} has just sent you a buzz!` },
  'buzz-out': { kind: 'buzz', text: () => 'You have just sent a buzz!' },
  online: { kind: 'system', text: (name, at) => `${name} came online at ${clockTime(at)}.` },
  offline: { kind: 'system', text: (name, at) => `${name} went offline at ${clockTime(at)}.` },
}

const listOf = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** The mark and the line under the panel of a message of yours; either may be left out. */
export interface Way {
  readonly mark?: MessageMark
  readonly note?: MessageNote
}

/**
 * How a message of yours is getting there, from the Messenger's word for it. A message that
 * went straight to them, and that they haven't said they hold, has no word: nothing is claimed
 * for it. With `tryAgain`, one that no Lighthouse took yet offers Try Again, which calls it.
 */
export function wayOf(
  route: MessageRoute | undefined,
  friend: string,
  tryAgain?: () => void,
): Way | undefined {
  switch (route?.kind) {
    case 'sealing':
      return { mark: { state: 'sealing', text: 'Sealing' } }
    case 'left':
      return {
        mark: {
          state: 'mailed',
          text: 'Mailed',
          detail: `Left at ${listOf(route.where)} for when ${friend}'s back`,
        },
      }
    case 'has':
      return { mark: { state: 'received', text: 'Received' } }
    case 'waiting':
      return { note: { text: `Waiting for ${friend} to be online`, bad: false } }
    case 'retrying':
      // While a try runs there is nothing to press: the words say it is under way.
      if (route.attempt === 'trying')
        return {
          mark: { state: 'sealing', text: 'Mailing' },
          note: { text: 'Trying to mail it...', bad: false },
        }
      return {
        mark: { state: 'failed', text: 'Not mailed yet' },
        note: {
          text:
            route.attempt === 'failed'
              ? 'Not mailed yet. No Lighthouse answered. Pigeon tries again at the next mail check.'
              : 'Not mailed yet. Pigeon tries again at the next mail check.',
          bad: true,
          ...(tryAgain === undefined ? {} : { action: { label: 'Try Again', run: tryAgain } }),
        },
      }
    default:
      return undefined
  }
}

/**
 * Whether a mark is drawn. Only the newest message of yours and any that isn't received yet carry
 * one, so a conversation settles into plain panels; a failure always keeps its mark.
 */
export const showsMark = (mark: MessageMark, newest: boolean): boolean =>
  newest || mark.state !== 'received'

/** "3 messages by letter", "1 message by letter". */
const countText = (count: number) => `${count} ${count === 1 ? 'message' : 'messages'} by letter`

/** The Lighthouse names in a run of letter messages, once each, in the order they came. */
const throughOf = (run: readonly MessageEntry[]): string[] => [
  ...new Set(run.flatMap((entry) => entry.letter?.through ?? [])),
]

const cameByLetter = (entry: TranscriptEntry): entry is MessageEntry =>
  entry.kind === 'message' && entry.letter !== undefined

/**
 * Gathers the messages that came by letter and weren't read yet into sections, each drawn as one
 * pixel envelope: "Rook left 3 messages while you were away, by letter, through Dovecote".
 *
 * Messages arrived together when nothing else lies between them in the chat: a run of a friend's
 * messages that all came by letter, with none of yours, none that came straight, no buzz, no day
 * line and no coming or going in between. Unread is the other half: a message you had already
 * read when the chat opened (`settled`, by entry id) is shown like any other message, so a
 * section ends when you've read it and the chat is opened again. Every Lighthouse the run came
 * through is named; mail is only ever fetched from your own list, so each one is yours.
 *
 * The chat doesn't keep when a letter was taken, only where it sits in the log, so the run
 * itself is what says "together": a few letters taken hours apart, with nothing from either of
 * you between, were all waiting when you came back.
 */
export function letterSections(
  entries: readonly TranscriptEntry[],
  settled: ReadonlySet<string>,
): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  let run: MessageEntry[] = []
  const end = () => {
    const first = run[0]
    if (first !== undefined) {
      const through = listOf(throughOf(run))
      out.push({
        kind: 'section',
        id: `letters-${first.id}`,
        from: first.from,
        title: `${first.from} left ${run.length} ${run.length === 1 ? 'message' : 'messages'} while you were away`,
        how: `By letter, through ${through}`,
        label: `${countText(run.length)}, through ${through}`,
        entries: run,
      })
    }
    run = []
  }
  for (const entry of entries) {
    if (cameByLetter(entry) && !entry.own && !settled.has(entry.id)) {
      run.push(entry)
      continue
    }
    end()
    // Read before the chat opened: a message like any other, with no mark of how it came.
    if (cameByLetter(entry)) {
      const { letter: _letter, ...plain } = entry
      out.push(plain)
      continue
    }
    out.push(entry)
  }
  end()
  return out
}

/**
 * Which entries had been read when a chat opened: all but the friend's last `unread`, since
 * `unread` counts what arrived since you last looked. Entries that come later aren't in it.
 */
export function readAtOpen(view: FriendView, mine: (author: PeerId) => boolean): Set<string> {
  const read = new Set<string>()
  let unread = view.unread
  for (const entry of view.log.entries.toReversed()) {
    if (!mine(entry.author) && unread > 0) unread -= 1
    else read.add(entry.sig)
  }
  return read
}

/** `mine` says which entries are yours: written on any of your devices. `routeOf` says each one's way. */
export function transcriptFor(
  view: FriendView,
  mine: PeerId | ((author: PeerId) => boolean),
  selfName: string,
  routeOf: (entry: LogEntry) => MessageRoute | undefined = () => undefined,
  /** Puts what no Lighthouse took yet at once: offered under such a message as Try Again. */
  tryAgain?: () => void,
  /** For the day lines: "Today", "Yesterday". */
  now: number = Date.now(),
) {
  const isMine = typeof mine === 'string' ? (author: PeerId) => author === mine : mine
  const entries: TranscriptEntry[] = []
  // Where the chat began: kept with the friend (addedAt), so it's there on every visit.
  if (view.addedAt > 0)
    entries.push({
      kind: 'system',
      id: 'became-friends',
      text: `${selfName} and ${view.name} became friends on ${dayName(view.addedAt)} at ${clockTime(view.addedAt)}.`,
    })
  const notes = [...view.notes]
  // The newest message of yours is the one that keeps its mark once it's received.
  const newestOwn = view.log.entries.findLastIndex((entry) => isMine(entry.author))
  const flush = (upTo: number) => {
    while (notes[0] !== undefined && notes[0].after <= upTo) {
      const note = notes.shift()
      if (note === undefined) continue
      const shown = NOTES[note.kind]
      entries.push({
        kind: shown.kind,
        id: `note-${note.id}`,
        text: shown.text(view.name, note.at),
      })
    }
  }
  let before: number | undefined
  view.log.entries.forEach((entry, index) => {
    flush(index)
    const own = isMine(entry.author)
    const route = routeOf(entry)
    const found = own ? wayOf(route, view.name, tryAgain) : undefined
    const mark =
      found?.mark !== undefined && showsMark(found.mark, index === newestOwn)
        ? found.mark
        : undefined
    if (before === undefined || !sameDay(before, entry.at))
      entries.push({ kind: 'day', id: `day-${entry.sig}`, text: dayLabel(entry.at, now) })
    before = entry.at
    entries.push({
      kind: 'message',
      id: entry.sig,
      from: own ? selfName : view.name,
      own,
      author: entry.author,
      text: entry.text,
      at: entry.at,
      time: clockTime(entry.at),
      when: fullTime(entry.at),
      ...(route?.kind === 'arrived' ? { letter: { through: route.through } } : {}),
      ...(mark === undefined ? {} : { mark }),
      ...(found?.note === undefined ? {} : { note: found.note }),
    })
  })
  flush(Number.POSITIVE_INFINITY)
  if (view.removedYouAt !== undefined)
    entries.push({
      kind: 'system',
      id: 'removed-you',
      text: `${view.name} removed you as a friend on ${dayName(view.removedYouAt)} at ${clockTime(view.removedYouAt)}.`,
    })
  // Their Pigeon is from before device logs: it only takes messages from your first device.
  if (view.seesThisDevice === false)
    entries.push({
      kind: 'system',
      id: 'needs-update',
      text: `${view.name}'s Pigeon needs an update to get messages from this device. Your first device still reaches them, and reloading Pigeon updates it.`,
    })
  return entries
}
