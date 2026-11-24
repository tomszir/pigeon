// What Add a Friend shows while it works: a paper plane flying between you and your friend, the steps
// done so far, a bar that keeps moving, and how long until it gives up. Each step is a real one
// from the handshake (core's OpenStep), so a stuck step says where it is stuck.
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js'
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
  steps: readonly ConnectingStep[]
  /** When this wait started and how long it lasts, for the countdown. */
  startedAt: number
  timeoutMs: number
  now: () => number
  /** Shown once the wait has gone on this long, if the current step hasn't moved. */
  hint?: { readonly afterMs: number; readonly text: string } | undefined
  onCancel: () => void
}

/**
 * A paper plane in big pixels, nose to the right, drawn for Pigeon (decision 0007). Each pixel is
 * one unit of the viewBox, so it stays crisp at any whole-number scale.
 */
function PaperPlane() {
  return (
    <svg
      class={styles.plane}
      width="32"
      height="22"
      viewBox="0 0 16 11"
      shape-rendering="crispEdges"
      aria-hidden="true"
    >
      <path fill="#ffffff" d="M1 1h1v1h-1zM2 2h2v1h-2zM2 3h5v1h-5zM3 4h7v1h-7zM3 5h10v1h-10z" />
      <path fill="#c9d6ee" d="M4 7h7v1h-7zM3 8h4v1h-4zM3 9h1v1h-1z" />
      <path fill="#7f97c9" d="M4 6h10v1h-10z" />
      <path
        fill="#24418f"
        d="M0 0h2v1h-2zM0 1h1v1h-1zM2 1h2v1h-2zM1 2h1v1h-1zM4 2h3v1h-3zM1 3h1v1h-1zM7 3h3v1h-3zM2 4h1v1h-1zM10 4h3v1h-3zM2 5h1v1h-1zM13 5h2v1h-2zM3 6h1v1h-1zM14 6h2v1h-2zM3 7h1v1h-1zM11 7h3v1h-3zM2 8h1v1h-1zM7 8h3v1h-3zM2 9h1v1h-1zM4 9h3v1h-3zM2 10h2v1h-2z"
      />
    </svg>
  )
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
            <img src={brand('pigeon-32')} alt="" width="32" height="32" />
            <figcaption>You</figcaption>
          </figure>
          <div class={styles.track}>
            <PaperPlane />
          </div>
          <figure class={styles.end}>
            <img src={tango('contact-new', 32)} alt="" width="32" height="32" />
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
