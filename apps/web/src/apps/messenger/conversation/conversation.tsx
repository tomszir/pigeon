// A conversation window's insides: menus, toolbar, the "To:" line, the transcript (ending in
// the "is writing" line while the friend types) and the compose box. It draws what it is given; sample-conversation and live-conversation
// decide what that is.
import { createSignal } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { brandIcon, tangoIcon } from '../../../ui/icons/icons.ts'
import { MenuBar } from '../../../ui/menu-bar/menu-bar.tsx'
import { StatusBar } from '../../../ui/status-bar/status-bar.tsx'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { Toolbar, ToolbarButton, ToolbarSeparator } from '../../../ui/toolbar/toolbar.tsx'
import { Transcript, type TranscriptEntry } from '../../../ui/transcript/transcript.tsx'
import styles from './conversation.module.css'

export interface ConversationProps {
  name: string
  /** Shown in angle brackets after the name. */
  fingerprint: string
  /** How the friend is reached: "direct, encrypted", "offline". */
  route: string
  /** Whether the route is up, which colours it. */
  connected: boolean
  entries: readonly TranscriptEntry[]
  /** "Mika is writing a message...", or empty. */
  typing: string
  status: string
  /** A buzz needs the friend online; messages wait in the chat log. */
  canBuzz: boolean
  onSend: (text: string) => void
  onDraft?: (text: string) => void
  onBuzz: () => void
  onClose: () => void
  onAbout: () => void
}

export function Conversation(props: ConversationProps) {
  const [draft, setDraft] = createSignal('')
  const withTyping = (): readonly TranscriptEntry[] =>
    props.typing === ''
      ? props.entries
      : [...props.entries, { kind: 'typing', id: 'typing', text: props.typing }]
  const edit = (text: string) => {
    setDraft(text)
    props.onDraft?.(text)
  }
  const send = () => {
    const text = draft().trim()
    if (text === '') return
    props.onSend(text)
    edit('')
  }

  return (
    <>
      <MenuBar
        label="Conversation"
        menus={[
          { label: '&File', entries: [{ label: 'C&lose', onSelect: props.onClose }] },
          { label: '&Edit', entries: [{ label: '&Clear my draft', onSelect: () => edit('') }] },
          {
            label: '&Actions',
            entries: [
              {
                label: 'Send a &Buzz',
                shortcut: 'Ctrl+G',
                disabled: !props.canBuzz,
                onSelect: props.onBuzz,
              },
              { label: 'Send a &File...', disabled: true },
              { label: 'S&eal a letter', disabled: true },
            ],
          },
          { label: '&Tools', entries: [{ label: '&Font...', disabled: true }] },
          { label: '&Help', entries: [{ label: '&About Pigeon', onSelect: props.onAbout }] },
        ]}
      />
      <Toolbar label="Conversation actions">
        <ToolbarButton icon={tangoIcon('contact-new', 22)} label="&Invite" disabled />
        <ToolbarButton icon={tangoIcon('mail-attachment', 22)} label="Send &Files" disabled />
        <ToolbarSeparator />
        <ToolbarButton
          icon={brandIcon('buzz-22')}
          label="&Buzz!"
          disabled={!props.canBuzz}
          onClick={props.onBuzz}
        />
        <ToolbarButton icon={tangoIcon('internet-mail', 22)} label="Le&tters" disabled />
        <ToolbarButton icon={tangoIcon('internet-web-browser', 22)} label="&Homepage" disabled />
      </Toolbar>
      <p class={styles.to}>
        To: <strong>{props.name}</strong> &lt;{props.fingerprint}&gt; ·{' '}
        <span class={props.connected ? styles.route : styles.offline}>{props.route}</span>
      </p>
      <div class={styles.transcript}>
        <Transcript label={`Conversation with ${props.name}`} entries={withTyping()} />
      </div>
      <div class={styles.compose}>
        <TextField
          label={`Message to ${props.name}`}
          labelHidden
          rows={4}
          value={draft()}
          onInput={edit}
          onSubmit={send}
          class={styles.draft}
        />
        <div class={styles.send}>
          <Button label="&Send" isDefault onClick={send} class={styles.sendButton} />
          <Button label="S&eal letter" disabled />
        </div>
      </div>
      <StatusBar fields={[{ content: props.status, grow: true }]} />
    </>
  )
}
