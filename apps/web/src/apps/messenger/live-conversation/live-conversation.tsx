// A conversation with a real friend: the chat log as a transcript, buzzes in between, the
// typing line, and a status bar that says plainly how the words travel.
import { formatFingerprint, type PeerId } from '@pigeon/core'
import { createEffect, Show } from 'solid-js'
import type { TranscriptEntry } from '../../../ui/transcript/transcript.tsx'
import { Conversation } from '../conversation/conversation.tsx'
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
}

/** "6:38 PM", in the visitor's own time zone, like the taskbar clock. */
export function clockTime(at: number): string {
  const date = new Date(at)
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
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

export function transcriptFor(view: FriendView, self: PeerId, selfName: string) {
  const entries: TranscriptEntry[] = []
  const notes = [...view.notes]
  const flush = (upTo: number) => {
    while (notes[0] !== undefined && notes[0].after <= upTo) {
      const note = notes.shift()
      if (note === undefined) continue
      const shown = NOTES[note.kind]
      entries.push({
        kind: shown.kind,
        id: `note-${note.id}`,
        text: shown.text(view.handle, note.at),
      })
    }
  }
  view.log.entries.forEach((entry, index) => {
    flush(index)
    const own = entry.author === self
    entries.push({
      kind: 'message',
      id: entry.sig,
      from: own ? selfName : view.handle,
      own,
      text: entry.text,
    })
  })
  flush(Number.POSITIVE_INFINITY)
  return entries
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
          name={current().handle}
          fingerprint={formatFingerprint(current().fingerprint)}
          route={current().online ? 'direct, encrypted' : 'offline'}
          connected={current().online}
          entries={transcriptFor(current(), props.messenger.self, props.messenger.profile().handle)}
          typing={current().typing ? `${current().handle} is writing a message...` : ''}
          status={
            current().online
              ? `Connected directly to ${current().handle}. Nothing passes through a server.`
              : `${current().handle} is offline. What you write reaches them next time you're both online.`
          }
          canBuzz={current().online}
          onSend={(text) => void props.messenger.send(props.friend, text)}
          onDraft={(text) => props.messenger.typing(props.friend, text.trim() !== '')}
          onBuzz={() => {
            props.messenger.buzz(props.friend)
            props.onBuzz()
          }}
          onClose={props.onClose}
          onAbout={props.onAbout}
        />
      )}
    </Show>
  )
}
