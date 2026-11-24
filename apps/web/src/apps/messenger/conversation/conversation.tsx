// A conversation window. In M1 it only plays the sample: what you type stays in this tab.
import { createSignal } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { brandIcon, tango, tangoIcon } from '../../../ui/icons/icons.ts'
import { MenuBar } from '../../../ui/menu-bar/menu-bar.tsx'
import { Progress } from '../../../ui/progress/progress.tsx'
import { StatusBar } from '../../../ui/status-bar/status-bar.tsx'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { Toolbar, ToolbarButton, ToolbarSeparator } from '../../../ui/toolbar/toolbar.tsx'
import { Transcript, type TranscriptEntry } from '../../../ui/transcript/transcript.tsx'
import type { SampleConversation } from '../sample/sample.ts'
import styles from './conversation.module.css'

export interface ConversationProps {
  conversation: SampleConversation
  self: string
  /** Shakes this window (the shell decides shake or flash). */
  onBuzz: () => void
  onClose: () => void
  onAbout: () => void
}

/** The file transfer from the board, frozen at 64%. */
function SampleTransfer(props: { to: string }) {
  return (
    <div class={styles.transfer}>
      <img src={tango('image-x-generic', 32)} alt="" width="32" height="32" />
      <div class={styles.detail}>
        <span>
          Sending "<strong>sunset.jpg</strong>" (2.4 MB) directly to {props.to}.
        </span>
        <Progress label="sunset.jpg transfer" value={64} class={styles.bar} />
        <span>64% · about 2 seconds left</span>
      </div>
    </div>
  )
}

export function Conversation(props: ConversationProps) {
  const name = props.conversation.name
  const [draft, setDraft] = createSignal('')
  const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>([
    ...props.conversation.entries,
    ...(props.conversation.scripted === true
      ? [{ kind: 'custom' as const, id: 'transfer', content: () => <SampleTransfer to={name} /> }]
      : []),
  ])
  let next = 0
  const add = (entry: TranscriptEntry) => setEntries([...entries(), entry])

  const send = () => {
    const text = draft().trim()
    if (text === '') return
    next += 1
    add({ kind: 'message', id: `own-${next}`, from: props.self, own: true, text })
    setDraft('')
  }

  const buzz = () => {
    next += 1
    add({ kind: 'buzz', id: `buzz-${next}`, text: 'You have just sent a buzz!' })
    props.onBuzz()
  }

  return (
    <>
      <MenuBar
        label="Conversation"
        menus={[
          { label: '&File', entries: [{ label: 'C&lose', onSelect: props.onClose }] },
          { label: '&Edit', entries: [{ label: '&Clear my draft', onSelect: () => setDraft('') }] },
          {
            label: '&Actions',
            entries: [
              { label: 'Send a &Buzz', shortcut: 'Ctrl+G', onSelect: buzz },
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
        <ToolbarButton icon={brandIcon('buzz-22')} label="&Buzz!" onClick={buzz} />
        <ToolbarButton icon={tangoIcon('internet-mail', 22)} label="Le&tters" disabled />
        <ToolbarButton icon={tangoIcon('internet-web-browser', 22)} label="&Homepage" disabled />
      </Toolbar>
      <p class={styles.to}>
        To: <strong>{name}</strong> &lt;{props.conversation.fingerprint}&gt; ·{' '}
        <span class={styles.route}>{props.conversation.route}</span>
      </p>
      <div class={styles.transcript}>
        <Transcript label={`Conversation with ${name}`} entries={entries()} />
      </div>
      <p class={styles.typing}>
        {props.conversation.scripted === true ? `${name} is writing a message...` : '\u00a0'}
      </p>
      <div class={styles.compose}>
        <TextField
          label={`Message to ${name}`}
          labelHidden
          rows={4}
          value={draft()}
          onInput={setDraft}
          onSubmit={send}
          class={styles.draft}
        />
        <div class={styles.send}>
          <Button label="&Send" isDefault onClick={send} class={styles.sendButton} />
          <Button label="S&eal letter" disabled />
        </div>
      </div>
      <StatusBar
        fields={[
          { content: 'Sample conversation: nothing leaves this tab.', grow: true },
          { content: '38 ms' },
        ]}
      />
    </>
  )
}
