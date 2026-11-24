// A beige 2003 CRT monitor around the screen, by the made-up Kestrel, drawn in CSS (decision 0012). It scales with the
// screen by the same whole number. The power button really turns the screen off and on.
import { createSignal, type JSX, Show } from 'solid-js'
import { classes } from '../../ui/classes/classes.ts'
import styles from './monitor.module.css'

export function Monitor(props: {
  scale: number
  left: number
  top: number
  children: JSX.Element
}) {
  const [on, setOn] = createSignal(true)
  return (
    <div
      class={styles.monitor}
      style={{ left: `${props.left}px`, top: `${props.top}px`, '--pg-scale': props.scale }}
    >
      <div class={styles.case}>
        <div class={styles.bevel}>
          <div class={styles.recess}>
            <div class={styles.tube}>
              {props.children}
              <Show when={!on()}>
                <div class={styles.off} aria-hidden="true" />
              </Show>
            </div>
          </div>
        </div>
        <div class={styles.chin}>
          {/* Kestrel is a made-up maker: the monitor is part of the world, not Pigeon's brand. */}
          <span class={styles.badge} aria-hidden="true">
            KESTREL
          </span>
          <span class={styles.model} aria-hidden="true">
            KV-1710 · 17" flat screen
          </span>
          <span class={styles.controls}>
            <span class={styles.knob} aria-hidden="true" />
            <span class={styles.knob} aria-hidden="true" />
            <span class={styles.knob} aria-hidden="true" />
            <span class={classes(styles.led, !on() && styles.ledOff)} aria-hidden="true" />
            <button
              type="button"
              class={styles.power}
              aria-label="Monitor power"
              aria-pressed={on()}
              title={on() ? 'Turn the monitor off' : 'Turn the monitor on'}
              onClick={() => setOn(!on())}
            />
          </span>
        </div>
      </div>
    </div>
  )
}
