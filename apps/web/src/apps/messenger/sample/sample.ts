// The sample from the Desktop board, shown when the visitor asks to see how a conversation will
// look. Nothing here is real and the UI says so (brief.md, "Honest P2P").
import type { ContactGroup, Presence } from '../../../ui/contact-list/contact-list.tsx'
import type { TranscriptEntry } from '../../../ui/transcript/transcript.tsx'

export const SAMPLE_SELF = {
  name: 'Rook',
  personalMessage: 'building a messenger, ironically',
  lettersCarried: 3,
}

export const SAMPLE_GROUPS: readonly ContactGroup[] = [
  {
    id: 'online',
    label: 'Online',
    contacts: [
      { id: 'mika', name: 'Mika', presence: 'online' },
      { id: 'ren', name: 'Ren', presence: 'online', note: '- 2 letters' },
      { id: 'ola', name: 'Ola', presence: 'away', note: '(Away)' },
    ],
  },
  {
    id: 'always-on',
    label: 'Always on',
    contacts: [
      { id: 'lighthouse', name: 'Lighthouse', presence: 'peer', note: '(peer)' },
      { id: 'coo', name: 'Coo', presence: 'bot', note: '(bot)' },
    ],
  },
  {
    id: 'offline',
    label: 'Offline',
    contacts: [
      { id: 'jo', name: 'Jo', presence: 'offline', note: '- letter waiting' },
      { id: 'sam', name: 'Sam', presence: 'offline' },
    ],
  },
]

export interface SampleConversation {
  readonly name: string
  readonly fingerprint: string
  readonly route: string
  readonly entries: readonly TranscriptEntry[]
  /** The board's half-sent sunset.jpg and "is writing" line, for the scripted one only. */
  readonly scripted?: boolean
}

export const SAMPLE_CONVERSATIONS: Readonly<Record<string, SampleConversation>> = {
  mika: {
    scripted: true,
    name: 'Mika',
    fingerprint: '7f3a…91c2',
    route: 'direct, encrypted',
    entries: [
      {
        kind: 'message',
        id: 'm1',
        from: 'Mika',
        own: false,
        text: "wait, there's really no server??",
      },
      {
        kind: 'message',
        id: 'm2',
        from: 'Rook',
        own: true,
        text: 'nope. your browser is talking straight to mine',
      },
      { kind: 'message', id: 'm3', from: 'Mika', own: false, text: 'prove it' },
      { kind: 'buzz', id: 'm4', text: 'You have just sent a buzz!' },
      {
        kind: 'message',
        id: 'm5',
        from: 'Mika',
        own: false,
        text: 'ok my whole window just shook. send the sunset pic',
      },
    ],
  },
}

/** What the "To:" line says about how each kind of contact is reached. */
const ROUTES: Record<Presence, string> = {
  online: 'direct, encrypted',
  away: 'direct, encrypted',
  offline: 'offline',
  peer: 'always-on peer, encrypted',
  bot: 'runs in your own tab',
}

/** Made-up fingerprints for the sample contacts without a scripted conversation. */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  ren: '2c90…4e1b',
  ola: 'a41d…07fe',
  lighthouse: '5b6e…c3a0',
  coo: 'e017…9d42',
  jo: '93fa…1b77',
  sam: '0d4c…e8a5',
}

/** The scripted conversation, or an empty one for any other sample contact. */
export function sampleConversation(contactId: string): SampleConversation | undefined {
  const scripted = SAMPLE_CONVERSATIONS[contactId]
  if (scripted !== undefined) return scripted
  const contact = SAMPLE_GROUPS.flatMap((group) => group.contacts).find(
    (candidate) => candidate.id === contactId,
  )
  if (contact === undefined) return undefined
  const offline: readonly TranscriptEntry[] = [
    {
      kind: 'system',
      id: 'offline',
      text: `${contact.name} is offline. Letters for offline friends arrive in a later version.`,
    },
  ]
  return {
    name: contact.name,
    fingerprint: FINGERPRINTS[contact.id] ?? '0000…0000',
    route: ROUTES[contact.presence],
    entries: contact.presence === 'offline' ? offline : [],
  }
}
