// A beige 2003 CRT monitor around the screen, by the made-up Kestrel, drawn in CSS (decisions 0012,
// 0020). It scales with the screen by the same whole number: a slim even frame of plastic and
// dark glass, with nothing below the screen.
import type { JSX } from 'solid-js'
import styles from './monitor.module.css'

export function Monitor(props: {
  scale: number
  left: number
  top: number
  children: JSX.Element
}) {
  return (
    <div
      class={styles.monitor}
      style={{ left: `${props.left}px`, top: `${props.top}px`, '--pg-scale': props.scale }}
    >
      <div class={styles.case}>
        <div class={styles.bevel}>
          <div class={styles.recess}>
            <div class={styles.tube}>{props.children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
