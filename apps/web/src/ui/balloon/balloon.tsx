import { type JSX, onCleanup, onMount, Show } from 'solid-js'
import { classes } from '../classes/classes.ts'
import type { Icon } from '../icons/icons.ts'
import styles from './balloon.module.css'

export const BALLOON_TIMEOUT_MS = 10_000

export interface BalloonProps {
  title: string
  icon?: Icon | undefined
  children: JSX.Element
  onClose: () => void
  /** Clicking the balloon does this and closes it, as the era's tray balloons did. */
  onClick?: (() => void) | undefined
  /** Hides itself after this long; 10 seconds unless set. */
  timeoutMs?: number | undefined
  class?: string | undefined
}

/** A tray notice. The shell shows at most one at a time. */
export function Balloon(props: BalloonProps) {
  let timer: ReturnType<typeof setTimeout> | undefined
  onMount(() => {
    timer = setTimeout(() => props.onClose(), props.timeoutMs ?? BALLOON_TIMEOUT_MS)
  })
  onCleanup(() => clearTimeout(timer))

  const click = (event: MouseEvent) => {
    if (props.onClick === undefined) return
    if (event.target instanceof Element && event.target.closest(`.${styles.close}`) !== null) return
    props.onClick()
    props.onClose()
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the body's own button takes the keyboard.
    <div
      role="status"
      class={classes(styles.balloon, props.onClick !== undefined && styles.clickable, props.class)}
      onClick={click}
    >
      <div class={styles.head}>
        <Show when={props.icon}>
          {(icon) => <img src={icon().src} alt="" width={icon().size} height={icon().size} />}
        </Show>
        <strong class={styles.title}>{props.title}</strong>
        <button
          type="button"
          class={styles.close}
          aria-label="Close notification"
          onClick={() => props.onClose()}
        >
          <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true">
            <path d="M1 1 L6 6 M6 1 L1 6" stroke="#444444" stroke-width="1.2" />
          </svg>
        </button>
      </div>
      <p class={styles.body}>
        <Show when={props.onClick} fallback={props.children}>
          <button type="button" class={styles.action}>
            {props.children}
          </button>
        </Show>
      </p>
    </div>
  )
}
