import { createUniqueId, type JSX, Show } from 'solid-js'
import { AccessLabel, accessKeyOf } from '../access-key/access-key.tsx'
import { classes } from '../classes/classes.ts'
import { useLayout } from '../layout/layout.ts'
import styles from './check.module.css'

export interface CheckProps {
  label: string
  checked: boolean
  onChange?: ((checked: boolean) => void) | undefined
  /** A radio button in the group `name`, or a check box. */
  kind?: 'checkbox' | 'radio' | undefined
  name?: string | undefined
  disabled?: boolean | undefined
  /** A line under the label. It belongs to the label, so tapping it toggles the box too. */
  description?: JSX.Element | undefined
}

export function Check(props: CheckProps) {
  const id = createUniqueId()
  return (
    <span
      class={classes(
        styles.check,
        props.kind === 'radio' && styles.radio,
        useLayout() === 'phone' && styles.phone,
      )}
    >
      <input
        id={id}
        class={styles.input}
        type={props.kind ?? 'checkbox'}
        name={props.name}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange?.(event.currentTarget.checked)}
      />
      <label for={id} class={styles.label} data-access-key={accessKeyOf(props.label)}>
        <span class={styles.texts}>
          <span>
            <AccessLabel text={props.label} />
          </span>
          <Show when={props.description}>
            <span class={styles.description}>{props.description}</span>
          </Show>
        </span>
      </label>
    </span>
  )
}
