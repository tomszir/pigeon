// What Add a Friend shows while it works: a paper plane flying between you and your friend, the steps
// done so far, a bar that keeps moving, and how long until it gives up. Each step is a real one
// from the handshake (core's OpenStep), so a stuck step says where it is stuck.
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js'
import { Avatar } from '../../../ui/avatar/avatar.tsx'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { brand, tango } from '../../../ui/icons/icons.ts'
import { useLayout } from '../../../ui/layout/layout.ts'
import { Progress } from '../../../ui/progress/progress.tsx'
import styles from './connecting.module.css'

export type StepState = 'done' | 'current' | 'pending'

export interface ConnectingStep {
  readonly label: JSX.Element
  readonly state: StepState
}

export interface ConnectingProps {
  /** Who is at the far end, under the friend's icon. */
  friend: string
  /** Your pixel pigeon at your end, and theirs once you know who they are; icons stand in. */
  you?: JSX.Element
  them?: JSX.Element
  steps: readonly ConnectingStep[]
  /** When this wait started and how long it lasts, for the countdown. */
  startedAt: number
  timeoutMs: number
  now: () => number
  /** Shown once the wait has gone on this long, if the current step hasn't moved. */
  hint?: { readonly afterMs: number; readonly text: string } | undefined
  onCancel: () => void
}

export function Connecting(props: ConnectingProps) {
  const phone = useLayout() === 'phone'
  const [now, setNow] = createSignal(props.now())
  const timer = setInterval(() => setNow(props.now()), 1000)
  onCleanup(() => clearInterval(timer))

  const elapsed = () => Math.max(0, now() - props.startedAt)
  const left = () => Math.max(0, Math.ceil((props.timeoutMs - elapsed()) / 1000))
  const current = () => props.steps.find((step) => step.state === 'current')

  return (
    <div class={classes(styles.connecting, phone && styles.phone)}>
      <div class={styles.content}>
        <div class={styles.scene} aria-hidden="true">
          <figure class={styles.end}>
            {props.you ?? (
              <Avatar
                traits={undefined}
                size={32}
                name="You"
                decorative
                placeholder={<img src={brand('pigeon-32')} alt="" width="32" height="32" />}
              />
            )}
            <figcaption>You</figcaption>
          </figure>
          <div class={styles.track}>
            <img class={styles.plane} src={brand('paper-plane-24')} alt="" width="24" height="24" />
          </div>
          <figure class={styles.end}>
            {/* Framed like a bird, so both ends are the same size and in the same place. */}
            {props.them ?? (
              <Avatar
                traits={undefined}
                size={32}
                name={props.friend}
                decorative
                placeholder={<img src={tango('contact-new', 32)} alt="" width="32" height="32" />}
              />
            )}
            <figcaption>{props.friend}</figcaption>
          </figure>
        </div>

        <ol class={styles.steps}>
          <For each={props.steps}>
            {(step) => (
              <li
                class={classes(styles.step, styles[step.state])}
                aria-current={step.state === 'current' ? 'step' : undefined}
              >
                <span class={styles.mark} aria-hidden="true" />
                <span>{step.label}</span>
              </li>
            )}
          </For>
        </ol>

        <Progress label={`${current() === undefined ? 'Working' : 'Waiting'}...`} />
        <p class={styles.countdown} aria-live="off">
          Pigeon stops trying in {left()} {left() === 1 ? 'second' : 'seconds'}.
        </p>
        <Show when={props.hint !== undefined && elapsed() >= (props.hint?.afterMs ?? 0)}>
          <p class={styles.hint} role="status">
            <img src={tango('dialog-information', 16)} alt="" width="16" height="16" />
            {props.hint?.text}
          </p>
        </Show>
      </div>
      <div class={styles.buttons}>
        <Button label="Cancel" onClick={props.onCancel} class={phone ? styles.wide : undefined} />
      </div>
    </div>
  )
}
