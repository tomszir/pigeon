import { For, type JSX } from 'solid-js'
import { classes } from '../classes/classes.ts'
import { Marquee } from '../marquee/marquee.tsx'
import styles from './status-bar.module.css'

export interface StatusField {
  readonly content: JSX.Element
  /** Takes up the spare width. Usually the first field. */
  readonly grow?: boolean
}

export function StatusBar(props: { fields: readonly StatusField[] }) {
  return (
    <div class={styles.statusBar} role="status">
      <For each={props.fields}>
        {(field) => (
          <span class={classes(styles.field, field.grow === true && styles.grow)}>
            <Marquee>{field.content}</Marquee>
          </span>
        )}
      </For>
    </div>
  )
}
