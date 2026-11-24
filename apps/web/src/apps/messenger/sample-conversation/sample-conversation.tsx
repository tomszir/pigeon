// The Desktop board's sample conversation. What you type stays in this tab, and the window says
// so (brief.md, "Honest P2P").
import { createSignal } from 'solid-js'
import { tango } from '../../../ui/icons/icons.ts'
import { Progress } from '../../../ui/progress/progress.tsx'
import type { TranscriptEntry } from '../../../ui/transcript/transcript.tsx'
import { Conversation } from '../conversation/conversation.tsx'
import type { SampleConversation as Sample } from '../sample/sample.ts'
import styles from './sample-conversation.module.css'

export interface SampleConversationProps {
  conversation: Sample
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

export function SampleConversation(props: SampleConversationProps) {
  const name = props.conversation.name
  const [entries, setEntries] = createSignal<readonly TranscriptEntry[]>([
    ...props.conversation.entries,
    ...(props.conversation.scripted === true
      ? [{ kind: 'custom' as const, id: 'transfer', content: () => <SampleTransfer to={name} /> }]
      : []),
  ])
  let next = 0
  const add = (entry: TranscriptEntry) => setEntries([...entries(), entry])

  return (
    <Conversation
      name={name}
      fingerprint={props.conversation.fingerprint}
      route={props.conversation.route}
      connected={props.conversation.route !== 'offline'}
      entries={entries()}
      typing={props.conversation.scripted === true ? `${name} is writing a message...` : ''}
      status="Sample conversation: nothing leaves this tab."
      canBuzz
      onSend={(text) => {
        next += 1
        add({ kind: 'message', id: `own-${next}`, from: props.self, own: true, text })
      }}
      onBuzz={() => {
        next += 1
        add({ kind: 'buzz', id: `buzz-${next}`, text: 'You have just sent a buzz!' })
        props.onBuzz()
      }}
      onClose={props.onClose}
      onAbout={props.onAbout}
    />
  )
}
