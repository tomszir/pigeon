import { Show } from 'solid-js'
import { classes } from '../classes/classes.ts'
import styles from './progress.module.css'

export interface ProgressProps {
  label: string
  /** 0 to 100; leave out for an indeterminate bar. */
  value?: number | undefined
  class?: string | undefined
}

export function Progress(props: ProgressProps) {
  const clamped = () => Math.min(100, Math.max(0, props.value ?? 0))
  return (
    <div
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.value === undefined ? undefined : clamped()}
      class={classes(styles.progress, props.class)}
    >
      <Show when={props.value !== undefined} fallback={<div class={styles.slider} />}>
        <div class={styles.value} style={{ width: `${clamped()}%` }} />
      </Show>
    </div>
  )
}
