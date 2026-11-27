// A conversation with a real friend: the chat log as panels, buzzes in between, the typing
// line, and a status bar that says plainly how the words travel.
import { formatFingerprint, type PeerId } from '@pigeon/core'
import { createEffect, Show } from 'solid-js'
import type { MenuEntry } from '../../../ui/menu/menu.tsx'
import { Conversation } from '../conversation/conversation.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import type { FriendView, Messenger } from '../service/messenger.ts'
import { clockTime, dayName } from './clock-text.ts'
import { letterSections, readAtOpen, transcriptFor } from './panels.ts'

export interface LiveConversationProps {
  messenger: Messenger
  friend: PeerId
  /** True while this window has focus, so arrivals count as read. */
  isActive: () => boolean
  /** Shakes this window. */
  onBuzz: () => void
  onClose: () => void
  onAbout: () => void
  /** The friend's own items for the Actions menu (profile, rename, mute, remove). */
  actions?: (() => readonly MenuEntry[]) | undefined
  /** Hands the visitor a text file to save: Save Conversation As... */
  saveText?: ((name: string, text: string) => void) | undefined
  /** Now, for the line saying when it was saved. */
  now?: (() => number) | undefined
}

/** "Conversation with Mika.txt", without characters file systems refuse. */
export function conversationFileName(name: string): string {
  const safe = [...name]
    .filter((char) => (char.codePointAt(0) ?? 0) >= 32 && !'\\/:*?"<>|'.includes(char))
    .join('')
    .trim()
  return `Conversation with ${safe === '' ? 'a friend' : safe}.txt`
}

/** Columns a saved conversation's lines keep to, so a viewer at least this wide never wraps one. */
export const SAVED_LINE_WIDTH = 76

/** What starts each line a message runs on to: an indent, then a left-to-right mark. */
const CONTINUATION = '    \u200e'

/**
 * Columns a character may take in a viewer: one for ASCII, two for anything else, since viewers
 * draw many other characters double, so a line in a monospace viewer is never wider than it's
 * counted.
 */
const columns = (text: string): number =>
  [...text].reduce((sum, char) => sum + ((char.codePointAt(0) ?? 0) > 0x7e ? 2 : 1), 0)

/** Columns a name keeps to in the saved file; a longer one is cut short with "...". */
const NAME_COLUMNS = 32

const shortName = (name: string): string => {
  if (columns(name) <= NAME_COLUMNS) return name
  let kept = ''
  for (const char of name) {
    if (columns(`${kept}${char}`) > NAME_COLUMNS - 3) break
    kept += char
  }
  return `${kept}...`
}

/** How a name compares: as it's drawn, with invisible characters left out and forms unified. */
const asDrawn = (name: string): string =>
  name
    .normalize('NFKC')
    .replace(/\p{Cf}|\u034f/gu, '')
    .toLowerCase()

/**
 * One line of a message cut into rows: the first `first` columns wide, the rest `rest`, broken at
 * a space where one fits and anywhere in a word too long for a row.
 */
function rows(line: string, first: number, rest: number): string[] {
  const done: string[] = []
  let row = ''
  let used = 0
  const limit = () => (done.length === 0 ? first : rest)
  const next = () => {
    done.push(row)
    row = ''
    used = 0
  }
  for (const word of line.split(' ')) {
    const width = columns(word)
    if (row !== '' && used + 1 + width <= limit()) {
      row += ` ${word}`
      used += 1 + width
      continue
    }
    if (row !== '') next()
    for (const char of word) {
      const wide = columns(char)
      if (used + wide > limit() && row !== '') next()
      row += char
      used += wide
    }
  }
  done.push(row)
  return done
}

/**
 * A message for the saved file, after `prefix` on its first line: every row kept within
 * `SAVED_LINE_WIDTH`, and each row after the first indented and started with a left-to-right
 * mark. A viewer at least that wide has nothing left to wrap, so no part of a message reaches the
 * left edge where a message of its own starts, and marks in the text can't send a row to the
 * right edge and hide its indent. Anything a viewer may break a line at counts as a line break,
 * every run of spaces, tabs and wide or no-break spaces becomes one space, and any other
 * control character, which a terminal could act on, becomes U+FFFD.
 */
function savedMessage(prefix: string, text: string): string {
  const first = Math.max(SAVED_LINE_WIDTH - columns(prefix), 1)
  const rest = SAVED_LINE_WIDTH - columns(CONTINUATION)
  const all = text
    .split(/\r\n|[\n\v\f\r\u0085\u2028\u2029]/)
    .flatMap((line, i) =>
      rows(
        line.replace(/[\t\p{Zs}]+/gu, ' ').replace(/\p{Cc}/gu, '\ufffd'),
        i === 0 ? first : rest,
        rest,
      ),
    )
  return prefix + all.join(`\n${CONTINUATION}`)
}

/**
 * The chat as plain text for Save Conversation As: each message starts a line with its day and
 * time, and the rows it runs on to are indented under it. A friend's name is marked "(friend)"
 * when it starts with yours or holds a colon, so none of their lines can pass for yours.
 */
export function conversationText(
  view: FriendView,
  mine: (author: PeerId) => boolean,
  selfName: string,
  savedAt: number,
): string {
  const when = (at: number) => `${dayName(at)}, ${clockTime(at)}`
  // Your name as your own lines show it, cut short or not, without the "...".
  const yours = asDrawn(shortName(selfName).replace(/\.\.\.$/, ''))
  const looksLikeYou =
    asDrawn(view.name).includes(':') || (yours !== '' && asDrawn(view.name).startsWith(yours))
  const them = `${shortName(view.name)}${looksLikeYou ? ' (friend)' : ''}`
  const lines = [
    `Conversation with ${view.name} <${formatFingerprint(view.fingerprint)}>`,
    `Saved from Pigeon on ${dayName(savedAt)}, ${new Date(savedAt).getFullYear()} at ${clockTime(savedAt)}`,
    '',
  ]
  if (view.addedAt > 0)
    lines.push(`${selfName} and ${view.name} became friends on ${when(view.addedAt)}.`, '')
  for (const entry of view.log.entries)
    lines.push(
      savedMessage(
        `[${when(entry.at)}] ${mine(entry.author) ? shortName(selfName) : them}: `,
        entry.text,
      ),
    )
  if (view.removedYouAt !== undefined)
    lines.push('', `You were removed as a friend by ${them} on ${when(view.removedYouAt)}.`)
  return `${lines.join('\n')}\n`
}

export function LiveConversation(props: LiveConversationProps) {
  const view = () => props.messenger.friend(props.friend)
  // What's kept of letters with them, so each message can say its way.
  void props.messenger.loadLetters(props.friend)
  // What was read when this window opened, worked out once the friend is loaded, so the letters
  // that came while you were away stay in their section for as long as it's open.
  let readOnOpening: Set<string> | undefined
  const readBefore = (current: FriendView): ReadonlySet<string> => {
    readOnOpening ??= readAtOpen(current, props.messenger.isMine)
    return readOnOpening
  }

  createEffect(() => {
    const current = view()
    if (current !== undefined && current.unread > 0 && props.isActive())
      props.messenger.markRead(props.friend)
  })

  return (
    <Show when={view()} fallback={<p>This friend is no longer on your list.</p>}>
      {(current) => (
        <Conversation
          name={current().name}
          fingerprint={formatFingerprint(current().fingerprint)}
          avatar={
            <FriendAvatar
              messenger={props.messenger}
              id={props.friend}
              name={current().name}
              size={32}
            />
          }
          bird={() => (
            <FriendAvatar
              messenger={props.messenger}
              id={props.friend}
              name={current().name}
              size={32}
              decorative
            />
          )}
          route={current().online ? 'direct, encrypted' : 'offline'}
          connected={current().online}
          entries={letterSections(
            transcriptFor(
              current(),
              props.messenger.isMine,
              props.messenger.profile().handle,
              (entry) => props.messenger.messageRoute(props.friend, entry),
              () => void props.messenger.tryAgain(props.friend),
              props.now?.() ?? Date.now(),
            ),
            readBefore(current()),
          )}
          typing={current().typing ? `${current().name} is writing a message...` : ''}
          closed={current().removedYouAt !== undefined}
          status={
            current().removedYouAt !== undefined
              ? `${current().name} removed you. This chat stays here until you remove them too.`
              : current().online
                ? `Connected directly to ${current().name}. Nothing passes through a server.`
                : props.messenger.settings().relayOnly
                  ? `${current().name} is offline. What you write waits at their Lighthouses if they use yours or the official ones, since the relay is always on; if not, until you're both online.`
                  : `${current().name} is offline. What you write waits at their Lighthouses for when they're back.`
          }
          canBuzz={current().online}
          onSend={(text) => void props.messenger.send(props.friend, text)}
          onDraft={(text) => props.messenger.typing(props.friend, text.trim() !== '')}
          onBuzz={() => {
            props.messenger.buzz(props.friend)
            props.onBuzz()
          }}
          onSaveAs={
            props.saveText === undefined
              ? undefined
              : () =>
                  props.saveText?.(
                    conversationFileName(current().name),
                    conversationText(
                      current(),
                      props.messenger.isMine,
                      props.messenger.profile().handle,
                      props.now?.() ?? Date.now(),
                    ),
                  )
          }
          onClose={props.onClose}
          onAbout={props.onAbout}
          actions={props.actions?.()}
        />
      )}
    </Show>
  )
}
