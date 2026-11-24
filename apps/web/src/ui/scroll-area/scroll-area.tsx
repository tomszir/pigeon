import type { JSX } from 'solid-js'
import { classes } from '../classes/classes.ts'
import styles from './scroll-area.module.css'

/** A white, bordered, scrolling box with XP scroll bars (thin native bars in Firefox). */
export function ScrollArea(props: {
  children: JSX.Element
  class?: string
  ref?: (element: HTMLElement) => void
  /** Names the scrolling region for screen readers. */
  label: string
}) {
  return (
    <section
      ref={props.ref}
      class={classes(styles.scrollArea, props.class)}
      aria-label={props.label}
    >
      {props.children}
    </section>
  )
}
