// A conversation with a real friend: the chat log as a transcript, buzzes in between, the
// typing line, and a status bar that says plainly how the words travel.
import { formatFingerprint, type PeerId } from '@pigeon/core'
import { createEffect, Show } from 'solid-js'
import type { MenuEntry } from '../../../ui/menu/menu.tsx'
import type { TranscriptEntry } from '../../../ui/transcript/transcript.tsx'
import { Conversation } from '../conversation/conversation.tsx'
import { FriendAvatar } from '../friend-avatar/friend-avatar.tsx'
import type { FriendView, Messenger, Note } from '../service/service.ts'

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
  /** Hands the visitor a text file to save: Save Conversation As... (M13). */
  saveText?: ((name: string, text: string) => void) | undefined
  /** Now, for the line saying when it was saved. */
  now?: (() => number) | undefined
}

/** "6:38 PM", in the visitor's own time zone, like the taskbar clock. */
export function clockTime(at: number): string {
  const date = new Date(at)
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}

/** "November 24", the day without the year, as the era's chat windows wrote it. */
export function dayName(at: number): string {
  return new Date(at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

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

/** `mine` says which entries are yours: written on any of your devices (decision 0024). */
export function transcriptFor(
  view: FriendView,
  mine: PeerId | ((author: PeerId) => boolean),
  selfName: string,
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
  view.log.entries.forEach((entry, index) => {
    flush(index)
    const own = isMine(entry.author)
    entries.push({
      kind: 'message',
      id: entry.sig,
      from: own ? selfName : view.name,
      own,
      text: entry.text,
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

/** "Conversation with Mika.txt", without characters file systems refuse. */
export function conversationFileName(name: string): string {
  const safe = [...name]
    .filter((char) => (char.codePointAt(0) ?? 0) >= 32 && !'\\/:*?"<>|'.includes(char))
    .join('')
    .trim()
  return `Conversation with ${safe === '' ? 'a friend' : safe}.txt`
}

/** The chat as plain text, one message a line with its day and time, for Save Conversation As. */
export function conversationText(
  view: FriendView,
  mine: (author: PeerId) => boolean,
  selfName: string,
  savedAt: number,
): string {
  const when = (at: number) => `${dayName(at)}, ${clockTime(at)}`
  const lines = [
    `Conversation with ${view.name} <${formatFingerprint(view.fingerprint)}>`,
    `Saved from Pigeon on ${dayName(savedAt)}, ${new Date(savedAt).getFullYear()} at ${clockTime(savedAt)}`,
    '',
  ]
  if (view.addedAt > 0)
    lines.push(`${selfName} and ${view.name} became friends on ${when(view.addedAt)}.`, '')
  for (const entry of view.log.entries)
    lines.push(`[${when(entry.at)}] ${mine(entry.author) ? selfName : view.name}: ${entry.text}`)
  if (view.removedYouAt !== undefined)
    lines.push('', `${view.name} removed you as a friend on ${when(view.removedYouAt)}.`)
  return `${lines.join('\n')}\n`
}

export function LiveConversation(props: LiveConversationProps) {
  const view = () => props.messenger.friend(props.friend)

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
          route={current().online ? 'direct, encrypted' : 'offline'}
          connected={current().online}
          entries={transcriptFor(
            current(),
            props.messenger.isMine,
            props.messenger.profile().handle,
          )}
          typing={current().typing ? `${current().name} is writing a message...` : ''}
          closed={current().removedYouAt !== undefined}
          status={
            current().removedYouAt !== undefined
              ? `${current().name} removed you. This chat stays here until you remove them too.`
              : current().online
                ? `Connected directly to ${current().name}. Nothing passes through a server.`
                : `${current().name} is offline. What you write reaches them next time you're both online.`
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
