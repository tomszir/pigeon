import type { JSX } from 'solid-js'
import { classes } from '../classes/classes.ts'
import styles from './group-box.module.css'

export function GroupBox(props: { legend: string; children: JSX.Element; class?: string }) {
  return (
    <fieldset class={classes(styles.groupBox, props.class)}>
      <legend class={styles.legend}>{props.legend}</legend>
      {props.children}
    </fieldset>
  )
}
