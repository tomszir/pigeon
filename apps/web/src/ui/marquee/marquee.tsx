// One line of text that doesn't fit drifts to its end and back, pausing at each, instead of
// being cut off. Text that fits stays still, and so does everything when motion is reduced.
import { createSignal, type JSX, onCleanup, onMount } from 'solid-js'
import { classes } from '../classes/classes.ts'
import styles from './marquee.module.css'

/** How fast the text drifts, in px per second; slow enough to read while it moves. */
export const MARQUEE_SPEED = 25
/** Seconds spent still at each end, before turning round. */
export const MARQUEE_PAUSE = 1.5

/** One leg of the trip, end to end and the pause at the far end, for a given overflow. */
export const marqueeLeg = (overflow: number): number =>
  Math.round((overflow / MARQUEE_SPEED + MARQUEE_PAUSE) * 10) / 10

export function Marquee(props: { children: JSX.Element; class?: string | undefined }) {
  const [overflow, setOverflow] = createSignal(0)
  let outer: HTMLSpanElement | undefined
  let inner: HTMLSpanElement | undefined

  onMount(() => {
    const measure = () => {
      if (outer === undefined || inner === undefined) return
      setOverflow(Math.max(0, Math.ceil(inner.scrollWidth - outer.clientWidth)))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (outer !== undefined) observer.observe(outer)
    if (inner !== undefined) observer.observe(inner)
    onCleanup(() => observer.disconnect())
  })

  return (
    <span class={classes(styles.marquee, props.class)} ref={outer}>
      <span
        ref={inner}
        class={styles.text}
        data-moving={overflow() > 0 ? '' : undefined}
        style={
          overflow() > 0
            ? {
                '--marquee-shift': `-${overflow()}px`,
                '--marquee-leg': `${marqueeLeg(overflow())}s`,
              }
            : {}
        }
      >
        {props.children}
      </span>
    </span>
  )
}
