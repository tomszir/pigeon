// The small icon after a message that says how it got or is getting there. Its words are
// there for screen readers, in a tooltip on hover, and pinned open by a click or tap.
import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { classes } from '../classes/classes.ts'
import styles from './message-way.module.css'

/** `letter` is the envelope on a friend's message that came by letter. */
export type WayState = 'sealing' | 'left' | 'has' | 'waiting' | 'retrying' | 'letter'

export interface MessageWay {
  readonly state: WayState
  /** What the icon means, in words: "Left at Loft for when Jo's back". */
  readonly text: string
  /** Said under the message in words, as the newest one of yours and one needing attention are. */
  readonly spelled: boolean
  /** Something to do about it, drawn as a link after the words under the message: "Try Again". */
  readonly action?: { readonly label: string; readonly run: () => void }
}

/** How long a mouse rests on the icon before its words show. */
export const WAY_HOVER_MS = 300

export function MessageWay(props: { way: MessageWay }) {
  const [hovered, setHovered] = createSignal(false)
  const [pinned, setPinned] = createSignal(false)
  let anchor: HTMLSpanElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const rest = (event: PointerEvent) => {
    // A finger has no hover: it taps, which pins the words instead.
    if (event.pointerType !== 'mouse') return
    clearTimeout(timer)
    timer = setTimeout(() => setHovered(true), WAY_HOVER_MS)
  }
  const leave = () => {
    clearTimeout(timer)
    setHovered(false)
  }
  onCleanup(() => clearTimeout(timer))

  // A pinned tooltip closes on a press anywhere else.
  createEffect(() => {
    if (!pinned()) return
    const away = (event: PointerEvent) => {
      if (!anchor?.contains(event.target as Node)) setPinned(false)
    }
    document.addEventListener('pointerdown', away)
    onCleanup(() => document.removeEventListener('pointerdown', away))
  })

  const icon = () => classes(styles.icon, styles[props.way.state])

  return (
    <Show
      when={!props.way.spelled}
      fallback={<span class={classes(styles.anchor, icon())} aria-hidden="true" />}
    >
      <span ref={anchor} class={styles.anchor} onPointerEnter={rest} onPointerLeave={leave}>
        <button
          type="button"
          class={styles.button}
          onClick={() => setPinned((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setPinned(false)
          }}
        >
          <span class={icon()} aria-hidden="true" />
          <span class={styles.words}>{props.way.text}</span>
        </button>
        <Show when={hovered() || pinned()}>
          <span class={styles.tip} aria-hidden="true">
            {props.way.text}
          </span>
        </Show>
      </span>
    </Show>
  )
}
