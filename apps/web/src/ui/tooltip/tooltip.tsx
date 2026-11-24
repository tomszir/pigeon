import { createSignal, createUniqueId, type JSX, onCleanup, Show } from 'solid-js'
import styles from './tooltip.module.css'

export const TOOLTIP_DELAY_MS = 500

/** Shows `text` under its child after the pointer rests on it for half a second. */
export function Tooltip(props: { text: string; children: JSX.Element }) {
  const id = createUniqueId()
  const [shown, setShown] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  const hide = () => {
    clearTimeout(timer)
    setShown(false)
  }
  const show = () => {
    clearTimeout(timer)
    timer = setTimeout(() => setShown(true), TOOLTIP_DELAY_MS)
  }
  onCleanup(() => clearTimeout(timer))

  return (
    <span
      class={styles.tooltipAnchor}
      aria-describedby={id}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
    >
      {props.children}
      <Show when={shown()}>
        <span id={id} role="tooltip" class={styles.tooltip}>
          {props.text}
        </span>
      </Show>
    </span>
  )
}
