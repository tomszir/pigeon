import { createUniqueId } from 'solid-js'
import { AccessLabel, accessKeyOf } from '../access-key/access-key.tsx'
import { classes } from '../classes/classes.ts'
import styles from './check.module.css'

export interface CheckProps {
  label: string
  checked: boolean
  onChange?: ((checked: boolean) => void) | undefined
  /** A radio button in the group `name`, or a check box. */
  kind?: 'checkbox' | 'radio' | undefined
  name?: string | undefined
  disabled?: boolean | undefined
}

export function Check(props: CheckProps) {
  const id = createUniqueId()
  return (
    <span class={classes(styles.check, props.kind === 'radio' && styles.radio)}>
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
        <span>
          <AccessLabel text={props.label} />
        </span>
      </label>
    </span>
  )
}
