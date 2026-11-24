import type { JSX } from 'solid-js'
import { AccessLabel, accessKeyOf, plainText } from '../access-key/access-key.tsx'
import { classes } from '../classes/classes.ts'
import styles from './button.module.css'

export interface ButtonProps {
  /** Label with an optional access key: "&Send". */
  label: string
  onClick?: (() => void) | undefined
  disabled?: boolean | undefined
  /** The dialog's default button, drawn with the focus ring and pressed by Enter. */
  isDefault?: boolean | undefined
  type?: 'button' | 'submit' | undefined
  class?: string | undefined
  style?: JSX.CSSProperties | undefined
}

export function Button(props: ButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      class={classes(styles.button, props.isDefault === true && styles.default, props.class)}
      style={props.style}
      disabled={props.disabled}
      aria-label={plainText(props.label)}
      data-access-key={accessKeyOf(props.label)}
      data-default={props.isDefault === true ? '' : undefined}
      onClick={() => props.onClick?.()}
    >
      <AccessLabel text={props.label} />
    </button>
  )
}
